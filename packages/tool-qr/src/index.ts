import jsQRModule from 'jsqr';
import { correction, generate, mode } from 'lean-qr';

// 二维码生成与识别（T1）。只依赖字节数组，不依赖 DOM / Canvas：
// 生成得到模块矩阵和 RGBA 像素（App 用 Skia 编码成 PNG），识别直接吃 RGBA 像素。
// lean-qr 主入口是纯 ESM，顶层只用 TextEncoder（Hermes 已内置）。

export type QrErrorCode = 'empty' | 'tooLong';

export class QrError extends Error {
  constructor(readonly code: QrErrorCode) {
    super(code);
  }
}

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** 每边的模块数（不含留白）。 */
  size: number;
  /** size*size 个模块，按行存储，1 = 深色。 */
  modules: Uint8Array;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** width*height*4 字节，RGBA 顺序。 */
  data: Uint8Array;
}

export const MAX_TEXT_LENGTH = 1000;

// 不用 lean-qr 默认的 shift_jis 模式：它会调用 TextDecoder('sjis')，Hermes 不支持。
// 非 ASCII 文本走 UTF-8（ECI 26），jsQR 和主流扫码器都能正确识别中文。
const MODES = [mode.numeric, mode.alphaNumeric, mode.ascii, mode.utf8];

/** 生成二维码矩阵。ecc 是最低纠错等级，版本有余量时 lean-qr 会自动提高。 */
export function qrMatrix(text: string, { ecc = 'M' }: { ecc?: QrEcc } = {}): QrMatrix {
  const length = [...text].length;
  if (length === 0) throw new QrError('empty');
  if (length > MAX_TEXT_LENGTH) throw new QrError('tooLong');
  let code;
  try {
    code = generate(text, { minCorrectionLevel: correction[ecc], modes: MODES });
  } catch {
    // 唯一可能的失败是内容超出最大版本（40）的容量，比如 1000 个汉字。
    throw new QrError('tooLong');
  }
  const { size } = code;
  const modules = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) modules[y * size + x] = code.get(x, y) ? 1 : 0;
  }
  return { size, modules };
}

export interface QrRgbaOptions {
  /** 每个模块占多少像素（正整数）。 */
  scale: number;
  /** 四周留白的模块数，规范要求至少 4。 */
  marginModules?: number;
  /** `#RGB`、`#RRGGBB` 或 `#RRGGBBAA`。 */
  dark?: string;
  light?: string;
}

function parseColor(hex: string): [number, number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m?.[1]) throw new RangeError(`invalid color: ${hex}`);
  let digits = m[1];
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join('');
  if (digits.length === 6) digits += 'ff';
  const channel = (i: number) => parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return [channel(0), channel(1), channel(2), channel(3)];
}

/** 把矩阵光栅化成 RGBA 像素。 */
export function qrToRgba(
  matrix: QrMatrix,
  { scale, marginModules = 4, dark = '#000000', light = '#FFFFFF' }: QrRgbaOptions,
): RgbaImage {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`invalid scale: ${scale}`);
  if (!Number.isInteger(marginModules) || marginModules < 0) {
    throw new RangeError(`invalid margin: ${marginModules}`);
  }
  const on = parseColor(dark);
  const off = parseColor(light);
  const { size, modules } = matrix;
  const width = (size + marginModules * 2) * scale;
  const height = width;
  const data = new Uint8Array(width * height * 4);
  // 每个模块行先画出一行像素，再整行复制 scale 次。
  const row = new Uint8Array(width * 4);
  for (let my = -marginModules; my < size + marginModules; my++) {
    for (let mx = -marginModules; mx < size + marginModules; mx++) {
      const isDark = my >= 0 && my < size && mx >= 0 && mx < size && modules[my * size + mx] === 1;
      const color = isDark ? on : off;
      const start = (mx + marginModules) * scale * 4;
      for (let p = 0; p < scale; p++) row.set(color, start + p * 4);
    }
    const top = (my + marginModules) * scale;
    for (let r = 0; r < scale; r++) data.set(row, (top + r) * width * 4);
  }
  return { width, height, data };
}

/**
 * 按盒式平均把图片缩到长边不超过 maxSide（默认 1600 px），已经足够小就原样返回。
 * 识别前先缩小：大照片直接交给 jsQR 又慢又费内存。
 */
export function downscaleRgba(image: RgbaImage, maxSide = 1600): RgbaImage {
  const { width, height, data } = image;
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return image;
  const ratio = maxSide / longSide;
  const tw = Math.max(1, Math.round(width * ratio));
  const th = Math.max(1, Math.round(height * ratio));
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / tw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          a += data[i + 3] ?? 0;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (ty * tw + tx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width: tw, height: th, data: out };
}

// jsqr 是 CommonJS 包：Metro/Babel 会取 .default，Node 原生 ESM 则拿到整个 exports 对象。
const jsQR: typeof jsQRModule =
  typeof jsQRModule === 'function'
    ? jsQRModule
    : (jsQRModule as unknown as { default: typeof jsQRModule }).default;

/** 识别图片里的二维码，找不到返回 null。同时尝试反色（深底浅码）。 */
export function decodeQr({ data, width, height }: RgbaImage): string | null {
  if (data.length !== width * height * 4) {
    throw new RangeError(`expected ${width * height * 4} bytes, got ${data.length}`);
  }
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}
export interface WifiNetwork {
  name: string;
  security: 'WPA' | 'WEP' | 'none';
  password: string;
  hidden: boolean;
}

/** Wi-Fi 二维码里的文字有问题：网络名（空、超过 32 字节）或密码（没填、WPA 不是 8–63 个字符）。 */
export type WifiProblem = 'name' | 'passwordMissing' | 'password';

/** 网络名、密码里的 \ ; , : " 前面加反斜杠（Wi-Fi 二维码格式的转义）。 */
const wifiEscape = (s: string) => s.replace(/[\\;,:"]/g, (c) => `\\${c}`);

/** UTF-8 字节数（这个包的类型里没有 TextEncoder）。 */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** 先检查，有问题时返回问题，否则返回 null。 */
export function wifiProblem(net: WifiNetwork): WifiProblem | null {
  if (!net.name.trim() || utf8Length(net.name) > 32) return 'name';
  if (net.security === 'none') return null;
  if (!net.password) return 'passwordMissing';
  if (net.security === 'WPA' && (net.password.length < 8 || net.password.length > 63)) {
    return 'password';
  }
  return null;
}

/**
 * 手机相机扫 Wi-Fi 二维码时认的文字（D-198）：WIFI:T:WPA;S:网络名;P:密码;H:true;;
 * 没有密码时 T:nopass、不写 P。先用 wifiProblem 检查。
 */
export function wifiText(net: WifiNetwork): string {
  const type = net.security === 'none' ? 'nopass' : net.security;
  const password = net.security === 'none' ? '' : `P:${wifiEscape(net.password)};`;
  return `WIFI:T:${type};S:${wifiEscape(net.name)};${password}${net.hidden ? 'H:true;' : ''};`;
}

export { encodePng } from './png';
