// 把 pages/<套件>/ 里的单页来源拼成 pdfs/<套件>.pdf，并写 pdfs/<套件>.json（第几页是哪个用例、来源的 sha256）。
// 来源按文件名排序（NN-用例名.扩展名）：
//   .html       Chrome 打印成 PDF（数字 PDF：有文字层和矢量线）
//   .scan.html  先打印，再画成 200dpi 的图、略微转斜、加一点噪点，只放图片（模拟扫描件）
//   .pdf        直接取第一页（公开文档里截出的一页）
//   .jpg/.png   图片铺满一页（照片、扫描件）
// 用法：npx tsx tests/word-regression/build-pdfs.ts [套件名…]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { ENV, HERE, need } from './lib/env';
import { CK, decode } from './lib/ocr';
import { pdfClient } from './lib/pdfjs';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const suites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(`${HERE}/pages`, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

const tmp = mkdtempSync(join(tmpdir(), 'word-regression-'));
const client = await pdfClient();

function printHtml(file: string): Uint8Array {
  const out = join(tmp, `${sha(Buffer.from(file)).slice(0, 12)}.pdf`);
  execFileSync(
    need(ENV.chrome, 'Chrome'),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${out}`,
      `file://${file}`,
    ],
    { stdio: 'ignore', timeout: 60000 },
  );
  return new Uint8Array(readFileSync(out));
}

/** 画成图、转斜、加噪点：同一个来源每次得到同样的字节（噪点用固定的种子）。 */
async function scanOf(pdf: Uint8Array, seed: string) {
  const file = join(tmp, `${seed}.pdf`);
  writeFileSync(file, pdf);
  const [page] = await client.call<{ data: string; paper: { width: number; height: number } }[]>(
    'render',
    { file: 'input', maxSide: 2339, quality: 0.95, pages: [0] },
    { input: file },
  );
  const im = decode(Buffer.from(page!.data, 'base64'));
  const w = im.width();
  const h = im.height();
  const s = CK.MakeSurface(w, h);
  const c = s.getCanvas();
  c.clear(CK.Color(250, 249, 245, 1));
  c.save();
  c.rotate(0.6, w / 2, h / 2);
  c.drawImage(im, 0, 0, null);
  c.restore();
  s.flush();
  const snap = s.makeImageSnapshot();
  const px = new Uint8Array(
    snap.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    }),
  );
  let r = parseInt(seed.slice(0, 8), 16) || 1;
  for (let i = 0; i < px.length; i += 4) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    const n = ((r >> 16) % 17) - 8;
    for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, px[i + k]! + n));
  }
  const noisy = CK.MakeImage(
    {
      width: w,
      height: h,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    },
    px,
    w * 4,
  );
  const jpg = noisy.encodeToBytes(CK.ImageFormat.JPEG, 80);
  noisy.delete();
  snap.delete();
  s.dispose();
  im.delete();
  return { jpg: new Uint8Array(jpg), paper: page!.paper };
}

try {
  for (const suite of suites) {
    const dir = `${HERE}/pages/${suite}`;
    const out = await PDFDocument.create();
    const manifest: { page: number; id: string; source: string; sha256: string }[] = [];
    for (const f of readdirSync(dir)
      .filter((f) => !f.startsWith('.'))
      .sort()) {
      const m = /^\d+-(.+?)(\.scan)?\.(html|pdf|jpg|png)$/.exec(f);
      if (!m) continue;
      const [, id, scan, ext] = m as unknown as [string, string, string | undefined, string];
      const path = `${dir}/${f}`;
      const bytes = new Uint8Array(readFileSync(path));
      if (ext === 'html' && !scan) {
        const src = await PDFDocument.load(printHtml(path));
        const [p] = await out.copyPages(src, [0]);
        out.addPage(p!);
      } else if (ext === 'pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const [p] = await out.copyPages(src, [0]);
        out.addPage(p!);
      } else {
        let jpg: Uint8Array;
        let paper: { width: number; height: number };
        if (ext === 'html') {
          ({ jpg, paper } = await scanOf(printHtml(path), sha(bytes)));
        } else {
          const im = decode(bytes);
          paper = { width: 595, height: (595 * im.height()) / im.width() };
          im.delete();
          jpg = bytes;
        }
        const page = out.addPage([paper.width, paper.height]);
        const image = ext === 'png' ? await out.embedPng(jpg) : await out.embedJpg(jpg);
        page.drawImage(image, { x: 0, y: 0, width: paper.width, height: paper.height });
      }
      manifest.push({ page: out.getPageCount(), id, source: f, sha256: sha(bytes) });
    }
    // 固定元数据，同样的来源拼出同样的字节。
    const epoch = new Date('2026-01-01T00:00:00Z');
    out.setCreationDate(epoch);
    out.setModificationDate(epoch);
    out.setProducer('word-regression');
    out.setCreator('word-regression');
    writeFileSync(`${HERE}/pdfs/${suite}.pdf`, await out.save({ useObjectStreams: false }));
    writeFileSync(`${HERE}/pdfs/${suite}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${suite}.pdf: ${manifest.length} pages`);
  }
} finally {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
}
