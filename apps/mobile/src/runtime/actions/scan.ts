import { RunCancelled, RunError, type ActionImpl, type RunItem } from '@morph/core';
import {
  clampQuad,
  isConvexQuad,
  orderQuad,
  pickPaper,
  quadArea,
  warpSize,
  type GrayImage,
  type Point,
  type Quad,
} from '@morph/tool-image';

import type { EnhanceMode } from '../platform';
import {
  displayName,
  fileItems,
  freshName,
  fromBase64,
  imageForPage,
  writeItem,
  type RunServices,
} from './helpers';

// 扫描（T5）：找边 → 用户在本地确认或拖动四个角 → 透视矫正；增强用 Skia。
// 找边和矫正在 iOS 上用系统的 Vision / Core Image（D-086），其他平台用扫描包页面（OpenCV.js）；
// 两边都只给候选，选哪个是同一套 pickPaper（D-327）。
// 系统文档相机拍的页面已经拉正，直接放行。

type Impl = ActionImpl<RunServices>;

/** 送进找边的照片长边（12 MP 照片 4032 px 原样送进去，在原图上矫正）。 */
const SCAN_INPUT_SIDE = 4096;
/** 拉正后的页面长边：A4 约 200 dpi。文档相机的页面也缩到这么大。 */
export const SCAN_OUTPUT_SIDE = 2400;
/** 找到的纸张小于照片的 1/10 时当作没找到（多半是噪点）。 */
const MIN_PAPER_SHARE = 0.1;

/** 能当作纸张的四边形：凸的、不小于照片的 1/10。 */
function usableQuad(quad: Quad, size: { width: number; height: number }): boolean {
  return isConvexQuad(quad) && quadArea(quad) >= size.width * size.height * MIN_PAPER_SHARE;
}

/** 扫描包页面的找边结果：几个候选（每个四个点）和一张小灰度图，由 pickPaper 挑（D-326）。 */
interface PackDetect {
  candidates: Point[][];
  gray: { width: number; height: number; data: string };
}

/**
 * 展平拉正后的页面（D-274，参数 flatten 不写成 false 就做）：展平模型没装（用户没下载）时原样返回，照常扫描。
 * 某一页展平失败也只是这一页不展平，不让整个扫描失败。
 */
async function flattenPages(
  items: RunItem[],
  params: Record<string, unknown>,
  ctx: Parameters<Impl>[2],
): Promise<RunItem[]> {
  const vision = ctx.services.files.vision;
  if (params.flatten === false || !vision?.flatten) return items;
  const out: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    ctx.throwIfCancelled();
    let page;
    try {
      page = await vision.flatten(item.uri, ctx.services.runId, freshName(item.name, 'jpg'));
    } catch {
      out.push(item);
      continue;
    }
    // 模型没装：后面的页也一样，原样返回。
    if (!page) return [...out, ...items.slice(i)];
    const { takenAt } = item;
    out.push({
      uri: page.uri,
      name: item.name,
      ext: 'jpg',
      mimeType: 'image/jpeg',
      size: page.size,
      width: page.width,
      height: page.height,
      ...(takenAt !== undefined ? { takenAt } : {}),
    });
    ctx.progress(i + 1, items.length);
  }
  return out;
}

