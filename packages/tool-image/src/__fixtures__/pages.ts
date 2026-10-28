// 合成的「手机拍的纸」（测试用）：白纸上一行行字（2 px 的笔画），可以加手影、光照渐变、暖色光、
// 红色印章、彩色照片、灰度照片。返回 RGBA 和各区域的位置，测试按区域量亮度和颜色。

import type { Rect } from '../geometry';

export interface PageOptions {
  width?: number;
  height?: number;
  /** 左下角一块柔和的手影，最暗处只有这么亮（0–1）。 */
  shadow?: number;
  /** 从左到右的光照渐变，右边只有这么亮。 */
  gradient?: number;
  /** 暖色光（偏黄）。 */
  warm?: boolean;
  /** 右上角一个红色实心印章。 */
  stamp?: boolean;
  /** 中间一张彩色照片（大块，带渐变）。 */
  photo?: boolean;
  /** 中间一张灰度照片（中灰）。 */
  grayPhoto?: boolean;
  /** 整张都是照片，没有纸（很多块不同颜色的拼贴，像真照片一样到处是边）。 */
  noPaper?: boolean;
}

export interface Page {
  width: number;
  height: number;
  data: Uint8Array;
  /** 写了字的几行（字和纸混在一起）。 */
  textRows: Rect[];
  /** 阴影最深处附近的一块纸（没有字）。 */
  shadowPaper: Rect;
  /** 亮处的一块纸（没有字）。 */
  brightPaper: Rect;
  stamp: Rect;
  photo: Rect;
}

const PAPER = [0.93, 0.93, 0.91];
const INK = [0.12, 0.12, 0.14];

export function syntheticPage(o: PageOptions = {}): Page {
  const width = o.width ?? 600;
  const height = o.height ?? 848;
  const data = new Uint8Array(width * height * 4);
  const textRows: Rect[] = [];
  const stamp = { x: width * 0.66, y: height * 0.05, width: width * 0.2, height: width * 0.2 };
  const photo = { x: width * 0.25, y: height * 0.42, width: width * 0.5, height: height * 0.18 };
  const shadowAt = { x: width * 0.18, y: height * 0.82 };
  const shadowRadius = width * 0.32;
  const s = width * 0.06;
  const shadowPaper = { x: shadowAt.x - s / 2, y: shadowAt.y - s / 2, width: s, height: s };
  const brightPaper = { x: width * 0.8, y: height * 0.3, width: s, height: s };
  // 量纸张亮度的两块地方不写字。
  const blank = (x: number, y: number) =>
    [shadowPaper, brightPaper].some(
      (r) => x > r.x - 8 && x < r.x + r.width + 8 && y > r.y - 20 && y < r.y + r.height + 8,
    );
  // 字：每行一串「字」，每个字由几道 2 px 的横竖笔画组成。
  const ink = new Uint8Array(width * height);
  const margin = Math.round(width * 0.08);
  for (let y = Math.round(height * 0.06); y < height * 0.94; y += 26) {
    if (y + 14 > photo.y - 6 && y < photo.y + photo.height + 6) continue;
    textRows.push({ x: margin, y, width: width - 2 * margin, height: 14 });
    for (let x = margin; x < width - margin - 12; x += 16) {
      if (blank(x, y) || blank(x + 12, y)) continue;
      const seed = (x * 31 + y * 17) % 7;
      for (let k = 0; k < 2; k++) {
        const yy = y + 3 + ((seed + k * 3) % 4) * 3;
        for (let dx = 0; dx < 12; dx++)
          for (let dy = 0; dy < 2; dy++) ink[(yy + dy) * width + x + dx] = 1;
      }
      const xx = x + 2 + (seed % 3) * 4;
      for (let dy = 0; dy < 14; dy++)
        for (let dx = 0; dx < 2; dx++) ink[(y + dy) * width + xx + dx] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let color = ink[i] ? INK : PAPER;
      const inStamp =
        o.stamp &&
        Math.hypot(x - stamp.x - stamp.width / 2, y - stamp.y - stamp.height / 2) < stamp.width / 2;
      const inPhoto =
        (o.photo || o.grayPhoto) &&
        x >= photo.x &&
        x < photo.x + photo.width &&
        y >= photo.y &&
        y < photo.y + photo.height;
      if (inStamp) color = [0.78, 0.12, 0.14];
      if (o.noPaper) {
        const tile = Math.floor(x / 40) * 7 + Math.floor(y / 40) * 13;
        color = [
          0.2 + 0.1 * (tile % 6),
          0.25 + 0.12 * ((tile >> 1) % 5),
          0.15 + 0.13 * ((tile >> 2) % 6),
        ];
      } else if (inPhoto) {
        const u = (x - photo.x) / photo.width;
        const v = (y - photo.y) / photo.height;
        color = o.grayPhoto
          ? [0.35 + 0.3 * u, 0.35 + 0.3 * u, 0.35 + 0.3 * u]
          : [0.2 + 0.5 * u, 0.45 + 0.2 * v, 0.75 - 0.4 * u];
      }
      // 光照：渐变 × 手影 × 色温。
      let light = 1;
      if (o.gradient !== undefined) light *= 1 - (1 - o.gradient) * (x / width);
      if (o.shadow !== undefined) {
        const d = Math.hypot(x - shadowAt.x, y - shadowAt.y) / shadowRadius;
        const t = Math.min(1, Math.max(0, (d - 0.55) / 0.45));
        const soft = t * t * (3 - 2 * t);
        light *= o.shadow + (1 - o.shadow) * soft;
      }
      const tint = o.warm ? [1, 0.9, 0.7] : [1, 1, 1];
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = Math.round(Math.min(1, color[c]! * light * tint[c]!) * 255);
      }
      data[i * 4 + 3] = 255;
    }
  }
  return {
    width,
    height,
    data,
    textRows,
    shadowPaper,
    brightPaper,
    stamp,
    photo,
  };
}

/** 按面积平均缩小（和 Skia 用 mipmap 缩小的效果相近），长边缩到 side。 */
export function downscale(rgba: Uint8Array, width: number, height: number, side: number) {
  const k = Math.min(1, side / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++) sum += rgba[(yy * width + xx) * 4 + c]!;
        out[(y * w + x) * 4 + c] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
  }
  return { width: w, height: h, data: out };
}
