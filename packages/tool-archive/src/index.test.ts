import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ArchiveError, createZip, extractZip, mimeTypeOfName, sanitizeName } from './index';

const text = (s: string) => strToU8(s);

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}

describe('createZip / extractZip', () => {
  it('round-trips files, keeping order, bytes and Chinese names', () => {
    const zip = createZip([
      { name: '报告.txt', bytes: text('第一季度') },
      { name: 'photo.jpg', bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]) },
      { name: '数据 2024.csv', bytes: text('a,b\n1,2') },
    ]);
    const entries = extractZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['报告.txt', 'photo.jpg', '数据 2024.csv']);
    expect(strFromU8(entries[0]!.bytes)).toBe('第一季度');
    expect(Array.from(entries[1]!.bytes)).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(entries.map((e) => e.mimeType)).toEqual(['text/plain', 'image/jpeg', 'text/csv']);
  });

  it('stores already-compressed formats and deflates the rest', () => {
    const repetitive = text('morph '.repeat(2000));
    const zip = createZip([
      { name: 'a.txt', bytes: repetitive },
      { name: 'b.png', bytes: repetitive },
    ]);
    const info: Record<string, number> = {};
    unzipSync(zip, {
      filter: (f) => {
        info[f.name] = f.compression;
        return false;
      },
    });
    expect(info).toEqual({ 'a.txt': 8, 'b.png': 0 });
  });

  it('sanitises and de-duplicates names case-insensitively', () => {
    const zip = createZip([
      { name: 'photo.jpg', bytes: text('1') },
      { name: 'Photo.JPG', bytes: text('2') },
      { name: 'photo.jpg', bytes: text('3') },
      { name: '../../etc/passwd', bytes: text('4') },
      { name: 'a\u0000b\\c.txt', bytes: text('5') },
      { name: '..', bytes: text('6') },
    ]);
    const names = Object.keys(unzipSync(zip));
    expect(names).toEqual([
      'photo.jpg',
      'Photo-2.JPG',
      'photo-3.jpg',
      '._._etc_passwd',
      'ab_c.txt',
      'file',
    ]);
    for (const name of names) {
      expect(name).not.toMatch(/[/\\]|\.\./);
    }
  });

  it('rejects empty input and inputs over the limits', () => {
    expect(errorOf(() => createZip([]))).toMatchObject({ code: 'empty' });
    const three = [1, 2, 3].map((i) => ({ name: `${i}.txt`, bytes: text('x') }));
    expect(errorOf(() => createZip(three, { limits: { maxEntries: 2 } }))).toMatchObject({
      code: 'tooManyEntries',
    });
    expect(errorOf(() => createZip(three, { limits: { maxTotalBytes: 2 } }))).toMatchObject({
      code: 'tooLarge',
    });
  });
});

