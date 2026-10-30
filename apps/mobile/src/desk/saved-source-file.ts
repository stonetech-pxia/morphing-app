import { decodeUtf8, type RunItem } from '@morph/core';
import { parseDocDoc, parseTableDoc } from '@morph/tool-office';

import { extOf } from '../runtime/actions/helpers';
import type { FilePlatform } from '../runtime/platform';
import { mapSourcePaths, sourcePaths, type DeskSourceDoc } from './store';

// 用户文件旁边的中间格式（D-367、D-377）：assets/<id>/morph-source.json 和它用到的图片
// morph-source-<n>.<扩展名>（JSON 里写同一目录里的文件名）。房间里存的、结果页的「保存」、
// 快捷操作的保存步骤都写这一份，从存储空间「放到桌上」时读它（saved-source.ts）。
// 单独一个文件：保存步骤（runtime/actions/io.ts）也要用，saved-source.ts 又用着 io.ts 的 saveItems。

/** 中间格式的文件名（和用户文件放在同一个目录里）。 */
export const SOURCE_NAME = 'morph-source.json';

export interface SavedSource {
  version: 1;
  kind: DeskSourceDoc['kind'];
  doc: unknown;
  pagesWithoutTables?: number[];
  /** 中间格式和图片一共多大（存储空间里加在这个文件上）。 */
  bytes: number;
}

type Files = Pick<FilePlatform, 'readUri' | 'writeBytes'>;

/** 把中间格式（图片是现在能读的地址）和它用到的图片存进用户文件 assetId 的目录。 */
export async function writeSavedSource(
  files: Files,
  assetId: string,
  source: DeskSourceDoc,
  pagesWithoutTables?: readonly number[],
): Promise<void> {
  // 图片换成同一个目录里的文件名，各复制一份。
  const names = new Map<string, string>();
  let bytes = 0;
  for (const [k, path] of [...sourcePaths(source)].entries()) {
    const ext = extOf(path.split('?')[0]!) || 'jpg';
    const name = `morph-source-${k}.${ext}`;
    const written = await files.writeBytes(assetId, name, await files.readUri(path));
    bytes += written.size;
    names.set(path, name);
  }
  const doc = mapSourcePaths(source, (path) => names.get(path) ?? '').doc;
  const docJson = JSON.stringify(doc);
  const body: SavedSource = {
    version: 1,
    kind: source.kind,
    doc,
    ...(pagesWithoutTables?.length ? { pagesWithoutTables: [...pagesWithoutTables] } : {}),
    // 图片加上中间格式本身（JSON 外面的几个字段不算）。
    bytes: bytes + new TextEncoder().encode(docJson).length,
  };
  await files.writeBytes(assetId, SOURCE_NAME, new TextEncoder().encode(JSON.stringify(body)));
}

/**
 * 结果页的「保存」、快捷操作的保存步骤（D-377）：转 Excel、转 Word 的结果带着中间格式时，跟着存一份。
 * 中间格式不再对应这个文件（后面的步骤改过它）、读不出来时只存文件，和放到桌上一样。
 * 运行目录里的中间格式和图片只复制（运行页关掉时才删）。
 */
export async function saveRunItemSource(
  files: Files,
  item: RunItem,
  assetId: string,
): Promise<void> {
  const kind =
    item.tableDoc?.for === item.uri ? 'table' : item.docDoc?.for === item.uri ? 'doc' : null;
  if (!kind) return;
  let source: DeskSourceDoc | null = null;
  try {
    const text = decodeUtf8(
      await files.readUri(kind === 'table' ? item.tableDoc!.uri : item.docDoc!.uri),
    );
    if (kind === 'table') {
      const doc = parseTableDoc(text);
      if (doc) source = { kind, doc };
    } else {
      const doc = parseDocDoc(text);
      if (doc) source = { kind, doc };
    }
  } catch {
    source = null;
  }
  if (!source) return;
  await writeSavedSource(
    files,
    assetId,
    source,
    kind === 'table' ? item.tableDoc?.pagesWithoutTables : undefined,
  );
}
