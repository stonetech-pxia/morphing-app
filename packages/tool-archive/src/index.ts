import { unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';

// ZIP 打包与解压（T1）。只依赖字节数组；fflate 只用同步 API（异步 API 需要 Worker，
// Hermes 没有），因此同一份代码在手机上运行，也能在 Node 中用真实 ZIP 测试。

export type ArchiveErrorCode = 'unreadable' | 'tooManyEntries' | 'tooLarge' | 'encrypted' | 'empty';

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    readonly fileName?: string,
  ) {
    super(fileName ? `${code}: ${fileName}` : code);
  }
}

export interface ArchiveLimits {
  /** 最多文件数（目录和系统垃圾文件不计）。 */
  maxEntries: number;
  /** 所有文件解压后的总字节数上限。 */
  maxTotalBytes: number;
  /** 单个文件解压后的字节数上限。 */
  maxFileBytes: number;
  /** 解压后 / 压缩后 的比例上限，防 zip 炸弹；只对超过 1 MB 的文件检查。 */
  maxRatio: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxEntries: 500,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxRatio: 200,
};

const RATIO_CHECK_MIN_BYTES = 1024 * 1024;

export interface ArchiveInput {
  name: string;
  bytes: Uint8Array;
}

export interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface CreateZipOptions {
  level?: CompressionLevel;
  limits?: Partial<ArchiveLimits>;
}

export interface ExtractZipOptions {
  limits?: Partial<ArchiveLimits>;
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

// 本身已经压缩过的格式，再压缩只浪费时间，直接存储（level 0）。
const STORED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf', 'zip']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function mimeTypeOfName(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}

/**
 * 把任意名字变成安全的单层文件名：去掉控制字符，`/` `\` 换成 `_`，
 * 连续的点压成一个（不可能再出现 `..`），去掉首尾空白和结尾的点。保留中文等 UTF-8 字符。
 */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/[.\s]+$/, '');
  return cleaned === '' || cleaned === '.' ? 'file' : cleaned;
}

/** 大小写不敏感地去重：`photo.jpg` 已存在时得到 `photo-2.jpg`、`photo-3.jpg`…… */
function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem}-${i}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function resolveLimits(limits: Partial<ArchiveLimits> | undefined): ArchiveLimits {
  return { ...DEFAULT_LIMITS, ...limits };
}

/** 把文件打成一个 ZIP。文件名会被清理并去重，已压缩格式只存储不压缩。 */
export function createZip(
  entries: readonly ArchiveInput[],
  { level = 6, limits }: CreateZipOptions = {},
): Uint8Array {
  const max = resolveLimits(limits);
  if (entries.length === 0) throw new ArchiveError('empty');
  if (entries.length > max.maxEntries) throw new ArchiveError('tooManyEntries');
  // 用无原型对象，避免名为 `__proto__` 的文件被吞掉。
  const files = Object.create(null) as Zippable;
  const taken = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const name = uniqueName(sanitizeName(entry.name), taken);
    if (entry.bytes.length > max.maxFileBytes) throw new ArchiveError('tooLarge', name);
    total += entry.bytes.length;
    if (total > max.maxTotalBytes) throw new ArchiveError('tooLarge');
    files[name] = [entry.bytes, { level: STORED_EXTENSIONS.has(extensionOf(name)) ? 0 : level }];
  }
  return zipSync(files);
}

const u16 = (d: Uint8Array, i: number) => (d[i] ?? 0) | ((d[i + 1] ?? 0) << 8);
const u32 = (d: Uint8Array, i: number) => (u16(d, i) | (u16(d, i + 2) << 16)) >>> 0;

/**
 * 按中央目录顺序读出每个条目的通用标志位（fflate 的 filter 不提供它）。
 * 只读不解压；结构异常时返回 null，交给 fflate 自己报错。
 */
function readEntryFlags(data: Uint8Array): number[] | null {
  let e = data.length - 22;
  while (e >= 0 && u32(data, e) !== 0x06054b50) {
    if (data.length - e > 65558) return null;
    e--;
  }
  if (e < 0) return null;
  let count = u16(data, e + 8);
  let offset = u32(data, e + 16);
  // ZIP64：真正的条目数和偏移在 ZIP64 结尾记录里（只取低 32 位，100 MB 上限内足够）。
  if (e >= 20 && u32(data, e - 20) === 0x07064b50) {
    const z = u32(data, e - 12);
    if (u32(data, z) === 0x06064b50) {
      count = u32(data, z + 32);
      offset = u32(data, z + 48);
    }
  }
  const flags: number[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || u32(data, offset) !== 0x02014b50) return null;
    flags.push(u16(data, offset + 8));
    offset += 46 + u16(data, offset + 28) + u16(data, offset + 30) + u16(data, offset + 32);
  }
  return flags;
}

/** 目录、`__MACOSX/` 和 `.DS_Store` 不算用户文件。 */
function isJunk(path: string): boolean {
  const parts = path.split('/');
  const base = parts[parts.length - 1] ?? '';
  return base === '' || base === '.DS_Store' || parts.includes('__MACOSX');
}

/**
 * 解开 ZIP，返回扁平的文件列表（只保留文件名，丢掉目录层级，因此不可能路径穿越）。
 * 所有上限在解压前用中央目录里声明的大小检查；fflate 按声明大小分配输出，
 * 实际数据更大也写不出界。未标记 UTF-8 的文件名按 Latin-1 解码（如 GBK 中文名会乱码）。
 */
export function extractZip(bytes: Uint8Array, { limits }: ExtractZipOptions = {}): ArchiveEntry[] {
  const max = resolveLimits(limits);
  const flags = readEntryFlags(bytes);
  const order: string[] = [];
  let index = -1;
  let total = 0;
  const filter = (file: UnzipFileInfo): boolean => {
    index++;
    const path = file.name.replace(/\\/g, '/');
    if (isJunk(path)) return false;
    // 第 0 位：加密；99：AES 加密的压缩方式。
    if (((flags?.[index] ?? 0) & 1) !== 0 || file.compression === 99) {
      throw new ArchiveError('encrypted', file.name);
    }
    if (order.length + 1 > max.maxEntries) throw new ArchiveError('tooManyEntries');
    if (file.originalSize > max.maxFileBytes) throw new ArchiveError('tooLarge', file.name);
    total += file.originalSize;
    if (total > max.maxTotalBytes) throw new ArchiveError('tooLarge');
    if (file.originalSize > RATIO_CHECK_MIN_BYTES && file.originalSize > file.size * max.maxRatio) {
      throw new ArchiveError('tooLarge', file.name);
    }
    order.push(file.name);
    return true;
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter });
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    throw new ArchiveError('unreadable');
  }

  const taken = new Set<string>();
  const result: ArchiveEntry[] = [];
  // 同一路径在 ZIP 里重复出现时 fflate 只保留最后一份，这里也只输出一次。
  for (const path of new Set(order)) {
    const data = files[path];
    if (!data) continue;
    const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
    const name = uniqueName(sanitizeName(base), taken);
    result.push({ name, bytes: data, mimeType: mimeTypeOfName(name) });
  }
  if (result.length === 0) throw new ArchiveError('empty');
  return result;
}
