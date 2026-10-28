import { decodeUtf8, type RunItem } from '@morph/core';
import { pagesWithoutTables, parseTableDoc, writeXlsx, type TableDoc } from '@morph/tool-office';

import { freshName } from '../runtime/actions/helpers';
import type { FilePlatform } from '../runtime/platform';

// 转 Excel 的编辑页（D-272）读写 TableDoc：读出运行目录里的 JSON；改过以后重新生成 xlsx，
// 写成新文件（换掉结果里的地址和大小），同时写一份新的 TableDoc，再删掉旧的两个文件。

/** 这一项还能编辑：有 TableDoc，而且它还是为这个 xlsx 存的（后面的步骤没有生成新文件）。 */
export const canEditTable = (item: RunItem) =>
  item.tableDoc !== undefined && item.tableDoc.for === item.uri;

export async function loadTableDoc(files: FilePlatform, item: RunItem): Promise<TableDoc> {
  if (!canEditTable(item)) throw new Error('not editable');
  const doc = parseTableDoc(decodeUtf8(await files.readUri(item.tableDoc!.uri)));
  if (!doc) throw new Error('unreadable table data');
  return doc;
}

/**
 * 保存编辑：新的 xlsx 和 TableDoc 写进本次运行的目录（文件名不变），旧的删掉。
 * 已经存成用户文件的那份不跟着变：新的这一份没有 assetId，结果页会再显示「保存」。
 */
export async function saveTableEdits(
  files: FilePlatform,
  runId: string,
  item: RunItem,
  doc: TableDoc,
): Promise<RunItem> {
  const xlsx = await files.writeRunFile(runId, freshName(item.name, item.ext), writeXlsx(doc));
  const json = await files.writeRunFile(
    runId,
    freshName(item.name, 'json'),
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  // 新文件万一和旧文件同名（覆盖写在原处），就不能再删。
  const old = [item.uri, item.tableDoc?.uri].filter(
    (u): u is string => !!u && u !== xlsx.uri && u !== json.uri,
  );
  for (const uri of old) {
    try {
      await files.removeRunFile(uri);
    } catch {
      // 删不掉的临时文件关闭运行页面时会和整个运行目录一起删。
    }
  }
  const missing = pagesWithoutTables(doc);
  const { assetId: _saved, tableDoc: _old, ...rest } = item;
  return {
    ...rest,
    uri: xlsx.uri,
    size: xlsx.size,
    tableDoc: {
      uri: json.uri,
      for: xlsx.uri,
      ...(missing.length ? { pagesWithoutTables: missing } : {}),
    },
  };
}
