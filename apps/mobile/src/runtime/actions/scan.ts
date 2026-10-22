import { RunCancelled, RunError, type ActionImpl, type RunItem } from '@morph/core';
import { clampQuad, isConvexQuad, quadArea, warpSize, type Quad } from '@morph/tool-image';

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

// 扫描（T5）：扫描包页面找边 → 用户在本地确认或拖动四个角 → 扫描包页面透视矫正；增强用 Skia。

type Impl = ActionImpl<RunServices>;

/** 送进扫描包的照片长边（12 MP 照片 4032 px 原样送进去，在原图上矫正）。 */
const SCAN_INPUT_SIDE = 4096;
/** 拉正后的页面长边：A4 约 200 dpi。 */
const SCAN_OUTPUT_SIDE = 2400;
/** 找到的纸张小于照片的 1/10 时当作没找到（多半是噪点）。 */
const MIN_PAPER_SHARE = 0.1;

export const SCAN_IMPLS: Record<string, Impl> = {
  async 'scan.detect'(input, _params, ctx) {
    const items = fileItems(input);
    const packs = ctx.services.packs;
    if (!packs) throw new RunError('packFailed', { detail: 'scan' });
    const found: { item: RunItem; quad: Quad | null }[] = [];
    for (const [i, original] of items.entries()) {
      ctx.throwIfCancelled();
      const item = await imageForPage(ctx.services, original, SCAN_INPUT_SIDE);
      const size = { width: item.width!, height: item.height! };
      let result: { quad: Quad | null };
      try {
        result = await packs.runtime.call(
          'scan',
          'detect',
          { file: 'input', maxSide: 1000 },
          { input: item.uri },
        );
      } catch (e) {
        throw new RunError('packFailed', { detail: String(e instanceof Error ? e.message : e) });
      }
      const quad = result.quad ? clampQuad(result.quad, size) : null;
      const usable =
        quad && isConvexQuad(quad) && quadArea(quad) >= size.width * size.height * MIN_PAPER_SHARE;
      found.push({ item, quad: usable ? quad : null });
      ctx.progress(i + 1, items.length);
    }
    // 找边在背景杂乱或纸张出画时会出错，所以每张都请用户确认四个角（不是可选的）。
    const quads = await ctx.services.ui.open('corners', { items: found });
    if (!quads) throw new RunCancelled();
    const out: RunItem[] = [];
    for (const [i, { item }] of found.entries()) {
      ctx.throwIfCancelled();
      const quad = clampQuad(quads[i]!, { width: item.width!, height: item.height! });
      const { width, height } = warpSize(quad, SCAN_OUTPUT_SIDE);
      let page: { width: number; height: number; data: string };
      try {
        page = await packs.runtime.call(
          'scan',
          'warp',
          { file: 'input', quad, width, height, quality: 0.9 },
          { input: item.uri },
        );
      } catch {
        throw new RunError('unreadable', { name: displayName(items[i]!) });
      }
      const { takenAt } = items[i]!;
      out.push(
        await writeItem(ctx.services, fromBase64(page.data), {
          name: item.name,
          ext: 'jpg',
          mimeType: 'image/jpeg',
          width: page.width,
          height: page.height,
          ...(takenAt !== undefined ? { takenAt } : {}),
        }),
      );
      ctx.progress(i + 1, found.length);
    }
    return { type: 'images', items: out };
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
      });
      ctx.progress(i + 1, items.length);
    }
    return { type: 'images', items: out };
  },
};
