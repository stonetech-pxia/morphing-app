import { describe, expect, it } from 'vitest';

import {
  addPageNumbers,
  countPages,
  fillForm,
  listFormFields,
  pageInfo,
  rotatePages,
  selectPages,
  splitPdf,
  stampImage,
  stampText,
} from './index';
import { brokenBytes, makeEncryptedPdf, readJpeg } from './test-helpers';

// 每个读取 PDF 的函数都要把加密 / 损坏报告成 PdfError。
const operations: [string, (bytes: Uint8Array) => Promise<unknown>][] = [
  ['countPages', countPages],
  ['pageInfo', pageInfo],
  ['selectPages', (b) => selectPages(b, [0])],
  ['rotatePages', (b) => rotatePages(b, 90)],
  ['splitPdf', (b) => splitPdf(b, { kind: 'every', n: 1 })],
  [
    'addPageNumbers',
    (b) =>
      addPageNumbers(b, {
        position: 'bottomCenter',
        format: 'n',
        startAt: 1,
        fontSize: 10,
        marginPt: 20,
      }),
  ],
  [
    'stampText',
    (b) =>
      stampText(b, { text: 'x', position: 'center', fontSize: 10, color: '#000000', opacity: 1 }),
  ],
  [
    'stampImage',
    (b) =>
      stampImage(b, {
        image: { bytes: readJpeg(), kind: 'jpeg' },
        pageIndex: 0,
        x: 0,
        y: 0,
        width: 0.1,
      }),
  ],
  ['listFormFields', listFormFields],
  ['fillForm', (b) => fillForm(b, {}, { flatten: false })],
];

describe.each(operations)('%s', (_, run) => {
  it('reports encrypted and unreadable PDFs', async () => {
    await expect(run(await makeEncryptedPdf())).rejects.toMatchObject({ code: 'encrypted' });
    await expect(run(brokenBytes)).rejects.toMatchObject({ code: 'unreadable' });
  });
});
