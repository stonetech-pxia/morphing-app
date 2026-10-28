import { RunError } from '@morph/core';
import { zlibSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

import { rotatedSize, type Quad } from '@morph/tool-image';
import type { TextLayer } from '@morph/tool-pdf';

import type {
  AudioEncode,
  BackgroundPlatform,
  Box,
  DocumentPlatform,
  DrawOp,
  FilePlatform,
  FolderItem,
  ImageFormat,
  ImageOps,
  MediaInfo,
  MediaJob,
  MediaOutput,
  MediaPlatform,
  PdfPasswordPlatform,
  PickedFile,
  SpeakErrorCode,
  SpeakPlatform,
  SpeakRequest,
  TranslatePlatform,
  VideoEncode,
  VisionPlatform,
} from '../runtime/platform';
import {
  SpeechError,
  type SpeechErrorCode,
  type SpeechNeed,
  type SpeechPlatform,
  type TranscribeRequest,
} from '../runtime/speech';

// 测试用工具：内存文件平台和真实 PDF 生成。

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

/** 一张真实的 60×40 JPEG（tool-pdf 的测试素材），假编码器在它后面补零到目标大小。 */
export const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAPKADAAQAAAABAAAAKAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAKAA8AwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICBAICBAYEBAQGCAYGBgYICggICAgICgwKCgoKCgoMDAwMDAwMDA4ODg4ODhAQEBAQEhISEhISEhISEv/bAEMBAwMDBQQFCAQECBMNCw0TExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE//dAAQABP/aAAwDAQACEQMRAD8A/H608O/7NdTaeHf9mvT7Tw7/ALNdRaeHf9mv3PE5z5nzOS8Q7anmFn4d6fLXU2fh3p8ten2nh3p8tdTZ+Heny14OJzrzP1vJeIdtTzCz8O/7NdTaeHf9mvT7Pw70+WuotPDv+zXgYnOfM/W8l4h21PMLTw7/ALNdFF4d+T7terWnh3/Zroo/Dvy/drwq+da7n6tlfEPubn//0Pm608O/7NdRaeHf9mvT7Tw7/s11Np4d/wBmvZxOdeZ/M+S8QbanmFp4d6fLXU2nh3p8ten2nh3/AGa6iz8O9PlrwcTnXmfreS8QbanmFp4d6fLXU2nh3p8ten2fh3p8tdTZ+Hf9mvAxOdeZ+t5LxBtqeYWnh3/Zroo/Dvyfdr1W08O/7NdFH4d+X7teFXznXc/Vsr4g9zc//9H1608O9PlrqbTw7/s1bs+1dTadq+MxOKqdz+B8lxtXTUp2nh3/AGa6m08O9Plq5aV1FpXg4nFVO5+t5LjaumpUtPDvT5a6iz8O9Plq5Z9a6i07V4GJxVTufreS42rpqVLTw70+Wuij8O/L92tKz7V0cf3BXhV8VUvufq2V42rybn//2Q==',
  ),
  (c) => c.charCodeAt(0),
);

/** 一个真实的、纯灰色的 PNG（pdf-lib 可以嵌入）。 */
export function makePng(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8); // 8 位灰度
  const raw = new Uint8Array((width + 1) * height).fill(128);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}

