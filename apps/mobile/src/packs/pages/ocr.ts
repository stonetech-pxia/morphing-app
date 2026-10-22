import { packPage } from './common';

// 文字识别包页面（T5）：tesseract.js 7.0.0，完全离线（调研笔记 pack-manifests §4）。
// - tesseract.min.js 是经典脚本；worker 是一个 Blob：前置脚本 + 核心（.wasm.js，内嵌 wasm）+ worker.min.js。
//   核心的顶层 var 定义了 TesseractCore，worker 就不会再 importScripts。
// - worker 用全局 fetch 取语言数据：前置脚本把 self.fetch 换成「等页面送来字节」。
// - createWorker 同步创建线程：临时包一下 window.Worker 拿到线程，把语言数据作为可转移对象送进去。
// - 语言加载失败时 createWorker 永远不返回，所以要加超时。只用 LSTM（OEM 1），不缓存到 IndexedDB。

const SCRIPT = String.raw`
let tesseractLoaded = false;
let workerUrl = null;
let worker = null;
let workerLang = null;
const packOf = (lang) => 'ocr-' + lang.replace('_', '-');
function morphPrelude() {
  const files = new Map();
  const waiters = new Map();
  self.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__morph !== 'file') return;
    e.stopImmediatePropagation();
    const w = waiters.get(d.name);
    if (w) { waiters.delete(d.name); w(d.bytes); } else files.set(d.name, d.bytes);
  });
  self.fetch = (url) => new Promise((resolve) => {
    const name = String(url).split('/').pop();
    const hit = (b) => resolve(new Response(b, { status: 200 }));
    if (files.has(name)) { const b = files.get(name); files.delete(name); hit(b); } else waiters.set(name, hit);
  });
}
async function prepare() {
  if (!tesseractLoaded) {
    await loadClassic(blobUrl(await need({ pack: 'ocr', path: 'tesseract.min.js' }, 'text')));
    tesseractLoaded = true;
  }
  if (!workerUrl) {
    // 和 wasm-feature-detect 一样的 SIMD 检测字节。
    const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
    const core = await need({ pack: 'ocr', path: simd ? 'core/tesseract-core-simd-lstm.wasm.js' : 'core/tesseract-core-lstm.wasm.js' }, 'text');
    workerUrl = blobUrl(['(' + morphPrelude.toString() + ')();\n', core, '\n;\n', await need({ pack: 'ocr', path: 'worker.min.js' }, 'text')]);
  }
}
async function workerFor(lang) {
  if (worker && workerLang === lang) return worker;
  if (worker) { await worker.terminate().catch(() => undefined); worker = null; workerLang = null; }
  await prepare();
  const data = await need({ pack: packOf(lang), path: lang + '.traineddata.gz' }, 'bytes');
  const RealWorker = window.Worker;
  let thread = null;
  window.Worker = class extends RealWorker { constructor(u, o) { super(u, o); thread = this; } };
  let ready;
  try {
    ready = Tesseract.createWorker([lang], 1, {
      workerPath: workerUrl,
      workerBlobURL: false,
      corePath: 'embedded/tesseract-core-lstm.wasm.js',
      langPath: 'https://morph-pack.invalid/tessdata',
      cacheMethod: 'none',
      gzip: true,
      legacyCore: false,
      legacyLang: false,
      errorHandler: (err) => post({ t: 'log', message: 'ocr worker: ' + String(err) }),
    });
  } finally {
    window.Worker = RealWorker;
  }
  if (!thread) throw new Error('worker was not created');
  thread.postMessage({ __morph: 'file', name: lang + '.traineddata.gz', bytes: data }, [data.buffer]);
  worker = await withTimeout(ready, 90000, 'text recognition');
  workerLang = lang;
  return worker;
}
handlers.recognize = async ({ file, lang }) => {
  const w = await workerFor(lang);
  const bytes = await need({ file }, 'bytes');
  const { data } = await w.recognize(new Blob([bytes], { type: 'image/jpeg' }));
  return { text: data.text || '', confidence: data.confidence || 0 };
};
handlers.ping = async () => ({ ok: true });
`;

export const OCR_PAGE = packPage(SCRIPT);
