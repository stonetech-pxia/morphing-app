import {
  AlphaType,
  ClipOp,
  ColorType,
  ImageFormat,
  Skia,
  TileMode,
  matchFont,
} from '@shopify/react-native-skia';
import { Platform } from 'react-native';

import { MAX_SURFACE_SIDE, surfaceScale } from '@morph/tool-image';

import type { DrawOp } from './platform';

/** 超过 Metal 纹理上限的离屏画布会让 App 直接崩溃（不是 JS 错误），所以先在 JS 里拦住。 */
function makeSurface(width: number, height: number) {
  if (width > MAX_SURFACE_SIDE || height > MAX_SURFACE_SIDE || width < 1 || height < 1) {
    throw new Error(`canvas ${width}×${height} is too large`);
  }
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error('offscreen surface unavailable');
  return surface;
}

// Skia 离屏绘制（Expo Go 自带）。只画我们自己的固定内容，不执行任何配置里的代码。

/** 系统字体：iOS 用苹方（含中文），Android 用默认无衬线字体。 */
const FONT_FAMILY = Platform.select({ ios: 'PingFang SC', default: 'sans-serif' });

export function renderTextPng(
  text: string,
  style: { fontSize: number; color: string; opacity: number },
): { bytes: Uint8Array; width: number; height: number } {
  let font = matchFont({ fontFamily: FONT_FAMILY, fontSize: style.fontSize, fontWeight: 'bold' });
  // 很长的一行字会超过画布上限：按比例缩小字号（调用方只用宽高比）。
  const natural = font.measureText(text).width + 8;
  if (natural > MAX_SURFACE_SIDE) {
    const fontSize = Math.max(8, Math.floor((style.fontSize * (MAX_SURFACE_SIDE - 16)) / natural));
    font = matchFont({ fontFamily: FONT_FAMILY, fontSize, fontWeight: 'bold' });
  }
  const metrics = font.getMetrics();
  const width = Math.ceil(font.measureText(text).width) + 8;
  const height = Math.ceil(metrics.descent - metrics.ascent) + 8;
  const surface = makeSurface(width, height);
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(style.color));
  paint.setAlphaf(style.opacity);
  canvas.drawText(text, 4, 4 - metrics.ascent, paint, font);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
  return { bytes, width, height };
}

/** 颜色矩阵（4×5，平移量是 0–1）：亮度 L 按 Rec.601 加权。 */
function enhanceMatrix(mode: 'auto' | 'gray' | 'bw'): number[] {
  const luminance = (k: number, b: number) => {
    const row = [0.299 * k, 0.587 * k, 0.114 * k, 0, b];
    return [...row, ...row, ...row, 0, 0, 0, 1, 0];
  };
  switch (mode) {
    // 提亮：拉高对比度，纸张接近白色，保留颜色。
    case 'auto': {
      const k = 1.35;
      const b = -0.06;
      return [k, 0, 0, 0, b, 0, k, 0, 0, b, 0, 0, k, 0, b, 0, 0, 0, 1, 0];
    }
    case 'gray':
      return luminance(1.2, -0.05);
    // 黑白：灰度后以 0.6 为界大幅拉开对比度，字迹变黑、纸张变白。
    case 'bw':
      return luminance(4, 0.5 - 4 * 0.6);
  }
}

/** 扫描件增强（D-078）：Skia 离屏绘制加颜色矩阵，输出 JPG。 */
export function enhanceJpeg(
  bytes: Uint8Array,
  mode: 'auto' | 'gray' | 'bw',
): { bytes: Uint8Array; width: number; height: number } {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('image could not be decoded');
  // 太大的图先缩到画布放得下。
  const k = surfaceScale({ width: image.width(), height: image.height() });
  const width = Math.max(1, Math.floor(image.width() * k));
  const height = Math.max(1, Math.floor(image.height() * k));
  const surface = makeSurface(width, height);
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(enhanceMatrix(mode)));
  surface
    .getCanvas()
    .drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, width, height),
      paint,
    );
  surface.flush();
  const out = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
  return { bytes: out, width, height };
}

