import { RunError } from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import type { FilePlatform, ImageFormat, ImageOps, PickedFile } from '../runtime/platform';

// 测试用工具：内存文件平台和真实 PDF 生成。

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

/** 内存中的“文件系统”。 */
export class FakeFiles implements FilePlatform {
  disk = new Map<string, Uint8Array>();
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
  async saveRunFile(uri: string, assetId: string, name: string) {
    return this.writeBytes(assetId, name, await this.readBytes(uri));
  }
  async shareUris(items: readonly { uri: string }[]) {
    this.shared.push(...items.map((i) => i.uri));
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
    if (!size) throw new Error('not an image');
    return size;
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
    const bytes = new Uint8Array(size);
    bytes.set(save.format === 'png' ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8, 0xff, 0xdb]);
    const dest = `runs/${runId}/${relPath}`;
    this.disk.set(dest, bytes);
    this.imageSizes.set(dest, { width, height });
    this.encodes.push({ ops, format: save.format, quality: save.quality, width, height });
    return { uri: dest, width, height, size };
  }
  /** 放一张“用户可选择的”假照片。 */
  offerImage(
    name: string,
    width: number,
    height: number,
    mimeType = 'image/jpeg',
    bytes?: Uint8Array,
  ): PickedFile {
    const picked = this.offer(name, bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType);
    this.imageSizes.set(picked.uri, { width, height });
    return { ...picked, width, height };
  }
  /** 临时目录里还剩的文件。 */
  runFiles() {
    return [...this.disk.keys()].filter((k) => k.startsWith('runs/'));
  }
  /** 放一个“用户可选择的”文件。 */
  offer(name: string, bytes: Uint8Array, mimeType = 'application/pdf'): PickedFile {
    const uri = `picker://${name}`;
    this.disk.set(uri, bytes);
    return { uri, name, size: bytes.length, mimeType };
  }
}
