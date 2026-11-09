import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { leafBlocks, type DocDoc, type DocLeaf } from './doc';
import { writeDocx, type DocxImage } from './docx';
import { importDocx, MAX_IMPORT_BLOCKS } from './docx-import';
import { importOffice } from './office-import';

// 读外来的 docx（D-509）：用真文件测——mammoth 自带的测试文件（Word 存的）、macOS 的 textutil 从 UTF-8 网页
// 转出来的 docx、Pages 存的加了密码的 docx，再加上用 jszip 按 Word 的写法拼出来的文件（样式、编号、合并格子、
// 修订、页眉页脚、分页）。

const require = createRequire(import.meta.url);
const mammothData = join(dirname(require.resolve('mammoth/package.json')), 'test/test-data');
const mammoth = (name: string) => new Uint8Array(readFileSync(join(mammothData, name)));
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, 'fixtures/office', name)));

/** 一份文档里所有能单独放的块。 */
const leaves = (doc: DocDoc): DocLeaf[] => doc.pages.flatMap(leafBlocks);
/** 所有段落、列表项、格子的字（按顺序，一项一行）。 */
const texts = (doc: DocDoc) =>
  leaves(doc).flatMap((b) =>
    b.kind === 'paragraph'
      ? [b.text]
      : b.kind === 'list'
        ? b.items
        : b.kind === 'table'
          ? b.table.cells.map((c) => c.text)
          : [],
  );

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** 按 Word 的写法拼一份 docx（jszip，和我们自己写 docx 用的 fflate 不是一个库）。 */
async function wordLike(
  body: string,
  extra: { styles?: string; numbering?: string; parts?: Record<string, string> } = {},
) {
  const zip = new JSZip();
  const rels = [
    `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`,
    ...(extra.numbering
      ? [`<Relationship Id="rIdNum" Type="${REL}/numbering" Target="numbering.xml"/>`]
      : []),
    `<Relationship Id="rIdHeader" Type="${REL}/header" Target="header1.xml"/>`,
    `<Relationship Id="rIdComments" Type="${REL}/comments" Target="comments.xml"/>`,
  ];
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} ${R}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr></w:body></w:document>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>' +
      (extra.styles ?? '') +
      '</w:styles>',
  );
  if (extra.numbering) zip.file('word/numbering.xml', extra.numbering);
  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${W}><w:p><w:r><w:t>CONFIDENTIAL HEADER</w:t></w:r></w:p></w:hdr>`,
  );
  zip.file(
    'word/comments.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0"><w:p><w:r><w:t>Reviewer note</w:t></w:r></w:p></w:comment></w:comments>`,
  );
  for (const [name, xml] of Object.entries(extra.parts ?? {})) zip.file(name, xml);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>` +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '</w:numbering>';
const item = (numId: number, text: string, ilvl = 0) =>
  p(
    r(text),
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`,
  );

