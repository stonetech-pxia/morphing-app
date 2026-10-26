import { describe, expect, it } from 'vitest';

import { DEFAULT_HEAD_RATIO, HEAD_RATIO, ID_PHOTO_SPECS, faceCrop, mainFace } from './id-photo';

const spec = (id: string) => ID_PHOTO_SPECS.find((s) => s.id === id)!;
const aspect = (id: string) => spec(id).widthMm / spec(id).heightMm;

describe('faceCrop (D-252)', () => {
  // 一张 3024×4032 的竖拍自拍，脸框 800×1000，在画面中间偏上。
  const image = { width: 3024, height: 4032 };
  const face = { x: 1100, y: 1200, width: 800, height: 1000 };

  it('makes the head take the share of the photo the spec asks for, centered left to right', () => {
    const crop = faceCrop(image, face, aspect('schengen'), HEAD_RATIO.schengen!);
    const head = 1000 * 1.45;
    expect(crop.height).toBeCloseTo(head / 0.75, -1);
    expect(crop.width / crop.height).toBeCloseTo(35 / 45, 2);
    // 脸的中线在裁剪框中间。
    expect(crop.x + crop.width / 2).toBeCloseTo(face.x + face.width / 2, 0);
    // 头顶上面的空白比下巴下面少（40% / 60%）。
    const crown = face.y + face.height - head;
    const above = crown - crop.y;
    const below = crop.y + crop.height - (face.y + face.height);
    expect(above / (above + below)).toBeCloseTo(0.4, 2);
  });

  it('a square US photo frames the head smaller than a Schengen one', () => {
    const us = faceCrop(image, face, aspect('us-passport'), HEAD_RATIO['us-passport']!);
    const eu = faceCrop(image, face, aspect('schengen'), HEAD_RATIO.schengen!);
    expect(us.width).toBe(us.height);
    expect(us.height).toBeGreaterThan(eu.height);
  });

  it('never goes outside the photo: a face near the edge or a small photo shrinks the frame', () => {
    const edge = faceCrop(image, { x: 0, y: 0, width: 800, height: 1000 }, 1, DEFAULT_HEAD_RATIO);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    const small = faceCrop(
      { width: 600, height: 400 },
      { x: 200, y: 100, width: 200, height: 250 },
      35 / 45,
      0.75,
    );
    expect(small.x).toBeGreaterThanOrEqual(0);
    expect(small.y).toBeGreaterThanOrEqual(0);
    expect(small.x + small.width).toBeLessThanOrEqual(600);
    expect(small.y + small.height).toBeLessThanOrEqual(400);
    expect(small.width / small.height).toBeCloseTo(35 / 45, 1);
  });

  it('picks the biggest face when there are several', () => {
    expect(mainFace([])).toBeNull();
    expect(mainFace([{ x: 0, y: 0, width: 10, height: 10 }, face])).toBe(face);
  });
});
