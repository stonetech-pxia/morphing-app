import { RunError } from '@morph/core';
import { zlibSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

import type { FilePlatform, ImageFormat, ImageOps, PickedFile } from '../runtime/platform';

// 测试用工具：内存文件平台和真实 PDF 生成。

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

/** 一张真实的 60×40 JPEG（tool-pdf 的测试素材），假编码器在它后面补零到目标大小。 */
const TINY_JPEG = Uint8Array.from(
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
    const width = [...text].length * 10;
    const height = Math.round(style.fontSize);
    return { bytes: makePng(width, height), width, height };
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