export const SCAN_IMPLS: Record<string, Impl> = {
  async 'scan.detect'(input, params, ctx) {
    const items = fileItems(input);
    // 文档相机拍的页面已经拉正；全部是这样的页面时不需要找边，也不打开四角界面（展平照样做）。
    const todo = items.filter((item) => !item.straightened);
    if (todo.length === 0) return { type: 'images', items: await flattenPages(items, params, ctx) };
    const { packs } = ctx.services;
    // Android 的 ML Kit 不能给照片找边，退回扫描包。
    const native = ctx.services.files.vision;
    const vision = native?.canFindPaper ? native : null;
    if (!vision && !packs) throw new RunError('packFailed', { detail: 'scan' });
    const found: { item: RunItem; quad: Quad | null }[] = [];
    for (const [i, original] of todo.entries()) {
      ctx.throwIfCancelled();
      const item = await imageForPage(ctx.services, original, SCAN_INPUT_SIDE);
      const size = { width: item.width!, height: item.height! };
      let detected: Quad | null;
      try {
        // 找边只给候选和灰度图，两个平台都用 pickPaper 挑（D-326、D-327）。
        let paper: { candidates: Point[][]; gray: GrayImage };
        if (vision) {
          paper = await vision.findPaper(item.uri);
        } else {
          const { candidates, gray } = await packs!.runtime.call<PackDetect>(
            'scan',
            'detect',
            { file: 'input', maxSide: 1000 },
            { input: item.uri },
          );
          paper = { candidates, gray: { ...gray, data: fromBase64(gray.data) } };
        }
        const quads = paper.candidates
          .map((pts) => clampQuad(orderQuad(pts), size))
          .filter((q) => usableQuad(q, size));
        detected = pickPaper(quads, size, paper.gray);
      } catch (e) {
        const detail = String(e instanceof Error ? e.message : e);
        throw new RunError(vision ? 'unexpected' : 'packFailed', { detail });
      }
      const quad = detected ? clampQuad(detected, size) : null;
      const usable = quad && usableQuad(quad, size);
      found.push({ item, quad: usable ? quad : null });
      ctx.progress(i + 1, todo.length);
    }
    // 找边在背景杂乱或纸张出画时会出错，所以每张都请用户确认四个角（不是可选的）。
    const quads = await ctx.services.ui.open('corners', { items: found });
    if (!quads) throw new RunCancelled();
    const straightened: RunItem[] = [];
    for (const [i, { item }] of found.entries()) {
      ctx.throwIfCancelled();
      const quad = clampQuad(quads[i]!, { width: item.width!, height: item.height! });
      const size = warpSize(quad, SCAN_OUTPUT_SIDE);
      const { takenAt } = todo[i]!;
      const meta = {
        name: item.name,
        ext: 'jpg',
        mimeType: 'image/jpeg',
        ...(takenAt !== undefined ? { takenAt } : {}),
      };
      try {
        if (vision) {
          const page = await vision.straighten(
            item.uri,
            quad,
            size,
            ctx.services.runId,
            freshName(item.name, 'jpg'),
          );
          straightened.push({ ...meta, uri: page.uri, size: page.size, ...size });
        } else {
          const page = await packs!.runtime.call<{ width: number; height: number; data: string }>(
            'scan',
            'warp',
            { file: 'input', quad, ...size, quality: 0.9 },
            { input: item.uri },
          );
          straightened.push(
            await writeItem(ctx.services, fromBase64(page.data), {
              ...meta,
              width: page.width,
              height: page.height,
            }),
          );
        }
      } catch {
        throw new RunError('unreadable', { name: displayName(todo[i]!) });
      }
      ctx.progress(i + 1, found.length);
    }
    // 按原来的顺序放回（已经拉正的页面原样保留）。
    const out = items.map((item) => (item.straightened ? item : straightened.shift()!));
    return { type: 'images', items: await flattenPages(out, params, ctx) };
  },

  async 'scan.enhance'(input, params, ctx) {
    const items = fileItems(input);
    const mode = params.mode as EnhanceMode | 'none';
    if (mode === 'none') return { type: 'images', items };
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      let encoded;
      try {
        encoded = await ctx.services.files.enhanceImage(
          item.uri,
          mode,
          ctx.services.runId,
          freshName(item.name, 'jpg'),
        );
      } catch {
        throw new RunError('unreadable', { name: displayName(item) });
      }
      const { takenAt } = item;
      out.push({
        uri: encoded.uri,
        name: item.name,
        ext: 'jpg',
        mimeType: 'image/jpeg',
        size: encoded.size,
        width: encoded.width,
        height: encoded.height,
        ...(takenAt !== undefined ? { takenAt } : {}),
        // 识别文字用增强前的图（D-267）。
        ocrSource: {
          uri: item.uri,
          for: encoded.uri,
          width: encoded.base.width,
          height: encoded.base.height,
          skew: encoded.skew,
        },
      });
      ctx.progress(i + 1, items.length);
    }
    return { type: 'images', items: out };
  },
};
