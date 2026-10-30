import type { RunItem } from '@morph/core';

// 转 Excel、转 Word 的结果（D-272、D-328）：带着中间格式、而且中间格式还是为这个文件存的（后面的步骤没有
// 生成新文件）时，结果页能「放到桌上」改（file-room R2，D-345）。

export const canEditTable = (item: RunItem) =>
  item.tableDoc !== undefined && item.tableDoc.for === item.uri;

export const canEditWord = (item: RunItem) =>
  item.docDoc !== undefined && item.docDoc.for === item.uri;
