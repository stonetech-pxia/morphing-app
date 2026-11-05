import { formatValue, type DataRecord } from './data';
import { MAX_ATTACHMENTS, attachmentIds } from './field-values';
import { mediaKindOf } from './media';
import type { Collection, Field, Locale } from './schema';
import {
  FILE_VALUE_TYPES,
  actionAccepts,
  handedFileTypeOf,
  type ActionDefinition,
  type HandedFileType,
} from './workflow/contract';

// 容器把记录里的字段交给工具（D-428、D-442）：文字类的字段交它显示的文字，附件字段交里面的文件。
// 纯函数：哪些字段交什么、附件里哪些文件第一步收。文件本身（复制进这次运行的临时目录）由 App 做。
// 交出去以后，工作流不知道这些值来自哪条记录（外部运行：结果不回到来源）。

/** 能当文字交出的字段：存的值，显示出来就是一段文字。算出来的、引用、勾选框不算。 */
const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'text',
  'note',
  'number',
  'money',
  'date',
  'datetime',
  'time',
  'duration',
  'rating',
  'choice',
  'tags',
]);

/** 这个字段能交给第一步收什么：文字、文件，或者什么都交不了。 */
export function fieldHandsTo(field: Field): 'text' | 'files' | null {
  if (field.type === 'file') return 'files';
  return TEXT_FIELDS.has(field.type) ? 'text' : null;
}

/** 交出去的文字：字段显示的样子，去掉两头的空白；空的是空字符串。 */
export function fieldHandedText(field: Field, raw: unknown, locale: Locale): string {
  if (fieldHandsTo(field) !== 'text') return '';
  if (field.type === 'text' || field.type === 'note')
    return typeof raw === 'string' ? raw.trim() : '';
  return raw === undefined || raw === null ? '' : formatValue(field, raw, locale).trim();
}

/** 一次最多交几个附件：和一个附件字段最多放的个数一样（D-263）。 */
export const HANDED_FILES_MAX = MAX_ATTACHMENTS;

/** 一个附件的元数据（来自用户文件的记录）；内容不在这里。 */
export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * 交给第一步的附件（点了按钮才有）：只有文件 ID，副本在运行开始时才复制进这次运行的临时目录。
 * name 是字段名，给运行页面当标题。
 */
export interface HandedFiles {
  type: 'attachments';
  fileType: HandedFileType;
  assetIds: string[];
  name: string;
}

/** 一个附件算哪一种文件：先看 MIME 类型，说不清（octet-stream）再看文件名。 */
export function attachmentType(info: Pick<AttachmentInfo, 'name' | 'mimeType'>): HandedFileType {
  switch (mediaKindOf(info.mimeType, info.name)) {
    case 'image':
      return 'images';
    case 'pdf':
      return 'pdf';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'zip':
      return 'zip';
    default:
      return 'files';
  }
}

/**
 * 附件里第一步收的那些，按附件的顺序。第一步收任何文件（files）时全交，值的类型是它们共有的那一种
 * （都是 PDF 就是 pdf，混着就是 files）；只收某几种时只交收的，混着收的几种时取 FILE_VALUE_TYPES 里靠前的一种。
 * 一个都不收时是 null：按钮不出现。
 */
export function pickHandedFiles(
  action: ActionDefinition,
  infos: readonly AttachmentInfo[],
): { fileType: HandedFileType; assetIds: string[] } | null {
  const typed = infos
    .map((info) => ({ id: info.id, type: attachmentType(info) }))
    .filter((x) => actionAccepts(action, x.type));
  if (typed.length === 0) return null;
  const present = new Set(typed.map((x) => x.type));
  if (present.size === 1) return { fileType: typed[0]!.type, assetIds: typed.map((x) => x.id) };
  if (handedFileTypeOf(action) === 'files')
    return { fileType: 'files', assetIds: typed.map((x) => x.id) };
  const fileType = FILE_VALUE_TYPES.find((t) => present.has(t))!;
  return { fileType, assetIds: typed.filter((x) => x.type === fileType).map((x) => x.id) };
}

/** 这张表的附件字段：写了字段 ID 就是它（要是附件字段）；没写是第一个附件字段。 */
export function attachmentField(table: Collection, fieldId?: string): Field | undefined {
  return table.fields.find((f) => f.type === 'file' && (fieldId === undefined || f.id === fieldId));
}

/** 一批记录里第一个附件字段的文件 ID，按记录和附件的顺序，不重复。 */
export function attachmentIdsOfRecords(
  table: Collection,
  records: readonly DataRecord[],
): string[] {
  const field = attachmentField(table);
  if (!field) return [];
  const ids = new Set<string>();
  for (const record of records)
    for (const id of attachmentIds(record.values[field.id])) ids.add(id);
  return [...ids];
}

/**
 * 记录块（单条、列表）交给第一步收文件的快捷操作的附件：这张表第一个附件字段里，这些记录的、第一步收的文件。
 * infos 是已经读到的文件元数据（App 按 attachmentIdsOfRecords 取）；读不到的（文件已经没了）不交。
 */
export function handedFilesFor(
  action: ActionDefinition,
  table: Collection,
  records: readonly DataRecord[],
  infos: ReadonlyMap<string, AttachmentInfo>,
): HandedFiles | null {
  const field = attachmentField(table);
  if (!field) return null;
  const known = attachmentIdsOfRecords(table, records).flatMap((id) => {
    const info = infos.get(id);
    return info ? [info] : [];
  });
  const picked = pickHandedFiles(action, known);
  return picked ? { type: 'attachments', ...picked, name: field.name } : null;
}
