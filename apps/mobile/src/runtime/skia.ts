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
  MAX_SURFACE_SIDE,
  SAUVOLA_K,
  despeckle,
  planScanEnhance,
  rotatedSize,
  surfaceScale,
  type RgbaImage,
  type ScanLook,
  type ScanOutput,
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

/** 分析图的长边：背景、黑白两端、彩色还是灰度、倾斜角都在这么大的图上算（D-266）。 */
const ENHANCE_ANALYSIS_SIDE = 800;

// 全分辨率的逐像素运算（D-266）：除以纸张背景（每个通道分开，纸变成中性白）→ 按黑白两端拉伸 →
// 彩色 / 灰度 / 黑白（Sauvola 局部阈值，按最暗的通道判断，均值和标准差来自分析图）。背景和统计图都很小，按格子中心线性插值。
const ENHANCE_SKSL = `
uniform shader image;
uniform shader background;
uniform shader stats;
uniform float lo;
uniform float hi;
uniform float mode;
uniform float k;

half4 main(float2 p) {
  float3 c = float3(image.eval(p).rgb);
  float3 b = max(float3(background.eval(p).rgb), float3(0.04));
  float3 n = clamp((c / b - lo) / (hi - lo), 0.0, 1.0);
  float y = dot(n, float3(0.299, 0.587, 0.114));
  if (mode < 1.5) {
    // 中间调压暗一点（γ 1.3）：纸还是白、黑还是黑，淡的字更清楚。黑白模式不用（阈值是按没压暗的亮度算的）。
    float3 d = pow(n, float3(1.3));
    float dy = pow(y, 1.3);
    if (mode > 0.5) return half4(half3(dy), 1.0);
    // 接近灰色的像素（纸上的噪点、拍屏幕的摩尔纹）去掉颜色；颜色浓的（红字、印章）保留。
    float chroma = max(n.r, max(n.g, n.b)) - min(n.r, min(n.g, n.b));
    return half4(half3(mix(float3(dy), d, smoothstep(0.08, 0.2, chroma))), 1.0);
  }
  // 黑白：先取 3×3 的平均（压掉拍屏幕的摩尔纹和纸纹，笔画有 3–4 像素宽，影响不大），
  // 再按三个通道里最暗的那个判断（红字、蓝字也算深色，和分析图上的 leveledInk 一致）。
  float3 sum = float3(0.0);
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) sum += float3(image.eval(p + float2(dx, dy)).rgb);
  }
  float3 m3 = clamp((sum / 9.0 / b - lo) / (hi - lo), 0.0, 1.0);
  float ink = min(m3.r, min(m3.g, m3.b));
  // stats：R 是均值，G 是标准差 × 2，所以 s / 0.5 正好是 G。
  float2 ms = float2(stats.eval(p).rg);
  float t = ms.x * (1.0 + k * (ms.y - 1.0));
  float v = ink < t ? 0.0 : 1.0;
  return half4(half3(v), 1.0);
}
`;

let enhanceEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;

/** RGBA 像素做成 Skia 图片（背景格子、统计图）。 */
function imageFromRgba(img: RgbaImage) {
  const out = Skia.Image.MakeImage(
    {
      width: img.width,
      height: img.height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    Skia.Data.fromBytes(img.data),
    img.width * 4,
  );
  if (!out) throw new Error('image could not be created');
  return out;
}

/** 把一张图读成 RGBA 像素：缩到 width × height（线性插值，缩小时用 mipmap，免得摩尔纹混进分析）。 */
function readScaled(image: SkImageLike, width: number, height: number): RgbaImage {
  const surface = makeSurface(width, height);
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('#FFFFFF'));
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, width, height),
    FilterMode.Linear,
    MipmapMode.Linear,
  );
  surface.flush();
  return { width, height, data: readRgba(surface.makeImageSnapshot(), width, height) };
}

function readRgba(image: SkImageLike, width: number, height: number): Uint8Array {
  const data = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(data instanceof Uint8Array)) throw new Error('pixels could not be read');
  return data;
}

