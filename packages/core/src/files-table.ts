import type { Collection } from './schema-base';

// 系统表 $files（v34 NEW_FORMAT §2.3、Q2）：用户文件（存到 Morph 的、快捷操作保存的、附件、文件位里选的）
// 当成一张只读结构的表。字段是自动的，AI 只能在 source 和 filter 里引用它们，不能加字段、删记录，
// 也看不到文件名和内容（规则 3、D-042）。收件那一批、桌上的工作副本、运行的中间结果是工作区，不在这里。

export const FILES_TABLE = '$files';

/** 文件的种类（和 MIME 大类一一对应：image/*、application/pdf、video/*、audio/*，表格、文档、其他）。 */
export const FILE_KINDS = ['image', 'pdf', 'video', 'audio', 'sheet', 'doc', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** 文件从哪来：用户选的（文件位、附件、存到 Morph），或者快捷操作生成的。 */
export const FILE_SOURCES = ['picked', 'generated'] as const;

/** 按 MIME 类型认出文件的种类。 */
export function fileKindOf(mimeType: string): FileKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType === 'text/csv' ||
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel'
  )
    return 'sheet';
  if (mimeType.includes('wordprocessing') || mimeType === 'application/msword') return 'doc';
  return 'other';
}

/** $files 的结构（检查筛选、排序用；createdAt 是系统字段）。名字给 AI 看，不是用户的内容。 */
export const FILES_COLLECTION: Collection = {
  id: 'files',
  name: 'Files',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    {
      id: 'kind',
      name: 'Kind',
      type: 'choice',
      options: FILE_KINDS.map((id) => ({ id, label: id })),
    },
    { id: 'size', name: 'Size', type: 'number' },
    {
      id: 'source',
      name: 'Source',
      type: 'choice',
      options: FILE_SOURCES.map((id) => ({ id, label: id })),
    },
  ],
};
