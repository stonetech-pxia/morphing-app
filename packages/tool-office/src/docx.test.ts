import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { DocDoc, DocPage } from './doc';
import { writeDocx } from './docx';

const box = { x: 100, y: 100, width: 400, height: 40 };

function page(blocks: DocPage['blocks'], bodySize = 11): DocPage {
  return { source: 'file:///p.jpg', width: 1000, height: 1400, bodySize, blocks };
}

const unzip = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return {
    names: Object.keys(files).sort(),
    text: (name: string) => strFromU8(files[name]!),
    bytes: (name: string) => files[name]!,
  };
};

describe('writeDocx', () => {
  it('writes a valid package with document, styles and numbering parts', () => {
    const zip = unzip(writeDocx({ version: 1, pages: [page([])] }));
    expect(zip.names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/fontTable.xml',
      'word/numbering.xml',
      'word/styles.xml',
    ]);
    expect(zip.text('[Content_Types].xml')).toContain(
      'PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"',
    );
    expect(zip.text('_rels/.rels')).toContain('Target="word/document.xml"');
    // A4 纵向。
    expect(zip.text('word/document.xml')).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    // 正文字号写进默认样式（半磅）。
    expect(zip.text('word/styles.xml')).toContain('<w:sz w:val="22"/>');
  });

  it('writes headings, run styles, alignment, escaped text and line breaks', () => {
    const doc: DocDoc = {
      version: 1,
      pages: [
        page([
          { kind: 'paragraph', text: 'Titre', heading: 1, bold: true, box },
          {
            kind: 'paragraph',
            text: 'A < B & "C"\nsecond line',
            color: '172094',
            size: 14,
            align: 'center',
            spaced: true,
            box,
          },
          { kind: 'paragraph', text: 'body size', size: 11, box },
        ]),
      ],
    };
    const xml = unzip(writeDocx(doc)).text('word/document.xml');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">Titre</w:t>');
    expect(xml).toContain('<w:color w:val="172094"/><w:sz w:val="28"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:spacing w:before="160"/>');
    expect(xml).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(xml).toContain('<w:br/><w:t xml:space="preserve">second line</w:t>');
    // 和正文一样大的不单独写字号；不画下划线和删除线。
    expect(xml).toMatch(
      /<w:rPr><w:rFonts [^>]*\/><\/w:rPr><w:t xml:space="preserve">body size<\/w:t>/,
    );
    expect(xml).not.toMatch(/<w:u |<w:strike/);
  });

  it('writes lists with their own numbering, starting at the first item’s number', () => {
    const doc: DocDoc = {
      version: 1,
      pages: [
        page([
          { kind: 'list', ordered: true, format: '%1)', start: 3, items: ['three', 'four'], box },
          { kind: 'list', ordered: false, items: ['dot'], box },
        ]),
      ],
    };
    const zip = unzip(writeDocx(doc));
    const xml = zip.text('word/document.xml');
    expect(xml.match(/<w:numId w:val="1"\/>/g)).toHaveLength(2);
    expect(xml.match(/<w:numId w:val="2"\/>/g)).toHaveLength(1);
    const numbering = zip.text('word/numbering.xml');
    expect(numbering).toContain(
      '<w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/>',
    );
    expect(numbering).toContain('<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>');
    expect(numbering).toContain('<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>');
  });

  it('writes tables with column widths, horizontal and vertical merges', () => {
    const doc: DocDoc = {
      version: 1,
      pages: [
        page([
          {
            kind: 'table',
            colWidths: [100, 200, 200],
            box,
            table: {
              kind: 'table',
              rows: 2,
              col: 0,
              cols: 3,
              box,
              cells: [
                { row: 0, col: 0, rowSpan: 2, colSpan: 1, text: 'tall' },
                { row: 0, col: 1, rowSpan: 1, colSpan: 2, text: 'wide' },
                { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '12', align: 'right' },
                { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: '' },
              ],
            },
          },
        ]),
      ],
    };
    const xml = unzip(writeDocx(doc)).text('word/document.xml');
    // 原图宽 1000 像素按 A4 宽 11906 twip 换算。
    expect(xml).toContain('<w:gridCol w:w="1191"/><w:gridCol w:w="2381"/><w:gridCol w:w="2381"/>');
    const rows = xml.match(/<w:tr>.*?<\/w:tr>/g)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<w:vMerge w:val="restart"/>');
    expect(rows[0]).toContain('<w:gridSpan w:val="2"/>');
    expect(rows[1]!.match(/<w:tc>/g)).toHaveLength(3);
    expect(rows[1]).toContain('<w:vMerge/>');
    expect(rows[1]).toContain('<w:jc w:val="right"/>');
  });

  it('embeds cropped images and skips image blocks without one; each page starts on a new page', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const doc: DocDoc = {
      version: 1,
      pages: [
        page([{ kind: 'image', box: { x: 0, y: 0, width: 500, height: 250 }, src: 'crop1' }]),
        page([
          { kind: 'paragraph', text: 'page two', box },
          { kind: 'image', box },
        ]),
      ],
    };
    const zip = unzip(
      writeDocx(doc, new Map([['crop1', { bytes: jpg, width: 400, height: 200 }]])),
    );
    expect(zip.names).toContain('word/media/image1.jpg');
    expect(Array.from(zip.bytes('word/media/image1.jpg'))).toEqual(Array.from(jpg));
    expect(zip.text('word/_rels/document.xml.rels')).toContain(
      'Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpg"',
    );
    const xml = zip.text('word/document.xml');
    // 半页宽（5953 twip）→ EMU；高按图片的宽高比。
    expect(xml).toContain('<wp:extent cx="3780155" cy="1890078"/>');
    expect(xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(xml).toMatch(
      /<w:pageBreakBefore\/><\/w:pPr><w:r><w:rPr>.*?<\/w:rPr><w:t xml:space="preserve">page two/,
    );
  });

  it('uses sans-serif fonts by default and bold headings (D-312)', () => {
    const zip = unzip(writeDocx({ version: 1, pages: [page([])] }));
    const styles = zip.text('word/styles.xml');
    expect(styles).toContain(
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>',
    );
    expect(styles).toMatch(/w:styleId="Heading1">.*<w:rPr><w:b\/><w:bCs\/>/);
    // 字体表写明是无衬线（没有这个字体的电脑换成别的无衬线字体）。
    const fonts = zip.text('word/fontTable.xml');
    expect(fonts).toContain('<w:font w:name="Microsoft YaHei"><w:altName w:val="PingFang SC"/>');
    expect(fonts).toContain('<w:family w:val="swiss"/>');
    // 每个 run 也写字体（苹果的预览不读默认样式里的字体）。
    const xml = unzip(
      writeDocx({ version: 1, pages: [page([{ kind: 'paragraph', text: 'x', box }])] }),
    ).text('word/document.xml');
    expect(xml).toContain('<w:r><w:rPr><w:rFonts w:ascii="Arial"');
    expect(zip.text('word/_rels/document.xml.rels')).toContain('Target="fontTable.xml"');
    expect(zip.text('[Content_Types].xml')).toContain('PartName="/word/fontTable.xml"');
  });

  it('writes the first-line indent in twips (D-312)', () => {
    const xml = unzip(
      writeDocx({ version: 1, pages: [page([{ kind: 'paragraph', text: 'p', indent: 50, box }])] }),
    ).text('word/document.xml');
    // 原图宽 1000 像素 = A4 宽 11906 twip。
    expect(xml).toContain('<w:ind w:firstLine="595"/>');
  });

  it('writes a row of side-by-side blocks as a borderless layout table with nested content (D-313)', () => {
    const table = {
      kind: 'table' as const,
      colWidths: [200, 200],
      box,
      table: {
        kind: 'table' as const,
        rows: 1,
        col: 0,
        cols: 2,
        box,
        cells: [
          { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'x' },
          { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: 'y' },
        ],
      },
    };
    const doc: DocDoc = {
      version: 1,
      pages: [
        page([
          {
            kind: 'row',
            box,
            cells: [
              { width: 400, blocks: [{ kind: 'paragraph', text: 'left', box }] },
              { width: 350, blocks: [table] },
            ],
          },
        ]),
      ],
    };
    const xml = unzip(writeDocx(doc)).text('word/document.xml');
    const tables = xml.match(/<w:tbl>/g)!;
    expect(tables).toHaveLength(2);
    // 外面那张：没有边框，两列按原图宽度换算（1000 像素 = 11906 twip）。
    expect(xml).toMatch(
      /<w:body><w:tbl><w:tblPr><w:tblW [^>]*><w:tblLayout [^>]*><w:tblBorders><w:top w:val="nil"\/>/,
    );
    expect(xml).toContain('<w:gridCol w:w="4762"/><w:gridCol w:w="4167"/>');
    // 里面的表照常有边框，按它那一格的宽（减去左右边距）缩小：2381 → 2004。
    expect(xml).toContain('<w:gridCol w:w="2004"/><w:gridCol w:w="2004"/>');
    expect(xml).toContain('<w:top w:val="single"');
    // 每一格以段落结尾（Word 要求）。
    for (const cell of xml.match(/<w:tc>(?:(?!<w:tc>)[^])*?<\/w:tc>/g)!)
      expect(cell).toMatch(/(<w:p\/>|<\/w:p>)<\/w:tc>$/);
    expect(xml).toContain('>left</w:t>');
  });

  it('writes form label and value pairs as a borderless two-column table, one pair per row (D-314)', () => {
    const xml = unzip(
      writeDocx({
        version: 1,
        pages: [
          page([{ kind: 'paragraph', text: 'A\t1\nBB\t2', tab: 300, box: { ...box, width: 500 } }]),
        ],
      }),
    ).text('word/document.xml');
    // 标签一列到值的左边（300 像素），值一列占到内容区的右边（9638 - 3572）。
    expect(xml).toContain('<w:gridCol w:w="3572"/><w:gridCol w:w="6066"/>');
    expect(xml).toContain('<w:tblBorders><w:top w:val="nil"/>');
    const rows = xml.match(/<w:tr>.*?<\/w:tr>/g)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/>A<\/w:t>.*<\/w:tc><w:tc>.*>1<\/w:t>/);
    expect(rows[1]).toMatch(/>BB<\/w:t>.*<\/w:tc><w:tc>.*>2<\/w:t>/);
  });
});
