import { RunCancelled, RunError, aspectRatio, type ActionImpl, type RunItem } from '@morph/core';
import {
  ID_PHOTO_SPECS,
  centeredCropForAspect,
  layoutGrid,
  layoutPrintSheet,
  layoutStitch,
  layoutWatermark,
  MAX_SURFACE_SIDE,
  searchForTargetSize,
  surfaceScale,
  type Rect,
} from '@morph/tool-image';

import type { DrawOp } from '../platform';
import { displayName, fileItems, freshName, type RunServices } from './helpers';
import { eachImage, encode, formatBytes, sizeOf } from './image';

// T6 图片合成（D-079）：排版在 packages/tool-image 计算，像素由 Skia 离屏绘制（platform.composeImage）。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

/** 拼长图单张的最长边：GPU 离屏画布的上限。超过就分成几张。 */
const STITCH_MAX_SIDE = MAX_SURFACE_SIDE;
/** 拼长图的宽度不超过它（手机截图 1290 左右），控制内存。 */
const STITCH_MAX_CROSS = 1600;
/** 为了拼成一张，宽度最多收窄到这里（再窄字就看不清了）。 */
const STITCH_MIN_CROSS = 720;
/** 宫格输出宽度。 */
const GRID_WIDTH = 2400;
/** 冲印 300 dpi。 */
const PRINT_DPI = 300;

const SHEETS: Record<string, { widthIn: number; heightIn: number }> = {
  '4x6': { widthIn: 4, heightIn: 6 },
  '5x7': { widthIn: 5, heightIn: 7 },
  a4: { widthIn: 8.27, heightIn: 11.69 },
  letter: { widthIn: 8.5, heightIn: 11 },
};

