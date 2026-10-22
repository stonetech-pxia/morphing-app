// JPEG 元数据：读取拍摄时间/方向/是否含位置，以及无损去除元数据。
// 只用 Uint8Array / DataView，手工解码 ASCII，Hermes 上可直接运行。

export type ImageErrorCode = 'notJpeg' | 'malformed';

export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code);
  }
}

export interface ExifInfo {
  /** DateTimeOriginal，没有时用 DateTime；EXIF 不带时区，按本地时间解释。 */
  takenAt: Date | null;
  /** 1–8，见 EXIF Orientation 定义。 */
  orientation: number | null;
  /** 含 GPS 坐标（GPS IFD 无法解析时也视为含位置）。 */
  hasLocation: boolean;
}

interface Segment {
  marker: number;
  /** 段起点（含前面的填充 0xFF）。 */
  start: number;
  /** 段数据起点（长度字段之后）。 */
  data: number;
  end: number;
}

const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;
const APP13 = 0xed;

function byteAt(bytes: Uint8Array, i: number): number {
  const b = bytes[i];
  if (b === undefined) throw new ImageError('malformed');
  return b;
}

/** 手工按 ASCII 解码，遇到 NUL 停止。 */
function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

function startsWith(bytes: Uint8Array, at: number, end: number, prefix: string): boolean {
  if (end - at < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[at + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

/** 列出扫描数据（SOS）之前的所有段。 */
function readSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ImageError('notJpeg');
  const segments: Segment[] = [];
  let i = 2;
  for (;;) {
    if (byteAt(bytes, i) !== 0xff) throw new ImageError('malformed');
    let j = i;
    while (byteAt(bytes, j + 1) === 0xff) j++; // 段前允许多个填充 0xFF
    const marker = byteAt(bytes, j + 1);
    if (marker === SOS || marker === EOI) return { segments, scanStart: i };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: i, data: j + 2, end: j + 2 }); // 无长度字段的标记
      i = j + 2;
      continue;
    }
    const length = (byteAt(bytes, j + 2) << 8) | byteAt(bytes, j + 3);
    const end = j + 2 + length;
    if (length < 2 || end > bytes.length) throw new ImageError('malformed');
    segments.push({ marker, start: i, data: j + 4, end });
    i = end;
  }
}

interface Entry {
  type: number;
  count: number;
  /** 值或值偏移所在位置（相对 TIFF 头）。 */
  at: number;
}

function parseDate(text: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y === 0 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** 解析 TIFF 结构（APP1 中 "Exif\0\0" 之后），两种字节序都支持；损坏处跳过。 */
function parseTiff(bytes: Uint8Array, start: number, end: number): ExifInfo {
  const info: ExifInfo = { takenAt: null, orientation: null, hasLocation: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return info;
  const little = order === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(2) !== 42) return info;

  const readIfd = (offset: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>();
    const n = u16(offset);
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      entries.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return entries;
  };
  const text = (entry: Entry | undefined): string | undefined => {
    if (!entry || entry.type !== 2) return undefined;
    const at = entry.count <= 4 ? entry.at : u32(entry.at);
    if (at + entry.count > view.byteLength) return undefined;
    return ascii(bytes, start + at, entry.count);
  };
  const date = (entry: Entry | undefined) => {
    const t = attempt(() => text(entry));
    return t === undefined ? null : parseDate(t);
  };

  const ifd0 = attempt(() => readIfd(u32(4)));
  if (!ifd0) return info;
  const orient = ifd0.get(0x0112);
  if (orient && (orient.type === 3 || orient.type === 4)) {
    const v = attempt(() => (orient.type === 3 ? u16(orient.at) : u32(orient.at)));
    if (v !== undefined && v >= 1 && v <= 8) info.orientation = v;
  }
  const exifPtr = ifd0.get(0x8769);
  const exifIfd = exifPtr ? attempt(() => readIfd(u32(exifPtr.at))) : undefined;
  info.takenAt = date(exifIfd?.get(0x9003)) ?? date(ifd0.get(0x0132));

  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const gps = attempt(() => readIfd(u32(gpsPtr.at)));
    // 只写了版本号的 GPS IFD 不算位置；解析失败时保守地认为有。
    info.hasLocation = gps ? gps.has(0x0002) || gps.has(0x0004) : true;
  }
  return info;
}

/** 读取 JPEG 的拍摄时间、方向和位置标记。非 JPEG 或没有 EXIF 时返回空结果，不抛错。 */
export function readExif(bytes: Uint8Array): ExifInfo {
  const empty: ExifInfo = { takenAt: null, orientation: null, hasLocation: false };
  const parsed = attempt(() => readSegments(bytes));
  if (!parsed) return empty;
  for (const seg of parsed.segments) {
    if (seg.marker === APP1 && startsWith(bytes, seg.data, seg.end, 'Exif\0\0')) {
      return attempt(() => parseTiff(bytes, seg.data + 6, seg.end)) ?? empty;
    }
  }
  return empty;
}

function segmentName(bytes: Uint8Array, seg: Segment): string {
  if (seg.marker === APP1) {
    if (startsWith(bytes, seg.data, seg.end, 'Exif\0')) return 'exif';
    if (startsWith(bytes, seg.data, seg.end, 'http://ns.adobe.com/xap/1.0/\0')) return 'xmp';
    if (startsWith(bytes, seg.data, seg.end, 'http://ns.adobe.com/xmp/extension/\0'))
      return 'xmp-extension';
    return 'app1';
  }
  return startsWith(bytes, seg.data, seg.end, 'Photoshop 3.0\0') ? 'photoshop' : 'app13';
}

/**
 * 无损去除 APP1（EXIF、XMP）和 APP13（Photoshop/IPTC）段，保留 JFIF（APP0）、
 * ICC（APP2）等其他段和图像数据。去掉 EXIF 也会去掉方向标记，
 * 调用方必须先把方向"烧"进像素（例如先用 expo-image-manipulator 旋转一次）。
 */
export function stripJpegMetadata(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const { segments, scanStart } = readSegments(bytes);
  const removed: string[] = [];
  const parts: [number, number][] = [[0, 2]];
  for (const seg of segments) {
    if (seg.marker === APP1 || seg.marker === APP13) removed.push(segmentName(bytes, seg));
    else parts.push([seg.start, seg.end]);
  }
  parts.push([scanStart, bytes.length]);
  const out = new Uint8Array(parts.reduce((n, [a, b]) => n + b - a, 0));
  let o = 0;
  for (const [a, b] of parts) {
    out.set(bytes.subarray(a, b), o);
    o += b - a;
  }
  return { bytes: out, removed };
}