type SkImageLike = NonNullable<ReturnType<typeof Skia.Image.MakeImageFromEncoded>>;

/**
 * 离屏合成（D-079）：按顺序执行固定的几种绘制。解码过的图片只缓存最近一张，
 * 拼很多张大图时不会同时占着所有图片的内存。
 */
export async function composeOnSurface(
  canvasSpec: { width: number; height: number; background: string },
  ops: readonly DrawOp[],
  save: { format: 'jpeg' | 'png'; quality: number },
  readUri: (uri: string) => Promise<Uint8Array>,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { width, height } = canvasSpec;
  const surface = makeSurface(width, height);
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color(canvasSpec.background));
  let cached: { key: string; image: SkImageLike } | null = null;
  const decode = async (source: { uri: string } | { bytes: Uint8Array }) => {
    const key = 'uri' in source ? source.uri : '';
    if (cached && key && cached.key === key) return cached.image;
    const bytes = 'uri' in source ? await readUri(source.uri) : source.bytes;
    const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
    if (!image) throw new Error('image could not be decoded');
    cached?.image.dispose?.();
    cached = { key, image };
    return image;
  };
  for (const op of ops) {
    switch (op.kind) {
      case 'image': {
        const image = await decode(op.source);
        const src = op.src ?? { x: 0, y: 0, width: image.width(), height: image.height() };
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        if (op.opacity !== undefined) paint.setAlphaf(op.opacity);
        canvas.save();
        if (op.angleDeg) {
          canvas.rotate(op.angleDeg, op.dst.x + op.dst.width / 2, op.dst.y + op.dst.height / 2);
        }
        canvas.drawImageRect(
          image,
          Skia.XYWHRect(src.x, src.y, src.width, src.height),
          Skia.XYWHRect(op.dst.x, op.dst.y, op.dst.width, op.dst.height),
          paint,
        );
        canvas.restore();
        break;
      }
      case 'rect': {
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(op.color));
        canvas.drawRect(Skia.XYWHRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height), paint);
        break;
      }
      case 'blur': {
        // 先把已经画好的内容拍下来，再在这块区域里画它的模糊版本。
        surface.flush();
        const snapshot = surface.makeImageSnapshot();
        const paint = Skia.Paint();
        paint.setImageFilter(Skia.ImageFilter.MakeBlur(op.sigma, op.sigma, TileMode.Clamp, null));
        canvas.save();
        canvas.clipRect(
          Skia.XYWHRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height),
          ClipOp.Intersect,
          true,
        );
        canvas.drawImage(snapshot, 0, 0, paint);
        canvas.restore();
        snapshot.dispose?.();
        break;
      }
      case 'line': {
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(op.color));
        paint.setStyle(1); // Stroke
        paint.setStrokeWidth(op.width);
        canvas.drawLine(op.x1, op.y1, op.x2, op.y2, paint);
        break;
      }
    }
  }
  (cached as { image: SkImageLike } | null)?.image.dispose?.();
  surface.flush();
  const out = surface.makeImageSnapshot();
  const bytes = out.encodeToBytes(
    save.format === 'png' ? ImageFormat.PNG : ImageFormat.JPEG,
    Math.round(save.quality * 100),
  );
  out.dispose?.();
  return { bytes, width, height };
}

/** 图片的 RGBA 像素（长边缩到 maxSide 以内）。 */
export function pixelsOf(
  bytes: Uint8Array,
  maxSide: number,
): { width: number; height: number; data: Uint8Array } {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('image could not be decoded');
  const k = Math.min(1, maxSide / Math.max(image.width(), image.height()));
  const width = Math.max(1, Math.round(image.width() * k));
  const height = Math.max(1, Math.round(image.height() * k));
  const surface = makeSurface(width, height);
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('#FFFFFF'));
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint(),
  );
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const data = snapshot.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(data instanceof Uint8Array)) throw new Error('pixels could not be read');
  return { width, height, data };
}
