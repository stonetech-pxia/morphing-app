// 拼接、宫格、水印的排版计算。App 用 Skia 按这些矩形绘制，这里只算位置。

import type { Rect, Size } from './geometry';

// ---- 长图拼接 ----

export interface StitchOptions {
  direction: 'vertical' | 'horizontal';
  gapPx: number;
  /** 单张输出的最长边（GPU 纹理上限）。 */
  maxSide?: number;
  /** 竖拼的统一宽度；默认取最窄图片的宽度（不放大）。 */
  outputWidth?: number;
  /** 横拼的统一高度；默认取最矮图片的高度。 */
  outputHeight?: number;
}

export interface StitchPlacement extends Rect {
  /** 输入图片序号。 */
  index: number;
  /** 竖拼时图片被切开：源图上的起始行和行数。 */
  srcY?: number;
  srcHeight?: number;
  /** 横拼时图片被切开：源图上的起始列和列数。 */
  srcX?: number;
  srcWidth?: number;
}

export interface StitchSegment {
  width: number;
  height: number;
  placements: StitchPlacement[];
}

/**
 * 统一宽度（竖拼）或高度（横拼）后依次排列；总长超过 maxSide 时拆成多张输出。
 * 单张图片本身超过 maxSide 时跨段切开，用 src 子区域描述每一段取源图的哪部分。
 */
export function layoutStitch(
  sizes: readonly Size[],
  options: StitchOptions,
): { segments: StitchSegment[] } {
  const { direction, gapPx, maxSide = 16384 } = options;
  const vertical = direction === 'vertical';
  const across = (s: Size) => (vertical ? s.width : s.height);
  const along = (s: Size) => (vertical ? s.height : s.width);
  if (sizes.length === 0) return { segments: [] };
  const wanted = vertical ? options.outputWidth : options.outputHeight;
  const cross = Math.min(maxSide, Math.round(wanted ?? Math.min(...sizes.map(across))));
  if (!(cross >= 1)) throw new RangeError('outputSize');

  const segments: StitchSegment[] = [];
  let placements: StitchPlacement[] = [];
  let length = 0;
  const close = () => {
    segments.push(
      vertical
        ? { width: cross, height: length, placements }
        : { width: length, height: cross, placements },
    );
    placements = [];
    length = 0;
  };

  sizes.forEach((size, index) => {
    const src = along(size);
    const total = Math.max(1, Math.round((src * cross) / across(size)));
    let done = 0;
    while (done < total) {
      const start = placements.length > 0 ? length + gapPx : 0;
      const rest = total - done;
      if (rest > maxSide - start && placements.length > 0) {
        close(); // 放不下就换新的一段，尽量不切开图片
        continue;
      }
      const piece = Math.min(rest, maxSide - start);
      const placement: StitchPlacement = vertical
        ? { index, x: 0, y: start, width: cross, height: piece }
        : { index, x: start, y: 0, width: piece, height: cross };
      if (piece < total) {
        const from = Math.round((done * src) / total);
        const to = Math.round(((done + piece) * src) / total);
        if (vertical) {
          placement.srcY = from;
          placement.srcHeight = to - from;
        } else {
          placement.srcX = from;
          placement.srcWidth = to - from;
        }
      }
      placements.push(placement);
      length = start + piece;
      done += piece;
      if (done < total) close();
    }
  });
  if (placements.length > 0) close();
  return { segments };
}

// ---- 宫格拼图 ----

export interface GridOptions {
  columns: number;
  /** 单元格宽/高。 */
  cellAspect: number;
  gapPx: number;
  paddingPx: number;
  outputWidth: number;
}

