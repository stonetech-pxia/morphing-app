// 底线 4：原件永远不移动、不删除（相册、「文件」、content://），只处理副本。
// 这里用真的文件平台（expo-platform.ts），只把 expo-file-system 换成记下每次删除和移动的替身：
// 把原件的地址交给每个会删、会移动的入口，原件一个都不能少。真机上的行为（系统相册、分享扩展的目录）
// 只能在手机上验证，见 INVARIANTS_AUDIT.md。

import { expoFilePlatform } from '../runtime/expo-platform';

const mockTouched: { op: 'delete' | 'move'; uri: string }[] = [];

jest.mock('expo-file-system', () => {
  const join = (...parts: string[]) => parts.join('/').replace(/(?<![:/])\/{2,}/g, '/');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [];
    }
    delete() {
      mockTouched.push({ op: 'delete', uri: this.uri });
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));
    }
    get exists() {
      return true;
    }
    get size() {
      return 10;
    }
    get name() {
      return this.uri.split('/').pop();
    }
    create() {}
    delete() {
      mockTouched.push({ op: 'delete', uri: this.uri });
    }
    move(dest: { uri: string }) {
      mockTouched.push({ op: 'move', uri: this.uri });
      this.uri = dest.uri;
    }
    async copy() {}
    async write() {}
    async text() {
      return 'x';
    }
    async bytes() {
      return new Uint8Array(1);
    }
  }
  return {
    File,
    Directory,
    Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///doc/' } },
  };
});
jest.mock('../packs/store', () => ({ PackStore: class {} }));

/** 用户的原件：相册、「文件」、Android 的 content://、App 自己存的用户文件。 */
const ORIGINALS = [
  'content://media/external/images/media/42',
  'content://com.android.providers.downloads.documents/document/7',
  'file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG',
  'file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/合同.pdf',
  'file:///doc/assets/abcdef12/合同.pdf',
];

describe('底线 4：原件永远不移动、不删除', () => {
  beforeEach(() => {
    mockTouched.length = 0;
  });

  it('cleaning up a run, a picker batch or a shared batch never touches an original', async () => {
    for (const uri of ORIGINALS) {
      await expoFilePlatform.removeRunFile(uri);
      await expoFilePlatform.removePickedCopies([uri]);
      await expoFilePlatform.removeShared([], [uri]);
      await expoFilePlatform.readPickedText(uri);
    }
    // removeShared 每次都清掉 Android 预览的缓存目录（cache/preview），那是 App 自己的副本。
    expect(mockTouched.filter((t) => !t.uri.startsWith('file:///cache/'))).toEqual([]);
  });

  it('using an original in a run uses it in place; only the app’s own cache copies are moved', async () => {
    for (const uri of ORIGINALS) {
      const used = await expoFilePlatform.adoptIntoRun(uri, 'run1', 'a.jpg');
      expect(used.uri).toBe(uri);
    }
    expect(mockTouched).toEqual([]);
    // 选择器放在缓存里的副本可以移进运行目录（属于这一批，不是原件）。
    await expoFilePlatform.adoptIntoRun('file:///cache/ImagePicker/x.jpg', 'run1', 'b.jpg');
    expect(mockTouched.filter((t) => t.op === 'move')).toEqual([
      { op: 'move', uri: 'file:///cache/ImagePicker/x.jpg' },
    ]);
    expect(mockTouched.every((t) => t.uri.startsWith('file:///cache/'))).toBe(true);
  });

  it('removing a saved file only deletes inside the app’s own assets folder', async () => {
    for (const path of ['../DCIM/a.jpg', 'Documents/a.pdf', 'assets/..', 'assets/']) {
      await expoFilePlatform.removeAssetFile(path);
    }
    expect(mockTouched).toEqual([]);
  });
});
