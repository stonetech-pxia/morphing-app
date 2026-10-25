import {
  t,
  FILE_ACCEPT,
  OFFICE_MIME_TYPES,
  RunCancelled,
  isOfficeFile,
  RunError,
  mediaKindOf,
  renderNameTemplate,
  sanitizeFileName,
  shareFitsInput,
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
  isMediaFile,
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
  videos: ['video/*'],
  audio: ['audio/*'],
  documents: [...OFFICE_MIME_TYPES],
  any: ['*/*'],
};

const KINDS: Record<string, string> = {
  pdf: 'PDF',
  images: 'image',
  videos: 'video',
  audio: 'audio',
  documents: 'document',
};
const kindOf = (accept: string) => KINDS[accept] ?? 'PDF/image';

function matches(accept: string, mime: string, name: string): boolean {
  switch (accept) {
    case 'pdf':
      return mime === 'application/pdf';
    case 'images':
      return isImageMime(mime);
    case 'pdfOrImages':
      return mime === 'application/pdf' || isImageMime(mime);
    case 'videos':
      return mediaKindOf(mime, name) === 'video';
    case 'audio':
      return mediaKindOf(mime, name) === 'audio';
    case 'documents':
      return isOfficeFile(mime, name);
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
    // 视频和音频可能有几个 GB：不复制，移进来或原地使用（D-142）。
    const media = isMediaFile({ name: clean, mimeType });
    let stored;
    try {
      stored = media
        ? await services.files.adoptIntoRun(
            f.uri,
            services.runId,
            freshName(name, ext),
            !!services.incoming,
          )
        : await services.files.copyToRun(f.uri, services.runId, freshName(name, ext));
    } catch {
      throw new RunError('accessDenied', { name: f.name });
    }
    items.push({
      uri: stored.uri,
      name,
      ext,
      mimeType,
      size: stored.size || f.size || 0,
      ...(f.width ? { width: f.width } : {}),
      ...(f.height ? { height: f.height } : {}),
      ...(f.takenAt !== undefined ? { takenAt: f.takenAt } : {}),
      ...(f.straightened ? { straightened: true } : {}),
      ...(f.durationMs ? { durationMs: f.durationMs } : {}),
    });
    ctx.progress(i + 1, picked.length);
  }
  checkSizes(
    items.map((i) => ({ name: `${i.name}.${i.ext}`, size: i.size, mimeType: i.mimeType })),
  );
  return items;
}

/**
 * 这个快捷操作上次存下的结果（D-197）：运行记录里最近一次成功、存了文件的那次。文件已经删了、
 * 或者没有授权给它（§7G）时为 null。
 */
async function lastResult(ctx: Parameters<Impl>[2]): Promise<PickedFile | null> {
  const { repo, files, grantee } = ctx.services;
  const run = (await repo.listToolRuns(200)).find(
    (r) => r.workflowId === ctx.workflow.id && r.status === 'succeeded' && r.outputAssetId,
  );
  const asset = run ? await repo.getAsset(run.outputAssetId!) : null;
  if (!asset || !(await repo.hasGrant(grantee, asset.id))) return null;
  return {
    uri: files.fileUri(asset.path),
    name: asset.name,
    size: asset.size,
    mimeType: asset.mimeType,
  };
}

function addExistingQuestion(locale: import('@morph/core').Locale, last: string | null) {
  return {
    title: t(locale, 'io_Add_which_existing_file_a4bbf'),
    message: t(locale, 'io_It_goes_together_with_this_run_s_files_03244'),
    options: [
      ...(last ? [t(locale, 'io_Last_one_15660', { v0: last })] : []),
      t(locale, 'io_Choose_one_in_Files_e6073'),
      t(locale, 'io_Start_a_new_one_this_time_6e970'),
    ],
  };
}

function checkCount(count: number, min: number, max: number, kind: string) {
  if (count < min) throw new RunError('tooFew', { min, kind });
  if (count > max) throw new RunError('tooMany', { max });
}

/**
 * 从别的 App 分享进来的文件（D-115）：只在第一步用，代替选择器。类型、个数、大小和选择器一样检查，
 * 收件页面已经只列出接得上的工作流，这里是再检查一次。
 */
