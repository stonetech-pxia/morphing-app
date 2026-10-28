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
  adjustImage?(
    uri: string,
    options: { mode: 'auto' | 'manual'; brightness: number; contrast: number; saturation: number },
    format: 'jpeg' | 'png',
    output: string,
  ): Promise<Omit<NativeImage, 'uri'>>;

  backgroundRemovalSupported?(): boolean;
  backgroundStatus?(): Promise<'ready' | 'download' | 'unsupported'>;
  downloadBackgroundModel?(): Promise<void>;
  removeBackground?(
    uri: string,
    background: string,
    output: string,
  ): Promise<Omit<NativeImage, 'uri'>>;

  /** 人脸框（像素，原点在左上角，已摆正）；width / height 是检测用的图的大小（Android 会先缩小，D-252）。 */
  detectFaces?(uri: string): Promise<{
    width: number;
    height: number;
    faces: { x: number; y: number; width: number; height: number }[];
  }>;
  /** 只保留人像、其余换成纯色（iOS 人像分割，D-252）；Android 没有，用 removeBackground。 */
  replacePersonBackground?(
    uri: string,
    color: string,
    output: string,
  ): Promise<Omit<NativeImage, 'uri'>>;

  /** 系统文档相机能不能用（模拟器和很旧的设备上是 false）。 */
  isDocumentCameraSupported(): boolean;
  /** 有没有相机（模拟器上没有）。 */
  isCameraAvailable(): boolean;
  /** 能不能给一张照片找纸张的四个角（iOS 能，Android 的 ML Kit 不能：detectDocument / straighten 不存在）。 */
  canFindPaper(): boolean;
  /** 这种语言（BCP 47）系统能不能识别（Android 上只剩韩文用 ML Kit，D-269）。 */
  supportsLanguage(code: string): boolean;

  /**
   * PP-OCRv6（D-269）：载入扩展包里的两个模型；输入、输出都是临时文件（float32 小端）。
   * ocrDetect 写出每个像素的概率 × 255（width × height 字节）；ocrRecognize 写出 count × steps 个 int32 类别
   * 再接 count × steps 个 float32 概率，返回 steps。旧版 App（原生模块里没有）时是 undefined。
   */
  ocrLoad?(det: string, rec: string): Promise<void>;
  ocrDetect?(input: string, width: number, height: number, output: string): Promise<void>;
  ocrRecognize?(input: string, count: number, width: number, output: string): Promise<number>;
  ocrUnload?(): Promise<void>;
  supportedLanguages(): Promise<string[]>;
  /** languages：BCP 47，第一种必须支持，后面的是补充。 */
  recognizeText(
    uri: string,
    languages: readonly string[],
  ): Promise<{
    text: string;
    lines: number;
    languages: string[];
    /** 识别时图片的像素大小和每行的位置（原点在左上角，D-195）。 */
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
