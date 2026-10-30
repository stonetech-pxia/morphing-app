import {
  RunError,
  commitVersion,
  sealEdit,
  currentFiles,
  decodeUtf8,
  isFileValue,
  isStaleDesk,
  deskBytes,
  newDesk,
  parseDesk,
  placeOutputs,
  redoDesk,
  undoDesk,
  type Desk,
  type DeskBlob,
  type DeskFile,
  type DeskSource,
  type DeskStep,
  type RunItem,
  type RunValue,
} from '@morph/core';
import {
  leafBlocks,
  pagesWithoutTables,
  parseDocDoc,
  parseTableDoc,
  writeDocx,
  writeXlsx,
  type DocDoc,
  type DocxImage,
  type TableDoc,
} from '@morph/tool-office';

import { baseName, extOf, extOfMime, mimeOf } from '../runtime/actions/helpers';
import type { FilePlatform, PickedFile } from '../runtime/platform';

// 桌面的存储（file-room DESIGN §3、§11.1，D-357）：版本栈的逻辑在 @morph/core 的 desk/model.ts，
// 这里按它算出来的结果复制、移动、删除文件，并把桌面写成 desk/<deskId>/desk.json。
// 文件的归属（AGENTS.md）：放上桌时原件只复制；工具的结果是运行目录里的临时文件，直接移进来；
// 中间格式（TableDoc / DocDoc）引用的图片放进 assets/，JSON 里写桌面里的相对路径，各版本共用一份。

type Files = Pick<FilePlatform, 'desk' | 'readUri' | 'freeDiskBytes' | 'imageSize'>;

const JSON_NAME = 'desk.json';
/** 还没合上的一段编辑（防丢，§11.2）：每改一下写一次，合上时删掉。 */
const DRAFT_NAME = 'editing.json';

/** 桌面里的相对路径 → desk/ 下的路径。 */
const inDesk = (desk: Pick<Desk, 'id'>, path: string) => `${desk.id}/${path}`;

/** 扩展名只留字母和数字（做文件名用）。 */
const cleanExt = (ext: string) => ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';

export function newDeskId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 桌上一份文件现在的地址。 */
export const deskFileUri = (files: Files, desk: Desk, path: string) =>
  files.desk.uri(inDesk(desk, path));

export async function saveDesk(files: Files, desk: Desk): Promise<void> {
  await files.desk.writeText(inDesk(desk, JSON_NAME), JSON.stringify(desk));
}

export async function loadDesk(files: Files, deskId: string): Promise<Desk | null> {
  const text = await files.desk.readText(`${deskId}/${JSON_NAME}`);
  const desk = text === null ? null : parseDesk(text);
  return desk?.id === deskId ? desk : null;
}

/** 所有桌面（存储页列出、提示清理）；读不出来的目录不算。 */
export async function listDesks(files: Files): Promise<Desk[]> {
  const out: Desk[] = [];
  for (const id of await files.desk.list()) {
    const desk = await loadDesk(files, id);
    if (desk) out.push(desk);
  }
  return out.sort((a, b) => b.touchedAt - a.touchedAt);
}

export const deskSummary = (desk: Desk, now: number) => ({
  id: desk.id,
  names: currentFiles(desk).map((f) => `${f.name}.${f.ext}`),
  bytes: deskBytes(desk),
  touchedAt: desk.touchedAt,
  stale: isStaleDesk(desk, now),
});

/** 磁盘不够时不开始复制（大视频）。 */
function checkSpace(files: Files, bytes: number) {
  const free = files.freeDiskBytes();
  if (free !== null && bytes * 1.1 > free) {
    throw new RunError('notEnoughSpace', {
      gb: Math.ceil(((bytes * 1.1 - free) / 1024 ** 3) * 10) / 10,
    });
  }
}

/**
 * 放到桌上（收件页面的「放到桌上」）：每份复制一份工作副本，原件永远不动。
 * 收件那一批（分享扩展、选择器的副本）照旧由收件页面释放。
 */
