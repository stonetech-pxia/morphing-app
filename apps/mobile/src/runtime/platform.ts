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
}

export type ImageFormat = 'jpeg' | 'png' | 'webp';

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

/** 用户存好的签名（documentDirectory/signatures/，不进配置和版本，不发给 AI）。 */
export interface SavedSignature {
  uri: string;
  bytes: Uint8Array;
  aspect: number;
}

export interface FilePlatform {
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
  /** 从「文件」App 选文件；types 是 MIME 类型（可含 image/*、* / *）。 */
  pickDocuments(types: readonly string[], multiple: boolean): Promise<PickedFile[] | null>;

  // ---- 工作流执行：临时文件（缓存目录 runs/<runId>/，D-063）----
  /** 把选择器给的文件复制进本次运行的临时目录。 */
  copyToRun(uri: string, runId: string, fileName: string): Promise<{ uri: string; size: number }>;
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
  /** 把临时文件存成用户文件。 */
  saveRunFile(uri: string, assetId: string, name: string): Promise<{ path: string; size: number }>;

  // ---- 工作流执行：输出 ----
  /** 依次打开系统分享面板（系统一次只能分享一个文件）。 */
  shareUris(items: readonly { uri: string; mimeType: string }[]): Promise<void>;
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