/** 内存中的“文件系统”。 */
export class FakeFiles implements FilePlatform {
  disk = new Map<string, Uint8Array>();
  /** 办公文档转 PDF：默认像 Android，只能转 .docx（iOS 的测试换成全部格式）。 */
  documents: FakeDocuments = new FakeDocuments(this);
  /** 系统文字识别和扫描：默认没有（像 Android / Expo Go），测试里换成 FakeVision。 */
  vision: VisionPlatform | null = null;
  /** 系统翻译：默认没有（像 Expo Go），测试里换成 FakeTranslator。 */
  translator: TranslatePlatform | null = null;
  /** 视频处理：默认有（像开发版），测试 Expo Go 时设为 null。 */
  media: MediaPlatform | null = new FakeMedia(this);
  /** 语音转文字：默认没有（像 Expo Go），测试里换成 FakeSpeech。 */
  speech: SpeechPlatform | null = null;
  /** 系统朗读（D-270）：默认没有（像 Expo Go），测试里换成 FakeSpeaker。 */
  speaker: SpeakPlatform | null = null;
  /** 后台继续（D-160）：默认没有（像 Expo Go），测试里换成 FakeBackground。 */
  background: BackgroundPlatform | null = null;
  /** 下一次从相册选视频的结果。 */
  nextVideos: PickedFile[] | null = null;
  /** 手机剩余空间（字节）；null 表示读不到。 */
  freeBytes: number | null = 64 * 1024 * 1024 * 1024;
  /** 被「移进」本次运行的文件（视频、音频不复制，D-142）。 */
  adopted: string[] = [];
  /** 下一次选文件（「文件」App）的结果。 */
  nextPick: PickedFile[] | null = null;
  /** 下一次从相册多选的结果。 */
  nextPhotos: PickedFile[] | null = null;
  /** 依次拍到的照片；null 表示用户取消。 */
  camera: (PickedFile | null)[] = [];
  cameraAvailable = true;
  photosAllowed = true;
  /** 最近一次选文件时请求的类型。 */
  lastPickTypes: readonly string[] = [];
  shared: string[] = [];
  savedToPhotos: string[] = [];
  printed: string[] = [];
  clipboard = '';
  nextImage: PickedFile | null = null;
  /** 每次选照片要求的最长边。 */
  imageSides: (number | undefined)[] = [];
  async pickImage(maxSide?: number) {
    this.imageSides.push(maxSide);
    return this.nextImage;
  }
  nextMedia: PickedFile[] | null = null;
  async pickMedia(max: number) {
    return this.nextMedia ? this.nextMedia.slice(0, max) : null;
  }
  async pickPhotos(max: number) {
    return this.nextPhotos ? this.nextPhotos.slice(0, max) : null;
  }
  async pickVideos(max: number) {
    return this.nextVideos ? this.nextVideos.slice(0, max) : null;
  }
  async adoptIntoRun(uri: string, runId: string, fileName: string, keepSource = false) {
    const bytes = this.disk.get(uri);
    if (!bytes) throw new Error('permission denied');
    this.adopted.push(uri);
    // 选择器的副本（picker://）和运行中的临时文件移进来；分享进来的原地使用。
    if (!keepSource && (uri.startsWith('picker://') || uri.startsWith('runs/'))) {
      const dest = `runs/${runId}/${fileName}`;
      this.disk.delete(uri);
      this.disk.set(dest, bytes);
      const info = this.videos.get(uri);
      if (info) this.videos.set(dest, info);
      return { uri: dest, size: bytes.length };
    }
    return { uri, size: bytes.length };
  }
  freeDiskBytes() {
    return this.freeBytes;
  }
  /** 假视频的信息（uri → 时长、宽高、有没有声音）。 */
  videos = new Map<string, MediaInfo>();
  /** 放一个“用户可选择的”假视频；字节数就是它的大小（内容不重要）。 */
  offerVideo(
    name: string,
    opts: Partial<MediaInfo> & { size: number },
    mimeType = 'video/quicktime',
  ): PickedFile {
    const picked = this.offer(name, new Uint8Array(opts.size), mimeType);
    const info: MediaInfo = {
      kind: 'video',
      durationMs: 60_000,
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      videoBitrateKbps: 15_000,
      ...opts,
    };
    this.videos.set(picked.uri, info);
    return { ...picked, durationMs: info.durationMs, width: info.width!, height: info.height! };
  }
  /** 放一个「文件」里可选的假音频；字节数就是它的大小。 */
  offerAudio(
    name: string,
    opts: Partial<MediaInfo> & { size: number },
    mimeType = 'audio/mp4',
  ): PickedFile {
    const picked = this.offer(name, new Uint8Array(opts.size), mimeType);
    const info: MediaInfo = {
      kind: 'audio',
      durationMs: 60_000,
      hasVideo: false,
      hasAudio: true,
      audioBitrateKbps: 128,
      channels: 2,
      sampleRate: 44100,
      ...opts,
    };
    this.videos.set(picked.uri, info);
    return { ...picked, durationMs: info.durationMs };
  }
  async takePhoto() {
    if (!this.cameraAvailable) {
      throw new RunError('cameraUnavailable');
    }
    return this.camera.shift() ?? null;
  }
  async pickDocuments(types: readonly string[]) {
    this.lastPickTypes = types;
    return this.nextPick;
  }
  fileUri(path: string) {
    return `file:///fake/${path}`;
  }
  async importFile(file: PickedFile, assetId: string, name: string) {
    const bytes = this.disk.get(file.uri);
    if (!bytes) throw new Error('permission denied');
    const path = `assets/${assetId}/${name}`;
    this.disk.set(path, bytes);
    return { path, size: bytes.length };
  }
  async removeAssetFile(path: string) {
    const [root, id] = path.split('/');
    if (root !== 'assets' || !id) return;
    for (const key of [...this.disk.keys()])
      if (key.startsWith(`assets/${id}/`)) this.disk.delete(key);
  }
  async readBytes(path: string) {
    // 真机上 readBytes 读的是「文档」目录里的相对路径；运行目录在缓存里、要用 readUri 读。
    if (path.startsWith('runs/') || path.includes(':'))
      throw new Error(`not a document path: ${path}`);
    const bytes = this.disk.get(path);
    if (!bytes) throw new Error('missing');
    return bytes;
  }
  async writeBytes(assetId: string, name: string, bytes: Uint8Array) {
    const path = `assets/${assetId}/${name}`;
    this.disk.set(path, bytes);
    return { path, size: bytes.length };
  }
  async share(path: string) {
    this.shared.push(path);
  }
  /** 选择器给的文字文件：地址 → 内容；读完的副本记在 readPicked 里。 */
  pickedTexts = new Map<string, string>();
  readPicked: string[] = [];
  async readPickedText(uri: string) {
    this.readPicked.push(uri);
    const text = this.pickedTexts.get(uri);
    if (text === undefined) throw new Error('permission denied');
    return text;
  }
  /** 导出的文字文件：文件名 → 内容。 */
  sharedTexts = new Map<string, string>();
  async shareText(fileName: string, text: string) {
    this.sharedTexts.set(fileName, text);
  }
  async copyToRun(uri: string, runId: string, fileName: string) {
    // 用户文件的地址（fileUri）也能复制进来，例如「加上已有文件」（D-197）。
    const bytes = this.disk.get(uri) ?? this.disk.get(uri.replace('file:///fake/', ''));
    if (!bytes) throw new Error('permission denied');
    const dest = `runs/${runId}/${fileName}`;
    this.disk.set(dest, bytes);
    const size = this.imageSizes.get(uri);
    if (size) this.imageSizes.set(dest, size);
    return { uri: dest, size: bytes.length };
  }
  async writeRunFile(runId: string, fileName: string, bytes: Uint8Array) {
    const dest = `runs/${runId}/${fileName}`;
    this.disk.set(dest, bytes);
    return { uri: dest, size: bytes.length };
  }
  async readUri(uri: string) {
    const bytes = this.disk.get(uri);
    if (!bytes) throw new Error('missing');
    return bytes;
  }
  async removeRun(runId: string) {
    for (const key of [...this.disk.keys()]) {
      if (key.startsWith(`runs/${runId}/`)) this.disk.delete(key);
    }
  }
  async removeAllRuns() {
    for (const key of [...this.disk.keys()]) if (key.startsWith('runs/')) this.disk.delete(key);
  }
  async removeShared(keep: readonly string[] = [], copies: readonly string[] = []) {
    for (const key of [...this.disk.keys()]) {
      if (key.startsWith('file:///group/') && !keep.includes(key)) this.disk.delete(key);
    }
    for (const uri of copies) this.disk.delete(uri);
  }
  async removePickedCopies(uris: readonly string[]) {
    for (const uri of uris) if (uri.startsWith('picker://')) this.disk.delete(uri);
  }
  async removeStalePickerCopies() {
    for (const key of [...this.disk.keys()]) if (key.startsWith('picker://')) this.disk.delete(key);
  }
  async saveRunFile(uri: string, assetId: string, name: string) {
    return this.writeBytes(assetId, name, await this.readUri(uri));
  }
  /** 每次打开分享面板带了哪些文件。 */
  shareSheets: string[][] = [];
  async shareUris(items: readonly { uri: string }[]) {
    this.shareSheets.push(items.map((i) => i.uri));
    this.shared.push(...items.map((i) => i.uri));
  }
  /** 下一次选文件夹时用户怎么做：选好、取消、选了写不进去的文件夹（写不进去对记住的文件夹也生效）。 */
  folderChoice: 'pick' | 'cancel' | 'notWritable' = 'pick';
  /** 用户在选择器里选的文件夹名。 */
  nextFolder = 'MorphOut';
  /** 最后选过的文件夹（D-123）。 */
  remembered: string | null = null;
  /** 每个快捷操作记住的文件夹（D-196）：快捷操作 ID → 文件夹名。 */
  rememberedBy = new Map<string, string>();
  /** 打开了几次文件夹选择器。 */
  folderPicks = 0;
  /** 各文件夹里的文件：文件夹名 → 文件名 → 内容。 */
  folders = new Map<string, Map<string, Uint8Array>>();
  async saveToFolder(items: readonly FolderItem[], key: string, choose = false) {
    const kept = choose ? null : (this.rememberedBy.get(key) ?? this.remembered);
    let folder = kept;
    if (!folder) {
      this.folderPicks++;
      if (this.folderChoice === 'cancel') return null;
      folder = this.nextFolder;
    }
    if (this.folderChoice === 'notWritable') throw new RunError('folderNotWritable');
    if (!kept) this.remembered = folder;
    this.rememberedBy.set(key, folder);
    const files = this.folders.get(folder) ?? new Map<string, Uint8Array>();
    this.folders.set(folder, files);
    for (const item of items) {
      files.set(`${item.name}.${item.ext}`, await this.readUri(item.uri));
    }
    return { saved: items.length, folder };
  }
  rememberedFolder(key: string) {
    return this.rememberedBy.get(key) ?? this.remembered;
  }
  forgetFolders(keep: readonly string[]) {
    for (const key of [...this.rememberedBy.keys()]) {
      if (!keep.includes(key)) this.rememberedBy.delete(key);
    }
  }
  async saveToPhotos(uris: readonly string[]) {
    if (!this.photosAllowed) {
      throw new RunError('permissionDenied', { what: 'photos' });
    }
    this.savedToPhotos.push(...uris);
  }
  /** 用系统预览打开过的文件（D-238）。 */
  previewed: { uri: string; mimeType: string }[] = [];
  /** 为 true 时预览报「没有能打开它的 App」。 */
  previewFails = false;
  async previewFile(item: { uri: string; mimeType: string }) {
    if (this.previewFails) throw new RunError('noViewer');
    this.previewed.push({ uri: item.uri, mimeType: item.mimeType });
  }
  async print(item: { uri: string }) {
    this.printed.push(item.uri);
  }
  async copyText(text: string) {
    this.clipboard = text;
  }
  /** 假图片的尺寸（uri → 宽高）。 */
  imageSizes = new Map<string, { width: number; height: number }>();
  /** 编码结果的最小字节数（模拟怎么压都压不下去的图片）。 */
  minEncodedBytes = 200;
  /** 每次编码的记录，便于断言。 */
  encodes: {
    ops: ImageOps;
    format: ImageFormat;
    quality: number;
    width: number;
    height: number;
  }[] = [];
  async imageSize(uri: string) {
    const size = this.imageSizes.get(uri);
    if (size) return size;
    // 动作直接写出的图片（例如无损去掉定位）：按真实的小 JPEG / PNG 处理。
    const bytes = this.disk.get(uri);
    if (bytes && ((bytes[0] === 0xff && bytes[1] === 0xd8) || bytes[0] === 0x89)) {
      return { width: 60, height: 40 };
    }
    throw new Error('not an image');
  }
  /**
   * 假的编码器：按像素数和质量估算体积（JPEG 约 0.05–0.5 字节 / 像素，PNG 1.5），
   * 写出相应长度的字节，单调且可预测，足够测试「压到目标大小」的搜索。
   */
  /** 已经删掉的文件（测试里模拟运行中途被清理）。 */
  deleted = new Set<string>();
  /** 每次重新编码用的源图（和 encodes 一一对应）。 */
  encodedFrom: string[] = [];
  async transformImage(
    uri: string,
    ops: ImageOps,
    save: { format: ImageFormat; quality: number },
    runId: string,
    relPath: string,
  ) {
    // 和真机一样：文件已经被删掉时读不了。
    if (this.deleted.has(uri)) throw new Error('missing');
    let { width, height } = await this.imageSize(uri);
    if (ops.crop) ({ width, height } = ops.crop);
    if (ops.resize) ({ width, height } = ops.resize);
    if (ops.rotate === 90 || ops.rotate === 270) [width, height] = [height, width];
    width = Math.round(width);
    height = Math.round(height);
    const perPixel = save.format === 'png' ? 1.5 : 0.05 + 0.45 * save.quality;
    const size = Math.max(this.minEncodedBytes, Math.round(width * height * perPixel));
    // JPEG 用真实的小图开头（pdf-lib 能嵌入），PNG 用真实的灰色 PNG，后面补零到估算的大小。
    const head = save.format === 'png' ? makePng(4, 4) : TINY_JPEG;
    const bytes = new Uint8Array(Math.max(size, head.length));
    bytes.set(head);
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, bytes);
    this.imageSizes.set(dest, { width, height });
    this.encodes.push({ ops, format: save.format, quality: save.quality, width, height });
    this.encodedFrom.push(uri);
    return { uri: dest, width, height, size: bytes.length };
  }
  /** 放一张“用户可选择的”假照片。 */
  offerImage(
    name: string,
    width: number,
    height: number,
    mimeType = 'image/jpeg',
    bytes?: Uint8Array,
  ): PickedFile {
    // JPEG 用真实的小图（pdf-lib 要能嵌入），其他格式只需要占位字节。
    const fallback = mimeType === 'image/jpeg' ? TINY_JPEG : new Uint8Array([0, 1, 2, 3]);
    const picked = this.offer(name, bytes ?? fallback, mimeType);
    this.imageSizes.set(picked.uri, { width, height });
    return { ...picked, width, height };
  }
  /** 合成过的画布和绘制步骤（拼图、打码、水印、相纸）。 */
  composed: { canvas: { width: number; height: number; background: string }; ops: DrawOp[] }[] = [];
  async composeImage(
    canvas: { width: number; height: number; background: string },
    ops: readonly DrawOp[],
    save: { format: 'jpeg' | 'png'; quality: number },
    runId: string,
    relPath: string,
  ) {
    this.composed.push({ canvas, ops: [...ops] });
    const head = save.format === 'png' ? makePng(4, 4) : TINY_JPEG;
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, head);
    this.imageSizes.set(dest, { width: canvas.width, height: canvas.height });
    return { uri: dest, width: canvas.width, height: canvas.height, size: head.length };
  }
  /** imagePixels 返回的像素（按 uri）；没有时返回一张白图。 */
  pixels = new Map<string, { width: number; height: number; data: Uint8Array }>();
  async imagePixels(uri: string) {
    if (!this.disk.has(uri)) throw new Error('missing');
    return this.pixels.get(uri) ?? { width: 2, height: 2, data: new Uint8Array(16).fill(255) };
  }
  /** 生成过的 HTML（文字转 PDF、报表）。PDF 用 pdf-lib 生成一页真实的 PDF。 */
  printedHtml: string[] = [];
  async htmlToPdf(
    html: string,
    page: { width: number; height: number },
    runId: string,
    relPath: string,
  ) {
    this.printedHtml.push(html);
    const doc = await PDFDocument.create();
    doc.addPage([page.width, page.height]);
    const bytes = await doc.save();
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, bytes);
    return { uri: dest, size: bytes.length, pageCount: 1 };
  }
  enhanced: string[] = [];
  /** 增强时转正的角度（下一次增强用，按顺序）；转了的话画布按转过之后的大小放大。 */
  enhanceSkews: number[] = [];
  async enhanceImage(uri: string, mode: string, runId: string, relPath: string) {
    if (!this.disk.has(uri)) throw new Error('missing');
    const base = this.imageSizes.get(uri) ?? { width: 600, height: 800 };
    const skew = this.enhanceSkews.shift() ?? 0;
    const size = rotatedSize(base, skew);
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, TINY_JPEG);
    this.imageSizes.set(dest, size);
    this.enhanced.push(mode);
    return { uri: dest, ...size, size: TINY_JPEG.length, skew, base };
  }
  signatures: { uri: string; bytes: Uint8Array; aspect: number }[] = [];
  async loadSignatures() {
    return this.signatures;
  }
  async saveSignature(png: Uint8Array, aspect: number) {
    this.signatures.unshift({ uri: `sig://${this.signatures.length}`, bytes: png, aspect });
  }
  /** 画过的文字（断言用）。 */
  renderedTexts: string[] = [];
  /** 用真实的 PNG 代替 Skia 画出的文字（每个字 10 像素宽）。 */
  async renderText(text: string, style: { fontSize: number }) {
    this.renderedTexts.push(text);
    const width = [...text].length * Math.round(style.fontSize * 0.6);
    const height = Math.round(style.fontSize);
    return { bytes: makePng(width, height), width, height };
  }
  /** 临时目录里还剩的文件。 */
  runFiles() {
    return [...this.disk.keys()].filter((k) => k.startsWith('runs/'));
  }
  /** 放一个“别的 App 分享进来的”文件（iOS 的 App Group 共享目录）。 */
  offerShared(
    name: string,
    bytes: Uint8Array,
    mimeType: string | null = 'application/pdf',
  ): PickedFile {
    const uri = `file:///group/${name}`;
    this.disk.set(uri, bytes);
    return { uri, name, size: bytes.length, mimeType };
  }
  sharedFiles() {
    return [...this.disk.keys()].filter((k) => k.startsWith('file:///group/'));
  }
  /** 放一个“用户可选择的”文件。 */
  offer(name: string, bytes: Uint8Array, mimeType = 'application/pdf'): PickedFile {
    const uri = `picker://${name}`;
    this.disk.set(uri, bytes);
    return { uri, name, size: bytes.length, mimeType };
  }
}

