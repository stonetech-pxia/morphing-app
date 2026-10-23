import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphVision（ios/MorphVisionModule.swift，D-084）。
// 只在 iOS 开发版 / 正式版里有；Expo Go、Android 和测试里是 null，调用方退回扩展包。
// 坐标：像素，原点在左上角，和 @morph/tool-image 的 Quad 一致。

export interface NativePoint {
  x: number;
  y: number;
}

export interface NativeQuad {
  tl: NativePoint;
  tr: NativePoint;
  br: NativePoint;
  bl: NativePoint;
}

export interface NativeImage {
  uri: string;
  width: number;
  height: number;
  size: number;
}

export interface MorphVisionModule {
  /** 系统文档相机能不能用（模拟器和很旧的设备上是 false）。 */
  isDocumentCameraSupported(): boolean;
  /** 有没有相机（模拟器上没有）。 */
  isCameraAvailable(): boolean;
  supportedLanguages(): Promise<string[]>;
  /** languages：BCP 47，第一种必须支持，后面的是补充。 */
  recognizeText(
    uri: string,
    languages: readonly string[],
  ): Promise<{ text: string; lines: number; languages: string[] }>;
  detectDocument(uri: string): Promise<{
    width: number;
    height: number;
    method: 'segmentation' | 'rectangles' | 'none';
    confidence: number;
    quad: NativeQuad | null;
  }>;
  straighten(
    uri: string,
    quad: NativeQuad,
    width: number,
    height: number,
    quality: number,
    output: string,
  ): Promise<{ width: number; height: number; size: number }>;
  /** 打开系统文档相机；用户取消时返回 null。 */
  scanDocuments(directory: string, maxSide: number, quality: number): Promise<NativeImage[] | null>;
}

export default requireOptionalNativeModule<MorphVisionModule>('MorphVision');
