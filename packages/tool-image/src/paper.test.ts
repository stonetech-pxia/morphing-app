import { describe, expect, it } from 'vitest';

import { downscale, syntheticPage, type Page, type PageOptions } from './__fixtures__/pages';
import type { Rect } from './geometry';
import { enhancePixels, paperBackground, PAPER_SIDE, type EnhanceLook } from './paper';

function enhance(page: Page, mode: EnhanceLook) {
  const small = downscale(page.data, page.width, page.height, PAPER_SIDE);
  const bg = paperBackground(small.data, small.width, small.height);
  return { out: enhancePixels(page.data, page.width, page.height, bg, mode), bg };
}

/** 改之前的「提亮」：颜色矩阵 1.35·c − 0.06。 */
function oldAuto(page: Page) {
  return page.data.map((v, i) =>
    i % 4 === 3 ? 255 : Math.round(Math.min(1, Math.max(0, (v / 255) * 1.35 - 0.06)) * 255),
  );
}

function pixels(rgba: Uint8Array, width: number, r: Rect) {
  const list: number[][] = [];
  for (let y = Math.round(r.y); y < Math.round(r.y + r.height); y++) {
    for (let x = Math.round(r.x); x < Math.round(r.x + r.width); x++) {
      const i = (y * width + x) * 4;
      list.push([rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255]);
    }
  }
  return list;
}

const light = ([r, g, b]: number[]) => 0.299 * r! + 0.587 * g! + 0.114 * b!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanLight = (rgba: Uint8Array, width: number, r: Rect) =>
  mean(pixels(rgba, width, r).map(light));
const meanColor = (rgba: Uint8Array, width: number, r: Rect) => {
  const list = pixels(rgba, width, r);
  return [0, 1, 2].map((c) => mean(list.map((p) => p[c]!)));
};

function hue([r, g, b]: number[]) {
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  const d = max - min || 1e-6;
  const h = max === r ? ((g! - b!) / d) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
  return (h * 60 + 360) % 360;
}
const saturation = (c: number[]) => (Math.max(...c) - Math.min(...c)) / (Math.max(...c) || 1);
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** 一行字里的对比度：最亮 10% 的平均（纸）减最暗 10% 的平均（字）。 */
function textContrast(rgba: Uint8Array, width: number, r: Rect) {
  const ls = pixels(rgba, width, r)
    .map(light)
    .sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(ls.length / 10));
  return mean(ls.slice(-k)) - mean(ls.slice(0, k));
}

/** 阴影最深处附近的一行字（在左下角）。 */
function shadowRow(page: Page) {
  const row = page.textRows.find((r) => r.y + r.height > page.shadowPaper.y)!;
  return { ...row, width: row.width * 0.3 };
}

const shadowed: PageOptions = { shadow: 0.45 };