describe('importDocx: Word files (mammoth test data)', () => {
  it('reads a table with its cells, borders and column widths between two paragraphs', () => {
    const { doc } = importDocx(mammoth('tables.docx'));
    const blocks = leaves(doc);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(texts(doc)).toEqual([
      'Above',
      'Top left',
      'Top right',
      'Bottom left',
      'Bottom right',
      'Below',
    ]);
    const table = blocks[1]!;
    if (table.kind !== 'table') throw new Error('table');
    expect(table.table).toMatchObject({ rows: 2, cols: 2, col: 0 });
    // Table Grid 有边框；列宽是网格里写的（4621 twip ≈ 231 磅）。
    expect(table.borderless).toBeUndefined();
    expect(table.colWidths.map(Math.round)).toEqual([231, 231]);
  });

  it('reads a bulleted list, underlined words inside a bold paragraph, and a picture', () => {
    expect(leaves(importDocx(mammoth('simple-list.docx')).doc)).toMatchObject([
      { kind: 'list', ordered: false, items: ['Apple', 'Banana'] },
    ]);
    expect(leaves(importDocx(mammoth('underline.docx')).doc)).toMatchObject([
      {
        kind: 'paragraph',
        text: 'The Sunset Tree',
        bold: true,
        runs: [{ text: 'The ' }, { text: 'Sunset', underline: true }, { text: ' Tree' }],
      },
    ]);
    // 只有一张图片的文件。
    const picture = importDocx(mammoth('tiny-picture.docx'));
    const [image] = leaves(picture.doc);
    expect(image).toMatchObject({ kind: 'image', src: 'word/media/image1.png' });
    expect(picture.images.get('word/media/image1.png')!.ext).toBe('png');
    expect(picture.images.get('word/media/image1.png')!.bytes).toEqual(
      new Uint8Array(readFileSync(join(mammothData, 'tiny-picture.png'))),
    );
  });

  it('puts footnotes and endnotes at the end, keeps text-box text, drops comments', () => {
    expect(texts(importDocx(mammoth('footnotes.docx')).doc)).toEqual([
      'Ouch[1].[2]',
      '[1] A tachyon walks into a bar.',
      '[2] Fin.',
    ]);
    expect(texts(importDocx(mammoth('endnotes.docx')).doc)).toEqual([
      'Ouch[1].[2]',
      '[1] A tachyon walks into a bar.',
      '[2] Fin.',
    ]);
    expect(texts(importDocx(mammoth('text-box.docx')).doc)).toEqual(['Datum plane']);
    // 批注的字不在正文里。
    expect(texts(importDocx(mammoth('comments.docx')).doc).join('\n')).not.toContain('tachyon');
  });

  it('reads strict-format files, a UTF-8 BOM, and drops pictures linked from the web', () => {
    expect(texts(importDocx(mammoth('strict-format.docx')).doc)).toEqual(['Test']);
    expect(texts(importDocx(mammoth('utf8-bom.docx')).doc)).toEqual([
      'This XML has a byte order mark.',
    ]);
    // 外部链接的图片不下载（不联网，不变量 1）。
    const linked = importDocx(mammoth('external-picture.docx'));
    expect(leaves(linked.doc)).toEqual([]);
    expect(linked.images.size).toBe(0);
  });

  it('an empty document is one empty page that can still be written', () => {
    const { doc } = importDocx(mammoth('empty.docx'));
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.blocks).toEqual([]);
    expect(unzipSync(writeDocx(doc))['word/document.xml']).toBeDefined();
  });
});

describe('importDocx: a file saved by macOS textutil from a UTF-8 web page', () => {
  // lease-textutil.docx：textutil -convert docx lease.html，网页开头写了 <meta charset="utf-8">
  // （不写时 £ 变成「拢」）。textutil 不写样式表、编号和表格：标题是大号粗体，列表项是「制表符 • 制表符 字」，
  // 表格的格子变成一段一段。
  const { doc } = importDocx(fixture('lease-textutil.docx'));
  const blocks = leaves(doc);

  it('keeps every character: pound and euro signs, accents and Chinese', () => {
    const all = texts(doc).join('\n');
    expect(all).toContain('The rent is £1,250 per month');
    expect(all).toContain('Café deposit: €300 — naïve façade.');
    expect(all).toContain('Total due on signing: £2,500');
    expect(all).toContain('中文测试：租金按月支付。');
    expect(all).not.toContain('拢');
  });

  it('reads sizes, bold / italic / underline words and centred text', () => {
    expect(doc.pages[0]!.bodySize).toBe(12);
    expect(blocks[0]).toMatchObject({ text: 'Flat Lease Agreement', size: 24, bold: true });
    expect(blocks[1]).toMatchObject({
      runs: [
        { text: 'This agreement is made on ' },
        { text: '1 November 2026', bold: true },
        { text: ' between ' },
        { text: 'Ann Landlord', italic: true },
        { text: ' and ' },
        { text: 'Bob Tenant', underline: true },
        { text: '.' },
      ],
    });
    expect(
      blocks.find((b) => b.kind === 'paragraph' && b.text === 'Signed in London'),
    ).toMatchObject({ align: 'center' });
  });

  it('typed bullets and numbers become lists; paragraphs with space after them are spaced', () => {
    expect(blocks.filter((b) => b.kind === 'list')).toMatchObject([
      { ordered: false, items: ['Water is included', 'Electricity is not included'] },
      {
        ordered: true,
        start: 1,
        items: ['Pay the rent', 'Keep the flat clean', 'Return the keys'],
      },
    ]);
    expect(blocks[1]).toMatchObject({ spaced: true });
  });
});