/** 假的文档转 PDF（D-186）：每 1 KB 文档算一页，写出一个最小的 PDF 头。 */
/**
 * 假的 PDF 密码：内容以「%LOCK:密码」开头的是要密码才能打开的，「%RESTRICT」开头的是只限制了打印、复制。
 * 解锁后去掉这一行，加密码时加上这一行。
 */
export class FakePdfPasswords implements PdfPasswordPlatform {
  constructor(private files: FakeFiles) {}
  private text(uri: string) {
    return new TextDecoder().decode(this.files.disk.get(uri) ?? new Uint8Array());
  }
  async lockState(uri: string) {
    const text = this.text(uri);
    return text.startsWith('%LOCK:')
      ? 'locked'
      : text.startsWith('%RESTRICT')
        ? 'restricted'
        : 'none';
  }
  async unlock(uri: string, password: string, runId: string, relPath: string) {
    const [first, ...rest] = this.text(uri).split('\n');
    if (first !== `%LOCK:${password}`) return null;
    return this.files.writeRunFile(runId, relPath, new TextEncoder().encode(rest.join('\n')));
  }
  async protect(uri: string, password: string, runId: string, relPath: string) {
    const bytes = new TextEncoder().encode(`%LOCK:${password}\n${this.text(uri)}`);
    return this.files.writeRunFile(runId, relPath, bytes);
  }
}