describe('paperBackground + enhancePixels（去阴影，D-266）', () => {
  it('evens out a hand shadow: paper in the shadow ends up nearly as bright as lit paper', () => {
    const page = syntheticPage(shadowed);
    const { out } = enhance(page, 'auto');
    const gap = (img: Uint8Array) =>
      meanLight(img, page.width, page.brightPaper) - meanLight(img, page.width, page.shadowPaper);
    expect(gap(page.data)).toBeGreaterThan(0.4);
    expect(gap(oldAuto(page))).toBeGreaterThan(0.3);
    expect(Math.abs(gap(out))).toBeLessThan(0.05);
    expect(meanLight(out, page.width, page.shadowPaper)).toBeGreaterThan(0.95);
  });

  it('evens out light falling off from one side', () => {
    const page = syntheticPage({ gradient: 0.55 });
    const { out } = enhance(page, 'auto');
    const left = { x: page.width * 0.02, y: page.height * 0.02, width: 20, height: 10 };
    const right = { x: page.width * 0.94, y: page.height * 0.02, width: 20, height: 10 };
    expect(
      meanLight(page.data, page.width, left) - meanLight(page.data, page.width, right),
    ).toBeGreaterThan(0.35);
    expect(
      Math.abs(meanLight(out, page.width, left) - meanLight(out, page.width, right)),
    ).toBeLessThan(0.05);
  });

  it('keeps text contrast in the shadow at least as high as before, and close to lit text', () => {
    const page = syntheticPage(shadowed);
    const { out } = enhance(page, 'auto');
    const lit = page.textRows[2]!;
    const dark = shadowRow(page);
    expect(textContrast(out, page.width, dark)).toBeGreaterThan(
      textContrast(page.data, page.width, dark),
    );
    expect(textContrast(out, page.width, dark)).toBeGreaterThan(
      textContrast(oldAuto(page), page.width, dark),
    );
    expect(textContrast(out, page.width, dark)).toBeGreaterThan(
      0.8 * textContrast(out, page.width, lit),
    );
    expect(textContrast(out, page.width, lit)).toBeGreaterThanOrEqual(
      textContrast(page.data, page.width, lit),
    );
  });

  it('turns paper under warm light white instead of yellow', () => {
    const page = syntheticPage({ warm: true });
    const before = meanColor(page.data, page.width, page.brightPaper);
    expect(before[0]! - before[2]!).toBeGreaterThan(0.2);
    const { out } = enhance(page, 'auto');
    const after = meanColor(out, page.width, page.brightPaper);
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(0.03);
    expect(Math.min(...after)).toBeGreaterThan(0.95);
  });

  it('keeps a red stamp red, even under a shadow and warm light', () => {
    const page = syntheticPage({ stamp: true, warm: true, gradient: 0.7 });
    const { out } = enhance(page, 'auto');
    const core = {
      ...page.stamp,
      x: page.stamp.x + page.stamp.width * 0.3,
      y: page.stamp.y + page.stamp.height * 0.3,
      width: page.stamp.width * 0.4,
      height: page.stamp.height * 0.4,
    };
    const color = meanColor(out, page.width, core);
    expect(hueGap(hue(color), hue([0.78, 0.12, 0.14]))).toBeLessThan(15);
    expect(saturation(color)).toBeGreaterThan(0.6);
    expect(light(color)).toBeLessThan(0.6);
  });

  it('does not wash out a colour photo on the page: colours and the contrast inside it stay', () => {
    const page = syntheticPage({ photo: true, shadow: 0.6 });
    const { out } = enhance(page, 'auto');
    const p = page.photo;
    const spots = [0.1, 0.5, 0.9].map((u) => ({
      x: p.x + p.width * u - 4,
      y: p.y + p.height * 0.5 - 4,
      width: 8,
      height: 8,
    }));
    const lights = spots.map((s) => meanLight(out, page.width, s));
    const before = spots.map((s) => meanLight(page.data, page.width, s));
    // 照片没有被拉成一片白，里面左右的明暗差也还在。
    expect(Math.max(...lights)).toBeLessThan(0.85);
    expect(Math.abs(lights[2]! - lights[0]!)).toBeGreaterThan(
      0.7 * Math.abs(before[2]! - before[0]!),
    );
    for (const s of spots) {
      const before = meanColor(page.data, page.width, s);
      const after = meanColor(out, page.width, s);
      expect(hueGap(hue(after), hue(before))).toBeLessThan(20);
      expect(saturation(after)).toBeGreaterThan(0.5 * saturation(before));
    }
  });

  it('does not wash out a grayscale photo on the page', () => {
    const page = syntheticPage({ grayPhoto: true });
    const { out } = enhance(page, 'auto');
    const middle = {
      x: page.photo.x + page.photo.width * 0.45,
      y: page.photo.y + page.photo.height * 0.4,
      width: 10,
      height: 10,
    };
    expect(meanLight(out, page.width, middle)).toBeLessThan(0.75);
  });

  it('leaves a photo without any paper un-flattened', () => {
    const page = syntheticPage({ noPaper: true });
    const { bg, out } = enhance(page, 'auto');
    expect(bg.paperShare).toBe(0);
    // 每一块的颜色都没被除成同一个颜色：块和块之间的差别保留下来。
    const tiles = [0, 1, 2, 3, 4, 5].map((k) => ({
      x: 10 + 40 * k,
      y: 410,
      width: 20,
      height: 20,
    }));
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ] as const) {
      const before = meanColor(page.data, page.width, tiles[a]!).map(
        (v, c) => v - meanColor(page.data, page.width, tiles[b]!)[c]!,
      );
      const after = meanColor(out, page.width, tiles[a]!).map(
        (v, c) => v - meanColor(out, page.width, tiles[b]!)[c]!,
      );
      for (let c = 0; c < 3; c++) {
        if (Math.abs(before[c]!) > 0.1) expect(Math.sign(after[c]!)).toBe(Math.sign(before[c]!));
      }
      expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(
        0.5 * Math.max(...before.map(Math.abs)),
      );
    }
  });

  it('gray and bw remove the shadow before converting', () => {
    const page = syntheticPage(shadowed);
    const gray = enhance(page, 'gray').out;
    const g = (r: Rect) => meanColor(gray, page.width, r);
    expect(Math.abs(light(g(page.brightPaper)) - light(g(page.shadowPaper)))).toBeLessThan(0.05);
    expect(saturation(g(page.brightPaper))).toBe(0);
    const bw = enhance(page, 'bw').out;
    // 阴影里的纸是白的，阴影里的字是黑的。
    expect(meanLight(bw, page.width, page.shadowPaper)).toBeGreaterThan(0.97);
    const dark = shadowRow(page);
    const ls = pixels(bw, page.width, dark).map(light);
    expect(Math.min(...ls)).toBeLessThan(0.05);
    expect(textContrast(bw, page.width, dark)).toBeGreaterThan(0.9);
  });
});