describe('importDocx: Word-shaped files', () => {
  it('headings by style name or outline level, list levels, style and direct run formatting', async () => {
    const data = await wordLike(
      [
        p(r('Annual report'), '<w:pStyle w:val="Heading1"/><w:jc w:val="center"/>'),
        p(r('Résumé'), '<w:pStyle w:val="Titre2"/>'),
        p(
          r('Plain, ') +
            r('strong', '<w:rStyle w:val="Strong"/>') +
            r(', red', '<w:color w:val="FF0000"/>') +
            r(' and big', '<w:sz w:val="36"/>') +
            r('hidden', '<w:vanish/>'),
        ),
        item(1, 'First'),
        item(1, 'Second'),
        item(1, 'Sub point', 1),
        item(1, 'Third'),
        item(2, 'Loose bullet'),
      ].join(''),
      { numbering: NUMBERING },
    );
    const blocks = leaves(importDocx(data).doc);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph', heading: 1, align: 'center', size: 16 });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', heading: 2, text: 'Résumé', size: 13 });
    expect(blocks[2]).toMatchObject({
      text: 'Plain, strong, red and big',
      runs: [
        { text: 'Plain, ' },
        { text: 'strong', bold: true },
        { text: ', red' },
        { text: ' and big', size: 18 },
      ],
    });
    // 颜色不是整段一种：不写。
    expect(blocks[2]).not.toHaveProperty('color');
    // 每一级各成一个列表，接着原来的编号（Third 是 3）。
    expect(blocks.slice(3)).toMatchObject([
      { kind: 'list', ordered: true, format: '%1.', start: 1, items: ['First', 'Second'] },
      { kind: 'list', ordered: false, items: ['Sub point'] },
      { kind: 'list', ordered: true, start: 3, items: ['Third'] },
      { kind: 'list', ordered: false, items: ['Loose bullet'] },
    ]);
  });

  it('accepts tracked changes, shows field results, keeps hyperlink text, splits at page breaks', async () => {
    const data = await wordLike(
      [
        p(
          r('Pay ') +
            `<w:del w:id="1"><w:r><w:delText>£900</w:delText></w:r></w:del>` +
            `<w:ins w:id="2">${r('£1,250')}</w:ins>` +
            r(' now.') +
            '<w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
        ),
        p(
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>' +
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
            r('7') +
            '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
            `<w:hyperlink r:id="rIdLink">${r('see the website')}</w:hyperlink>`,
        ),
        p(r('Before break') + '<w:r><w:br w:type="page"/></w:r>' + r('After break')),
        p(r('Own page'), '<w:pageBreakBefore/>'),
      ].join(''),
    );
    const { doc } = importDocx(data);
    expect(
      doc.pages.map((page) => page.blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.kind))),
    ).toEqual([
      ['Pay £1,250 now.', '7see the website', 'Before break'],
      ['After break'],
      ['Own page'],
    ]);
    // 页眉、批注的字都不在。
    expect(texts(doc).join('\n')).not.toMatch(/CONFIDENTIAL|Reviewer/);
  });

  it('merged cells (gridSpan, vMerge), short rows, borderless tables and pictures inside cells', async () => {
    const tc = (text: string, tcPr = '') =>
      `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(r(text))}</w:tc>`;
    const grid =
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid>';
    const data = await wordLike(
      [
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>' +
          grid +
          `<w:tr>${tc('Name', '<w:gridSpan w:val="2"/>')}${tc('Qty', '<w:vMerge w:val="restart"/>')}</w:tr>` +
          `<w:tr>${tc('First')}${tc('Last')}${tc('', '<w:vMerge/>')}</w:tr>` +
          `<w:tr>${tc('Only one cell')}</w:tr>` +
          '</w:tbl>',
        `<w:tbl><w:tblPr/>${grid}<w:tr>${tc('no lines')}</w:tr></w:tbl>`,
      ].join(''),
    );
    const blocks = leaves(importDocx(data).doc);
    const first = blocks[0]!;
    if (first.kind !== 'table') throw new Error('table');
    expect(first.colWidths).toEqual([100, 150, 50]);
    expect(first.table.rows).toBe(3);
    expect(first.table.cells.map((c) => [c.row, c.col, c.rowSpan, c.colSpan, c.text])).toEqual([
      [0, 0, 1, 2, 'Name'],
      [0, 2, 2, 1, 'Qty'],
      [1, 0, 1, 1, 'First'],
      [1, 1, 1, 1, 'Last'],
      [2, 0, 1, 1, 'Only one cell'],
      [2, 1, 1, 1, ''],
      [2, 2, 1, 1, ''],
    ]);
    // 每个位置正好属于一个格子。
    const owned = new Map<string, number>();
    for (const c of first.table.cells)
      for (let y = c.row; y < c.row + c.rowSpan; y++)
        for (let x = c.col; x < c.col + c.colSpan; x++)
          owned.set(`${y},${x}`, (owned.get(`${y},${x}`) ?? 0) + 1);
    expect(owned.size).toBe(9);
    expect([...owned.values()].every((n) => n === 1)).toBe(true);
    // 没有表格样式、没写边框：Word 里不画线。
    expect(blocks[1]).toMatchObject({ kind: 'table', borderless: true });
  });

  it('writes back through writeDocx: text, headings, lists, tables and PNG pictures survive a round trip', () => {
    const picture = importDocx(mammoth('tiny-picture.docx'));
    const images = new Map<string, DocxImage>(
      [...picture.images].map(([src, img]) => [src, { bytes: img.bytes, width: 10, height: 10 }]),
    );
    const doc: DocDoc = {
      ...picture.doc,
      pages: [
        {
          ...picture.doc.pages[0]!,
          blocks: [
            ...importDocx(mammoth('tables.docx')).doc.pages[0]!.blocks,
            ...picture.doc.pages[0]!.blocks,
          ],
        },
      ],
    };
    const written = writeDocx(doc, images);
    const files = unzipSync(written);
    // 图片按原来的格式存（PNG 不写成 .jpg）。
    expect(Object.keys(files)).toContain('word/media/image1.png');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain(
      'Extension="png" ContentType="image/png"',
    );
    const again = importDocx(written);
    expect(texts(again.doc)).toEqual(texts(doc));
    expect(leaves(again.doc).map((b) => b.kind)).toEqual([
      'paragraph',
      'table',
      'paragraph',
      'image',
    ]);
  });
});

