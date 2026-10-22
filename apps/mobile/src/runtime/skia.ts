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