export async function placeOnDesk(
  files: Files,
  picked: readonly PickedFile[],
  now: number,
  deskId = newDeskId(),
): Promise<Desk> {
  checkSpace(
    files,
    picked.reduce((n, f) => n + (f.size ?? 0), 0),
  );
  const placed: DeskFile[] = [];
  try {
    for (const [i, f] of picked.entries()) {
      // 名字里没有扩展名（Android 别的 App 分享过来常这样）时按 MIME 补上：转 PDF 这类工具按扩展名认格式。
      const ext = cleanExt(extOf(f.name) || extOfMime(f.mimeType));
      const path = `v1-${i}.${ext}`;
      const size = await files.desk.copyIn(f.uri, `${deskId}/${path}`);
      placed.push({
        id: `f1-${i}`,
        name: baseName(f.name) || f.name,
        ext,
        mimeType: mimeOf(f.name, f.mimeType),
        size,
        path,
        ...(f.width && f.height ? { width: f.width, height: f.height } : {}),
        ...(f.durationMs ? { durationMs: f.durationMs } : {}),
      });
    }
    const desk = newDesk(deskId, placed, now);
    await saveDesk(files, desk);
    return desk;
  } catch (error) {
    await files.desk.removeDesk(deskId);
    throw error;
  }
}

/** 运行交回的文件放进桌面：桌面里原有的直接用，运行目录里的移进来，别的复制。 */
async function adopt(
  files: Files,
  desk: Desk,
  uri: string,
  path: string,
  copy = false,
): Promise<DeskBlob> {
  const own = files.desk.pathOf(uri);
  const prefix = `${desk.id}/`;
  if (own?.startsWith(prefix)) {
    const rel = own.slice(prefix.length);
    const known = desk.versions
      .flatMap((v) => v.files)
      .flatMap((f) => [f, ...(f.source ? [f.source, ...f.source.assets] : [])])
      .find((b) => b.path === rel);
    if (known) return { path: rel, size: known.size };
  }
  const size =
    !copy && files.desk.isRunFile(uri)
      ? await files.desk.moveIn(uri, inDesk(desk, path))
      : await files.desk.copyIn(uri, inDesk(desk, path));
  return { path, size };
}

/** 中间格式引用的图片：搬进 assets/，同一张只搬一次；JSON 里改成桌面里的相对路径。 */
async function adoptSource(
  files: Files,
  desk: Desk,
  item: RunItem,
  path: string,
  tag: string,
  copy = false,
): Promise<DeskSource | undefined> {
  const kind =
    item.tableDoc?.for === item.uri ? 'table' : item.docDoc?.for === item.uri ? 'doc' : null;
  if (!kind) return undefined;
  const ref = kind === 'table' ? item.tableDoc! : item.docDoc!;
  let doc: TableDoc | DocDoc | null;
  try {
    const text = decodeUtf8(await files.readUri(ref.uri));
    doc = kind === 'table' ? parseTableDoc(text) : parseDocDoc(text);
  } catch {
    doc = null;
  }
  // 读不出来的中间格式不要了：这一版只是一个普通的 xlsx / docx（能看、能转 PDF，不能改）。
  if (!doc) return undefined;
  const assets = new Map<string, DeskBlob>();
  const asset = async (uri: string) => {
    const seen = assets.get(uri);
    if (seen) return seen.path;
    const blob = await adopt(
      files,
      desk,
      uri,
      `assets/${tag}-${assets.size}.${cleanExt(extOf(uri.split('?')[0]!)) || 'jpg'}`,
      copy,
    );
    assets.set(uri, blob);
    return blob.path;
  };
  for (const page of doc.pages) {
    if (page.source) page.source = await asset(page.source);
  }
  if (kind === 'doc') {
    for (const page of (doc as DocDoc).pages) {
      for (const block of leafBlocks(page)) {
        if (block.kind === 'image' && block.src) block.src = await asset(block.src);
      }
    }
  }
  const size = await files.desk.writeText(inDesk(desk, path), JSON.stringify(doc));
  return {
    kind,
    path,
    size,
    ...(kind === 'table' && item.tableDoc?.pagesWithoutTables?.length
      ? { pagesWithoutTables: item.tableDoc.pagesWithoutTables }
      : {}),
    assets: [...assets.values()],
  };
}