describe('importDocx: files it cannot open', () => {
  it('a password-protected file (saved by Pages with a password) says so', () => {
    expect(importOffice(fixture('password-pages.docx'), 'docx')).toEqual({
      ok: false,
      error: 'encrypted',
    });
  });

  it('an empty file, a file that is not a Word document, a broken zip', async () => {
    expect(importOffice(new Uint8Array(), 'docx')).toEqual({ ok: false, error: 'damaged' });
    expect(importOffice(new TextEncoder().encode('%PDF-1.7 not a docx'), 'docx')).toEqual({
      ok: false,
      error: 'notOffice',
    });
    expect(importOffice(mammoth('tables.docx').slice(0, 900), 'docx')).toEqual({
      ok: false,
      error: 'damaged',
    });
    // 一个 Excel 文件改成了 .docx。
    const sheet = new JSZip();
    sheet.file(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    sheet.file(
      'xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    );
    const renamed = new Uint8Array(await sheet.generateAsync({ type: 'uint8array' }));
    expect(importOffice(renamed, 'docx')).toEqual({ ok: false, error: 'notOffice' });
    expect(importOffice(new Uint8Array(), 'pdf')).toBeNull();
  });

  it('a very large document and a zip bomb are too large (checked before unpacking everything)', async () => {
    const many = await wordLike(
      Array.from({ length: MAX_IMPORT_BLOCKS + 1 }, (_, i) => p(r(`Line ${i}`))).join(''),
    );
    expect(importOffice(many, 'docx')).toEqual({ ok: false, error: 'tooLarge' });
    // 2 MB 的空白压成几 KB：压缩比超过 200 倍。
    const bomb = await wordLike(p(r('x')) + ' '.repeat(2 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(20000);
    expect(importOffice(bomb, 'docx')).toEqual({ ok: false, error: 'tooLarge' });
  });
});
