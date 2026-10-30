import { OFFICE_MIME_BY_EXT, mediaKindOf } from '../media';

// 文件房间的桌面（file-room DESIGN §3、§11.1，D-336）：桌上放着几份工作副本，每用一次工具生成一个新版本，
// 可以撤销、重做。这里只有纯逻辑（版本栈、上限、合成版本、清理提示），文件的复制和删除由 App 按这里
// 算出来的路径去做。路径都是桌面目录里的相对路径（iOS 更新 App 后文档目录的绝对地址会变）。
// 只记工具的 ID，不记参数、文件内容和识别出的文字；AI 看不到这些（D-042、D-113）。

/** 最近几个版本（创始人 2026-10-30 确认，§10 第 2 题）。 */
export const DESK_MAX_VERSIONS = 20;
/** 所有版本合起来最多多大（先到哪个上限算哪个）。 */
export const DESK_MAX_BYTES = 500 * 1024 * 1024;
/** 多少天没动提示清理（只提示，不自动删）。 */
export const DESK_STALE_DAYS = 7;

/** 桌面目录里的一个文件（相对路径）和它的大小。 */
export interface DeskBlob {
  path: string;
  size: number;
}

/**
 * 中间格式（§11.1）：转 Excel 的 TableDoc、转 Word 的 DocDoc。JSON 是这一版的「源」，桌上的 xlsx / docx 是
 * 从它生成的成品。assets 是它引用的图片（原图截图用的页面、剪下来嵌进 docx 的图片），各版本共用一份。
 */
export interface DeskSource extends DeskBlob {
  kind: 'table' | 'doc';
  /** 识别范围是「仅表格内容」、但没找到带线的表格的页（转 Excel，从 1 开始）。 */
  pagesWithoutTables?: number[];
  assets: DeskBlob[];
}

/** 桌上的一份文件（某个版本里的样子）。 */
export interface DeskFile extends DeskBlob {
  /** 桌上这份文件的 ID：工具改出来的新文件换新 ID。 */
  id: string;
  /** 不含扩展名的显示名（只在本机）。 */
  name: string;
  ext: string;
  mimeType: string;
  width?: number;
  height?: number;
  pageCount?: number;
  durationMs?: number;
  source?: DeskSource;
}

/** 这个版本是怎么来的：只记工具或快捷操作的 ID，不记参数（参数里可能有用户写的文字）。 */
export type DeskStep =
  | { kind: 'place' }
  | { kind: 'action'; action: string }
  | { kind: 'workflow'; workflowId: string }
  /** 在表格、文档上的一段编辑（R2）：连续的编辑合成一个版本。 */
  | { kind: 'edit' };

export interface DeskVersion {
  /** 版本号，从 1 开始，删掉旧版本也不重排。 */
  n: number;
  by: DeskStep;
  at: number;
  files: DeskFile[];
  /** 还没合上的编辑（§11.2）：接着编辑时直接替换这一版，不另生成版本。 */
  open?: true;
}

export interface Desk {
  version: 1;
  id: string;
  createdAt: number;
  /** 最后一次改动（放上桌、用工具、撤销、重做）。清理提示按它算。 */
  touchedAt: number;
  versions: DeskVersion[];
  /** 现在显示的是第几个（下标）；撤销后后面的版本留着，可以重做。 */
  current: number;
  nextN: number;
}

export interface DeskLimits {
  maxVersions: number;
  maxBytes: number;
}

export const DESK_LIMITS: DeskLimits = {
  maxVersions: DESK_MAX_VERSIONS,
  maxBytes: DESK_MAX_BYTES,
};

/** 一次改动的结果：新的桌面，以及已经没有任何版本用到、可以删掉的文件。 */
export interface DeskChange {
  desk: Desk;
  drop: string[];
}

export function newDesk(id: string, files: DeskFile[], now: number): Desk {
  return {
    version: 1,
    id,
    createdAt: now,
    touchedAt: now,
    versions: [{ n: 1, by: { kind: 'place' }, at: now, files }],
    current: 0,
    nextN: 2,
  };
}

export const currentVersion = (desk: Desk): DeskVersion => desk.versions[desk.current]!;
export const currentFiles = (desk: Desk): DeskFile[] => currentVersion(desk).files;

/** 一个文件用到的所有桌面文件：它自己、中间格式、中间格式引用的图片。 */
export function blobsOf(file: DeskFile): DeskBlob[] {
  return [file, ...(file.source ? [file.source, ...file.source.assets] : [])].map(
    ({ path, size }) => ({ path, size }),
  );
}

function blobsOfVersions(versions: readonly DeskVersion[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of versions)
    for (const f of v.files) for (const b of blobsOf(f)) out.set(b.path, b.size);
  return out;
}

/** 桌面占多大：同一个文件（各版本共用的图片、没变的文件）只算一次。 */
export const deskBytes = (desk: Desk): number =>
  [...blobsOfVersions(desk.versions).values()].reduce((a, b) => a + b, 0);

/** before 里有、after 里已经没有的路径。 */
function dropped(before: readonly DeskVersion[], after: readonly DeskVersion[]): string[] {
  const keep = blobsOfVersions(after);
  return [...blobsOfVersions(before).keys()].filter((p) => !keep.has(p));
}

const sealed = (v: DeskVersion): DeskVersion => {
  if (!v.open) return v;
  const { open: _open, ...rest } = v;
  return rest;
};

/**
 * 生成一个新版本（用了工具、快捷操作，或者一段编辑）。撤销过的话，后面的版本丢掉（不能再重做）。
 * by 是 edit、而且现在这一版是还没合上的编辑时，直接替换它（连续的编辑合成一个版本，§10 第 4 题）。
 * 超过上限时从最旧的删起，现在这一版永远留着。
 */
