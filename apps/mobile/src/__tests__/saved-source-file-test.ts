import type { DocDoc, TableDoc } from '@morph/tool-office';

import { SOURCE_NAME, writeSavedSource } from '../desk/saved-source-file';
import { FakeFiles } from '../test-utils/fake-files';

// 存成用户文件时跟着存中间格式（D-367）：有一张图读不到（2026-11-06 三星上「完成」后刚换的图已经搬走），
// 中间格式也照样存，不然这份 Word 放回桌上就不能改了（D-470）。

describe('writeSavedSource', () => {
  it('a missing picture is left out, the rest is still saved', async () => {
    const files = new FakeFiles();
    files.disk.set('runs/r1/page.jpg', new Uint8Array([1, 2, 3]));
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const doc: DocDoc = {
      version: 1,
      pages: [
        {
          source: 'runs/r1/page.jpg',
          width: 100,
          height: 100,
          bodySize: 11,
          blocks: [
            { kind: 'paragraph', text: 'Bonjour', box },
            { kind: 'image', box, src: 'runs/desk-x/gone.jpg' },
          ],
        },
      ],
    };
    const written: Record<string, Uint8Array> = {};
    await writeSavedSource(
      {
        readUri: (uri) => files.readUri(uri),
        writeBytes: async (_id, name, bytes) => {
          written[name] = bytes;
          return { path: name, size: bytes.length };
        },
      },
      'a1',
      { kind: 'doc', doc },
    );
    const body = JSON.parse(new TextDecoder().decode(written[SOURCE_NAME]!));
    expect(body.doc.pages[0].source).toBe('morph-source-0.jpg');
    expect(body.doc.pages[0].blocks[0].text).toBe('Bonjour');
    expect(body.doc.pages[0].blocks[1].src).toBe('');
    expect(Object.keys(written).sort()).toEqual(['morph-source-0.jpg', SOURCE_NAME]);
  });

  it('keeps an Excel picture beside the saved file and points the sidecar at it (D-520)', async () => {
    const files = new FakeFiles();
    files.disk.set('desk/d1/assets/page.jpg', new Uint8Array([1, 2, 3]));
    files.disk.set('desk/d1/assets/fig.jpg', new Uint8Array([4, 5]));
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const doc: TableDoc = {
      version: 3,
      scope: 'all',
      pages: [
        {
          name: 'P',
          source: 'desk/d1/assets/page.jpg',
          width: 100,
          height: 100,
          lineHeight: 10,
          colWidths: [50, 50],
          blocks: [{ kind: 'image', col: 0, cols: 2, box, src: 'desk/d1/assets/fig.jpg' }],
        },
      ],
    };
    const written: Record<string, Uint8Array> = {};
    await writeSavedSource(
      {
        readUri: (uri) => files.readUri(uri),
        writeBytes: async (_id, name, bytes) => {
          written[name] = bytes;
          return { path: name, size: bytes.length };
        },
      },
      'a1',
      { kind: 'table', doc },
    );
    const body = JSON.parse(new TextDecoder().decode(written[SOURCE_NAME]!));
    expect(body.doc.pages[0].blocks[0].src).toBe('morph-source-1.jpg');
    expect(Array.from(written['morph-source-1.jpg']!)).toEqual([4, 5]);
  });
});
