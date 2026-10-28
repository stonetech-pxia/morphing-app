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

/** 原生端的错误码（error.code）。 */
export const VISION_ERRORS = {
  /** cancelClassify(taskId) 取消了。 */
  cancelled: 'ERR_VISION_CANCELLED',
  /** detectData：Android 这种语言的实体识别模型还没下载（又不许下载，或者没网）。 */
  needsDownload: 'ERR_VISION_NEEDS_DOWNLOAD',
} as const;

/** 系统识别出的日期或金额：在整段文字里的位置（UTF-16）；日期的值是 YYYY-MM-DD，金额的值可以没有。 */
export interface NativeDataMatch {
  kind: 'amount' | 'date';
  start: number;
  end: number;
  value?: string;
}

/** 图像分类的一个标签：id 是平台自己的英文标识（iOS Vision 和 Android ML Kit 的词表不同）。 */
export interface NativeImageLabel {
  id: string;
  /** 0–1。 */
  confidence: number;
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
  /**
   * 照片里是什么（没有文字的照片做推荐用）：iOS 是 Vision 的 VNClassifyImageRequest，Android 是 ML Kit 图像标注
   * （基础模型打包进 App）。先缩到长边 1024 再分类，不写中间文件。只返回不低于 minConfidence 的、最多 maxResults 个，
   * 从高到低；width / height 是分类用的图的大小。taskId 用来 cancelClassify。旧开发构建缺这两个方法。
   */
  classifyImage?(
    taskId: string,
    uri: string,
    options: { maxResults: number; minConfidence: number },
  ): Promise<{ labels: NativeImageLabel[]; width: number; height: number }>;
  /**
   * 「记一笔」预填用的系统识别（只做规则的补充）：iOS 26 起 DataDetection（日期、金额），更早的 iOS 用
   * NSDataDetector（只有日期）；Android 是 ML Kit 实体识别（每种语言的模型第一次用时下载，
   * allowDownload 为 false 时不下载，以 ERR_VISION_NEEDS_DOWNLOAD 结束）。language 是 BCP 47。
   */
  detectData?(text: string, language: string, allowDownload: boolean): Promise<NativeDataMatch[]>;
  /** ready：能直接用；download：要先下载模型（Android）；unsupported：这种语言不支持。 */
  dataDetectionStatus?(language: string): Promise<'ready' | 'download' | 'unsupported'>;
  /** 下载这种语言的识别模型（Android；iOS 什么都不做）。App 先问过用户才调用。 */
  downloadDataModel?(language: string): Promise<void>;
  /** 取消正在进行的分类：那次以 ERR_VISION_CANCELLED 结束；还没开始或已经结束的不起作用。 */
  cancelClassify?(taskId: string): void;
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