export interface DeskCommit {
  desk: Desk;
  /** 没有文件输出（识别文字、读二维码）时：结果只给用户看，桌上不变。 */
  text?: string;
}

/**
 * 把一次运行（一个工具、一个快捷操作）的结果放回桌上，生成一个新版本（§3.1）。
 * selected 是交给这次运行的桌上文件的 ID。调用的人在这之后删掉运行目录（移进来的文件已经不在那里了）。
 */
export async function commitRun(
  files: Files,
  desk: Desk,
  selected: readonly string[],
  value: RunValue | null,
  by: DeskStep,
  now: number,
): Promise<DeskCommit> {
  if (value?.type === 'text') return { desk, text: value.text };
  if (!isFileValue(value) || value.items.length === 0) return { desk };
  const n = desk.nextN;
  const outputs: DeskFile[] = [];
  for (const [i, item] of value.items.entries()) {
    const ext = cleanExt(item.ext);
    const blob = await adopt(files, desk, item.uri, `v${n}-${i}.${ext}`);
    const same = desk.versions.flatMap((v) => v.files).find((f) => f.path === blob.path);
    // 工具原样交回的文件（例如快捷操作最后一步是分享）：还是桌上原来那一份。
    if (same) {
      outputs.push(same);
      continue;
    }
    const source = await adoptSource(files, desk, item, `v${n}-${i}.json`, `v${n}-${i}`);
    outputs.push({
      id: `f${n}-${i}`,
      name: item.name,
      ext,
      mimeType: item.mimeType,
      size: blob.size,
      path: blob.path,
      ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
      ...(item.pageCount ? { pageCount: item.pageCount } : {}),
      ...(item.durationMs ? { durationMs: item.durationMs } : {}),
      ...(source ? { source } : {}),
    });
  }
  const next = placeOutputs(currentFiles(desk), selected, outputs);
  if (!next) return { desk };
  // 结果和桌上现在的一模一样（工具什么都没改）：不生成新版本。
  const before = currentFiles(desk);
  if (next.length === before.length && next.every((f, i) => f === before[i])) return { desk };
  const change = commitVersion(desk, next, by, now);
  await saveDesk(files, change.desk);
  await files.desk.remove(change.drop.map((p) => inDesk(desk, p)));
  return { desk: change.desk };
}

export async function undo(files: Files, desk: Desk, now: number): Promise<Desk> {
  const next = undoDesk(desk, now);
  if (next !== desk) await saveDesk(files, next);
  return next;
}

export async function redo(files: Files, desk: Desk, now: number): Promise<Desk> {
  const next = redoDesk(desk, now);
  if (next !== desk) await saveDesk(files, next);
  return next;
}

/** 清空桌面（用户点的）：整个目录删掉；已经存成用户文件的不受影响。 */
export const clearDesk = (files: Files, deskId: string) => files.desk.removeDesk(deskId);

/** 读一份文件的中间格式，图片的相对路径换成现在的地址（显示用）。读不出来时返回 null。 */
export async function loadDeskSource(
  files: Files,
  desk: Desk,
  file: DeskFile,
): Promise<{ kind: 'table'; doc: TableDoc } | { kind: 'doc'; doc: DocDoc } | null> {
  if (!file.source) return null;
  const text = await files.desk.readText(inDesk(desk, file.source.path));
  if (text === null) return null;
  const uri = (path: string) => (path ? deskFileUri(files, desk, path) : path);
  if (file.source.kind === 'table') {
    const doc = parseTableDoc(text);
    if (!doc) return null;
    for (const page of doc.pages) page.source = uri(page.source);
    return { kind: 'table', doc };
  }
  const doc = parseDocDoc(text);
  if (!doc) return null;
  for (const page of doc.pages) {
    page.source = uri(page.source);
    for (const block of leafBlocks(page)) {
      if (block.kind === 'image' && block.src) block.src = uri(block.src);
    }
  }
  return { kind: 'doc', doc };
}

