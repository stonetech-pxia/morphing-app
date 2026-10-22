// 按目标体积搜索编码参数。真正的编码由 App（expo-image-manipulator）完成，
// 这里只决定"用什么质量、缩放到多少"去编码，并保证调用次数有上限。

/** 用给定质量（0–1）和缩放（≤1）编码一次，返回编码后的字节数。 */
export type EncodeFn = (quality: number, scale: number) => Promise<number>;

export interface TargetSizeOptions {
  encode: EncodeFn;
  targetBytes: number;
  minQuality?: number;
  maxQuality?: number;
  /** encode 调用次数上限（含最后一次重编码）。 */
  maxEncodes?: number;
  /** 缩放下限，默认 0.05；App 应按原图尺寸传入，避免缩到几个像素。 */
  minScale?: number;
}

export interface SharedTargetOptions extends Omit<TargetSizeOptions, 'encode'> {
  /** 用同一质量和缩放编码全部图片，返回字节数之和。 */
  encodeAll: EncodeFn;
  /** 容器本身的开销（如 PDF 结构），计入总体积。 */
  overheadBytes: number;
}

export interface TargetSizeResult {
  quality: number;
  scale: number;
  /** 返回参数对应的字节数（共享搜索时含 overheadBytes）。 */
  bytes: number;
  /** 是否满足目标；不满足时返回尝试过的最小结果。 */
  met: boolean;
  encodes: number;
}

interface Trial {
  quality: number;
  scale: number;
  bytes: number;
}

const QUALITY_ROUNDS = 7;
/** 质量区间小于此值就不再二分。 */
const QUALITY_STEP = 0.01;
/** 缩小时多留 5% 余量，降低再缩一次的概率。 */
const SCALE_MARGIN = 0.95;

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

async function search(
  encode: EncodeFn,
  target: number,
  options: Omit<TargetSizeOptions, 'encode' | 'targetBytes'>,
): Promise<{ trial: Trial; met: boolean; encodes: number }> {
  const { minQuality = 0.3, maxQuality = 0.92, maxEncodes = 16, minScale = 0.05 } = options;
  const budget = Math.max(1, Math.floor(maxEncodes));
  const trials: Trial[] = [];
  const run = async (quality: number, scale: number): Promise<Trial> => {
    const trial = { quality, scale, bytes: await encode(quality, scale) };
    trials.push(trial);
    return trial;
  };
  // 始终留一次调用，用于最后把最佳参数重编码一遍。
  const canSearch = () => trials.length < budget - 1;

  const first = await run(maxQuality, 1);
  let fit: Trial | undefined = first.bytes <= target ? first : undefined;

  // 最低质量仍然太大时按面积估算缩小，直到最低质量能放下。
  let scale = 1;
  while (!fit && canSearch()) {
    const low = await run(minQuality, scale);
    if (low.bytes <= target) {
      fit = low;
      break;
    }
    if (scale <= minScale) break;
    const factor = target > 0 ? Math.sqrt(target / low.bytes) * SCALE_MARGIN : 0.5;
    scale = Math.max(minScale, round(scale * factor, 4));
  }

  // 在找到的缩放下二分质量，取能放下的最高质量。
  if (fit && fit !== first) {
    let lo = fit.quality;
    let hi = maxQuality;
    for (let i = 0; i < QUALITY_ROUNDS && canSearch() && hi - lo > QUALITY_STEP; i++) {
      const mid = round((lo + hi) / 2, 3);
      const trial = await run(mid, fit.scale);
      if (trial.bytes <= target) {
        fit = trial;
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  let best = fit ?? trials.reduce((a, b) => (b.bytes < a.bytes ? b : a));
  // App 只保留最后一次输出：最佳结果不是最后一次时重编码一次。
  if (best !== trials.at(-1)) best = await run(best.quality, best.scale);
  return { trial: best, met: best.bytes <= target, encodes: trials.length };
}

/**
 * 搜索不超过 targetBytes 的最高质量编码：先试最高质量原尺寸，
 * 再二分质量，最低质量仍放不下时缩小尺寸再搜。
 * 最后一次 encode 调用的参数总是等于返回值。
 */
export async function searchForTargetSize(options: TargetSizeOptions): Promise<TargetSizeResult> {
  const { encode, targetBytes, ...rest } = options;
  if (!(targetBytes > 0)) throw new RangeError('targetBytes');
  const { trial, met, encodes } = await search(encode, targetBytes, rest);
  return { ...trial, met, encodes };
}

/** 多张图片共用一个质量和缩放（如"图片转 PDF ≤ X MB"），总体积含容器开销。 */
export async function searchSharedQuality(options: SharedTargetOptions): Promise<TargetSizeResult> {
  const { encodeAll, targetBytes, overheadBytes, ...rest } = options;
  if (!(targetBytes > 0)) throw new RangeError('targetBytes');
  const { trial, encodes } = await search(encodeAll, targetBytes - overheadBytes, rest);
  const bytes = trial.bytes + overheadBytes;
  return { ...trial, bytes, met: bytes <= targetBytes, encodes };
}
