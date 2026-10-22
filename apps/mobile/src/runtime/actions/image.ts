import { RunCancelled, RunError, aspectRatio, type ActionImpl, type RunItem } from '@morph/core';
import {
  readExif,
  resizeDimensions,
  searchForTargetSize,
  stripJpegMetadata,
  type ResizeSpec,
} from '@morph/tool-image';

import type { ImageFormat, ImageOps } from '../platform';
import { fileItems, freshName, readItem, writeItem, type RunServices } from './helpers';

// 图片动作的实现。像素处理交给平台（expo-image-manipulator），算法在 packages/tool-image。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

const EXT: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 保持原格式；HEIC 等不能输出的格式改成 JPG（D-047：默认永远不输出 HEIC）。 */
function keepFormat(item: RunItem): ImageFormat {
  if (item.mimeType === 'image/png') return 'png';
  if (item.mimeType === 'image/webp') return 'webp';
  return 'jpeg';
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

export async function sizeOf(ctx: Ctx, item: RunItem) {
  if (item.width && item.height) return { width: item.width, height: item.height };
  try {
    return await ctx.services.files.imageSize(item.uri);
  } catch {
    throw new RunError('unreadable', { name: `${item.name}.${item.ext}` });
  }
}

/** 处理一张图片，输出本次运行里的新临时文件。 */
export async function encode(
  ctx: Ctx,
  item: RunItem,
  ops: ImageOps,
  format: ImageFormat,
  quality: number,
): Promise<RunItem> {
  let out;
  try {
    out = await ctx.services.files.transformImage(
      item.uri,
      ops,
      { format, quality },
      ctx.services.runId,
      freshName(item.name, EXT[format]),
    );
  } catch {
    throw new RunError('unreadable', { name: `${item.name}.${item.ext}` });
  }
  const { takenAt } = item;
  return {
    uri: out.uri,
    name: item.name,
    ext: EXT[format],
    mimeType: MIME[format],
    size: out.size,
    width: out.width,
    height: out.height,
    ...(takenAt !== undefined ? { takenAt } : {}),
  };
}

/** 逐张处理，带进度和取消。 */
export async function eachImage(
  input: Parameters<Impl>[0],
  ctx: Ctx,
  fn: (item: RunItem) => Promise<RunItem>,
) {
  const items = fileItems(input);
  const out: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    ctx.throwIfCancelled();
    out.push(await fn(item));
    ctx.progress(i + 1, items.length);
  }
  return { type: 'images' as const, items: out };
}

export const IMAGE_IMPLS: Record<string, Impl> = {
  async 'image.convert'(input, params, ctx) {
    const { format, quality } = params as { format: ImageFormat; quality: number };
    return eachImage(input, ctx, (item) => encode(ctx, item, {}, format, quality / 100));
  },

  async 'image.resize'(input, params, ctx) {
    const spec = params as unknown as ResizeSpec;
    return eachImage(input, ctx, async (item) => {
      const size = await sizeOf(ctx, item);
      const target = resizeDimensions(size, spec);
      const format = keepFormat(item);
      return encode(ctx, item, { resize: target }, format, 0.9);
    });
  },

  async 'image.compress'(input, params, ctx) {
    const { maxKB, format } = params as { maxKB: number; format: ImageFormat };
    const target = maxKB * 1024;
    return eachImage(input, ctx, async (item) => {
      const size = await sizeOf(ctx, item);
      let last: RunItem | null = null;
      const result = await searchForTargetSize({
        targetBytes: target,
        // 最小缩到长边 64 像素，避免压成看不清的小图。
        minScale: Math.min(1, 64 / Math.max(size.width, size.height)),
        encode: async (quality, scale) => {
          ctx.throwIfCancelled();
          const resize =
            scale < 1
              ? {
                  width: Math.max(1, Math.round(size.width * scale)),
                  height: Math.max(1, Math.round(size.height * scale)),
                }
              : undefined;
          last = await encode(ctx, item, resize ? { resize } : {}, format, quality);
          return last.size;
        },
      });
      if (!result.met || !last) {
        throw new RunError('targetNotMet', {
          name: `${item.name}.${item.ext}`,
          target: formatBytes(target),
          got: formatBytes(result.bytes),
        });
      }
      return last;
    });
  },

  async 'image.crop'(input, params, ctx) {
    const items = fileItems(input);
    const sized: RunItem[] = [];
    for (const item of items) sized.push({ ...item, ...(await sizeOf(ctx, item)) });
    const rects = await ctx.services.ui.open('crop', {
      items: sized,
      aspect: aspectRatio(String(params.aspect)),
    });
    if (!rects) throw new RunCancelled();
    let i = 0;
    return eachImage({ type: 'images', items: sized }, ctx, (item) =>
      encode(ctx, item, { crop: rects[i++]! }, keepFormat(item), 0.92),
    );
  },

  async 'image.rotate'(input, params, ctx) {
    const { angle, flip } = params as { angle: 0 | 90 | 180 | 270; flip: string };
    const ops: ImageOps = {
      ...(angle ? { rotate: angle } : {}),
      ...(flip !== 'none' ? { flip: flip as 'horizontal' | 'vertical' } : {}),
    };
    return eachImage(input, ctx, (item) => encode(ctx, item, ops, keepFormat(item), 0.92));
  },

  async 'image.stripMetadata'(input, _params, ctx) {
    return eachImage(input, ctx, async (item) => {
      if (item.mimeType === 'image/jpeg') {
        const bytes = await readItem(ctx.services, item);
        const { orientation } = readExif(bytes);
        // 方向是 1（或没有）时无损去掉；否则先按方向摆正再重新编码，避免照片转向。
        if (orientation === null || orientation === 1) {
          try {
            const stripped = stripJpegMetadata(bytes).bytes;
            const { uri: _uri, size: _size, ...rest } = item;
            return await writeItem(ctx.services, stripped, rest);
          } catch {
            // 不是标准 JPEG：退回重新编码。
          }
        }
      }
      return encode(ctx, item, {}, 'jpeg', 0.92);
    });
  },
};
