import type { Quad } from '@morph/tool-image';
import type { TextLayer } from '@morph/tool-pdf';

import type { SpeechPlatform } from './speech';

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
  /** 文件的修改时间（毫秒，「文件」App 选的文件有，D-242）。 */
  modifiedAt?: number;
  /** 系统文档相机拍的页面：已经找边拉正。 */
  straightened?: boolean;
  /** 视频、音频的时长（毫秒），选择器给得出时。 */
  durationMs?: number;
}

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** 扫描件增强（Skia 着色器，D-266）：先去阴影、拉平光照，再保留颜色、灰度或黑白。 */
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
  | { kind: 'path'; points: { x: number; y: number }[]; color: string; width: number }
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
export interface ImageAdjustSettings {
  mode: 'auto' | 'manual';
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface VisionPlatform {
  adjustImage(
    uri: string,
    settings: ImageAdjustSettings,
    format: 'jpeg' | 'png',
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;

  readonly backgroundRemovalSupported: boolean;
  backgroundStatus(): Promise<'ready' | 'download' | 'unsupported'>;
  downloadBackgroundModel(): Promise<void>;
  removeBackground(
    uri: string,
    background: string,
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;

  /**
   * 证件照（D-252）：找人脸。坐标是 width × height 的图（已摆正，Android 会先缩小）上的像素，
   * 调用方按比例换回原图。没有这个能力时没有这个方法。
   */
  detectFaces?(uri: string): Promise<{ width: number; height: number; faces: Box[] }>;
  /**
   * 证件照换底色（D-252）：人留下，其余换成纯色，输出 PNG。iOS 用人像分割（iOS 15 起），
   * Android 用主体分割（和去背景同一个模型，要 Google Play 服务）。
   */
  replaceBackground?(
    uri: string,
    color: string,
    runId: string,
    relPath: string,
  ): Promise<EncodedImage>;
  /** replaceBackground 用的是系统自带的人像分割（iOS），不用先确认下载模型（Android 的主体分割要）。 */
  readonly personSegmentation?: boolean;

  /** 这种语言（BCP 47）系统能不能识别。 */
  supportsLanguage(code: string): boolean;
  /** 识别文字；languages 是 BCP 47，第一种是用户选的语言。文字只返回给 App。 */
  recognizeText(uri: string, languages: readonly string[]): Promise<string>;
  /** 识别文字，给出每行的位置（可搜索 PDF 的文字层，D-195）。 */
  recognizeLines(uri: string, languages: readonly string[]): Promise<TextLayer>;
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

/**
 * 系统自带的本机翻译（modules/morph-translate，D-170）：iOS 是 Translation 框架（iOS 18 起），
 * Android 是 ML Kit（语言模型第一次用时下载，约 30 MB）。语言用 BCP 47。没有原生模块时（Expo Go）为 null。
 * 文字只在本机处理，不上传、不发给 AI。
 */
export interface TranslatePlatform {
  /** 这台设备能不能翻译（iOS 17 及更早没有系统翻译）。 */
  readonly supported: boolean;
  /** 每段文字的语言；认不出时为 null。 */
  detectLanguages(texts: readonly string[]): Promise<(string | null)[]>;
  /**
   * 这一对语言现在能不能翻：installed 直接能翻；download 要先下载，missing 是还没下载的语言（Android，
   * 由 App 先问用户）；iOS 不给 missing，系统在翻译时自己弹窗问。unsupported 不能翻。
   */
  status(
    from: string,
    to: string,
  ): Promise<{ status: 'installed' | 'download' | 'unsupported'; missing?: string[] }>;
  /** 每种语言要下载多少字节（估计，Android 的 ML Kit 约 30 MB）。 */
  readonly downloadBytes?: number;
  /** 下载一种语言的模型（Android）；没有网络时抛出。iOS 没有这个方法。 */
  download?(language: string): Promise<void>;
  /** 已下载的语言（Android，「设置 → 已下载内容」列出；iOS 的语言由系统设置管理，没有这个方法）。 */
  downloadedLanguages?(): Promise<string[]>;
  /** 删除一种语言的模型（Android）。 */
  removeLanguage?(language: string): Promise<void>;
  /**
   * 翻译，一段对一段。iOS 需要下载时系统会弹窗；用户取消时抛出 code 为 cancelled 的错误。
   */
  translate(texts: readonly string[], from: string, to: string): Promise<string[]>;
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
  audioCodec?: string;
  audioBitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
}

/** 一次视频编码的要求（H.264 + AAC 的 MP4）。 */
export interface VideoEncode {
  /** 视频和声音一起变速，声音随之变调。 */
  speed?: number;
  /** 居中裁剪到这个宽高比。 */
  aspectRatio?: number;
  videoKbps: number;
  /** 0 = 去掉声音。 */
  audioKbps: number;
  /** 缩小到这个短边；不缩小时不给。 */
  shortSide?: number;
  maxFps: number;
  range?: { startMs: number; endMs: number };
}

/** 音频的编码要求（core 的 AudioPlan）：M4A（AAC）、WAV（16 位 PCM）或 MP3（D-183）；range 只要其中一段。 */
export interface AudioEncode {
  format: 'm4a' | 'wav' | 'mp3';
  bitrateKbps: number;
  channels: 1 | 2;
  sampleRate: number;
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

/** 写好的动图（D-184）：本次运行的临时文件。 */
export interface GifOutput {
  uri: string;
  size: number;
  width: number;
  height: number;
  frames: number;
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
  /** 同一个响度动作接音频或视频；视频设置存在时保留画面。 */
  /** 按视频完整时间轴提取 WAV，给本机字幕识别，包含开头/结尾静音。 */
  speechAudio(uri: string, runId: string, relPath: string, job: MediaJob): Promise<MediaOutput>;
  volume(
    uri: string,
    settings: { automatic: boolean; db: number; video?: VideoEncode },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  denoise(
    uri: string,
    settings: { automatic?: boolean; db?: number; video?: VideoEncode },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 去掉声音；iOS 不重新编码，Android 重新编码画面。 */
  muteVideo(
    uri: string,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 顺时针旋转；iOS 只改方向信息，Android 重新编码。 */
  rotateVideo(
    uri: string,
    degrees: 90 | 180 | 270,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 配乐运行时选择，不作为工作流中的第二个传递值。 */
  mixVideoAudio(
    uri: string,
    music: string,
    settings: VideoEncode & {
      originalVolume: number;
      loop: boolean;
      videoDurationMs: number;
      musicDurationMs: number;
    },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 按顺序拼接视频，尺寸和帧率以第一段为准，不同比例留黑边。 */
  concatVideo(
    uris: readonly string[],
    settings: VideoEncode & { width: number; height: number },
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
  /** 精确解码指定时间附近的一帧，原尺寸 JPEG，已摆正。 */
  frame(uri: string, timeMs: number, runId: string): Promise<string>;
  /** 按时间取画面（已摆正），JPEG 放进本次运行的临时目录。 */
  thumbnails(
    uri: string,
    timesMs: readonly number[],
    maxSide: number,
    runId: string,
  ): Promise<string[]>;
  /** 音频（或视频的声音）编码成 M4A / WAV / MP3（D-153、D-183）。 */
  encodeAudio(
    uri: string,
    settings: AudioEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 几段按顺序接成一段（D-155），格式、采样率可以不同。 */
  concatAudio(
    uris: readonly string[],
    settings: AudioEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput>;
  /** 波形（buckets 个 0–1 的峰值），剪一段界面用；读不到时返回 null。 */
  waveform(uri: string, buckets: number): Promise<number[] | null>;
  /** 整段视频转成 GIF（D-184）：按 fps 取画面，宽度不超过 width。 */
  videoGif(
    uri: string,
    settings: { width: number; fps: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<GifOutput>;
  /** 几张图片做成 GIF（D-184）：长边缩到 maxSide，按第一张的尺寸居中摆放，每张停 delayMs。 */
  imagesGif(
    uris: readonly string[],
    settings: { delayMs: number; maxSide: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<GifOutput>;
}

/**
 * 办公文档转 PDF（D-186）。iOS 用系统的文档预览排版（modules/morph-docs），Word、Excel、PowerPoint、RTF 都能转；
 * Android（和没有原生模块的 Expo Go）用 mammoth 把 Word（.docx）转成网页再打印成 PDF。
 */
/** PDF 密码（D-194，modules/morph-docs 的 PDFKit）。结果写成本次运行的临时文件 runs/<runId>/<relPath>。 */
export interface PdfPasswordPlatform {
  /** none：没有加密；restricted：不用密码能打开但有限制；locked：要密码才能打开。打不开时抛出错误。 */
  lockState(uri: string): Promise<'none' | 'restricted' | 'locked'>;
  /** 另存一份没有密码的；密码不对时返回 null。 */
  unlock(
    uri: string,
    password: string,
    runId: string,
    relPath: string,
  ): Promise<{ uri: string; size: number } | null>;
  protect(
    uri: string,
    password: string,
    runId: string,
    relPath: string,
  ): Promise<{ uri: string; size: number }>;
}

export interface DocumentPlatform {
  /** 能转的扩展名（小写）。 */
  readonly extensions: readonly string[];
  /** PDF 密码；Android 和 Expo Go 没有（P-025）。 */
  readonly passwords: PdfPasswordPlatform | null;
  /** 转成本次运行的 PDF 临时文件；打不开时抛出 code 为 ERR_DOC_UNREADABLE 的错误。 */
  toPdf(
    uri: string,
    ext: string,
    page: { width: number; height: number },
    runId: string,
    relPath: string,
  ): Promise<{ uri: string; size: number; pageCount: number }>;
}

/**
 * 长任务切到别的 App 也继续（modules/morph-background，D-160–D-163）：Android 是前台服务和进度通知，
 * iOS 26 是系统的后台任务（默认关着）。运行入口在一次含长步骤的运行前后调用；没有原生模块时为 null。
 */
export interface BackgroundPlatform {
  /** 切到别的 App 时会不会继续；运行页据此提示「可以切走」或「请留在 Morph 里」。 */
  readonly continuesInBackground: boolean;
  /** Android 13 起第一次时问一次通知权限（D-161）；返回现在能不能发通知。 */
  ensureNotificationPermission(): Promise<boolean>;
  /** 系统不让开始时返回 false，任务照旧只在前台跑。 */
  begin(title: string, text: string): boolean;
  /** fraction 为 null 时进度不定。 */
  update(text: string, fraction: number | null): void;
  /** done 不为 null 时发一条完成通知（D-162）。 */
  end(done: { title: string; body: string } | null): void;
  /** Morph 现在在不在前台（决定发不发完成通知）。 */
  isForeground(): boolean;
}

export interface FilePlatform {
  /** 办公文档转 PDF（D-186）。 */
  readonly documents: DocumentPlatform;
  /** 系统自带的文字识别和扫描；没有时为 null。 */
  readonly vision: VisionPlatform | null;
  /** 系统自带的本机翻译（D-170）；没有原生模块时为 null。 */
  readonly translator: TranslatePlatform | null;
  /** 本机处理视频和音频；没有时（Expo Go）为 null。 */
  readonly media: MediaPlatform | null;
  /** 本机语音转文字（D-150、D-151，modules/morph-speech）；没有时（Expo Go）为 null。 */
  readonly speech: SpeechPlatform | null;
  /** 长任务切到后台也继续（D-160）；没有原生模块时（Expo Go）为 null。 */
  readonly background: BackgroundPlatform | null;

  // ---- 用户文件（assets/<id>/<文件名>，D-019）----
  /**
   * 从相册选一张照片（图片组件、图片背景用），重新编码成 JPEG，最长边缩到 maxSide（默认 2048）以内，
   * 解码时就缩小；用户取消时返回 null。
   */
  pickImage(maxSide?: number): Promise<PickedFile | null>;
  /** 某个用户文件可以直接显示的地址（图片组件用）。 */
  fileUri(path: string): string;
  importFile(
    file: PickedFile,
    assetId: string,
    name: string,
  ): Promise<{ path: string; size: number }>;
  /**
   * 删掉一个用户文件在磁盘上的目录 assets/<id>/（「设置 → 存储空间」，D-264）。path 不在 assets/ 下时什么都不做；
   * 已经不在了也不算错。
   */
  removeAssetFile(path: string): Promise<void>;
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
  /** 从相册混选照片和视频；用户取消时返回 null。 */
  pickMedia(max: number): Promise<PickedFile[] | null>;
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
   * 分享进来的（共享目录、content://）原地使用，返回原地址；keepSource 为 true 时缓存副本也不移动（收件页要支持再次运行）。
   */
  adoptIntoRun(
    uri: string,
    runId: string,
    fileName: string,
    keepSource?: boolean,
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
  /**
   * 删除选择器放在 App 缓存目录里的副本（相册、「文件」选完之后系统复制的那份）。不在缓存目录的
   * （相册原件、content://、用户文件、运行临时目录 runs/）一律不动。
   */
  removePickedCopies(uris: readonly string[]): Promise<void>;
  /** 启动时调用：这时内存里没有任何一批收件，选择器缓存目录里剩下的副本都没人用了。 */
  removeStalePickerCopies(): Promise<void>;
  /** 把临时文件存成用户文件。 */
  saveRunFile(uri: string, assetId: string, name: string): Promise<{ path: string; size: number }>;

  // ---- 工作流执行：输出 ----
  /** 打开一次系统分享面板带上全部文件（MorphShare，D-119）；没有原生模块时（Expo Go）逐个打开。 */
  shareUris(items: readonly { uri: string; mimeType: string }[]): Promise<void>;
  /**
   * 把文件复制进「文件」里的一个文件夹（D-120）。每个快捷操作（key 是它的 ID）记住自己的文件夹（D-196）：
   * choose 不为 true 时有记住的就直接存进去，还没有时用最后选过的那个（D-123）并记给它；
   * 否则让用户选一个并记住它。返回存了几个和文件夹名，用户取消时返回 null。
   * 文件夹写不进去时抛出 folderNotWritable。
   */
  saveToFolder(
    items: readonly FolderItem[],
    key: string,
    choose?: boolean,
  ): Promise<{ saved: number; folder: string } | null>;
  /** 这个快捷操作会存进的文件夹的名字；没有时为 null。 */
  rememberedFolder(key: string): string | null;
  /** 忘掉已经删掉的快捷操作的文件夹（keep：现在还有的快捷操作 ID），打开 App 时调用。 */
  forgetFolders(keep: readonly string[]): void;
  /** 存到系统相册；没有权限时抛出 permissionDenied。 */
  saveToPhotos(uris: readonly string[]): Promise<void>;
  /**
   * 用系统预览打开一个文件（收件页面上的 PDF 等，D-238）：iOS 是 QuickLook，Android 交给能打开它的 App。
   * 没有能打开它的 App 时抛出 noViewer。
   */
  previewFile(item: { uri: string; mimeType: string; name: string }): Promise<void>;
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
