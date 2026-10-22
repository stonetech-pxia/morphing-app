import { type Mock, describe, expect, it, vi } from 'vitest';

import { type EncodeFn, searchForTargetSize, searchSharedQuality } from './size-search';

/** 模型编码器：体积 ∝ 面积 × f(质量)，加上固定的文件头开销。 */
function model(base: number, header = 600): Mock<EncodeFn> {
  return vi.fn<EncodeFn>(async (q, s) => Math.round(header + base * s * s * (0.15 + 0.85 * q * q)));
}

function lastCall(fn: Mock<EncodeFn>): unknown[] {
  return fn.mock.calls.at(-1) ?? [];
}

describe('searchForTargetSize', () => {
  it('returns after one encode when the image already fits', async () => {
    const encode = model(50_000);
    const result = await searchForTargetSize({ encode, targetBytes: 200_000 });
    expect(result).toMatchObject({ quality: 0.92, scale: 1, met: true, encodes: 1 });
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('finds the highest quality that fits at full size', async () => {
    const encode = model(1_000_000);
    const target = 500_000;
    const result = await searchForTargetSize({ encode, targetBytes: target });
    expect(result.met).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.bytes).toBeLessThanOrEqual(target);
    // 解析解：0.15 + 0.85q² = 0.4994 → q ≈ 0.641
    expect(result.quality).toBeGreaterThan(0.62);
    expect(result.quality).toBeLessThan(0.642);
    expect(result.encodes).toBeLessThanOrEqual(16);
    expect(encode).toHaveBeenCalledTimes(result.encodes);
    // App 只保留最后一次输出，所以最后一次调用必须就是结果。
    expect(lastCall(encode)).toEqual([result.quality, result.scale]);
  });

  it('shrinks the image when even the minimum quality is too big', async () => {
    const encode = model(20_000_000);
    const target = 1_000_000;
    const result = await searchForTargetSize({ encode, targetBytes: target });
    expect(result.met).toBe(true);
    expect(result.scale).toBeLessThan(1);
    expect(result.bytes).toBeLessThanOrEqual(target);
    expect(result.bytes).toBeGreaterThan(target * 0.8);
    expect(result.quality).toBeGreaterThanOrEqual(0.3);
    expect(result.encodes).toBeLessThanOrEqual(16);
    expect(lastCall(encode)).toEqual([result.quality, result.scale]);
  });

  it('copes with encoders that do not scale with area', async () => {
    // 体积只与缩放线性相关：按面积估算会缩得不够，需要再缩一次。
    const encode = vi.fn<EncodeFn>(async (q, s) => Math.round(8_000_000 * s * (0.2 + q)));
    const result = await searchForTargetSize({ encode, targetBytes: 300_000 });
    expect(result.met).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(300_000);
    expect(encode.mock.calls.length).toBeLessThanOrEqual(16);
  });

  it('returns the smallest attempt when the target is impossible', async () => {
    const encode = model(5_000_000, 150_000);
    const result = await searchForTargetSize({ encode, targetBytes: 100_000, minScale: 0.2 });
    expect(result.met).toBe(false);
    const sizes = await Promise.all(
      encode.mock.calls.map(([q, s]) => model(5_000_000, 150_000)(q, s)),
    );
    expect(result.bytes).toBe(Math.min(...sizes));
    expect(result.scale).toBeGreaterThanOrEqual(0.2);
    expect(result.quality).toBe(0.3);
    expect(result.encodes).toBeLessThanOrEqual(16);
    expect(lastCall(encode)).toEqual([result.quality, result.scale]);
  });

  it('never exceeds maxEncodes', async () => {
    for (const maxEncodes of [1, 2, 3, 4, 6, 10]) {
      for (const base of [10_000, 1_000_000, 50_000_000]) {
        const encode = model(base);
        const result = await searchForTargetSize({ encode, targetBytes: 400_000, maxEncodes });
        expect(encode.mock.calls.length).toBeLessThanOrEqual(maxEncodes);
        expect(result.encodes).toBe(encode.mock.calls.length);
        expect(lastCall(encode)).toEqual([result.quality, result.scale]);
        if (result.met) expect(result.bytes).toBeLessThanOrEqual(400_000);
      }
    }
  });

  it('respects custom quality bounds', async () => {
    const encode = model(1_000_000);
    const result = await searchForTargetSize({
      encode,
      targetBytes: 900_000,
      minQuality: 0.5,
      maxQuality: 0.8,
    });
    expect(result).toMatchObject({ quality: 0.8, scale: 1, met: true, encodes: 1 });
    for (const [q] of encode.mock.calls) {
      expect(q).toBeGreaterThanOrEqual(0.5);
      expect(q).toBeLessThanOrEqual(0.8);
    }
  });

  it('rejects a non-positive target', async () => {
    await expect(searchForTargetSize({ encode: model(1), targetBytes: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('searchSharedQuality', () => {
  const pages = [3_000_000, 1_500_000, 6_000_000];
  const encodeAll = () => {
    const encoders = pages.map((base) => model(base));
    return vi.fn<EncodeFn>(async (q, s) => {
      let sum = 0;
      for (const encode of encoders) sum += await encode(q, s);
      return sum;
    });
  };

  it('finds one quality for all images within the total budget', async () => {
    const fn = encodeAll();
    const result = await searchSharedQuality({
      encodeAll: fn,
      targetBytes: 4_000_000,
      overheadBytes: 20_000,
    });
    expect(result.met).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(4_000_000);
    expect(result.bytes).toBeGreaterThan(3_500_000);
    // 返回的 bytes 含容器开销。
    expect(result.bytes).toBe((await fn(result.quality, result.scale)) + 20_000);
  });

  it('reports failure when the overhead alone exceeds the target', async () => {
    const result = await searchSharedQuality({
      encodeAll: encodeAll(),
      targetBytes: 10_000,
      overheadBytes: 20_000,
      maxEncodes: 6,
    });
    expect(result.met).toBe(false);
    expect(result.encodes).toBeLessThanOrEqual(6);
    expect(result.bytes).toBeGreaterThan(10_000);
  });
});
