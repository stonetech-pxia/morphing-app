import {
  FILE_ACCEPT,
  RunCancelled,
  RunError,
  renderNameTemplate,
  sanitizeFileName,
  uniqueFileName,
  type ActionImpl,
  type FileValueType,
  type RunItem,
} from '@morph/core';

import type { PickedFile } from '../platform';
import {
  baseName,
  checkSizes,
  extOf,
  fileItems,
  freshName,
  isImageMime,
  mimeOf,
  type RunServices,
} from './helpers';
import { SCAN_OUTPUT_SIDE } from './scan';

// 内核输入输出动作的实现（TOOLS_DESIGN §5）。

type Impl = ActionImpl<RunServices>;

const DOCUMENT_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  images: ['image/*'],
  pdfOrImages: ['application/pdf', 'image/*'],
  any: ['*/*'],
};

const kindOf = (accept: string) =>
  accept === 'pdf' ? 'PDF' : accept === 'images' ? 'image' : 'PDF/image';

function matches(accept: string, mime: string): boolean {
  switch (accept) {
    case 'pdf':
      return mime === 'application/pdf';
    case 'images':
      return isImageMime(mime);
    case 'pdfOrImages':
      return mime === 'application/pdf' || isImageMime(mime);
    default:
      return true;
  }
}

/** 把选中的文件复制进本次运行的临时目录。 */
async function importPicked(
  services: RunServices,
  picked: readonly PickedFile[],
  ctx: Parameters<Impl>[2],
): Promise<RunItem[]> {
  const items: RunItem[] = [];
  for (const [i, f] of picked.entries()) {
    ctx.throwIfCancelled();
    const clean = sanitizeFileName(f.name);
    const mimeType = mimeOf(clean, f.mimeType);
    const ext = extOf(clean) || (mimeType === 'application/pdf' ? 'pdf' : 'jpg');
    const name = baseName(clean);
    let stored;
    try {
      stored = await services.files.copyToRun(f.uri, services.runId, freshName(name, ext));
    } catch {
      throw new RunError('accessDenied', { name: f.name });
    }
    items.push({
      uri: stored.uri,
      name,
      ext,
      mimeType,
      size: stored.size,
      ...(f.width ? { width: f.width } : {}),
      ...(f.height ? { height: f.height } : {}),
      ...(f.takenAt !== undefined ? { takenAt: f.takenAt } : {}),
      ...(f.straightened ? { straightened: true } : {}),
    });
    ctx.progress(i + 1, picked.length);
  }
  checkSizes(items.map((i) => ({ name: `${i.name}.${i.ext}`, size: i.size })));
  return items;
}

function checkCount(count: number, min: number, max: number, kind: string) {
  if (count < min) throw new RunError('tooFew', { min, kind });
  if (count > max) throw new RunError('tooMany', { max });
}

/** 把临时文件存成用户文件（file.save 步骤和结果页的「保存」共用）。已经存过的跳过。 */
export async function saveItems(
  services: Pick<RunServices, 'files' | 'repo' | 'grantee'>,
  items: readonly RunItem[],
  ctx: { now(): Date; newId(): string; progress?(done: number, total: number): void },
): Promise<RunItem[]> {
  const { files, repo, grantee } = services;
  const existing = (await repo.listAssets()).map((a) => a.name);
  const saved: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    if (item.assetId) {
      saved.push(item);
      continue;
    }
    const name = uniqueFileName(item.name, item.ext, existing);
    existing.push(name);
    const id = ctx.newId();
    let stored;
    try {
      stored = await files.saveRunFile(item.uri, id, name);
    } catch (e) {
      throw new RunError('saveFailed', { detail: String(e) });
    }
    await repo.addAsset({
      id,
      name,
      mimeType: item.mimeType,
      size: stored.size,
      path: stored.path,
      source: 'generated',
      createdAt: ctx.now().getTime(),
    });
    // 工作流产生的文件授权给它（§7G）。
    await repo.grantAsset(grantee, id);
    saved.push({ ...item, assetId: id, name: baseName(name) });
    ctx.progress?.(i + 1, items.length);
  }
  return saved;
}

