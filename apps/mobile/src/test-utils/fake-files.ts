import { PDFDocument } from 'pdf-lib';

import type { FilePlatform, PickedFile } from '../runtime/runner';

// 测试用工具：内存文件平台和真实 PDF 生成。

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

/** 内存中的“文件系统”。 */
export class FakeFiles implements FilePlatform {
  disk = new Map<string, Uint8Array>();
  nextPick: PickedFile[] | null = null;
  shared: string[] = [];
  async pickPdfs() {
    return this.nextPick;
  }
  nextImage: PickedFile | null = null;
  async pickImage() {
    return this.nextImage;
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
  /** 放一个“用户可选择的”文件。 */
  offer(name: string, bytes: Uint8Array, mimeType = 'application/pdf'): PickedFile {
    const uri = `picker://${name}`;
    this.disk.set(uri, bytes);
    return { uri, name, size: bytes.length, mimeType };
  }
}
