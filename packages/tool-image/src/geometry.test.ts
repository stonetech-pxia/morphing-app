import { describe, expect, it } from 'vitest';

import {
  type Rect,
  type Size,
  capPixels,
  centeredCropForAspect,
  clampCrop,
  cropToOutput,
  resizeDimensions,
  surfaceScale,
} from './geometry';

const photo: Size = { width: 4032, height: 3024 };

function inside(rect: Rect, size: Size): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= size.width &&
    rect.y + rect.height <= size.height &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
  );
}

describe('resizeDimensions', () => {
  it('scales by long edge, width, height and percent keeping aspect', () => {
    expect(resizeDimensions(photo, { mode: 'longEdge', px: 2048 })).toEqual({
      width: 2048,
      height: 1536,
    });
    expect(resizeDimensions({ width: 1000, height: 3000 }, { mode: 'longEdge', px: 1200 })).toEqual(
      { width: 400, height: 1200 },
    );
    expect(resizeDimensions(photo, { mode: 'width', px: 1000 })).toEqual({
      width: 1000,
      height: 750,
    });
    expect(resizeDimensions(photo, { mode: 'height', px: 1000 })).toEqual({
      width: 1333,
      height: 1000,
    });
    expect(resizeDimensions(photo, { mode: 'percent', percent: 25 })).toEqual({
      width: 1008,
      height: 756,
    });
  });

  it('fits inside a box without cropping', () => {
    const box = { mode: 'fit', width: 1080, height: 1080 } as const;
    expect(resizeDimensions(photo, box)).toEqual({ width: 1080, height: 810 });
    expect(resizeDimensions({ width: 3024, height: 4032 }, box)).toEqual({
      width: 810,
      height: 1080,
    });
    // 宽高比极端也不超框
    const r = resizeDimensions(
      { width: 7, height: 10_001 },
      { mode: 'fit', width: 333, height: 333 },
    );
    expect(r.width).toBeLessThanOrEqual(333);
    expect(r.height).toBeLessThanOrEqual(333);
    expect(r.width).toBeGreaterThanOrEqual(1);
  });

  it('never upscales unless allowed', () => {
    const small = { width: 640, height: 480 };
    expect(resizeDimensions(small, { mode: 'longEdge', px: 2048 })).toEqual(small);
    expect(resizeDimensions(small, { mode: 'percent', percent: 200 })).toEqual(small);
    expect(resizeDimensions(small, { mode: 'fit', width: 1920, height: 1080 })).toEqual(small);
    expect(
      resizeDimensions(small, { mode: 'percent', percent: 200 }, { allowUpscale: true }),
    ).toEqual({ width: 1280, height: 960 });
  });

  it('rejects invalid input', () => {
    expect(() => resizeDimensions(photo, { mode: 'width', px: 0 })).toThrow(RangeError);
    expect(() =>
      resizeDimensions({ width: 0, height: 10 }, { mode: 'percent', percent: 50 }),
    ).toThrow(RangeError);
  });
});

describe('centeredCropForAspect', () => {
  it('takes the largest centred rect at the aspect', () => {
    expect(centeredCropForAspect(photo, 1)).toEqual({ x: 504, y: 0, width: 3024, height: 3024 });
    expect(centeredCropForAspect(photo, 16 / 9)).toEqual({
      x: 0,
      y: 378,
      width: 4032,
      height: 2268,
    });
    const id = centeredCropForAspect({ width: 3024, height: 4032 }, 35 / 45);
    expect(id.height).toBe(3888);
    expect(id.width).toBe(3024);
    expect(inside(id, { width: 3024, height: 4032 })).toBe(true);
  });
});

describe('clampCrop', () => {
  const size = { width: 1000, height: 800 };

  it('moves and shrinks a rect back inside the image', () => {
    expect(clampCrop({ x: -50, y: 700, width: 300, height: 200 }, size)).toEqual({
      x: 0,
      y: 600,
      width: 300,
      height: 200,
    });
    expect(clampCrop({ x: 10, y: 10, width: 5000, height: 5000 }, size)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it('enforces the 16px minimum', () => {
    const r = clampCrop({ x: 500, y: 400, width: 2, height: 3 }, size);
    expect(r.width).toBe(16);
    expect(r.height).toBe(16);
    expect(inside(r, size)).toBe(true);
    // 图片本身小于 16px 时以图片为准
    expect(clampCrop({ x: 0, y: 0, width: 4, height: 4 }, { width: 10, height: 8 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 8,
    });
  });

  it('keeps an aspect ratio', () => {
    const aspect = 35 / 45;
    const cases: Rect[] = [
      { x: 100, y: 100, width: 300, height: 300 },
      { x: 900, y: 700, width: 400, height: 520 },
      { x: -200, y: -200, width: 3000, height: 100 },
      { x: 500, y: 400, width: 1, height: 1 },
    ];
    for (const rect of cases) {
      const r = clampCrop(rect, size, { aspect });
      expect(inside(r, size)).toBe(true);
      expect(Math.abs(r.width / r.height - aspect)).toBeLessThan(0.02);
      expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(16);
    }
    // 保持中心和面积
    const r = clampCrop({ x: 100, y: 100, width: 300, height: 300 }, size, { aspect: 1 });
    expect(r).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    // 太大时缩到最大可容纳的比例框
    expect(clampCrop({ x: 0, y: 0, width: 5000, height: 5000 }, size, { aspect: 1 })).toEqual({
      x: 200,
      y: 0,
      width: 800,
      height: 800,
    });
  });
});

describe('cropToOutput', () => {
  it('plans crop + resize and flags upscaling', () => {
    const rect = { x: 10, y: 20, width: 826, height: 1062 };
    expect(cropToOutput(rect, { width: 413, height: 531 })).toEqual({
      crop: rect,
      resize: { width: 413, height: 531 },
      upscale: false,
    });
    expect(
      cropToOutput({ x: 0, y: 0, width: 413, height: 531 }, { width: 413, height: 531 }),
    ).toMatchObject({ resize: null, upscale: false });
    expect(
      cropToOutput({ x: 0, y: 0, width: 200, height: 260 }, { width: 413, height: 531 }),
    ).toMatchObject({ upscale: true });
  });
});

describe('capPixels', () => {
  it('leaves small images alone', () => {
    expect(capPixels(photo)).toEqual(photo);
  });

  it('scales large images under the cap keeping aspect', () => {
    const big = { width: 8000, height: 6000 };
    const r = capPixels(big);
    expect(r.width * r.height).toBeLessThanOrEqual(16_777_216);
    expect(r.width * r.height).toBeGreaterThan(16_777_216 * 0.999);
    expect(Math.abs(r.width / r.height - 4 / 3)).toBeLessThan(0.001);
    const long = capPixels({ width: 1080, height: 60_000 }, 4_000_000);
    expect(long.width * long.height).toBeLessThanOrEqual(4_000_000);
    expect(capPixels({ width: 100_000, height: 1 }, 1000)).toEqual({ width: 1000, height: 1 });
  });
});

describe('surfaceScale', () => {
  it('keeps small canvases and shrinks ones the GPU cannot hold', () => {
    expect(surfaceScale({ width: 1290, height: 8000 })).toBe(1);
    expect(surfaceScale({ width: 1290, height: 16384 })).toBe(0.5);
    // 4800 万像素的照片缩到 1677 万像素以内。
    const k = surfaceScale({ width: 8000, height: 6000 });
    expect(Math.floor(8000 * k) * Math.floor(6000 * k)).toBeLessThanOrEqual(16_777_216);
  });
});