export const IO_IMPLS: Record<string, Impl> = {
  async 'in.photos'(_input, params, ctx) {
    const { source, min, max } = params as { source: string; min: number; max: number };
    const { files, ui } = ctx.services;
    let picked: PickedFile[] = [];
    if (source === 'scanner' && files.vision?.documentCamera) {
      // 系统文档相机（iOS 的 VisionKit、Android 的 ML Kit）：实时找边、自动拍摄、多页，拍完已经拉正（D-086、D-087）。
      const pages = await files.vision.scanDocuments(ctx.services.runId, SCAN_OUTPUT_SIDE);
      if (!pages || pages.length === 0) throw new RunCancelled();
      picked = pages;
    } else if (source === 'camera' || source === 'scanner') {
      // 没有文档相机（Expo Go、模拟器、没有 Google Play 服务的 Android）时用相机拍，后面的找边步骤再拉正。
      const zh = ctx.locale === 'zh';
      while (picked.length < max) {
        const photo = await files.takePhoto();
        if (!photo) break;
        picked.push(photo);
        if (picked.length >= max) break;
        const more = await ui.confirm(
          zh ? `已拍 ${picked.length} 张` : `${picked.length} taken`,
          zh ? '再拍一张' : 'Take another',
          zh ? '完成' : 'Done',
        );
        if (!more) break;
      }
      if (picked.length === 0) throw new RunCancelled();
    } else {
      const result = await files.pickPhotos(max);
      if (!result) throw new RunCancelled();
      picked = result;
    }
    checkCount(picked.length, min, max, 'image');
    checkSizes(picked);
    return { type: 'images', items: await importPicked(ctx.services, picked, ctx) };
  },

  async 'in.files'(_input, params, ctx) {
    const { accept, min, max } = params as { accept: string; min: number; max: number };
    const picked = await ctx.services.files.pickDocuments(DOCUMENT_TYPES[accept]!, max > 1);
    if (!picked) throw new RunCancelled();
    checkCount(picked.length, min, max, kindOf(accept));
    for (const f of picked) {
      if (!matches(accept, mimeOf(f.name, f.mimeType))) {
        throw new RunError('wrongType', { name: f.name, kind: kindOf(accept) });
      }
    }
    checkSizes(picked);
    const type = FILE_ACCEPT[accept] as FileValueType;
    return { type, items: await importPicked(ctx.services, picked, ctx) };
  },

  async 'file.rename'(input, params, ctx) {
    const { template } = params as { template: string };
    const items = fileItems(input);
    const taken: string[] = [];
    const named = items.map((item, i) => {
      const base = renderNameTemplate(template, {
        now: ctx.now(),
        index: i + 1,
        sourceName: item.name,
        ...(item.takenAt !== undefined ? { takenAt: new Date(item.takenAt) } : {}),
      });
      // 同一批文件不重名：报告、报告-2、报告-3。
      const name = baseName(uniqueFileName(base, item.ext, taken));
      taken.push(`${name}.${item.ext}`);
      return { ...item, name };
    });
    // 临时文件也换成新名字（分享出去的文件名就是它）。
    const renamed: RunItem[] = [];
    for (const item of named) {
      const stored = await ctx.services.files.copyToRun(
        item.uri,
        ctx.services.runId,
        freshName(item.name, item.ext),
      );
      renamed.push({ ...item, uri: stored.uri });
    }
    return { ...input!, items: renamed } as typeof input & { items: RunItem[] };
  },

  async 'file.order'(input, _params, ctx) {
    const items = fileItems(input);
    const order = await ctx.services.ui.open('reorder', { items });
    if (!order) throw new RunCancelled();
    if (order.length === 0) throw new RunError('tooFew', { min: 1, kind: 'file' });
    return { ...input!, items: order.map((i) => items[i]!) } as typeof input & {
      items: RunItem[];
    };
  },

  async 'file.save'(input, _params, ctx) {
    const items = await saveItems(ctx.services, fileItems(input), ctx);
    for (const item of items) if (item.assetId) ctx.saved.push(item.assetId);
    return { ...input!, items } as typeof input & { items: RunItem[] };
  },

  async 'out.share'(input, _params, ctx) {
    await ctx.services.files.shareUris(fileItems(input));
    return input!;
  },

  async 'out.saveToPhotos'(input, _params, ctx) {
    await ctx.services.files.saveToPhotos(fileItems(input).map((i) => i.uri));
    return input!;
  },

  async 'out.print'(input, _params, ctx) {
    for (const item of fileItems(input)) await ctx.services.files.print(item);
    return input!;
  },
};