/**
 * 扫描件增强（D-266，取代 D-078 的颜色矩阵）：分析图上算出背景、黑白两端、倾斜角和彩色还是灰度，
 * 再用一个着色器在全分辨率上一次画完（顺带转正倾斜，画布放大到能装下转过的四个角，空出的地方是白色）。
 * 黑白模式最后在全分辨率上去掉孤立的噪点。输出 JPG。
 */
export function enhanceJpeg(
  bytes: Uint8Array,
  look: ScanLook,
): {
  bytes: Uint8Array;
  width: number;
  height: number;
  output: ScanOutput;
  skew: number;
  /** 转正前的大小（画布在它外面放大，D-267 换算识别框用）。 */
  base: { width: number; height: number };
} {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('image could not be decoded');
  const iw = image.width();
  const ih = image.height();
  const a = Math.min(1, ENHANCE_ANALYSIS_SIDE / Math.max(iw, ih));
  const analysis = readScaled(
    image,
    Math.max(1, Math.round(iw * a)),
    Math.max(1, Math.round(ih * a)),
  );
  const plan = planScanEnhance(analysis, look);

  // 转正后的画布不能超过上限：按转过之后的大小算缩放。
  const k = surfaceScale(rotatedSize({ width: iw, height: ih }, plan.skew));
  const width = Math.max(1, Math.floor(iw * k));
  const height = Math.max(1, Math.floor(ih * k));
  const canvasSize = rotatedSize({ width, height }, plan.skew);

  enhanceEffect ??= Skia.RuntimeEffect.Make(ENHANCE_SKSL);
  if (!enhanceEffect) throw new Error('enhance shader could not be compiled');
  const shaderOf = (img: SkImageLike, w: number, h: number, fm: FilterMode) =>
    img.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      fm,
      MipmapMode.None,
      Skia.Matrix().scale(width / w, height / h),
    );
  const background = imageFromRgba(plan.background);
  const stats = plan.stats ? imageFromRgba(plan.stats) : background;
  const mode = plan.output === 'color' ? 0 : plan.output === 'gray' ? 1 : 2;
  const shader = enhanceEffect.makeShaderWithChildren(
    [plan.lo, plan.hi, mode, SAUVOLA_K],
    [
      shaderOf(image, iw, ih, FilterMode.Linear),
      shaderOf(background, plan.background.width, plan.background.height, FilterMode.Linear),
      shaderOf(stats, stats.width(), stats.height(), FilterMode.Linear),
    ],
  );

  const surface = makeSurface(canvasSize.width, canvasSize.height);
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('#FFFFFF'));
  canvas.save();
  canvas.translate(canvasSize.width / 2, canvasSize.height / 2);
  canvas.rotate(-plan.skew, 0, 0);
  canvas.translate(-width / 2, -height / 2);
  const paint = Skia.Paint();
  paint.setShader(shader);
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint);
  canvas.restore();
  surface.flush();
  let result = surface.makeImageSnapshot();

  if (plan.output === 'bw') {
    // 转正时边缘插值出的灰也要变成黑白：去噪点前按 128 二值化（despeckle 也按这个判断）。
    const px = {
      width: canvasSize.width,
      height: canvasSize.height,
      data: readRgba(result, canvasSize.width, canvasSize.height),
    };
    for (let i = 0; i < px.data.length; i += 4) {
      const v = px.data[i]! < 128 ? 0 : 255;
      px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
    }
    // 约 200 dpi 时：宽高都不超过 3 像素、9 像素内没有字的黑点当作噪点。
    const maxSide = Math.max(2, Math.round(Math.max(canvasSize.width, canvasSize.height) / 800));
    despeckle(px, { maxSide, reach: maxSide * 3 });
    result = imageFromRgba(px);
  }
  const out = result.encodeToBytes(ImageFormat.JPEG, 90);
  return {
    bytes: out,
    width: canvasSize.width,
    height: canvasSize.height,
    output: plan.output,
    skew: plan.skew,
    base: { width, height },
  };
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
