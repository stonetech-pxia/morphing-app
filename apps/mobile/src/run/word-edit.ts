import { decodeUtf8, type RunItem } from '@morph/core';
import { parseDocDoc, writeDocx, type DocDoc, type DocxImage } from '@morph/tool-office';

import { freshName } from '../runtime/actions/helpers';
import type { FilePlatform } from '../runtime/platform';

// 转 Word 的编辑页（D-310）读写 DocDoc：和转 Excel 一样（table-edit.ts），改过以后重新生成 docx，
// 写成新文件（换掉结果里的地址和大小），同时写一份新的 DocDoc，再删掉旧的两个文件。
// 剪好的图片留在运行目录里，新的 docx 再嵌一次；关闭运行页面时和整个运行目录一起删。

/** 这一项还能编辑：有 DocDoc，而且它还是为这个 docx 存的（后面的步骤没有生成新文件）。 */
export const canEditWord = (item: RunItem) =>
  item.docDoc !== undefined && item.docDoc.for === item.uri;

export async function loadDocDoc(files: FilePlatform, item: RunItem): Promise<DocDoc> {
  if (!canEditWord(item)) throw new Error('not editable');
  const doc = parseDocDoc(decodeUtf8(await files.readUri(item.docDoc!.uri)));
  if (!doc) throw new Error('unreadable document data');
  return doc;
}

/** 文档里还用着的剪好的图片（删掉的图片块不再嵌进去）。 */
async function imagesOf(files: FilePlatform, doc: DocDoc): Promise<Map<string, DocxImage>> {
  const out = new Map<string, DocxImage>();
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      if (block.kind !== 'image' || !block.src || out.has(block.src)) continue;
      try {
        const size = await files.imageSize(block.src);
        out.set(block.src, { bytes: await files.readUri(block.src), ...size });
      } catch {
        // 读不了的图片不写进文件。
      }
    }
  }
  return out;
}

/**
 * 保存编辑：新的 docx 和 DocDoc 写进本次运行的目录（文件名不变），旧的删掉。
 * 已经存成用户文件的那份不跟着变：新的这一份没有 assetId，结果页会再显示「保存」。
 */
export async function saveWordEdits(
  files: FilePlatform,
  runId: string,
  item: RunItem,
  doc: DocDoc,
): Promise<RunItem> {
  const docx = await files.writeRunFile(
    runId,
    freshName(item.name, item.ext),
    writeDocx(doc, await imagesOf(files, doc)),
  );
  const json = await files.writeRunFile(
    runId,
    freshName(item.name, 'json'),
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  // 新文件万一和旧文件同名（覆盖写在原处），就不能再删。
  const old = [item.uri, item.docDoc?.uri].filter(
    (u): u is string => !!u && u !== docx.uri && u !== json.uri,
  );
  for (const uri of old) {
    try {
      await files.removeRunFile(uri);
    } catch {
      // 删不掉的临时文件关闭运行页面时会和整个运行目录一起删。
    }
  }
  const { assetId: _saved, docDoc: _old, ...rest } = item;
  return { ...rest, uri: docx.uri, size: docx.size, docDoc: { uri: json.uri, for: docx.uri } };
}