export class FakeDocuments implements DocumentPlatform {
  extensions: readonly string[] = ['docx'];
  /** 设成 null 模拟 Android（P-025）。 */
  passwords: PdfPasswordPlatform | null;
  converted: { uri: string; ext: string; page: { width: number; height: number } }[] = [];
  /** 下一次转换抛出的错误码。 */
  failWith: string | null = null;
  constructor(private files: FakeFiles) {
    this.passwords = new FakePdfPasswords(files);
  }
  async toPdf(
    uri: string,
    ext: string,
    page: { width: number; height: number },
    runId: string,
    relPath: string,
  ) {
    if (this.failWith) {
      const code = this.failWith;
      this.failWith = null;
      throw Object.assign(new Error(code), { code });
    }
    this.converted.push({ uri, ext, page });
    const size = this.files.disk.get(uri)?.length ?? 0;
    const out = await this.files.writeRunFile(
      runId,
      relPath,
      new TextEncoder().encode('%PDF-1.7\n'),
    );
    return { uri: out.uri, size: out.size, pageCount: Math.max(1, Math.ceil(size / 1024)) };
  }
}

/**
 * 假的视频处理（modules/morph-media）：按码率和时长算出输出大小，写出相应长度的字节。
 * oversize 让编码器超出码率（测试「超了再压一次」）。
 */