export function commitVersion(
  desk: Desk,
  files: DeskFile[],
  by: DeskStep,
  now: number,
  limits: DeskLimits = DESK_LIMITS,
): DeskChange {
  const head = currentVersion(desk);
  const kept = desk.versions.slice(0, desk.current + 1);
  let versions: DeskVersion[];
  let nextN = desk.nextN;
  if (by.kind === 'edit' && head.open) {
    versions = [...kept.slice(0, -1), { ...head, at: now, files }];
  } else {
    versions = [
      ...kept.slice(0, -1),
      sealed(head),
      { n: nextN++, by, at: now, files, ...(by.kind === 'edit' ? { open: true as const } : {}) },
    ];
  }
  while (
    versions.length > 1 &&
    (versions.length > limits.maxVersions || bytesOf(versions) > limits.maxBytes)
  ) {
    versions = versions.slice(1);
  }
  const next: Desk = { ...desk, versions, current: versions.length - 1, nextN, touchedAt: now };
  return { desk: next, drop: dropped(desk.versions, versions) };
}

const bytesOf = (versions: readonly DeskVersion[]) =>
  [...blobsOfVersions(versions).values()].reduce((a, b) => a + b, 0);

/** 合上还没合上的编辑（用了别的工具、保存、离开房间、切到别的文件、App 进后台时，§11.2）。 */
export function sealEdit(desk: Desk): Desk {
  const head = currentVersion(desk);
  if (!head.open) return desk;
  return {
    ...desk,
    versions: desk.versions.map((v, i) => (i === desk.current ? sealed(v) : v)),
  };
}

export const canUndo = (desk: Desk) => desk.current > 0;
export const canRedo = (desk: Desk) => desk.current < desk.versions.length - 1;

/** 退到第 index 个版本（撤销、重做、退到任意一步）。后面的版本留着，可以再前进。 */
export function moveTo(desk: Desk, index: number, now: number): Desk {
  if (index < 0 || index >= desk.versions.length || index === desk.current) return desk;
  return { ...sealEdit(desk), current: index, touchedAt: now };
}

export const undoDesk = (desk: Desk, now: number) => moveTo(desk, desk.current - 1, now);
export const redoDesk = (desk: Desk, now: number) => moveTo(desk, desk.current + 1, now);

/**
 * 工具的结果怎么放回桌上（§3.1）：
 * - 没有文件输出（识别文字、读二维码）：返回 null，桌上不变，结果显示在面板里；
 * - 一变多（拆分 PDF、PDF 转图片）：原来那份留着，新的几份排在它后面；
 * - 一对一、多合一（类型变不变都一样）：替换用到的那几份，放在第一份的位置。
 * selected 是这次交给工具的文件（桌上的 ID）；桌上别的文件不动。
 */
export function placeOutputs(
  files: readonly DeskFile[],
  selected: readonly string[],
  outputs: readonly DeskFile[],
): DeskFile[] | null {
  if (outputs.length === 0) return null;
  const used = files.filter((f) => selected.includes(f.id));
  if (used.length === 0) return [...files, ...outputs];
  if (outputs.length > used.length) {
    const last = files.indexOf(used.at(-1)!);
    return [...files.slice(0, last + 1), ...outputs, ...files.slice(last + 1)];
  }
  const first = files.indexOf(used[0]!);
  const rest = files.filter((f) => !selected.includes(f.id));
  const at = files.slice(0, first).filter((f) => !selected.includes(f.id)).length;
  return [...rest.slice(0, at), ...outputs, ...rest.slice(at)];
}

/** 放了很久没动、该提示清理的桌面（只提示，不自动删）。 */
export function isStaleDesk(desk: Pick<Desk, 'touchedAt'>, now: number): boolean {
  return now - desk.touchedAt >= DESK_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * 桌面里一份文件的种类：决定怎么预览、默认工具栏放哪些工具。sheet 是 Excel；doc 是别的办公文档
 * （Word、RTF、PowerPoint）：工具都只有转 PDF，有 DocDoc 的 docx 用文档视图预览。
 */
export type DeskKind = 'image' | 'pdf' | 'sheet' | 'doc' | 'video' | 'audio' | 'other';

export const DESK_KINDS: readonly DeskKind[] = [
  'image',
  'pdf',
  'sheet',
  'doc',
  'video',
  'audio',
  'other',
];

export function deskKindOf(file: Pick<DeskFile, 'mimeType' | 'ext'>): DeskKind {
  const kind = mediaKindOf(file.mimeType, file.ext);
  if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') return kind;
  // 名字里没有扩展名时（Android 别的 App 分享过来常这样）按 MIME 认。
  const mime = file.mimeType.toLowerCase();
  const ext =
    file.ext.toLowerCase() in OFFICE_MIME_BY_EXT
      ? file.ext.toLowerCase()
      : (Object.keys(OFFICE_MIME_BY_EXT).find((e) => OFFICE_MIME_BY_EXT[e] === mime) ??
        (mime === 'application/rtf' ? 'rtf' : ''));
  if (ext === 'xlsx' || ext === 'xls') return 'sheet';
  if (ext) return 'doc';
  return 'other';
}

/** 读回桌面的 JSON；格式不对时返回 null（当作没有这个桌面）。 */
export function parseDesk(json: string): Desk | null {
  try {
    const desk = JSON.parse(json) as Desk;
    if (desk?.version !== 1 || typeof desk.id !== 'string') return null;
    if (!Array.isArray(desk.versions) || desk.versions.length === 0) return null;
    if (!desk.versions.every((v) => Array.isArray(v?.files))) return null;
    if (!(desk.current >= 0 && desk.current < desk.versions.length)) return null;
    return desk;
  } catch {
    return null;
  }
}
