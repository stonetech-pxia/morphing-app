import { ImageFormat, Skia, matchFont } from '@shopify/react-native-skia';
import { Platform } from 'react-native';

// Skia 离屏绘制（Expo Go 自带）。只画我们自己的固定内容，不执行任何配置里的代码。

/** 系统字体：iOS 用苹方（含中文），Android 用默认无衬线字体。 */
const FONT_FAMILY = Platform.select({ ios: 'PingFang SC', default: 'sans-serif' });

export function renderTextPng(
  text: string,
  style: { fontSize: number; color: string; opacity: number },
): { bytes: Uint8Array; width: number; height: number } {
  const font = matchFont({ fontFamily: FONT_FAMILY, fontSize: style.fontSize, fontWeight: 'bold' });
  const metrics = font.getMetrics();
  const width = Math.ceil(font.measureText(text).width) + 8;
  const height = Math.ceil(metrics.descent - metrics.ascent) + 8;
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error('offscreen surface unavailable');
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
  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error('offscreen surface unavailable');
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(enhanceMatrix(mode)));
  surface.getCanvas().drawImage(image, 0, 0, paint);
  surface.flush();
  const out = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
  return { bytes: out, width, height };
}
