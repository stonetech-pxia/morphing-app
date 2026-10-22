import { RunError } from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import type { FilePlatform, PickedFile } from '../runtime/platform';

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