/** 桌上的文件交给运行时的样子（和分享进来的文件一样，D-115）。 */
export function deskPicked(files: Files, desk: Desk, list: readonly DeskFile[]): PickedFile[] {
  return list.map((f) => ({
    uri: deskFileUri(files, desk, f.path),
    name: `${f.name}.${f.ext}`,
    size: f.size,
    mimeType: f.mimeType,
    ...(f.width && f.height ? { width: f.width, height: f.height } : {}),
    ...(f.durationMs ? { durationMs: f.durationMs } : {}),
  }));
}

/**
 * 结果页的「放到桌上」（D-366，代替原来的「查看和编辑」）：把这几份结果复制进一个新桌面，中间格式和图片一起。
 * 只复制、不移动：结果页还显示着它们（运行页关掉时运行目录才删）。
 */
export async function placeResultsOnDesk(
  files: Files,
  items: readonly RunItem[],
  now: number,
  deskId = newDeskId(),
): Promise<Desk> {
  checkSpace(
    files,
    items.reduce((n, i) => n + i.size, 0),
  );
  const empty = newDesk(deskId, [], now);
  const placed: DeskFile[] = [];
  try {
    for (const [i, item] of items.entries()) {
      const ext = cleanExt(item.ext);
      const blob = await adopt(files, empty, item.uri, `v1-${i}.${ext}`, true);
      const source = await adoptSource(files, empty, item, `v1-${i}.json`, `v1-${i}`, true);
      placed.push({
        id: `f1-${i}`,
        name: item.name,
        ext,
        mimeType: item.mimeType,
        size: blob.size,
        path: blob.path,
        ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
        ...(item.pageCount ? { pageCount: item.pageCount } : {}),
        ...(source ? { source } : {}),
      });
    }
    const desk = newDesk(deskId, placed, now);
    await saveDesk(files, desk);
    return desk;
  } catch (error) {
    await files.desk.removeDesk(deskId);
    throw error;
  }
}

/** 一份文件的中间格式（显示时图片是现在的地址，存回去时是桌面里的相对路径）。 */
export type DeskSourceDoc = { kind: 'table'; doc: TableDoc } | { kind: 'doc'; doc: DocDoc };

/** 中间格式里的图片路径换一遍（不改原来的）。 */
export function mapSourcePaths(source: DeskSourceDoc, fn: (path: string) => string): DeskSourceDoc {
  if (source.kind === 'table') {
    return {
      kind: 'table',
      doc: { ...source.doc, pages: source.doc.pages.map((p) => ({ ...p, source: fn(p.source) })) },
    };
  }
  const doc = JSON.parse(JSON.stringify(source.doc)) as DocDoc;
  for (const page of doc.pages) {
    page.source = fn(page.source);
    for (const block of leafBlocks(page)) {
      if (block.kind === 'image' && block.src) block.src = fn(block.src);
    }
  }
  return { kind: 'doc', doc };
}

/** 中间格式用到的图片（原图截图的页面、剪下来的图片）。 */
export function sourcePaths(source: DeskSourceDoc): Set<string> {
  const out = new Set<string>();
  mapSourcePaths(source, (path) => {
    if (path) out.add(path);
    return path;
  });
  return out;
}

/** 显示用的地址换回桌面里的相对路径。 */
const relativeSource = (files: Files, desk: Desk, source: DeskSourceDoc) =>
  mapSourcePaths(source, (path) => {
    const own = files.desk.pathOf(path);
    return own?.startsWith(`${desk.id}/`) ? own.slice(desk.id.length + 1) : path;
  });

/** docx 里嵌的图片（剪下来的那些）：按中间格式里写的路径读。 */
async function docxImages(files: Files, desk: Desk, doc: DocDoc) {
  const out = new Map<string, DocxImage>();
  for (const page of doc.pages) {
    for (const block of leafBlocks(page)) {
      if (block.kind !== 'image' || !block.src || out.has(block.src)) continue;
      try {
        const uri = deskFileUri(files, desk, block.src);
        out.set(block.src, { bytes: await files.readUri(uri), ...(await files.imageSize(uri)) });
      } catch {
        // 读不了的图片不写进文件。
      }
    }
  }
  return out;
}

