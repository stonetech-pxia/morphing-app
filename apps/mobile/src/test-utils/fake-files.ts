import { RunError } from '@morph/core';
import { zlibSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

import type { Quad } from '@morph/tool-image';

import type {
  DrawOp,
  FilePlatform,
  FolderItem,
  ImageFormat,
  ImageOps,
  PickedFile,
  VisionPlatform,
} from '../runtime/platform';

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
  /** 系统文字识别和扫描：默认没有（像 Android / Expo Go），测试里换成 FakeVision。 */
  vision: VisionPlatform | null = null;
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
  async pickImage() {
    return this.nextImage;
  }
  async pickPhotos(max: number) {
    return this.nextPhotos ? this.nextPhotos.slice(0, max) : null;
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
  async readBytes(path: string) {
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
  /** 导出的文字文件：文件名 → 内容。 */
  sharedTexts = new Map<string, string>();
  async shareText(fileName: string, text: string) {
    this.sharedTexts.set(fileName, text);
  }
  async copyToRun(uri: string, runId: string, fileName: string) {
    const bytes = this.disk.get(uri);
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
    return this.readBytes(uri);
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
  async saveRunFile(uri: string, assetId: string, name: string) {
    return this.writeBytes(assetId, name, await this.readBytes(uri));
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
  /** 记住的文件夹（D-123）。 */
  remembered: string | null = null;
  /** 打开了几次文件夹选择器。 */
  folderPicks = 0;
  /** 各文件夹里的文件：文件夹名 → 文件名 → 内容。 */
  folders = new Map<string, Map<string, Uint8Array>>();
  async saveToFolder(items: readonly FolderItem[], choose = false) {
    let folder = choose ? null : this.remembered;
    if (!folder) {
      this.folderPicks++;
      if (this.folderChoice === 'cancel') return null;
      folder = this.nextFolder;
    }
    if (this.folderChoice === 'notWritable') throw new RunError('folderNotWritable');
    this.remembered = folder;
    const files = this.folders.get(folder) ?? new Map<string, Uint8Array>();
    this.folders.set(folder, files);
    for (const item of items) {
      files.set(`${item.name}.${item.ext}`, await this.readBytes(item.uri));
    }
    return { saved: items.length, folder };
  }
  rememberedFolder() {
    return this.remembered;
  }
  async saveToPhotos(uris: readonly string[]) {
    if (!this.photosAllowed) {
      throw new RunError('permissionDenied', { what: 'photos' });
    }
    this.savedToPhotos.push(...uris);
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
  async transformImage(
    uri: string,
    ops: ImageOps,
    save: { format: ImageFormat; quality: number },
    runId: string,
    relPath: string,
  ) {
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
  async enhanceImage(uri: string, mode: string, runId: string, relPath: string) {
    if (!this.disk.has(uri)) throw new Error('missing');
    const size = this.imageSizes.get(uri) ?? { width: 600, height: 800 };
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, TINY_JPEG);
    this.imageSizes.set(dest, size);
    this.enhanced.push(mode);
    return { uri: dest, ...size, size: TINY_JPEG.length };
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

/** 假的系统文字识别和扫描（iOS 的 Vision；Android 的 ML Kit 设 canFindPaper = false）：按顺序返回找到的角和识别的文字，拉正写一张真实的小 JPEG。 */
export class FakeVision implements VisionPlatform {
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
  async recognizeText(uri: string, languages: readonly string[]) {
    this.calls.push({ method: 'recognizeText', uri, args: languages });
    return this.texts.shift() ?? '';
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