/** 按列数排宫格，单元格大小一致，取整剩下的像素平分到左右两侧。 */
export function layoutGrid(
  count: number,
  options: GridOptions,
): { width: number; height: number; cells: Rect[] } {
  const { columns, cellAspect, gapPx, paddingPx, outputWidth } = options;
  if (!(columns >= 1) || !(cellAspect > 0)) throw new RangeError('grid');
  const cellW = Math.floor((outputWidth - 2 * paddingPx - (columns - 1) * gapPx) / columns);
  if (cellW < 1) throw new RangeError('outputWidth');
  const cellH = Math.max(1, Math.round(cellW / cellAspect));
  const rows = Math.ceil(count / columns);
  const left = Math.floor((outputWidth - (columns * cellW + (columns - 1) * gapPx)) / 2);
  const cells: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % columns;
    const r = Math.floor(i / columns);
    cells.push({
      x: left + c * (cellW + gapPx),
      y: paddingPx + r * (cellH + gapPx),
      width: cellW,
      height: cellH,
    });
  }
  const height = 2 * paddingPx + rows * cellH + Math.max(0, rows - 1) * gapPx;
  return { width: outputWidth, height, cells };
}

// ---- 水印 ----

export type WatermarkPosition = 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft' | 'center';

export interface WatermarkOptions {
  mode: 'corner' | 'tile';
  corner: WatermarkPosition;
  /** 水印宽度占图片短边的比例。 */
  relativeSize: number;
  /** 水印（文字渲染成的图或 logo）的宽/高。 */
  markAspect: number;
  /** 绕各自中心旋转的角度；默认角落 0°、平铺 -30°。 */
  angleDeg?: number;
}

export interface WatermarkLayout {
  /** 未旋转时水印的位置，App 绕矩形中心旋转 angleDeg 后绘制，超出部分裁掉。 */
  rects: Rect[];
  angleDeg: number;
}

/** 角落模式放一个水印；平铺模式错位铺满整张图（含旋转后会露出的角落）。 */
export function layoutWatermark(size: Size, options: WatermarkOptions): WatermarkLayout {
  const { width, height } = size;
  const { mode, corner, relativeSize, markAspect } = options;
  if (!(relativeSize > 0) || !(markAspect > 0)) throw new RangeError('watermark');
  const angleDeg = options.angleDeg ?? (mode === 'tile' ? -30 : 0);
  const short = Math.min(width, height);
  const margin = Math.round(short * 0.03);
  // 水印不超过图片减去边距的范围。
  let markW = Math.min(
    relativeSize * short,
    width - 2 * margin,
    (height - 2 * margin) * markAspect,
  );
  markW = Math.max(1, Math.round(markW));
  const markH = Math.max(1, Math.round(markW / markAspect));

  if (mode === 'corner') {
    const xs = {
      left: margin,
      right: width - margin - markW,
      mid: Math.round((width - markW) / 2),
    };
    const ys = {
      top: margin,
      bottom: height - margin - markH,
      mid: Math.round((height - markH) / 2),
    };
    const [x, y] = {
      topLeft: [xs.left, ys.top] as const,
      topRight: [xs.right, ys.top] as const,
      bottomLeft: [xs.left, ys.bottom] as const,
      bottomRight: [xs.right, ys.bottom] as const,
      center: [xs.mid, ys.mid] as const,
    }[corner];
    return { rects: [{ x, y, width: markW, height: markH }], angleDeg };
  }

  // 用旋转后的外接框算步长，保证相邻水印不重叠；奇数行错开半格。
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = markW * cos + markH * sin;
  const boxH = markW * sin + markH * cos;
  const gap = Math.max(1, markH * 1.5);
  const stepX = boxW + gap;
  const stepY = boxH + gap;
  const cols = Math.ceil((width / 2 + boxW) / stepX);
  const rows = Math.ceil((height / 2 + boxH) / stepY);
  const rects: Rect[] = [];
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols - 1; i <= cols; i++) {
      const cx = width / 2 + i * stepX + (Math.abs(j) % 2 === 1 ? stepX / 2 : 0);
      const cy = height / 2 + j * stepY;
      // 只保留旋转外接框与图片相交的水印。
      if (cx + boxW / 2 < 0 || cx - boxW / 2 > width) continue;
      if (cy + boxH / 2 < 0 || cy - boxH / 2 > height) continue;
      rects.push({
        x: Math.round(cx - markW / 2),
        y: Math.round(cy - markH / 2),
        width: markW,
        height: markH,
      });
    }
  }
  return { rects, angleDeg };
}