async function compose(
  ctx: Ctx,
  name: string,
  canvas: { width: number; height: number; background: string },
  ops: DrawOp[],
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<RunItem> {
  // 画布超过 GPU 上限会让 App 直接崩溃：整体按比例缩小（大照片加水印、打码，很多张拼宫格）。
  const k = surfaceScale(canvas);
  if (k < 1) {
    canvas = {
      ...canvas,
      width: Math.max(1, Math.floor(canvas.width * k)),
      height: Math.max(1, Math.floor(canvas.height * k)),
    };
    ops = ops.map((op) => scaleOp(op, k));
  }
  let out;
  try {
    out = await ctx.services.files.composeImage(
      canvas,
      ops,
      { format, quality: 0.9 },
      ctx.services.runId,
      freshName(name, format === 'png' ? 'png' : 'jpg'),
    );
  } catch (e) {
    throw new RunError('unexpected', { detail: String(e instanceof Error ? e.message : e) });
  }
  return {
    uri: out.uri,
    name,
    ext: format === 'png' ? 'png' : 'jpg',
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    size: out.size,
    width: out.width,
    height: out.height,
  };
}

const scaleBox = (b: Rect, k: number): Rect => ({
  x: b.x * k,
  y: b.y * k,
  width: b.width * k,
  height: b.height * k,
});

function scaleOp(op: DrawOp, k: number): DrawOp {
  switch (op.kind) {
    case 'image':
      return { ...op, dst: scaleBox(op.dst, k) };
    case 'rect':
      return { ...op, rect: scaleBox(op.rect, k) };
    case 'blur':
      return { ...op, rect: scaleBox(op.rect, k), sigma: op.sigma * k };
    case 'line':
      return {
        ...op,
        x1: op.x1 * k,
        y1: op.y1 * k,
        x2: op.x2 * k,
        y2: op.y2 * k,
        width: Math.max(1, op.width * k),
      };
  }
}

/** 图片按比例铺满格子：居中裁掉多余部分。 */
const cover = (size: { width: number; height: number }, cell: Rect): Rect =>
  centeredCropForAspect(size, cell.width / cell.height);

/**
 * Skia 能直接画的输入：PNG 原样用（截图，没有方向信息）；其他格式（HEIC、带方向的 JPG）先用系统编码器
 * 转成 JPG，顺便按拍摄方向摆正。Skia 解不了 HEIC，也不一定按 EXIF 方向画。
 */
async function drawable(ctx: Ctx, item: RunItem): Promise<RunItem> {
  if (item.mimeType === 'image/png') return { ...item, ...(await sizeOf(ctx, item)) };
  return encode(ctx, item, {}, 'jpeg', 0.95);
}

async function withSizes(ctx: Ctx, items: RunItem[]) {
  const ready: RunItem[] = [];
  for (const item of items) {
    ctx.throwIfCancelled();
    ready.push(await drawable(ctx, item));
  }
  return ready;
}

export const COMPOSE_IMPLS: Record<string, Impl> = {
  async 'image.stitch'(input, params, ctx) {
    const { direction, gapPx, background } = params as {
      direction: 'vertical' | 'horizontal';
      gapPx: number;
      background: string;
    };
    const items = await withSizes(ctx, fileItems(input));
    const sizes = items.map((i) => ({ width: i.width!, height: i.height! }));
    const vertical = direction === 'vertical';
    let across = Math.min(STITCH_MAX_CROSS, ...sizes.map((s) => (vertical ? s.width : s.height)));
    // 总长超过画布上限时先把宽度收窄（不低于 STITCH_MIN_CROSS），尽量拼成一张；还放不下才分段。
    const length =
      sizes.reduce(
        (sum, s) =>
          sum + ((vertical ? s.height : s.width) * across) / (vertical ? s.width : s.height),
        0,
      ) +
      gapPx * (sizes.length - 1);
    if (length > STITCH_MAX_SIDE) {
      across = Math.max(STITCH_MIN_CROSS, Math.floor((across * STITCH_MAX_SIDE) / length));
    }
    const { segments } = layoutStitch(sizes, {
      direction,
      gapPx,
      maxSide: STITCH_MAX_SIDE,
      ...(vertical ? { outputWidth: across } : { outputHeight: across }),
    });
    const out: RunItem[] = [];
    for (const [s, segment] of segments.entries()) {
      ctx.throwIfCancelled();
      const ops: DrawOp[] = segment.placements.map((p) => {
        const size = sizes[p.index]!;
        const src = {
          x: p.srcX ?? 0,
          y: p.srcY ?? 0,
          width: p.srcWidth ?? size.width,
          height: p.srcHeight ?? size.height,
        };
        return {
          kind: 'image',
          source: { uri: items[p.index]!.uri },
          src,
          dst: { x: p.x, y: p.y, width: p.width, height: p.height },
        };
      });
      const name = segments.length > 1 ? `${items[0]!.name}-${s + 1}` : items[0]!.name;
      out.push(
        await compose(ctx, name, { width: segment.width, height: segment.height, background }, ops),
      );
      ctx.progress(s + 1, segments.length);
    }
    return { type: 'images', items: out };
  },

  async 'image.grid'(input, params, ctx) {
    const { columns, cell, gapPx, background } = params as {
      columns: number;
      cell: string;
      gapPx: number;
      background: string;
    };
    const items = await withSizes(ctx, fileItems(input));
    const layout = layoutGrid(items.length, {
      columns,
      cellAspect: aspectRatio(cell) ?? 1,
      gapPx,
      paddingPx: gapPx,
      outputWidth: GRID_WIDTH,
    });
    const ops: DrawOp[] = layout.cells.map((dst, i) => {
      const item = items[i]!;
      return {
        kind: 'image',
        source: { uri: item.uri },
        src: cover({ width: item.width!, height: item.height! }, dst),
        dst,
      };
    });
    const out = await compose(ctx, items[0]!.name, { ...layout, background }, ops);
    return { type: 'images', items: [out] };
  },

  async 'image.redact'(input, params, ctx) {
    const items = await withSizes(ctx, fileItems(input));
    const boxes = await ctx.services.ui.open('redact', { items });
    if (!boxes) throw new RunCancelled();
    const style = params.style as 'blur' | 'black';
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      const size = { width: item.width!, height: item.height! };
      const marks = boxes[i] ?? [];
      // 模糊强度跟着图片大小走：短边的 2%，至少 12 像素，看不出原来的字。
      const sigma = Math.max(12, Math.min(size.width, size.height) * 0.02);
      const ops: DrawOp[] = [
        { kind: 'image', source: { uri: item.uri }, dst: { x: 0, y: 0, ...size } },
        ...marks.map((rect): DrawOp =>
          style === 'black'
            ? { kind: 'rect', rect, color: '#000000' }
            : { kind: 'blur', rect, sigma },
        ),
      ];
      // 打码的原因是隐私：一律重新编码，不保留原图的元数据。
      out.push(await compose(ctx, item.name, { ...size, background: '#FFFFFF' }, ops));
      ctx.progress(i + 1, items.length);
    }
    return { type: 'images', items: out };
  },

  async 'image.watermark'(input, params, ctx) {
    const { text, mode, corner, sizePercent, opacity, color } = params as {
      text: string;
      mode: 'corner' | 'tile';
      corner: 'bottomRight';
      sizePercent: number;
      opacity: number;
      color: string;
    };
    // 用系统字体画成透明 PNG（中日韩文字和 emoji 都能显示），再按排版贴到图上。
    const mark = await ctx.services.files.renderText(text, { fontSize: 160, color, opacity: 1 });
    return eachImage(input, ctx, async (original) => {
      const item = await drawable(ctx, original);
      const size = { width: item.width!, height: item.height! };
      const layout = layoutWatermark(size, {
        mode,
        corner,
        relativeSize: sizePercent / 100,
        markAspect: mark.width / mark.height,
      });
      const ops: DrawOp[] = [
        { kind: 'image', source: { uri: item.uri }, dst: { x: 0, y: 0, ...size } },
        ...layout.rects.map((dst): DrawOp => ({
          kind: 'image',
          source: { bytes: mark.bytes },
          dst,
          angleDeg: layout.angleDeg,
          opacity: opacity / 100,
        })),
      ];
      return compose(ctx, item.name, { ...size, background: '#FFFFFF' }, ops);
    });
  },

  async 'image.idPhoto'(input, params, ctx) {
    const spec = ID_PHOTO_SPECS.find((s) => s.id === params.spec);
    if (!spec) throw new RunError('unexpected', { detail: String(params.spec) });
    const maxKB = Number(params.maxKB);
    // 裁剪和缩放由系统编码器完成（认识 HEIC 和拍摄方向），不需要先转换。
    const items: RunItem[] = [];
    for (const item of fileItems(input)) items.push({ ...item, ...(await sizeOf(ctx, item)) });
    const rects = await ctx.services.ui.open('crop', {
      items,
      aspect: spec.widthMm / spec.heightMm,
    });
    if (!rects) throw new RunCancelled();
    let i = 0;
    return eachImage({ type: 'images', items }, ctx, async (item) => {
      const ops = { crop: rects[i++]!, resize: { width: spec.widthPx, height: spec.heightPx } };
      let last = await encode(ctx, item, ops, 'jpeg', 0.92);
      if (maxKB > 0 && last.size > maxKB * 1024) {
        // 像素尺寸是规格要求的，不能缩小：只降低质量。
        const result = await searchForTargetSize({
          targetBytes: maxKB * 1024,
          minScale: 1,
          encode: async (quality) => {
            ctx.throwIfCancelled();
            last = await encode(ctx, item, ops, 'jpeg', quality);
            return last.size;
          },
        });
        if (!result.met) {
          throw new RunError('targetNotMet', {
            name: displayName(item),
            target: formatBytes(maxKB * 1024),
            got: formatBytes(result.bytes),
          });
        }
      }
      return last;
    });
  },

  async 'image.printSheet'(input, params, ctx) {
    const sheet = SHEETS[String(params.sheet)]!;
    const guides = Boolean(params.guides);
    return eachImage(input, ctx, async (original) => {
      const item = await drawable(ctx, original);
      const size = { width: item.width!, height: item.height! };
      // 照片按 300 dpi 算实际尺寸（证件照步骤输出的就是 300 dpi 的规格像素）。
      const photo = {
        widthMm: (size.width / PRINT_DPI) * 25.4,
        heightMm: (size.height / PRINT_DPI) * 25.4,
      };
      const layout = layoutPrintSheet({
        sheet,
        dpi: PRINT_DPI,
        photo,
        // 冲印店的做法：照片紧挨着排满，靠裁切线分开（2×2 英寸在 4×6 上正好 6 张）。
        gapMm: 0,
        marginMm: 0,
        guides,
      });
      if (layout.placements.length === 0) {
        throw new RunError('doesNotFit', { name: displayName(item) });
      }
      const ops: DrawOp[] = [
        ...layout.placements.map((dst): DrawOp =>
          layout.rotated
            ? // 照片转 90° 放进横着的格子：以格子中心旋转，画的时候宽高对调。
              {
                kind: 'image',
                source: { uri: item.uri },
                dst: {
                  x: dst.x + (dst.width - dst.height) / 2,
                  y: dst.y + (dst.height - dst.width) / 2,
                  width: dst.height,
                  height: dst.width,
                },
                angleDeg: 90,
              }
            : { kind: 'image', source: { uri: item.uri }, dst },
        ),
        ...layout.guides.map((g): DrawOp => ({ kind: 'line', ...g, color: '#BBBBBB', width: 2 })),
      ];
      return compose(
        ctx,
        `${item.name}-${String(params.sheet)}`,
        { width: layout.width, height: layout.height, background: '#FFFFFF' },
        ops,
      );
    });
  },
};
