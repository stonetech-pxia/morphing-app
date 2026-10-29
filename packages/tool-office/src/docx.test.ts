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
    expect(xml).toContain('<w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">Titre</w:t>');
    expect(xml).toContain('<w:color w:val="172094"/><w:sz w:val="28"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:spacing w:before="160"/>');
    expect(xml).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(xml).toContain('<w:br/><w:t xml:space="preserve">second line</w:t>');
    // 和正文一样大的不单独写字号；不画下划线和删除线。
    expect(xml).toContain('<w:r><w:t xml:space="preserve">body size</w:t></w:r>');
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
    expect(xml).toContain('<w:pageBreakBefore/></w:pPr><w:r><w:t xml:space="preserve">page two');
  });
});
