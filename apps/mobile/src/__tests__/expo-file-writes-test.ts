// expo-file-system 的 File.write 在 Android 上是异步的（返回 Promise，另有 writeSync）。
// 不等它写完就往下走，下一步可能读到写了一半的文件：手机上「多份材料合一」第 3 步报「文件可能已损坏」。
// 这里把 write 换成慢一点才写完的版本，检查每个写文件的地方都等它写完。

import { expoPackFs } from '../packs/expo-pack-fs';
import { expoFilePlatform } from '../runtime/expo-platform';
import { expoVision } from '../runtime/expo-vision';
import { expoToolFs } from '../tool-download/expo-tool-fs';

const mockDisk = new Map<string, Uint8Array | string>();

jest.mock('expo-file-system', () => {
  const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    get exists() {
      return true;
    }
    create() {}
    delete() {}
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return (mockDisk.get(this.uri) as Uint8Array | undefined)?.length ?? 0;
    }
    create() {}
    delete() {
      mockDisk.delete(this.uri);
    }
    write(content: Uint8Array | string) {
      // 和 Android 一样：调用时还没写，等一会儿才写进去。
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          mockDisk.set(this.uri, content);
          resolve();
        }, 5),
      );
    }
    async bytes() {
      return mockDisk.get(this.uri) as Uint8Array;
    }
    async text() {
      return mockDisk.get(this.uri) as string;
    }
  }
  return { File, Directory, Paths: { cache: { uri: 'cache' }, document: { uri: 'doc' } } };
});

// 文字识别（D-269）：张量写进临时文件交给原生模块。原生只看文件有多大，没写完就报
// 「input has 0 bytes」（手机上「识别照片里的文字」第 2 步）。
const mockDetectInputs: number[] = [];
jest.mock('../../modules/morph-vision', () => ({
  __esModule: true,
  default: {
    canFindPaper: () => false,
    isDocumentCameraSupported: () => false,
    supportsLanguage: () => false,
    ocrLoad: async () => {},
    async ocrDetect(input: string) {
      mockDetectInputs.push((mockDisk.get(input) as Uint8Array | undefined)?.length ?? 0);
      throw new Error('stop after detect');
    },
    ocrRecognize: async () => 0,
  },
}));
jest.mock('../packs/store', () => ({
  PackStore: class {
    isInstalled = async () => true;
    path = (id: string, file: string) => `packs/${id}/${file}`;
  },
}));
jest.mock('../runtime/skia', () => ({
  ocrPixels: async () => ({ width: 64, height: 32, data: new Uint8Array(64 * 32 * 4) }),
}));

beforeEach(() => {
  mockDisk.clear();
  mockDetectInputs.length = 0;
});

it('writes a run file completely before the next step can read it', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const { uri } = await expoFilePlatform.writeRunFile('run1', '1/merged.pdf', bytes);
  expect(mockDisk.get(uri)).toEqual(bytes);
});

it('finishes writing text files for packs and downloaded tools before returning', async () => {
  const before = mockDisk.size;
  await expoPackFs.writeText('pdfview/1/index.html', '<html></html>');
  expect(mockDisk.size).toBe(before + 1);
  await expoToolFs.writeText('tools/qr/1/tool.json', '{}');
  expect(mockDisk.size).toBe(before + 2);
});

it('finishes writing the text recognition input before the model reads it', async () => {
  mockDisk.set(expoPackFs.uri('packs/ppocr/dictionary.json'), '{"characters":["a"]}');
  const vision = expoVision((runId, relPath) => `cache/runs/${runId}/${relPath}`)!;
  await expect(vision.recognizeText('cache/photo.jpg', ['zh-Hans'])).rejects.toThrow(
    'stop after detect',
  );
  expect(mockDetectInputs).toHaveLength(1);
  expect(mockDetectInputs[0]).toBeGreaterThan(0);
});