describe('extractZip safety', () => {
  it('flattens traversal paths to safe base names', () => {
    // 手工构造的恶意路径：fflate 会原样写入这些名字。
    const zip = zipSync({
      '../../evil.txt': text('1'),
      '/etc/passwd': text('2'),
      'C:\\Windows\\win.ini': text('3'),
      'docs/sub/evil.txt': text('4'),
      'a/../..': text('5'),
    });
    const entries = extractZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      'evil.txt',
      'passwd',
      'win.ini',
      'evil-2.txt',
      'file',
    ]);
    expect(entries.map((e) => strFromU8(e.bytes))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('skips directories, __MACOSX and .DS_Store', () => {
    const zip = zipSync({
      'folder/': new Uint8Array(0),
      'folder/a.txt': text('a'),
      '__MACOSX/folder/._a.txt': text('junk'),
      'folder/.DS_Store': text('junk'),
    });
    expect(extractZip(zip).map((e) => e.name)).toEqual(['a.txt']);
  });

  it('reports an archive with no real files as empty', () => {
    expect(errorOf(() => extractZip(zipSync({})))).toMatchObject({ code: 'empty' });
    expect(errorOf(() => extractZip(zipSync({ '.DS_Store': text('x') })))).toMatchObject({
      code: 'empty',
    });
  });

  it('enforces limits from the central directory', () => {
    const zip = zipSync({ 'a.txt': text('aaaa'), 'b.txt': text('bbbb'), 'c.txt': text('cc') });
    expect(errorOf(() => extractZip(zip, { limits: { maxEntries: 2 } }))).toMatchObject({
      code: 'tooManyEntries',
    });
    expect(errorOf(() => extractZip(zip, { limits: { maxFileBytes: 3 } }))).toMatchObject({
      code: 'tooLarge',
      fileName: 'a.txt',
    });
    expect(errorOf(() => extractZip(zip, { limits: { maxTotalBytes: 9 } }))).toMatchObject({
      code: 'tooLarge',
    });
    expect(extractZip(zip, { limits: { maxTotalBytes: 10 } })).toHaveLength(3);
  });

  it('rejects highly compressed files as zip bombs', () => {
    const zip = zipSync({ 'zeros.bin': new Uint8Array(4 * 1024 * 1024) }, { level: 9 });
    expect(errorOf(() => extractZip(zip))).toMatchObject({
      code: 'tooLarge',
      fileName: 'zeros.bin',
    });
    // 小文件即使比例很高也放行。
    expect(extractZip(zipSync({ 'small.bin': new Uint8Array(100_000) }))).toHaveLength(1);
  });

  it('detects encrypted entries via the general-purpose flag', () => {
    const zip = zipSync({ 'secret.txt': text('hidden') });
    // 把中央目录和本地头的第 0 位标志都置 1，模拟 ZipCrypto 加密。
    for (let i = 0; i + 4 <= zip.length; i++) {
      const sig = zip[i]! | (zip[i + 1]! << 8) | (zip[i + 2]! << 16) | (zip[i + 3]! << 24);
      if (sig === 0x02014b50) zip[i + 8]! |= 1;
      if (sig === 0x04034b50) zip[i + 6]! |= 1;
    }
    expect(errorOf(() => extractZip(zip))).toMatchObject({
      code: 'encrypted',
      fileName: 'secret.txt',
    });
  });

  it('reports corrupted bytes as unreadable', () => {
    const error = errorOf(() => extractZip(text('this is not a zip')));
    expect(error).toBeInstanceOf(ArchiveError);
    expect(error).toMatchObject({ code: 'unreadable' });

    const zip = createZip([{ name: 'a.txt', bytes: text('hello '.repeat(500)) }]);
    const truncated = zip.slice(0, zip.length - 10);
    expect(errorOf(() => extractZip(truncated))).toMatchObject({ code: 'unreadable' });

    // 压缩数据开头被破坏（中央目录完好）：本地头 30 字节 + 文件名 5 字节之后就是 deflate 数据。
    const damaged = zip.slice();
    for (let i = 35; i < 45; i++) damaged[i] = 0xff;
    expect(errorOf(() => extractZip(damaged))).toMatchObject({ code: 'unreadable' });
  });
});

describe('helpers', () => {
  it('maps names to MIME types', () => {
    expect(mimeTypeOfName('a.PDF')).toBe('application/pdf');
    expect(mimeTypeOfName('x.jpeg')).toBe('image/jpeg');
    expect(mimeTypeOfName('报告.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mimeTypeOfName('clip.mov')).toBe('video/quicktime');
    expect(mimeTypeOfName('README')).toBe('application/octet-stream');
    expect(mimeTypeOfName('.json')).toBe('application/octet-stream');
  });

  it('sanitises names', () => {
    expect(sanitizeName('  照片 1.jpg  ')).toBe('照片 1.jpg');
    expect(sanitizeName('a/b\\c')).toBe('a_b_c');
    expect(sanitizeName('name...')).toBe('name');
    expect(sanitizeName('\u0001\u001f')).toBe('file');
  });
});
