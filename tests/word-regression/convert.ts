// 把任意 PDF / 图片用 App 的转 Word 动作转一遍（现场识别，不用记录），画出来和原页并排看。
// 用法：npx tsx tests/word-regression/convert.ts --out <目录> [--lang eng] [--pages 1,2] <文件…>
// 文件名后面可以带 #页码（从 1 起，逗号分开）只转这几页、@语言 指定这个文件的识别语言，例如 invoice.pdf#1,3@deu。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { textKept } from './lib/checks';
import { convertPage, renderPdf } from './lib/convert';
import { liveOcr } from './lib/ocr';
import { pdfClient } from './lib/pdfjs';
import { renderDocx, writeIndex, type Row } from './lib/render';

const args = process.argv.slice(2);
const take = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, v] = args.splice(i, 2);
  return v;
};
const out = resolve(take('--out') ?? 'word-convert-out');
const lang = take('--lang') ?? 'eng';
const defaultPages = take('--pages');
const noRender = args.includes('--no-render') && !!args.splice(args.indexOf('--no-render'), 1);
mkdirSync(out, { recursive: true });

const rows: Row[] = [];
const summary: Record<string, unknown>[] = [];
const client = await pdfClient();
try {
  for (const spec of args) {
    const [path, fileLang] = spec.split('@') as [string, string | undefined];
    const [file, pageSpec] = path.split('#') as [string, string | undefined];
    const name = basename(file).replace(/\.[^.]+$/, '');
    const wanted = (pageSpec ?? defaultPages)?.split(',').map(Number);
    const isPdf = /\.pdf$/i.test(file);
    const pages = isPdf
      ? await renderPdf(
          client,
          resolve(file),
          wanted?.map((p) => p - 1),
        )
      : [null];
    for (const page of pages) {
      const id = page ? `${name}-p${page.index + 1}` : name;
      const dir = `${out}/${id}`;
      const started = Date.now();
      const row: Row = { dir: id, title: id, subtitle: '', status: 'ok', notes: [], renders: [] };
      try {
        const converted = await convertPage({
          client,
          dir,
          image: page ? Buffer.from(page.data, 'base64') : new Uint8Array(readFileSync(file)),
          ...(page ? { pdf: { path: resolve(file), page } } : {}),
          ocr: liveOcr,
          lang: fileLang ?? lang,
          locale: 'en',
          name: id,
        });
        writeFileSync(`${dir}/ocr-lines.json`, JSON.stringify(converted.ocr));
        const kept = textKept().run(converted);
        if (kept) row.notes.push(kept);
        row.subtitle = `${converted.paras.length} paragraphs, ${((Date.now() - started) / 1000).toFixed(1)} s`;
      } catch (e) {
        row.status = 'fail';
        row.notes.push(String(e instanceof Error ? e.message : e));
      }
      if (!noRender) row.renders = renderDocx(dir);
      rows.push(row);
      summary.push({ id, status: row.status, notes: row.notes, renders: row.renders.length });
      console.log(`${row.status.padEnd(4)} ${id} ${row.subtitle} ${row.notes.join(' | ')}`);
    }
  }
} finally {
  await client.close();
}
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
writeIndex(`${out}/index.html`, `Word conversion — ${rows.length} pages`, rows);
console.log(`Review: ${out}/index.html`);