export class FakeMedia implements MediaPlatform {
  encodes: (VideoEncode & { uri: string })[] = [];
  trims: { uri: string; range: { startMs: number; endMs: number } }[] = [];
  /** 输出比按码率算的大多少（1 = 正好）。 */
  oversize = 1;
  /** 下一次处理抛出的错误码（ERR_MEDIA_UNSUPPORTED 等）。 */
  failWith: string | null = null;

  constructor(private files: FakeFiles) {}

  async probe(uri: string): Promise<MediaInfo> {
    const info = this.files.videos.get(uri);
    if (!info) throw Object.assign(new Error('unsupported'), { code: 'ERR_MEDIA_UNSUPPORTED' });
    return { ...info, size: this.files.disk.get(uri)?.length ?? 0 };
  }
  private fail() {
    if (this.failWith) {
      const code = this.failWith;
      this.failWith = null;
      throw Object.assign(new Error(code), { code });
    }
  }
  speechExtractions: string[] = [];
  async speechAudio(
    uri: string,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.speechExtractions.push(uri);
    return this.encodeAudio(
      uri,
      { format: 'wav', bitrateKbps: 1536, sampleRate: 48000, channels: 2 },
      runId,
      relPath,
      job,
    );
  }
  volumes: { uri: string; automatic: boolean; db: number }[] = [];
  async volume(
    uri: string,
    settings: { automatic: boolean; db: number; video?: VideoEncode },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.volumes.push({ uri, automatic: settings.automatic, db: settings.db });
    if (settings.video) return this.encodeVideo(uri, settings.video, runId, relPath, job);
    return this.encodeAudio(
      uri,
      { format: 'm4a', bitrateKbps: 192, channels: 2, sampleRate: 48000 },
      runId,
      relPath,
      job,
    );
  }
  denoises: string[] = [];
  async denoise(
    uri: string,
    settings: { video?: VideoEncode },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.denoises.push(uri);
    return this.volume(uri, { ...settings, automatic: false, db: 0 }, runId, relPath, job);
  }
  mutes: string[] = [];
  async muteVideo(
    uri: string,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.mutes.push(uri);
    return this.encodeVideo(uri, { ...settings, audioKbps: 0 }, runId, relPath, job);
  }
  rotations: { uri: string; degrees: number }[] = [];
  async rotateVideo(
    uri: string,
    degrees: 90 | 180 | 270,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.rotations.push({ uri, degrees });
    const out = await this.encodeVideo(uri, settings, runId, relPath, job);
    if (degrees !== 180) [out.info.width, out.info.height] = [out.info.height, out.info.width];
    this.files.videos.set(out.uri, out.info);
    return out;
  }
  mixes: { uri: string; music: string; originalVolume: number; loop: boolean }[] = [];
  async mixVideoAudio(
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
  ): Promise<MediaOutput> {
    this.mixes.push({ uri, music, originalVolume: settings.originalVolume, loop: settings.loop });
    await this.probe(music);
    return this.encodeVideo(uri, { ...settings, audioKbps: 128 }, runId, relPath, job);
  }
  videoConcats: { uris: readonly string[]; width: number; height: number; maxFps: number }[] = [];
  async concatVideo(
    uris: readonly string[],
    settings: VideoEncode & { width: number; height: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.fail();
    this.videoConcats.push({
      uris: [...uris],
      width: settings.width,
      height: settings.height,
      maxFps: settings.maxFps,
    });
    const infos = await Promise.all(uris.map((uri) => this.probe(uri)));
    const durationMs = infos.reduce((n, i) => n + i.durationMs, 0);
    if (job.isCancelled())
      throw Object.assign(new Error('cancelled'), { code: 'ERR_MEDIA_CANCELLED' });
    const size = Math.round(((settings.videoKbps + settings.audioKbps) * durationMs) / 8);
    const out = await this.files.writeRunFile(runId, relPath, new Uint8Array(size));
    const info: MediaInfo = {
      kind: 'video',
      durationMs,
      size,
      width: settings.width,
      height: settings.height,
      fps: settings.maxFps,
      hasVideo: true,
      hasAudio: settings.audioKbps > 0,
    };
    this.files.videos.set(out.uri, info);
    job.progress(1);
    return { ...out, ext: 'mp4', info };
  }
  async encodeVideo(
    uri: string,
    settings: VideoEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.fail();
    const source = await this.probe(uri);
    this.encodes.push({ ...settings, uri });
    job.progress(0.5);
    if (job.isCancelled()) {
      throw Object.assign(new Error('cancelled'), { code: 'ERR_MEDIA_CANCELLED' });
    }
    const ms =
      (settings.range ? settings.range.endMs - settings.range.startMs : source.durationMs) /
      (settings.speed ?? 1);
    const bytes = Math.round(
      (((settings.videoKbps + settings.audioKbps) * 1000 * (ms / 1000)) / 8) * this.oversize,
    );
    const out = await this.files.writeRunFile(runId, relPath, new Uint8Array(bytes));
    const originalW = source.width ?? 1;
    const originalH = source.height ?? 1;
    const cropW = settings.aspectRatio
      ? Math.min(originalW, originalH * settings.aspectRatio)
      : originalW;
    const cropH = settings.aspectRatio
      ? Math.min(originalH, originalW / settings.aspectRatio)
      : originalH;
    const short = settings.shortSide ?? Math.min(cropW, cropH);
    const k = Math.min(1, short / Math.min(cropW, cropH));
    const info: MediaInfo = {
      ...source,
      durationMs: ms,
      size: bytes,
      width: settings.aspectRatio
        ? Math.max(2, Math.round((cropW * k) / 2) * 2)
        : Math.round(originalW * k),
      height: settings.aspectRatio
        ? Math.max(2, Math.round((cropH * k) / 2) * 2)
        : Math.round(originalH * k),
      hasAudio: settings.audioKbps > 0,
    };
    this.files.videos.set(out.uri, info);
    job.progress(1);
    return { uri: out.uri, ext: 'mp4', size: bytes, info };
  }
  async trim(
    uri: string,
    range: { startMs: number; endMs: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.fail();
    const source = await this.probe(uri);
    this.trims.push({ uri, range });
    const part = (range.endMs - range.startMs) / source.durationMs;
    const bytes = Math.max(1, Math.round(source.size * part));
    const out = await this.files.writeRunFile(runId, relPath, new Uint8Array(bytes));
    const info = { ...source, durationMs: range.endMs - range.startMs, size: bytes };
    this.files.videos.set(out.uri, info);
    job.progress(1);
    return { uri: out.uri, ext: 'mp4', size: bytes, info };
  }
  frames: { uri: string; timeMs: number }[] = [];
  async frame(uri: string, timeMs: number, runId: string) {
    this.fail();
    const info = await this.probe(uri);
    this.frames.push({ uri, timeMs });
    const out = await this.files.writeRunFile(runId, `frame-${this.frames.length}.jpg`, TINY_JPEG);
    this.files.imageSizes.set(out.uri, { width: info.width ?? 1, height: info.height ?? 1 });
    return out.uri;
  }
  async thumbnails(uri: string, timesMs: readonly number[]) {
    await this.probe(uri);
    return timesMs.map((ms) => `frame://${uri}/${ms}`);
  }
  audioEncodes: (AudioEncode & { uri: string })[] = [];
  concats: { uris: readonly string[]; settings: AudioEncode }[] = [];
  private async writeAudio(
    durationMs: number,
    settings: AudioEncode,
    runId: string,
    relPath: string,
  ): Promise<MediaOutput> {
    const bytes = Math.max(
      1,
      Math.round(
        (settings.format === 'wav'
          ? settings.sampleRate * settings.channels * 2 * (durationMs / 1000)
          : (settings.bitrateKbps * 1000 * (durationMs / 1000)) / 8) * this.oversize,
      ),
    );
    const out = await this.files.writeRunFile(runId, relPath, new Uint8Array(bytes));
    const info: MediaInfo = {
      kind: 'audio',
      durationMs,
      size: bytes,
      hasVideo: false,
      hasAudio: true,
      audioCodec: settings.format === 'wav' ? 'lpcm' : 'aac',
      audioBitrateKbps: settings.bitrateKbps,
      channels: settings.channels,
      sampleRate: settings.sampleRate,
    };
    this.files.videos.set(out.uri, info);
    return { uri: out.uri, ext: settings.format, size: bytes, info };
  }
  async encodeAudio(
    uri: string,
    settings: AudioEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.fail();
    const source = await this.probe(uri);
    if (!source.hasAudio)
      throw Object.assign(new Error('no audio'), { code: 'ERR_MEDIA_UNSUPPORTED' });
    this.audioEncodes.push({ ...settings, uri });
    job.progress(0.5);
    if (job.isCancelled()) {
      throw Object.assign(new Error('cancelled'), { code: 'ERR_MEDIA_CANCELLED' });
    }
    const ms = settings.range ? settings.range.endMs - settings.range.startMs : source.durationMs;
    const out = await this.writeAudio(ms, settings, runId, relPath);
    job.progress(1);
    return out;
  }
  async concatAudio(
    uris: readonly string[],
    settings: AudioEncode,
    runId: string,
    relPath: string,
    job: MediaJob,
  ): Promise<MediaOutput> {
    this.fail();
    let ms = 0;
    for (const uri of uris) ms += (await this.probe(uri)).durationMs;
    this.concats.push({ uris, settings });
    const out = await this.writeAudio(ms, settings, runId, relPath);
    job.progress(1);
    return out;
  }
  gifs: { uris: readonly string[]; settings: Record<string, number> }[] = [];
  /** 假的 GIF：每帧 1 KB，尺寸按设置算（视频按 16:9，图片按正方形）。 */
  private async writeGif(
    frames: number,
    width: number,
    height: number,
    runId: string,
    relPath: string,
    job: MediaJob,
  ) {
    if (job.isCancelled()) {
      throw Object.assign(new Error('cancelled'), { code: 'ERR_MEDIA_CANCELLED' });
    }
    const out = await this.files.writeRunFile(runId, relPath, new Uint8Array(frames * 1024));
    job.progress(1);
    return { uri: out.uri, size: out.size, width, height, frames };
  }
  async videoGif(
    uri: string,
    settings: { width: number; fps: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ) {
    this.fail();
    const source = await this.probe(uri);
    this.gifs.push({ uris: [uri], settings });
    const frames = Math.max(1, Math.floor((source.durationMs / 1000) * settings.fps));
    const height = Math.round((settings.width * 9) / 16);
    return this.writeGif(frames, settings.width, height, runId, relPath, job);
  }
  async imagesGif(
    uris: readonly string[],
    settings: { delayMs: number; maxSide: number },
    runId: string,
    relPath: string,
    job: MediaJob,
  ) {
    this.fail();
    this.gifs.push({ uris, settings });
    return this.writeGif(uris.length, settings.maxSide, settings.maxSide, runId, relPath, job);
  }
  /** 波形：null 表示原生模块读不到。 */
  peaks: number[] | null = [0.1, 0.8, 0.4, 1];
  async waveform(uri: string, buckets: number) {
    await this.probe(uri);
    return this.peaks
      ? Array.from({ length: buckets }, (_, i) => this.peaks![i % this.peaks!.length]!)
      : null;
  }
}

/** 假的语音转文字（modules/morph-speech）：按顺序返回文字，记下语言和模型。 */
export class FakeSpeech implements SpeechPlatform {
  engine: 'system' | 'whisper' = 'whisper';
  calls: { uri: string; language: string; model: string }[] = [];
  texts: string[] = [];
  /** need() 的结果；Android 默认要下载模型。 */
  needs: SpeechNeed = { kind: 'ready' };
  prepared: string[] = [];
  error: SpeechErrorCode | null = null;
  async need() {
    return this.needs;
  }
  async prepare(language: string) {
    this.prepared.push(language);
    this.needs = { kind: 'ready' };
  }
  timedResults: import('@morph/core').SpeechSegment[][] = [];
  async transcribe(uri: string, request: TranscribeRequest) {
    this.calls.push({ uri, language: request.language, model: request.model });
    request.onProgress?.(0.5);
    if (request.isCancelled?.()) throw new SpeechError('cancelled');
    if (this.error) throw new SpeechError(this.error);
    const text = this.texts.shift() ?? '';
    return {
      text,
      durationMs: 1000,
      ...(request.timed
        ? {
            segments:
              this.timedResults.shift() ?? (text ? [{ startMs: 0, endMs: 1000, text }] : []),
          }
        : {}),
    };
  }
}

/**
 * 假的系统朗读（modules/morph-tts）：每个字读 0.1 秒（除以语速），写一个同样大小的 24 kHz 单声道 WAV
 * 进本次运行的临时目录，并登记成能 probe 的音频（后面可以接 FakeMedia 的转格式）。
 */
export class FakeSpeaker implements SpeakPlatform {
  /** 各声音的状态；没写的是 installed。 */
  statuses: Record<string, 'installed' | 'notDownloaded' | 'unsupported' | 'noEngine'> = {};
  calls: { segments: readonly string[]; voice: string; rate: number; relPath: string }[] = [];
  /** 朗读时抛出的错误码。 */
  failWith: SpeakErrorCode | null = null;
  constructor(private files: FakeFiles) {}
  async voiceStatus(voice: string) {
    return this.statuses[voice] ?? 'installed';
  }
  async synthesize(segments: readonly string[], request: SpeakRequest) {
    const { voice, rate, relPath } = request;
    this.calls.push({ segments, voice, rate, relPath });
    // 像原生模块：每段之前看一次「停止」。
    for (let i = 0; i < segments.length; i++) {
      if (request.isCancelled?.())
        throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      request.onProgress?.((i + 1) / segments.length);
    }
    if (this.failWith) throw Object.assign(new Error(this.failWith), { code: this.failWith });
    const sampleRate = 24000;
    const chars = segments.reduce((n, s) => n + s.length, 0);
    const durationMs = Math.round((chars * 100) / rate);
    const bytes = 44 + Math.round((sampleRate * 2 * durationMs) / 1000);
    const out = await this.files.writeRunFile(request.runId, relPath, new Uint8Array(bytes));
    this.files.videos.set(out.uri, {
      kind: 'audio',
      durationMs,
      size: out.size,
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'lpcm',
      channels: 1,
      sampleRate,
    });
    return { uri: out.uri, size: out.size, durationMs, sampleRate, channels: 1 };
  }
}

/** 假的后台继续（modules/morph-background）：按顺序记下每次调用。 */
export class FakeBackground implements BackgroundPlatform {
  continuesInBackground = true;
  /** 通知权限：问的时候用户怎么答。 */
  grantNotifications = true;
  /** Morph 在不在前台。 */
  foreground = true;
  /** begin 的返回值（false：系统不让）。 */
  canBegin = true;
  calls: (
    | { kind: 'permission' }
    | { kind: 'begin'; title: string; text: string }
    | { kind: 'update'; text: string; fraction: number | null }
    | { kind: 'end'; done: { title: string; body: string } | null }
  )[] = [];
  async ensureNotificationPermission() {
    this.calls.push({ kind: 'permission' });
    return this.grantNotifications;
  }
  begin(title: string, text: string) {
    this.calls.push({ kind: 'begin', title, text });
    return this.canBegin;
  }
  update(text: string, fraction: number | null) {
    this.calls.push({ kind: 'update', text, fraction });
  }
  end(done: { title: string; body: string } | null) {
    this.calls.push({ kind: 'end', done });
  }
  isForeground() {
    return this.foreground;
  }
}

/** 假的系统文字识别和扫描（iOS 的 Vision；Android 的 ML Kit 设 canFindPaper = false）：按顺序返回找到的角和识别的文字，拉正写一张真实的小 JPEG。 */
export class FakeVision implements VisionPlatform {
  async adjustImage(
    uri: string,
    settings: import('../runtime/platform').ImageAdjustSettings,
    format: 'jpeg' | 'png',
    runId: string,
    relPath: string,
  ) {
    this.calls.push({ method: 'adjustImage', uri, args: { ...settings, format } });
    const size = await this.files.imageSize(uri);
    const out = await this.files.writeRunFile(runId, relPath, TINY_JPEG);
    this.files.imageSizes.set(out.uri, size);
    return { ...out, ...size };
  }
  backgroundRemovalSupported = true;
  backgroundState: 'ready' | 'download' | 'unsupported' = 'ready';
  backgroundFailure = false;
  async backgroundStatus() {
    return this.backgroundState;
  }
  async downloadBackgroundModel() {
    this.calls.push({ method: 'downloadBackgroundModel', uri: '' });
    this.backgroundState = 'ready';
  }
  async removeBackground(uri: string, background: string, runId: string, relPath: string) {
    this.calls.push({ method: 'removeBackground', uri, args: background });
    if (this.backgroundFailure) throw new Error('no subject');
    const size = await this.files.imageSize(uri);
    const out = await this.files.writeRunFile(runId, relPath, TINY_JPEG);
    this.files.imageSizes.set(out.uri, size);
    return { ...out, ...size };
  }

  /** 证件照（D-252）：每次找脸的结果（按顺序；检测图的大小和脸框）。 */
  faceResults: { width: number; height: number; faces: Box[] }[] = [];
  async detectFaces(uri: string) {
    this.calls.push({ method: 'detectFaces', uri });
    return this.faceResults.shift() ?? { width: 1, height: 1, faces: [] };
  }
  /** 图像分类：每次的标签（按顺序）。 */
  labelResults: { id: string; confidence: number }[][] = [];
  async classifyImage(uri: string) {
    this.calls.push({ method: 'classifyImage', uri });
    return this.labelResults.shift() ?? [];
  }
  /** iOS 的人像分割不用下载模型；改成 false 模拟 Android。 */
  personSegmentation = true;
  async replaceBackground(uri: string, color: string, runId: string, relPath: string) {
    this.calls.push({ method: 'replaceBackground', uri, args: color });
    if (this.backgroundFailure) throw new Error('no person');
    const size = await this.files.imageSize(uri);
    const out = await this.files.writeRunFile(runId, relPath, makePng(size.width, size.height));
    this.files.imageSizes.set(out.uri, size);
    return { ...out, ...size };
  }

  calls: { method: string; uri: string; args?: unknown }[] = [];
  /** 每次找边的结果（按顺序）。 */
  found: (Quad | null)[] = [];
  texts: string[] = [];
  documentCamera = true;
  canFindPaper = true;
  /** 系统识别不了的语言（BCP 47 主语言），例如 Android 的 ML Kit 不认俄文。 */
  unsupported = new Set<string>();
  /** 下一次文档相机拍到的页面；null 表示用户取消。 */
  scanned: PickedFile[] | null = null;

  constructor(private files: FakeFiles) {}

  supportsLanguage(code: string) {
    return !this.unsupported.has(code.split('-')[0]!);
  }
  /** 有文字识别模型的设备（D-269）：设成 { pack, languages } 时这些语言要先下载模型。 */
  ocrModel?: { pack: string; languages: readonly string[] };
  async recognizeText(uri: string, languages: readonly string[]) {
    this.calls.push({ method: 'recognizeText', uri, args: languages });
    return this.texts.shift() ?? '';
  }
  /** 每次按行识别的结果（按顺序）；没有时是一张 100×100、没有字的图。 */
  layers: (TextLayer | Error)[] = [];
  async recognizeLines(uri: string, languages: readonly string[]) {
    this.calls.push({ method: 'recognizeLines', uri, args: languages });
    const next = this.layers.shift() ?? { width: 100, height: 100, lines: [] };
    if (next instanceof Error) throw next;
    return next;
  }
  async findPaper(uri: string) {
    this.calls.push({ method: 'findPaper', uri });
    return this.found.shift() ?? null;
  }
  async straighten(
    uri: string,
    quad: Quad,
    size: { width: number; height: number },
    runId: string,
    relPath: string,
  ) {
    this.calls.push({ method: 'straighten', uri, args: { quad, ...size } });
    const out = await this.files.writeRunFile(runId, relPath, TINY_JPEG);
    this.files.imageSizes.set(out.uri, size);
    return { ...out, ...size };
  }
  async scanDocuments(_runId: string, maxSide: number) {
    this.calls.push({ method: 'scanDocuments', uri: '', args: { maxSide } });
    return this.scanned;
  }
}

/**
 * 假的系统翻译（D-170）：按文字猜语言（汉字 → zh，假名 → ja，其他字母 → en），译文是「[目标语言] 原文」。
 * android = true 时要下载的语言给出大小（ML Kit），否则不给（iOS 由系统弹窗）。
 */
export class FakeTranslator implements TranslatePlatform {
  supported = true;
  calls: { method: string; args: unknown[] }[] = [];
  /** 还没下载的语言。 */
  missing = new Set<string>();
  unsupported = new Set<string>();
  android = false;
  /** 下一次翻译抛出的错误码（cancelled：用户在 iOS 的下载弹窗里取消）。 */
  failWith: string | null = null;

  async detectLanguages(texts: readonly string[]) {
    this.calls.push({ method: 'detectLanguages', args: [texts.length] });
    return texts.map((x) =>
      /[\u3040-\u30ff]/.test(x)
        ? 'ja'
        : /[\u4e00-\u9fff]/.test(x)
          ? 'zh'
          : /[a-z]/i.test(x)
            ? 'en'
            : null,
    );
  }
  async status(from: string, to: string) {
    this.calls.push({ method: 'status', args: [from, to] });
    if (this.unsupported.has(from) || this.unsupported.has(to)) {
      return { status: 'unsupported' as const };
    }
    const missing = [from, to].filter((l) => this.missing.has(l));
    if (missing.length === 0) return { status: 'installed' as const };
    return this.android
      ? { status: 'download' as const, missing }
      : { status: 'download' as const };
  }
  get downloadBytes() {
    return this.android ? 30 * 1024 * 1024 : undefined;
  }
  /** 下载过的语言（「设置 → 已下载内容」列出）。 */
  downloaded = new Set<string>();
  download = async (language: string) => {
    this.calls.push({ method: 'download', args: [language] });
    this.missing.delete(language);
    this.downloaded.add(language);
  };
  downloadedLanguages = async () => [...this.downloaded];
  removeLanguage = async (language: string) => {
    this.downloaded.delete(language);
    this.missing.add(language);
  };
  async translate(texts: readonly string[], from: string, to: string) {
    this.calls.push({ method: 'translate', args: [texts, from, to] });
    if (this.failWith) throw Object.assign(new Error(this.failWith), { code: this.failWith });
    return texts.map((x) => `[${to}] ${x}`);
  }
}
