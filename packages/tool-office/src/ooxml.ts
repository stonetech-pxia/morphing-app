import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';

import { children, parseXml, type XmlElement } from './xml';

// 打开外来的 docx / xlsx（D-509）的包：认出加了密码的（Office 把加密的文件装在 OLE 复合文件里，不是 zip）、
// 老格式（.doc / .xls 改了扩展名）和坏文件；只解压用得到的部分，解压前按目录里写的大小拦住太大的文件和
// 压缩炸弹（同 tool-archive）。全部在本机，不联网（不变量 1）。

/** 读不了的原因：加了密码、不是 docx / xlsx、文件坏了、太大（编辑页和预览放不下）。 */
export type OfficeImportError = 'encrypted' | 'notOffice' | 'damaged' | 'tooLarge';

export class OfficeImportFailure extends Error {
  constructor(readonly code: OfficeImportError) {
    super(`office import: ${code}`);
  }
}

/** 包的上限：一个 XML 部分、解压出来一共、图片一共（字节），压缩比（超过 1 MB 的部分才看）。 */
export const OFFICE_LIMITS = {
  maxPartBytes: 40 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  maxMediaBytes: 40 * 1024 * 1024,
  maxRatio: 200,
};
const RATIO_CHECK_MIN_BYTES = 1024 * 1024;

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** OLE 复合文件（加密的 Office 文件、老的 .doc / .xls）。 */
const isCfb = (bytes: Uint8Array) => CFB_MAGIC.every((b, i) => bytes[i] === b);

/** 复合文件的目录里有没有「EncryptedPackage」这个流（名字是 UTF-16LE）：有就是加了密码的 Office 文件。 */
function hasEncryptedPackage(bytes: Uint8Array): boolean {
  const name = 'EncryptedPackage';
  const first = name.charCodeAt(0);
  for (let i = 0; i + name.length * 2 <= bytes.length; i++) {
    if (bytes[i] !== first || bytes[i + 1] !== 0) continue;
    let ok = true;
    for (let k = 1; k < name.length && ok; k++) {
      ok = bytes[i + 2 * k] === name.charCodeAt(k) && bytes[i + 2 * k + 1] === 0;
    }
    if (ok) return true;
  }
  return false;
}

/** 部分的文字：UTF-8（带不带 BOM 都行），UTF-16 要有 BOM。 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes, true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes, false);
  return strFromU8(bytes);
}

function utf16(bytes: Uint8Array, little: boolean): string {
  let out = '';
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(
      little ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!,
    );
  }
  return out;
}

export interface Relationship {
  id: string;
  type: string;
  /** 包里的路径（不以 / 开头）；外部链接时是原来写的地址。 */
  target: string;
  external: boolean;
}

/** 相对 from 这个部分的目录解析出包里的路径。 */
export function resolvePart(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export interface OoxmlPackage {
  names: string[];
  bytes(path: string): Uint8Array | undefined;
  /** 解析好的 XML；没有这个部分时 undefined，坏了时抛 damaged。 */
  xml(path: string): XmlElement | undefined;
  /** 一个部分的关系（_rels/名字.rels）。 */
  rels(path: string): Map<string, Relationship>;
  /** 包的主文档（_rels/.rels 里的 officeDocument）。 */
  main(): string | undefined;
}

const caseless = (names: readonly string[]) => new Map(names.map((n) => [n.toLowerCase(), n]));

/**
 * 打开包：wanted 决定解压哪些部分（其余只看目录）。是加了密码的 Office 文件、老格式、坏文件、太大时抛
 * OfficeImportFailure。
 */
export function openPackage(
  data: Uint8Array,
  wanted: (name: string) => boolean,
  isMedia: (name: string) => boolean = () => false,
): OoxmlPackage {
  if (isCfb(data))
    throw new OfficeImportFailure(hasEncryptedPackage(data) ? 'encrypted' : 'notOffice');
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new OfficeImportFailure(data.length === 0 ? 'damaged' : 'notOffice');
  }
  let total = 0;
  let media = 0;
  const listed: string[] = [];
  const filter = (file: UnzipFileInfo): boolean => {
    listed.push(file.name);
    if (!wanted(file.name)) return false;
    const big = file.originalSize > RATIO_CHECK_MIN_BYTES;
    if (big && file.originalSize > file.size * OFFICE_LIMITS.maxRatio) {
      throw new OfficeImportFailure('tooLarge');
    }
    if (isMedia(file.name)) {
      media += file.originalSize;
      // 图片太多时后面的不解压（这几张图片空着），文档照样能读。
      if (media > OFFICE_LIMITS.maxMediaBytes) return false;
    } else if (file.originalSize > OFFICE_LIMITS.maxPartBytes) {
      throw new OfficeImportFailure('tooLarge');
    }
    total += file.originalSize;
    if (total > OFFICE_LIMITS.maxTotalBytes) throw new OfficeImportFailure('tooLarge');
    return true;
  };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter });
  } catch (e) {
    if (e instanceof OfficeImportFailure) throw e;
    throw new OfficeImportFailure('damaged');
  }
  // 包里的名字不分大小写（有的工具写 Word/Document.xml）。
  const byLower = caseless(Object.keys(files));
  const find = (path: string) => byLower.get(path.replace(/^\/+/, '').toLowerCase());
  const parsed = new Map<string, XmlElement | undefined>();
  const pkg: OoxmlPackage = {
    names: listed,
    bytes: (path) => {
      const name = find(path);
      return name === undefined ? undefined : files[name];
    },
    xml(path) {
      const name = find(path);
      if (name === undefined) return undefined;
      if (!parsed.has(name)) {
        try {
          parsed.set(name, parseXml(decodeText(files[name]!)));
        } catch {
          throw new OfficeImportFailure('damaged');
        }
      }
      return parsed.get(name);
    },
    rels(path) {
      const dir = path.split('/').slice(0, -1).join('/');
      const base = path.split('/').at(-1)!;
      const relPath = `${dir ? `${dir}/` : ''}_rels/${base}.rels`;
      const out = new Map<string, Relationship>();
      const root = pkg.xml(relPath);
      for (const rel of children(root)) {
        const id = rel.attrs.Id;
        const target = rel.attrs.Target;
        if (!id || target === undefined) continue;
        const external = rel.attrs.TargetMode === 'External';
        out.set(id, {
          id,
          type: rel.attrs.Type ?? '',
          target: external ? target : resolvePart(path, target),
          external,
        });
      }
      return out;
    },
    main() {
      for (const rel of pkg.rels('').values()) {
        if (/\/officeDocument$/.test(rel.type) && !rel.external) return rel.target;
      }
      return undefined;
    },
  };
  return pkg;
}

/** 关系的类型名（地址的最后一段：image、styles、worksheet）。 */
export const relKind = (rel: Relationship) => rel.type.split('/').at(-1) ?? '';
