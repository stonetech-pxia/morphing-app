import {
  AlphaType,
  ClipOp,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  matchFont,
} from '@shopify/react-native-skia';
import { Platform } from 'react-native';

import {
  ENHANCE_SHADER_MODE,
  ENHANCE_SKSL,
  MAX_SURFACE_SIDE,
  PAPER_SIDE,
  paperBackground,
  surfaceScale,
  type EnhanceLook,
} from '@morph/tool-image';

import { annotationSvg } from './annotations';
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

/** 标注预览与导出使用同一字体、字宽、基线和内边距。 */
export function textLayout(text: string, fontSize: number) {
  let font = matchFont({ fontFamily: FONT_FAMILY, fontSize, fontWeight: 'bold' });
  // 很长的一行字会超过画布上限：按比例缩小字号（调用方只用宽高比）。
  const natural = font.measureText(text).width + 8;
  if (natural > MAX_SURFACE_SIDE) {
    const fittedSize = Math.max(8, Math.floor((fontSize * (MAX_SURFACE_SIDE - 16)) / natural));
    font = matchFont({ fontFamily: FONT_FAMILY, fontSize: fittedSize, fontWeight: 'bold' });
  }
  const metrics = font.getMetrics();
  const width = Math.ceil(font.measureText(text).width) + 8;
  const height = Math.ceil(metrics.descent - metrics.ascent) + 8;
  return { font, width, height, baseline: 4 - metrics.ascent };
}

export function renderTextPng(
  text: string,
  style: { fontSize: number; color: string; opacity: number },
): { bytes: Uint8Array; width: number; height: number } {
  const { font, width, height, baseline } = textLayout(text, style.fontSize);
  const surface = makeSurface(width, height);
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(style.color));
  paint.setAlphaf(style.opacity);
  canvas.drawText(text, 4, baseline, paint, font);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
  return { bytes, width, height };
}

let enhanceEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;

/**
 * 扫描件增强（D-078、D-266）：先去阴影、拉平光照，再按效果出图，输出 JPG。
 * 整页缩到长边 PAPER_SIDE 读出像素，在 JS 里估出纸张背景（小图，几十毫秒）；
 * 原尺寸的「除以背景 + 色阶」交给 Skia 着色器在 GPU 上做，背景图按原尺寸双线性放大。
 */
export function enhanceJpeg(
  bytes: Uint8Array,
  mode: EnhanceLook,
): { bytes: Uint8Array; width: number; height: number } {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('image could not be decoded');
  const src = Skia.XYWHRect(0, 0, image.width(), image.height());
  // 太大的图先缩到画布放得下。
  const k = surfaceScale({ width: image.width(), height: image.height() });
  const width = Math.max(1, Math.floor(image.width() * k));
  const height = Math.max(1, Math.floor(image.height() * k));
  // 小图：用 mipmap 缩小（相当于按面积平均），字迹变成浅灰，估背景更稳。
  const s = Math.min(1, PAPER_SIDE / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * s));
  const sh = Math.max(1, Math.round(height * s));
  const small = makeSurface(sw, sh);
  small
    .getCanvas()
    .drawImageRectOptions(
      image,
      src,
      Skia.XYWHRect(0, 0, sw, sh),
      FilterMode.Linear,
      MipmapMode.Linear,
    );
  small.flush();
  const pixels = small.makeImageSnapshot().readPixels(0, 0, {
    width: sw,
    height: sh,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(pixels instanceof Uint8Array)) throw new Error('pixels could not be read');
  const bg = paperBackground(pixels, sw, sh);
  // 背景和纸张图都按原尺寸双线性放大。
  const scaled = (data: Uint8Array) => {
    const tiny = Skia.Image.MakeImage(
      {
        width: bg.width,
        height: bg.height,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      Skia.Data.fromBytes(data),
      bg.width * 4,
    );
    if (!tiny) throw new Error('background could not be made');
    return tiny.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None,
      Skia.Matrix().scale(width / bg.width, height / bg.height),
    );
  };
  enhanceEffect ??= Skia.RuntimeEffect.Make(ENHANCE_SKSL);
  if (!enhanceEffect) throw new Error('enhance shader did not compile');
  const shader = enhanceEffect.makeShaderWithChildren(
    [ENHANCE_SHADER_MODE[mode]],
    [
      image.makeShaderOptions(
        TileMode.Clamp,
        TileMode.Clamp,
        FilterMode.Linear,
        MipmapMode.None,
        Skia.Matrix().scale(width / image.width(), height / image.height()),
      ),
      scaled(bg.data),
      scaled(bg.paper),
    ],
  );
  const surface = makeSurface(width, height);
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, width, height), paint);
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
      case 'path': {
        if (!op.points.length) break;
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setColor(Skia.Color(op.color));
        paint.setStyle(1);
        paint.setStrokeWidth(op.width);
        paint.setStrokeCap(1);
        paint.setStrokeJoin(1);
        const path = Skia.Path.MakeFromSVGString(annotationSvg(op.points));
        if (path) canvas.drawPath(path, paint);
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
