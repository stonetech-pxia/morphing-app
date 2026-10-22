// 尺寸与裁剪的纯计算。结果都是整数像素，App 直接交给 expo-image-manipulator。

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeSpec =
  | { mode: 'longEdge'; px: number }
  | { mode: 'width'; px: number }
  | { mode: 'height'; px: number }
  | { mode: 'percent'; percent: number }
  | { mode: 'fit'; width: number; height: number };

const MIN_CROP = 16;

function assertPositive(...values: number[]): void {
  for (const v of values) if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(String(v));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 只缩放不裁剪：保持宽高比，默认不放大。 */
export function resizeDimensions(
  size: Size,
  spec: ResizeSpec,
  { allowUpscale = false }: { allowUpscale?: boolean } = {},
): Size {
  const { width, height } = size;
  assertPositive(width, height);
  let factor: number;
  switch (spec.mode) {
    case 'longEdge':
      assertPositive(spec.px);
      factor = spec.px / Math.max(width, height);
      break;
    case 'width':
      assertPositive(spec.px);
      factor = spec.px / width;
      break;
    case 'height':
      assertPositive(spec.px);
      factor = spec.px / height;
      break;
    case 'percent':
      assertPositive(spec.percent);
      factor = spec.percent / 100;
      break;
    case 'fit':
      // 完整放进框内，不裁剪；结果可能有一边小于框。
      assertPositive(spec.width, spec.height);
      factor = Math.min(spec.width / width, spec.height / height);
      break;
  }
  if (!allowUpscale) factor = Math.min(factor, 1);
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** 居中、按 aspect（宽/高）能取到的最大裁剪框。 */
export function centeredCropForAspect(size: Size, aspect: number): Rect {
  assertPositive(size.width, size.height, aspect);
  let width = size.width;
  let height = size.height;
  if (width / height > aspect) width = clamp(Math.round(height * aspect), 1, size.width);
  else height = clamp(Math.round(width / aspect), 1, size.height);
  return {
    x: Math.floor((size.width - width) / 2),
    y: Math.floor((size.height - height) / 2),
    width,
    height,
  };
}

/**
 * 把裁剪框收回图片内，最小边 16px（图片更小时以图片为准）。
 * 给定 aspect 时保持中心和大致面积，换算成该比例；取整后比例可能差 1px。
 */
export function clampCrop(rect: Rect, size: Size, { aspect }: { aspect?: number } = {}): Rect {
  assertPositive(size.width, size.height);
  const minW = Math.min(MIN_CROP, size.width);
  const minH = Math.min(MIN_CROP, size.height);
  let width = Math.max(1, rect.width);
  let height = Math.max(1, rect.height);
  if (aspect !== undefined) {
    assertPositive(aspect);
    const max = centeredCropForAspect(size, aspect);
    width = Math.sqrt(width * height * aspect);
    height = width / aspect;
    // 先放大到最小边，再缩到图片能容纳的最大比例框。
    const grow = Math.max(1, minW / width, minH / height);
    const shrink = Math.min(1, max.width / (width * grow), max.height / (height * grow));
    width = clamp(Math.round(width * grow * shrink), 1, max.width);
    height = clamp(Math.round(height * grow * shrink), 1, max.height);
  } else {
    width = clamp(Math.round(width), minW, size.width);
    height = clamp(Math.round(height), minH, size.height);
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: clamp(Math.round(cx - width / 2), 0, size.width - width),
    y: clamp(Math.round(cy - height / 2), 0, size.height - height),
    width,
    height,
  };
}

export interface CropPlan {
  crop: Rect;
  /** 裁剪后需要缩放到的尺寸；已经等于输出尺寸时为 null。 */
  resize: Size | null;
  /** 裁剪框小于输出尺寸，需要放大（证件照提示"原图分辨率不足"）。 */
  upscale: boolean;
}

/** 把"裁剪框 → 固定输出尺寸"翻译成先裁剪再缩放两步。 */
export function cropToOutput(rect: Rect, output: Size): CropPlan {
  const same = rect.width === output.width && rect.height === output.height;
  return {
    crop: rect,
    resize: same ? null : { width: output.width, height: output.height },
    upscale: rect.width < output.width || rect.height < output.height,
  };
}

/** iOS WebView canvas 最多约 1678 万像素；超过时等比缩小到上限内。 */
export function capPixels(size: Size, maxPixels = 16_777_216): Size {
  assertPositive(size.width, size.height, maxPixels);
  if (size.width * size.height <= maxPixels) return { width: size.width, height: size.height };
  const f = Math.sqrt(maxPixels / (size.width * size.height));
  let width = Math.max(1, Math.floor(size.width * f));
  let height = Math.max(1, Math.floor(size.height * f));
  // 极细长图：一边被钳到 1px 后，另一边按上限重算。
  width = Math.max(1, Math.min(width, Math.floor(maxPixels / height)));
  height = Math.max(1, Math.min(height, Math.floor(maxPixels / width)));
  return { width, height };
}

/** GPU 离屏画布单边上限：iOS 模拟器的 Metal 纹理是 8192（真机 16384），按小的算。 */
export const MAX_SURFACE_SIDE = 8192;

/**
 * 离屏画布放不下时整体缩小的比例（≤ 1）：单边不超过 MAX_SURFACE_SIDE，总像素不超过 1677 万。
 * 超过 Metal 上限会让 App 直接崩溃，所以每次离屏绘制前都要先算。
 */
export function surfaceScale(size: Size, maxPixels = 16_777_216): number {
  assertPositive(size.width, size.height, maxPixels);
  return Math.min(
    1,
    MAX_SURFACE_SIDE / size.width,
    MAX_SURFACE_SIDE / size.height,
    Math.sqrt(maxPixels / (size.width * size.height)),
  );
}