async function importShared(
  ctx: Parameters<Impl>[2],
  params: Record<string, unknown>,
  kind: string,
): Promise<{ type: FileValueType; items: RunItem[] } | null> {
  const shared = ctx.index === 0 ? ctx.services.incoming : null;
  if (!shared) return null;
  const infos = shared.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) }));
  const fit = shareFitsInput(ctx.action.id, params, infos);
  if (!fit.ok) {
    if (fit.reason === 'tooFew') throw new RunError('tooFew', { min: fit.min, kind });
    if (fit.reason === 'tooMany') throw new RunError('tooMany', { max: fit.max });
    throw new RunError('wrongType', { name: shared[0]?.name ?? '', kind });
  }
  checkSizes(infos);
  return { type: fit.type, items: await importPicked(ctx.services, shared, ctx) };
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
    const shared = await importShared(ctx, params, 'image');
    if (shared) return shared;
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

      while (picked.length < max) {
        const photo = await files.takePhoto();
        if (!photo) break;
        picked.push(photo);
        if (picked.length >= max) break;
        const more = await ui.confirm(
          t(ctx.locale, 'io_taken_af2cf', { v0: picked.length }),
          t(ctx.locale, 'io_Take_another_1b43d'),
          t(ctx.locale, 'io_Done_6f135'),
        );
        if (!more) break;
      }
      if (picked.length === 0) throw new RunCancelled();
    } else if (source === 'files') {
      // 从「文件」选（D-184）：下载的、电脑传来的图片，包括 HEIC。
      const result = await files.pickDocuments(DOCUMENT_TYPES.images!, max > 1);
      if (!result) throw new RunCancelled();
      for (const f of result) {
        if (!isImageMime(mimeOf(f.name, f.mimeType))) {
          throw new RunError('wrongType', { name: f.name, kind: 'image' });
        }
      }
      picked = result;
    } else {
      const result = await files.pickPhotos(max);
      if (!result) throw new RunCancelled();
      picked = result;
    }
    checkCount(picked.length, min, max, 'image');
    checkSizes(picked);
    return { type: 'images', items: await importPicked(ctx.services, picked, ctx) };
  },

  async 'in.videos'(_input, params, ctx) {
    const shared = await importShared(ctx, params, 'video');
    if (shared) return shared;
    const { source, min, max } = params as { source?: string; min: number; max: number };
    // 从「文件」选（D-185）：电脑拷来的、下载的视频一般不在相册里。
    const picked =
      source === 'files'
        ? await ctx.services.files.pickDocuments(DOCUMENT_TYPES.videos!, max > 1)
        : await ctx.services.files.pickVideos(max);
    if (!picked) throw new RunCancelled();
    checkCount(picked.length, min, max, 'video');
    for (const f of picked) {
      if (mediaKindOf(mimeOf(f.name, f.mimeType), f.name) !== 'video') {
        throw new RunError('wrongType', { name: f.name, kind: 'video' });
      }
    }
    checkSizes(picked.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) })));
    return { type: 'video', items: await importPicked(ctx.services, picked, ctx) };
  },

  // 音频（D-154）：从「文件」选，或者打开录音界面现在录一段；分享进来的录音直接用。
  async 'in.audio'(_input, params, ctx) {
    const shared = await importShared(ctx, params, 'audio');
    if (shared) return shared;
    const { source, min, max } = params as { source: 'files' | 'record'; min: number; max: number };
    if (source === 'record') {
      const name = renderNameTemplate(t(ctx.locale, 'io_Recording_1a04e'), {
        now: ctx.now(),
        index: 1,
        sourceName: '',
      });
      const recorded = await ctx.services.ui.open('record', { name });
      if (!recorded) throw new RunCancelled();
      return { type: 'audio', items: await importPicked(ctx.services, [recorded], ctx) };
    }
    const picked = await ctx.services.files.pickDocuments(DOCUMENT_TYPES.audio!, max > 1);
    if (!picked) throw new RunCancelled();
    checkCount(picked.length, min, max, 'audio');
    for (const f of picked) {
      if (mediaKindOf(mimeOf(f.name, f.mimeType), f.name) !== 'audio') {
        throw new RunError('wrongType', { name: f.name, kind: 'audio' });
      }
    }
    checkSizes(picked.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) })));
    return { type: 'audio', items: await importPicked(ctx.services, picked, ctx) };
  },

  async 'in.files'(_input, params, ctx) {
    const { accept, min, max } = params as { accept: string; min: number; max: number };
    const shared = await importShared(ctx, params, kindOf(accept));
    if (shared) return shared;
    const picked = await ctx.services.files.pickDocuments(DOCUMENT_TYPES[accept]!, max > 1);
    if (!picked) throw new RunCancelled();
    checkCount(picked.length, min, max, kindOf(accept));
    for (const f of picked) {
      if (!matches(accept, mimeOf(f.name, f.mimeType), f.name)) {
        throw new RunError('wrongType', { name: f.name, kind: kindOf(accept) });
      }
    }
    checkSizes(picked.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) })));
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
    const { files, runId } = ctx.services;
    for (const item of named) {
      const fileName = freshName(item.name, item.ext);
      // 视频和音频很大：临时文件直接改名（移动），只有分享进来的原件才复制（D-142）。
      let uri: string | null = null;
      if (isMediaFile({ name: `${item.name}.${item.ext}`, mimeType: item.mimeType })) {
        const moved = await files.adoptIntoRun(item.uri, runId, fileName);
        if (moved.uri !== item.uri) uri = moved.uri;
      }
      uri ??= (await files.copyToRun(item.uri, runId, fileName)).uri;
      renamed.push({ ...item, uri });
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

  async 'file.addExisting'(input, params, ctx) {
    const items = fileItems(input);
    const last = await lastResult(ctx);
    const q = addExistingQuestion(ctx.locale, last?.name ?? null);
    const answer = await ctx.services.ui.choose(q.title, q.message, q.options);
    if (answer === null) throw new RunCancelled();
    const choice = last ? answer : answer + 1;
    let picked: PickedFile[] | null;
    if (choice === 0) picked = [last!];
    else if (choice === 1) {
      picked = await ctx.services.files.pickDocuments(DOCUMENT_TYPES.pdfOrImages!, false);
      if (!picked) throw new RunCancelled();
      for (const f of picked) {
        if (!matches('pdfOrImages', mimeOf(f.name, f.mimeType), f.name)) {
          throw new RunError('wrongType', { name: f.name, kind: kindOf('pdfOrImages') });
        }
      }
    } else return { type: 'files', items };
    const added = await importPicked(ctx.services, picked, ctx);
    return {
      type: 'files',
      items: params.position === 'before' ? [...added, ...items] : [...items, ...added],
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

  async 'out.saveToFolder'(input, _params, ctx) {
    // 有记住的文件夹就直接存进去，第一次才让用户选（D-123）；每个快捷操作记自己的（D-196）。
    // 用户关掉选择器不算失败（和关掉分享面板一样），结果页上还可以再存。
    await ctx.services.files.saveToFolder(fileItems(input), ctx.workflow.id);
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
