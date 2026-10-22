import { packPage, WITH_RESOLVERS_POLYFILL } from './common';

// PDF 预览包页面：pdf.js（legacy ESM 版本）从 blob: 地址加载，worker 失败时 pdf.js 自己退回主线程。
// cmap、字体和解码器通过 BinaryDataFactory 按需向 App 要（只送这个文件用到的）。
// 只渲染和读文字：不加载 pdf.sandbox，不执行 PDF 里的脚本，不传 url（N3）。

const SCRIPT = String.raw`
const POLY = ${JSON.stringify(WITH_RESOLVERS_POLYFILL)} + '\n';
let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(blobUrl(await need({ pack: 'pdfview', path: 'legacy/build/pdf.min.mjs' }, 'text')));
  pdfjs.GlobalWorkerOptions.workerSrc = blobUrl([
    POLY,
    await need({ pack: 'pdfview', path: 'legacy/build/pdf.worker.min.mjs' }, 'text'),
  ]);
  return pdfjs;
}
class PackBinaryDataFactory {
  constructor() {}
  async fetch({ kind, filename }) {
    const dir = { cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/' }[kind];
    if (!dir) throw new Error('unsupported ' + kind);
    return need({ pack: 'pdfview', path: dir + filename }, 'bytes');
  }
}
async function open(file) {
  const p = await lib();
  const data = await need({ file }, 'bytes');
  return p.getDocument({
    data,
    BinaryDataFactory: PackBinaryDataFactory,
    useWorkerFetch: false,
    cMapPacked: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  }).promise;
}
// iOS WebView 的 canvas 上限约 1677 万像素。
const MAX_PIXELS = 16000000;
handlers.render = async ({ file, pages, maxSide, quality }) => {
  const doc = await open(file);
  try {
    const list = pages && pages.length ? pages : Array.from({ length: doc.numPages }, (_, i) => i);
    const out = [];
    for (const index of list) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      let scale = maxSide / Math.max(base.width, base.height);
      if (base.width * base.height * scale * scale > MAX_PIXELS) {
        scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
      }
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push({
        index,
        width: canvas.width,
        height: canvas.height,
        data: canvas.toDataURL('image/jpeg', quality).split(',')[1],
      });
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
    return out;
  } finally {
    await doc.destroy();
  }
};
handlers.text = async ({ file }) => {
  const doc = await open(file);
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      const lines = [];
      for (const item of content.items) {
        line += item.str || '';
        if (item.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      pages.push(lines.join('\n'));
      page.cleanup();
    }
    return { pages };
  } finally {
    await doc.destroy();
  }
};
handlers.ping = async () => ({ ok: true });
`;

export const PDFVIEW_PAGE = packPage(SCRIPT);
