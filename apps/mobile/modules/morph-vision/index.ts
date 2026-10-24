import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphVision（D-084、D-087）：iOS 是 ios/MorphVisionModule.swift（Vision），
// Android 是 android/…/MorphVisionModule.kt（ML Kit）。Expo Go 和测试里是 null，调用方退回扩展包。
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
  /** 能不能给一张照片找纸张的四个角（iOS 能，Android 的 ML Kit 不能：detectDocument / straighten 不存在）。 */
  canFindPaper(): boolean;
  /** 这种语言（BCP 47）系统能不能识别。 */
  supportsLanguage(code: string): boolean;
  supportedLanguages(): Promise<string[]>;
  /** languages：BCP 47，第一种必须支持，后面的是补充。 */
  recognizeText(
    uri: string,
    languages: readonly string[],
  ): Promise<{
    text: string;
    lines: number;
    languages: string[];
    /** 识别时图片的像素大小和每行的位置（原点在左上角，D-194）。 */
    width: number;
    height: number;
    items: { text: string; x: number; y: number; width: number; height: number }[];
  }>;
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
  /** 打开系统文档相机（iOS：VisionKit；Android：ML Kit，需要 Google Play 服务）；用户取消时返回 null。 */
  scanDocuments(directory: string, maxSide: number, quality: number): Promise<NativeImage[] | null>;
}

export default requireOptionalNativeModule<MorphVisionModule>('MorphVision');
