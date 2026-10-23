import type { Quad } from '@morph/tool-image';

// 平台能力（App 中由 Expo 模块实现，见 expo-platform.ts；测试中用 test-utils/fake-files.ts 的内存实现）。
// 动作实现只通过这里接触文件系统和系统界面。

export interface PickedFile {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  width?: number;
  height?: number;
  /** 照片的拍摄时间（毫秒）。 */
  takenAt?: number;
  /** 系统文档相机拍的页面：已经找边拉正。 */
  straightened?: boolean;
  /** 视频、音频的时长（毫秒），选择器给得出时。 */
  durationMs?: number;
}

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** 扫描件增强（Skia 颜色矩阵）：提亮、灰度、黑白。 */
export type EnhanceMode = 'auto' | 'gray' | 'bw';

/** 一次图片处理：先裁剪（原图像素坐标），再缩放，再旋转 / 翻转。 */
export interface ImageOps {
  crop?: { x: number; y: number; width: number; height: number };
  resize?: { width: number; height: number };
  rotate?: 0 | 90 | 180 | 270;
  flip?: 'horizontal' | 'vertical';
}

export interface EncodedImage {
  uri: string;
  width: number;
  height: number;
  size: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 离屏合成的一步（拼图、打码、水印、相纸排版）。只有固定的几种绘制，不执行任何配置里的代码。
 * 图片来源是本次运行的临时文件或刚画好的字节（文字水印）。
 */
export type DrawOp =
  | {
      kind: 'image';
      source: { uri: string } | { bytes: Uint8Array };
      /** 取源图的哪一部分（像素）；默认整张。 */
      src?: Box;
      dst: Box;
      /** 绕 dst 中心旋转（度）。 */
      angleDeg?: number;
      /** 0–1。 */
      opacity?: number;
    }
  | { kind: 'rect'; rect: Box; color: string }
  /** 把画布上这块区域模糊（打码）。 */
  | { kind: 'blur'; rect: Box; sigma: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number };

/** 用户存好的签名（documentDirectory/signatures/，不进配置和版本，不发给 AI）。 */
export interface SavedSignature {
  uri: string;
  bytes: Uint8Array;
  aspect: number;
}

/**
 * 系统自带的文字识别和扫描（modules/morph-vision）：iOS 是 Vision / VisionKit / Core Image（D-084–D-086），
 * Android 是 Google ML Kit（D-087）。没有时（Expo Go）为 null。系统做不了的（Android 找边、俄文识别）
 * 退回扩展包。全部在本机处理。
 */
export interface VisionPlatform {
  /** 这种语言（BCP 47）系统能不能识别。 */
  supportsLanguage(code: string): boolean;
  /** 识别文字；languages 是 BCP 47，第一种是用户选的语言。文字只返回给 App。 */
  recognizeText(uri: string, languages: readonly string[]): Promise<string>;
  /** 能不能给照片找边和拉正（findPaper / straighten）；Android 的 ML Kit 不能。 */
  readonly canFindPaper: boolean;
  /** 找纸张的四个角（像素，已按拍摄方向摆正）；没找到返回 null。 */
  findPaper(uri: string): Promise<Quad | null>;
  /** 按四个角拉正，缩放到 size，存成本次运行的 JPG 临时文件。 */
  straighten(
    uri: string,
    quad: Quad,
    size: { width: number; height: number },
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;
  /** 系统文档相机能不能用（模拟器上不能）。 */
  readonly documentCamera: boolean;
  /** 打开系统文档相机（实时找边、自动拍摄、多页），页面放进本次运行的临时目录；用户取消时返回 null。 */
  scanDocuments(runId: string, maxSide: number): Promise<PickedFile[] | null>;
}

/** 存到文件夹的一个文件：本机地址、文件名（不含扩展名）和扩展名。 */
export interface FolderItem {
  uri: string;
  name: string;
  ext: string;
  mimeType: string;
}

/** 视频、音频的信息（modules/morph-media 的 probe，D-141）。 */
export interface MediaInfo {
  kind: 'video' | 'audio';
  durationMs: number;
  size: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** 画面摆正之后的宽高。 */
  width?: number;
  height?: number;
  fps?: number;
  hdr?: boolean;
  videoCodec?: string;
  videoBitrateKbps?: number;
  audioBitrateKbps?: number;
}

/** 一次视频编码的要求（H.264 + AAC 的 MP4）。 */
export interface VideoEncode {
  videoKbps: number;
  /** 0 = 去掉声音。 */
  audioKbps: number;
  /** 缩小到这个短边；不缩小时不给。 */
  shortSide?: number;
  maxFps: number;
  range?: { startMs: number; endMs: number };
}

/** 一个长任务：步内进度（0–1）和取消。 */
export interface MediaJob {
  progress(fraction: number): void;
  isCancelled(): boolean;
}

/** 处理结果：本次运行的临时文件。 */
export interface MediaOutput {
  uri: string;
  ext: string;
  size: number;
  info: MediaInfo;
}

/**
 * 在本机处理视频和音频（modules/morph-media：iOS AVFoundation、Android Media3，D-141）。
 * 没有原生模块时（Expo Go）为 null，视频动作报 needsFullApp。处理期间屏幕不灭（D-148）。
 * 出错时抛出带 code 的错误（ERR_MEDIA_UNSUPPORTED / CANCELLED / INTERRUPTED / NOT_IMPLEMENTED / FAILED）。
 */
export interface MediaPlatform {
  probe(uri: string): Promise<MediaInfo>;
  /** 重新编码成 MP4，写进本次运行的临时目录 relPath（扩展名 .mp4）。 */
  encodeVideo(
    uri: string,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 不重新编码地剪一段；输出的扩展名可能和 relPath 不同（MP4 放不下原来的声音时用 MOV）。 */
  trim(
    uri: string,
    range: { startMs: number; endMs: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 按时间取画面（已摆正），JPEG 放进本次运行的临时目录。 */
  thumbnails(
    uri: string,
    timesMs: readonly number[],
    maxSide: number,
    runId: string,
  ): Promise<string[]>;
}

export interface FilePlatform {
  /** 系统自带的文字识别和扫描；没有时为 null。 */
  readonly vision: VisionPlatform | null;
  /** 本机处理视频和音频；没有时（Expo Go）为 null。 */
  readonly media: MediaPlatform | null;

  // ---- 用户文件（assets/<id>/<文件名>，D-019）----
  /** 从相册选一张照片（图片组件用）；用户取消时返回 null。 */
  pickImage(): Promise<PickedFile | null>;
  /** 某个用户文件可以直接显示的地址（图片组件用）。 */
  fileUri(path: string): string;
  importFile(
    file: PickedFile,
    assetId: string,
    name: string,
  ): Promise<{ path: string; size: number }>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(
    assetId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ path: string; size: number }>;
  share(path: string, mimeType: string): Promise<void>;
  /** 把一段文字存成临时文件并打开系统分享面板（导出 CSV 用）。不会成为用户文件。 */
  shareText(fileName: string, text: string, mimeType: string): Promise<void>;

  // ---- 工作流执行：选择 ----
  /** 从相册多选照片；用户取消时返回 null。 */
  pickPhotos(max: number): Promise<PickedFile[] | null>;
  /** 拍一张照片；用户取消时返回 null，没有相机时抛出 cameraUnavailable。 */
  takePhoto(): Promise<PickedFile | null>;
  /** 从相册多选视频（不在选的时候转码）；用户取消时返回 null。 */
  pickVideos(max: number): Promise<PickedFile[] | null>;
  /** 从「文件」App 选文件；types 是 MIME 类型（可含 image/*、* / *）。 */
  pickDocuments(types: readonly string[], multiple: boolean): Promise<PickedFile[] | null>;

  // ---- 工作流执行：临时文件（缓存目录 runs/<runId>/，D-063）----
  /** 把选择器给的文件复制进本次运行的临时目录。 */
  copyToRun(uri: string, runId: string, fileName: string): Promise<{ uri: string; size: number }>;
  /**
   * 大文件（视频、音频）不复制（D-142）：选择器放在 App 缓存里的副本移进本次运行的临时目录（之后一起删）；
   * 分享进来的（共享目录、content://）原地使用，返回原地址。
   */
  adoptIntoRun(
    uri: string,
    runId: string,
    fileName: string,
  ): Promise<{ uri: string; size: number }>;
  /** 手机剩余空间（字节）；读不到时为 null。 */
  freeDiskBytes(): number | null;
  writeRunFile(
    runId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{ uri: string; size: number }>;
  readUri(uri: string): Promise<Uint8Array>;
  /** 删除本次运行的临时目录。 */
  removeRun(runId: string): Promise<void>;
  /** 启动时清理上次没来得及删除的临时目录。 */
  removeAllRuns(): Promise<void>;
  /**
   * 删除分享进来的文件的副本（D-116）：iOS 分享扩展放进 App Group 共享目录的文件，keep 以外的全部删掉
   * （只动共享目录最上层、UUID 文件名的文件）；copies 是 Android 原生模块复制到缓存目录的副本，只删缓存目录里的。
   * Android 的 content:// 地址本身不用删。
   */
  removeShared(keep?: readonly string[], copies?: readonly string[]): Promise<void>;
  /** 把临时文件存成用户文件。 */
  saveRunFile(uri: string, assetId: string, name: string): Promise<{ path: string; size: number }>;

  // ---- 工作流执行：输出 ----
  /** 打开一次系统分享面板带上全部文件（MorphShare，D-119）；没有原生模块时（Expo Go）逐个打开。 */
  shareUris(items: readonly { uri: string; mimeType: string }[]): Promise<void>;
  /**
   * 把文件复制进「文件」里的一个文件夹（D-120）。记住上次选的文件夹（D-123）：choose 不为 true 时
   * 有记住的就直接存进去，否则让用户选一个并记住它。返回存了几个和文件夹名，用户取消时返回 null。
   * 文件夹写不进去时抛出 folderNotWritable。
   */
  saveToFolder(
    items: readonly FolderItem[],
    choose?: boolean,
  ): Promise<{ saved: number; folder: string } | null>;
  /** 记住的文件夹的名字；没有时为 null。 */
  rememberedFolder(): string | null;
  /** 存到系统相册；没有权限时抛出 permissionDenied。 */
  saveToPhotos(uris: readonly string[]): Promise<void>;
  print(item: { uri: string; mimeType: string }): Promise<void>;
  copyText(text: string): Promise<void>;

  // ---- 图片（expo-image-manipulator）----
  /** 图片尺寸（已按拍摄方向摆正）。 */
  imageSize(uri: string): Promise<{ width: number; height: number }>;
  /** 处理并编码成本次运行的临时文件；quality 0–1，PNG 忽略。重新编码会去掉 EXIF（包括位置）。 */
  transformImage(
    uri: string,
    ops: ImageOps,
    save: { format: ImageFormat; quality: number },
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;

  /** 增强一张图片（扫描件），输出 JPG 临时文件。 */
  enhanceImage(
    uri: string,
    mode: EnhanceMode,
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;

  /** 离屏合成一张图，编码成本次运行的临时文件。 */
  composeImage(
    canvas: { width: number; height: number; background: string },
    ops: readonly DrawOp[],
    save: { format: 'jpeg' | 'png'; quality: number },
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;
  /** 读出图片的 RGBA 像素（长边缩到 maxSide 以内），识别二维码用。 */
  imagePixels(
    uri: string,
    maxSide: number,
  ): Promise<{ width: number; height: number; data: Uint8Array }>;
  /** 用系统的打印排版把 HTML 变成 PDF（expo-print），存成本次运行的临时文件。 */
  htmlToPdf(
    html: string,
    page: { width: number; height: number },
    runId: string,
    relPath: string,
  ): Promise<{ uri: string; size: number; pageCount: number }>;

  // ---- 签名 ----
  loadSignatures(): Promise<SavedSignature[]>;
  saveSignature(png: Uint8Array, aspect: number): Promise<void>;

  // ---- Skia ----
  /** 用系统字体（含中日韩文字和 emoji）把一行字画成透明背景的 PNG。 */
  renderText(
    text: string,
    style: { fontSize: number; color: string; opacity: number },
  ): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}