/**
 * 合上一段编辑（file-room §11.2，D-366）：改过的中间格式写成这一版的 JSON，按它生成一次 xlsx / docx，
 * 桌上这一份换成新的（新 ID），整段编辑是一个版本（撤销时一起退）。没有中间格式时不变。
 * 返回新的桌面和这份文件的新 ID。
 */
export async function commitEdit(
  files: Files,
  desk: Desk,
  fileId: string,
  edited: DeskSourceDoc,
  now: number,
): Promise<{ desk: Desk; fileId: string }> {
  const list = currentFiles(desk);
  const file = list.find((f) => f.id === fileId);
  if (!file?.source) return { desk, fileId };
  const source = relativeSource(files, desk, edited);
  const n = desk.nextN;
  const path = `v${n}-0.${file.ext}`;
  const json = `v${n}-0.json`;
  const bytes =
    source.kind === 'table'
      ? writeXlsx(source.doc)
      : writeDocx(source.doc, await docxImages(files, desk, source.doc));
  const size = await files.desk.writeBytes(inDesk(desk, path), bytes);
  const jsonSize = await files.desk.writeText(inDesk(desk, json), JSON.stringify(source.doc));
  const used = sourcePaths(source);
  const missing = source.kind === 'table' ? pagesWithoutTables(source.doc) : [];
  const next: DeskFile = {
    ...file,
    id: `f${n}-0`,
    path,
    size,
    source: {
      kind: source.kind,
      path: json,
      size: jsonSize,
      assets: file.source.assets.filter((a) => used.has(a.path)),
      ...(missing.length ? { pagesWithoutTables: missing } : {}),
    },
  };
  const change = commitVersion(
    desk,
    list.map((f) => (f.id === fileId ? next : f)),
    { kind: 'edit' },
    now,
  );
  const sealed = sealEdit(change.desk);
  await saveDesk(files, sealed);
  await files.desk.remove([...change.drop, DRAFT_NAME].map((p) => inDesk(desk, p)));
  return { desk: sealed, fileId: next.id };
}

/** 还没合上的编辑写进桌面（防丢）：App 被关掉时，下次打开房间先把它合成一个版本。 */
export async function writeEditDraft(
  files: Files,
  desk: Desk,
  fileId: string,
  edited: DeskSourceDoc,
): Promise<void> {
  const source = relativeSource(files, desk, edited);
  await files.desk.writeText(inDesk(desk, DRAFT_NAME), JSON.stringify({ fileId, ...source }));
}

export const dropEditDraft = (files: Files, desk: Desk) =>
  files.desk.remove([inDesk(desk, DRAFT_NAME)]);

/** 打开房间时：上次没合上的编辑合成一个版本（撤销能退回去）。读不出来、文件已经不在桌上时丢掉。 */
export async function recoverEditDraft(files: Files, desk: Desk, now: number): Promise<Desk> {
  const text = await files.desk.readText(inDesk(desk, DRAFT_NAME));
  if (text === null) return desk;
  type Draft = { fileId?: string; kind?: string; doc?: unknown } | null;
  let draft: Draft;
  try {
    draft = JSON.parse(text) as Draft;
  } catch {
    draft = null;
  }
  const raw = JSON.stringify(draft?.doc ?? null);
  const source: DeskSourceDoc | null =
    draft?.kind === 'table'
      ? ((doc) => (doc ? { kind: 'table' as const, doc } : null))(parseTableDoc(raw))
      : draft?.kind === 'doc'
        ? ((doc) => (doc ? { kind: 'doc' as const, doc } : null))(parseDocDoc(raw))
        : null;
  const file = currentFiles(desk).find((f) => f.id === draft?.fileId);
  if (!source || !file || file.source?.kind !== source.kind) {
    await dropEditDraft(files, desk);
    return desk;
  }
  return (await commitEdit(files, desk, file.id, source, now)).desk;
}
