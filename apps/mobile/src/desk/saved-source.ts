import { decodeUtf8, newDesk, type Desk, type DeskBlob, type DeskFile } from '@morph/core';
import { parseDocDoc, parseTableDoc } from '@morph/tool-office';

import { saveItems } from '../runtime/actions/io';
import { baseName, extOf } from '../runtime/actions/helpers';
import type { FilePlatform } from '../runtime/platform';
import type { AssetRecord, WorkspaceRepo } from '../storage/types';
import {
  deskFileUri,
  mapSourcePaths,
  newDeskId,
  saveDesk,
  sourcePaths,
  loadDeskSource,
  type DeskSourceDoc,
} from './store';

// 存成用户文件以后还能放回桌上改（file-room §10 第 6 题，创始人 2026-10-30 同意在 R2 做，D-367）：
// 存 xlsx / docx 时，把中间格式和它用到的图片放在这个用户文件自己的目录 assets/<id>/ 里，
// 「设置 → 存储空间」把它们算在这个文件上，删文件时整个目录一起删（removeAssetFile）。
// 从存储空间「放到桌上」时复制一份回桌上（用户文件不动）。中间格式里有识别出的文字，只在本机，AI 看不到。

/** 中间格式的文件名（和用户文件放在同一个目录里）。 */
const SOURCE_NAME = 'morph-source.json';

interface SavedSource {
  version: 1;
  kind: DeskSourceDoc['kind'];
  doc: unknown;
  pagesWithoutTables?: number[];
  /** 中间格式和图片一共多大（存储空间里加在这个文件上）。 */
  bytes: number;
}

type Files = Pick<
  FilePlatform,
  'desk' | 'readUri' | 'readBytes' | 'writeBytes' | 'saveRunFile' | 'freeDiskBytes' | 'imageSize'
>;

/** 用户文件所在的目录 ID（assets/<id>/名字）；不是这种路径时 null。 */
const assetDirOf = (asset: Pick<AssetRecord, 'path'>) => {
  const [root, id] = asset.path.split('/');
  return root === 'assets' && id ? id : null;
};

/**
 * 「完成 → 存到文件」、工具栏的「保存」：桌上这几份存成用户文件；有中间格式的再把中间格式和图片存在旁边。
 */
export async function saveDeskFiles(
  files: Files,
  repo: WorkspaceRepo,
  desk: Desk,
  list: readonly DeskFile[],
  ctx: { now(): Date; newId(): string },
): Promise<void> {
  const saved = await saveItems(
    { files: files as FilePlatform, repo, grantee: 'desk' },
    list.map((f) => ({
      uri: deskFileUri(files, desk, f.path),
      name: f.name,
      ext: f.ext,
      mimeType: f.mimeType,
      size: f.size,
    })),
    ctx,
  );
  for (const [i, file] of list.entries()) {
    const assetId = saved[i]?.assetId;
    if (!file.source || !assetId) continue;
    const source = await loadDeskSource(files, desk, file);
    if (!source) continue;
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
      ...(file.source.pagesWithoutTables?.length
        ? { pagesWithoutTables: file.source.pagesWithoutTables }
        : {}),
      // 图片加上中间格式本身（JSON 外面的几个字段不算）。
      bytes: bytes + new TextEncoder().encode(docJson).length,
    };
    await files.writeBytes(assetId, SOURCE_NAME, new TextEncoder().encode(JSON.stringify(body)));
  }
}

async function readSaved(files: Pick<FilePlatform, 'readBytes'>, asset: AssetRecord) {
  const id = assetDirOf(asset);
  if (!id) return null;
  try {
    const body = JSON.parse(
      decodeUtf8(await files.readBytes(`assets/${id}/${SOURCE_NAME}`)),
    ) as SavedSource;
    if (body?.version !== 1 || (body.kind !== 'table' && body.kind !== 'doc')) return null;
    return { id, body };
  } catch {
    return null;
  }
}

/** 这个用户文件带着中间格式时，中间格式和图片一共多大（存储空间里加在它上面）；没有时 null。 */
export async function savedSourceBytes(
  files: Pick<FilePlatform, 'readBytes'>,
  asset: AssetRecord,
): Promise<number | null> {
  if (!/\.(xlsx|docx)$/i.test(asset.name)) return null;
  return (await readSaved(files, asset))?.body.bytes ?? null;
}

/** 从存储空间放回桌上：复制这个文件、中间格式和图片进一个新桌面（用户文件不动）。不能改时返回 null。 */
export async function placeAssetOnDesk(
  files: Files,
  asset: AssetRecord,
  now: number,
  deskId = newDeskId(),
): Promise<Desk | null> {
  const saved = await readSaved(files, asset);
  if (!saved) return null;
  const raw = JSON.stringify(saved.body.doc);
  const parsed =
    saved.body.kind === 'table'
      ? ((doc) => (doc ? ({ kind: 'table', doc } as const) : null))(parseTableDoc(raw))
      : ((doc) => (doc ? ({ kind: 'doc', doc } as const) : null))(parseDocDoc(raw));
  if (!parsed) return null;
  const ext = extOf(asset.name) || 'bin';
  const write = (path: string, bytes: Uint8Array) =>
    files.desk.writeBytes(`${deskId}/${path}`, bytes);
  try {
    const size = await write(`v1-0.${ext}`, await files.readBytes(asset.path));
    const assets: DeskBlob[] = [];
    const paths = new Map<string, string>();
    for (const [k, name] of [...sourcePaths(parsed)].entries()) {
      const path = `assets/v1-0-${k}.${extOf(name) || 'jpg'}`;
      const bytes = await files.readBytes(`assets/${saved.id}/${name}`);
      assets.push({ path, size: await write(path, bytes) });
      paths.set(name, path);
    }
    const doc = mapSourcePaths(parsed, (name) => paths.get(name) ?? '').doc;
    const jsonSize = await files.desk.writeText(`${deskId}/v1-0.json`, JSON.stringify(doc));
    const file: DeskFile = {
      id: 'f1-0',
      name: baseName(asset.name) || asset.name,
      ext,
      mimeType: asset.mimeType,
      size,
      path: `v1-0.${ext}`,
      source: {
        kind: parsed.kind,
        path: 'v1-0.json',
        size: jsonSize,
        assets,
        ...(saved.body.pagesWithoutTables?.length
          ? { pagesWithoutTables: saved.body.pagesWithoutTables }
          : {}),
      },
    };
    const desk = newDesk(deskId, [file], now);
    await saveDesk(files, desk);
    return desk;
  } catch (error) {
    await files.desk.removeDesk(deskId);
    throw error;
  }
}
