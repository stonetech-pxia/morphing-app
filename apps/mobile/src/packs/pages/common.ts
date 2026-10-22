// 扩展包页面的公共部分（我们随 App 发布的固定 HTML，不是下载来的）。
// - CSP 禁止一切网络请求：库文件和输入文件都由 App 经过消息通道按需送进来（D-074）。
// - 页面和 App 之间只有固定格式的消息：call / result / need / chunk，不注入任何模型生成的字符串。
// - 页面只能请求本次调用允许的文件（App 侧检查，见 PackHost）。

/** 页面的来源（.invalid 永远解析不到），让 blob: 地址算作同源，Worker 和 import() 才能用。 */
export const PACK_BASE_URL = 'https://morph-pack.invalid/';

const CSP = [
  "default-src 'none'",
  // OpenCV 的 embind 需要 unsafe-eval；所有 wasm 需要 wasm-unsafe-eval。
  "script-src blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  'worker-src blob:',
  'connect-src blob: data:',
  'img-src blob: data:',
  "style-src 'unsafe-inline'",
  'font-src blob: data:',
].join('; ');

/** pdf.js legacy 版本直接调用 Promise.withResolvers（iOS 17.4 以下没有）。 */
export const WITH_RESOLVERS_POLYFILL =
  'if(!Promise.withResolvers){Promise.withResolvers=function(){let resolve,reject;const promise=new this((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}}';

const BRIDGE = String.raw`
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
const blobUrl = (parts, type = 'text/javascript') =>
  URL.createObjectURL(new Blob(Array.isArray(parts) ? parts : [parts], { type }));
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
let reqId = 0;
const waiting = new Map();
const parts = new Map();
/** 向 App 要一个文件：{ pack, path } 是扩展包里的文件，{ file } 是本次调用传入的文件。 */
function need(ref, as) {
  const id = ++reqId;
  post({ t: 'need', id, ref, as });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject, as }));
}
const handlers = {};
async function onMessage(e) {
  let m;
  try { m = JSON.parse(e.data); } catch (_) { return; }
  if (m.t === 'chunk') {
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.error) { waiting.delete(m.id); w.reject(new Error(m.error)); return; }
    const arr = parts.get(m.id) || [];
    arr[m.i] = m.data;
    parts.set(m.id, arr);
    if (arr.filter((x) => x !== undefined).length === m.n) {
      waiting.delete(m.id);
      parts.delete(m.id);
      const s = arr.join('');
      w.resolve(w.as === 'bytes' ? b64ToBytes(s) : s);
    }
    return;
  }
  if (m.t === 'call') {
    post({ t: 'log', message: 'call ' + m.method });
    const fn = handlers[m.method];
    try {
      if (!fn) throw new Error('unknown method ' + m.method);
      post({ t: 'result', id: m.id, ok: true, value: await fn(m.args || {}) });
    } catch (err) {
      post({ t: 'result', id: m.id, ok: false, error: String((err && err.message) || err) });
    }
  }
}
window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);
window.onerror = (msg) => post({ t: 'log', message: String(msg) });
window.addEventListener('unhandledrejection', (e) => post({ t: 'log', message: 'unhandled: ' + String(e.reason && e.reason.message || e.reason) }));
`;

/** 生成一个扩展包页面：公共通道 + 这个扩展包自己的处理函数（写进 handlers）。 */
export function packPage(script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>${WITH_RESOLVERS_POLYFILL}</script></head><body><script>
${BRIDGE}
${script}
post({ t: 'ready' });
</script></body></html>`;
}
