// PDF 转 Word 的防倒退测试：pdfs/ 里每一页是一个用例（cases.ts），用 App 里真正的转换动作
// OCR_IMPLS['ocr.toWord'] 转，再查转出来的 DocDoc 和 docx。
// 用法见 README.md：npx tsx tests/word-regression/run.ts [--only a,b] [--record] [--render]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CASES } from './cases';
import { textKept } from './lib/checks';
import { convertPage, renderPdf } from './lib/convert';
import { HERE, need } from './lib/env';
import { OcrStore } from './lib/ocr';
import { pdfClient } from './lib/pdfjs';
import { renderDocx, writeIndex } from './lib/render';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg('--only')?.split(',');
const record = process.argv.includes('--record');
const render = process.argv.includes('--render');
const OUT = resolve(arg('--out') ?? `${HERE}/.out`);
const ids = new Set<string>();
for (const c of CASES) {
  if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
  ids.add(c.id);
}
const selected = CASES.filter((c) => !only || only.includes(c.id) || only.includes(c.suite));
if (!selected.length) throw new Error(`no case matches ${only?.join(',')}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

interface Result {
  id: string;
  suite: string;
  page: number;
  what: string;
  fix: string;
  failures: string[];
  known?: string;
  error?: string;
}
const results: Result[] = [];
const client = await pdfClient();
try {
  for (const suite of [...new Set(selected.map((c) => c.suite))]) {
    const pdfPath = need(`${HERE}/pdfs/${suite}.pdf`, 'suite PDF');
    const manifest: { page: number; id: string; sha256: string }[] = JSON.parse(
      readFileSync(`${HERE}/pdfs/${suite}.json`, 'utf8'),
    );
    // 一份 PDF 只渲染一次。
    const pages = await renderPdf(client, pdfPath);
    for (const c of selected.filter((x) => x.suite === suite)) {
      const entry = manifest.find((m) => m.id === c.id);
      const result: Result = {
        id: c.id,
        suite,
        page: entry?.page ?? 0,
        what: c.what,
        fix: c.fix,
        failures: [],
        ...(c.knownFailure ? { known: c.knownFailure } : {}),
      };
      results.push(result);
      const page = entry && pages[entry.page - 1];
      if (!entry || !page) {
        result.error = `${suite}.pdf has no page for ${c.id} (run build-pdfs.ts)`;
        continue;
      }
      const store = new OcrStore(`${HERE}/fixtures/${suite}/${c.id}.json`, entry.sha256, record);
      try {
        const converted = await convertPage({
          client,
          dir: `${OUT}/${c.id}`,
          image: Buffer.from(page.data, 'base64'),
          pdf: { path: pdfPath, page },
          ocr: store,
          lang: c.lang ?? 'eng',
          locale: c.locale ?? 'en',
          name: `${suite}-${entry.page}`,
        });
        for (const check of [textKept(c.recall, c.extra), ...c.checks]) {
          let problem: string | null;
          try {
            problem = check.run(converted);
          } catch (e) {
            problem = `threw ${String(e)}`;
          }
          if (problem) result.failures.push(`${check.name}: ${problem}`);
        }
      } catch (e) {
        result.error = String(e instanceof Error ? (e.stack ?? e.message) : e);
      } finally {
        store.save();
      }
    }
  }
} finally {
  await client.close();
}

let failed = 0;
let nowPassing = 0;
for (const r of results) {
  const bad = !!r.error || r.failures.length > 0;
  if (!r.known && bad) failed++;
  if (r.known && !bad) nowPassing++;
  const mark = r.known ? (bad ? 'KNOWN' : 'PASSES') : bad ? 'FAIL' : 'ok';
  console.log(`${mark.padEnd(6)} ${r.id}  (${r.suite}.pdf p${r.page}, ${r.fix})`);
  if (!bad) continue;
  for (const f of r.failures) console.log(`         - ${f}`);
  if (r.error)
    console.log(`         - error: ${r.error.split('\n').slice(0, 4).join('\n           ')}`);
  if (r.known) console.log(`         (known failure: ${r.known})`);
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(
  `\n${results.length} cases, ${failed} failed` +
    (nowPassing ? `, ${nowPassing} known failures now pass (remove knownFailure)` : '') +
    `. Output: ${OUT}`,
);

if (render) {
  writeIndex(
    `${OUT}/index.html`,
    `Word regression — ${results.length} cases, ${failed} failed`,
    results.map((r) => ({
      dir: r.id,
      title: r.id,
      subtitle: `${r.suite}.pdf p${r.page} · ${r.fix} — ${r.what}`,
      status: r.error || r.failures.length ? (r.known ? 'known' : 'fail') : 'ok',
      notes: [...r.failures, ...(r.error ? [r.error.split('\n')[0]!] : [])],
      renders: renderDocx(`${OUT}/${r.id}`),
    })),
  );
  console.log(`Rendered: ${OUT}/index.html`);
}
process.exitCode = failed ? 1 : 0;
