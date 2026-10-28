import { type PDFDocument, PDFHexString, type PDFRef, PDFString } from 'pdf-lib';

// 看不见的文字层要用的「无字形字体」（D-266）：中文、日文、韩文等 Helvetica 写不出的字用它写。
// 文字本来就不画出来（渲染模式 3），所以字体里只要一个空字形；每个字按 UTF-16 编码（Identity-H），
// 宽度一律 1 em（之后用 Tz 横向缩放到识别框的宽度），ToUnicode 把编码原样映射回 Unicode，搜索和复制靠它。
// 做法和 Tesseract 生成可搜索 PDF 的思路相同；字体文件按 TrueType 规范在这里自己生成，不依赖外部文件。

const FONT_NAME = 'GlyphLessFont';
const UNITS_PER_EM = 1000;

/** 大端写入工具。 */
class Writer {
  private bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number) {
    return this.u16(v >>> 16).u16(v & 0xffff);
  }
  tag(t: string) {
    for (const c of t) this.u8(c.charCodeAt(0));
    return this;
  }
  done() {
    return Uint8Array.from(this.bytes);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) |
      ((data[i + 1] ?? 0) << 16) |
      ((data[i + 2] ?? 0) << 8) |
      (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/** 只有两个空字形（.notdef 和一个空白字形）的 TrueType 字体。 */
export function glyphlessTrueType(): Uint8Array {
  const numGlyphs = 2;
  const head = new Writer()
    .u32(0x00010000) // version
    .u32(0x00010000) // fontRevision
    .u32(0) // checkSumAdjustment（最后填）
    .u32(0x5f0f3cf5) // magicNumber
    .u16(0x000b) // flags
    .u16(UNITS_PER_EM)
    .u32(0)
    .u32(0) // created
    .u32(0)
    .u32(0) // modified
    .u16(0)
    .u16(0)
    .u16(UNITS_PER_EM)
    .u16(UNITS_PER_EM) // xMin yMin xMax yMax
    .u16(0) // macStyle
    .u16(3) // lowestRecPPEM
    .u16(2) // fontDirectionHint
    .u16(0) // indexToLocFormat：短格式
    .u16(0) // glyphDataFormat
    .done();
  const hhea = new Writer()
    .u32(0x00010000)
    .u16(UNITS_PER_EM) // ascender
    .u16(0) // descender
    .u16(0) // lineGap
    .u16(UNITS_PER_EM) // advanceWidthMax
    .u16(0)
    .u16(0)
    .u16(0) // minLeftSideBearing minRightSideBearing xMaxExtent
    .u16(1)
    .u16(0)
    .u16(0) // caretSlopeRise caretSlopeRun caretOffset
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0) // reserved
    .u16(0) // metricDataFormat
    .u16(numGlyphs) // numberOfHMetrics
    .done();
  const maxp = new Writer().u32(0x00010000).u16(numGlyphs);
  maxp.u16(0).u16(0).u16(0).u16(0); // points contours compositePoints compositeContours
  maxp.u16(2); // maxZones
  for (let i = 0; i < 8; i++) maxp.u16(0);
  const hmtx = new Writer();
  for (let g = 0; g < numGlyphs; g++) hmtx.u16(UNITS_PER_EM).u16(0);
  // 两个字形都没有轮廓：loca 全是 0，glyf 是空的。
  const loca = new Writer();
  for (let g = 0; g <= numGlyphs; g++) loca.u16(0);
  const glyf = new Uint8Array(0);
  // cmap：只有一个结束段（格式 4 必须有）。
  const cmap = new Writer()
    .u16(0)
    .u16(1)
    .u16(3)
    .u16(1)
    .u32(12) // 一张子表：Windows Unicode BMP
    .u16(4)
    .u16(24)
    .u16(0) // format length language
    .u16(2)
    .u16(2)
    .u16(0)
    .u16(0) // segCountX2 searchRange entrySelector rangeShift
    .u16(0xffff) // endCode
    .u16(0) // reservedPad
    .u16(0xffff) // startCode
    .u16(1) // idDelta
    .u16(0) // idRangeOffset
    .done();
  const nameText = [...FONT_NAME].flatMap((c) => [0, c.charCodeAt(0)]);
  const nameIds = [1, 4, 6];
  const name = new Writer()
    .u16(0)
    .u16(nameIds.length)
    .u16(6 + 12 * nameIds.length);
  for (const id of nameIds) name.u16(3).u16(1).u16(0x409).u16(id).u16(nameText.length).u16(0);
  for (const b of nameText) name.u8(b);
  const post = new Writer().u32(0x00030000);
  for (let i = 0; i < 7; i++) post.u32(0);

  const tables: [string, Uint8Array][] = [
    ['cmap', cmap],
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp.done()],
    ['name', name.done()],
    ['post', post.done()],
  ];
  const n = tables.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const out = new Writer().u32(0x00010000).u16(n).u16(searchRange).u16(entrySelector);
  out.u16(n * 16 - searchRange);
  let offset = 12 + 16 * n;
  const padded = (t: Uint8Array) => (t.length + 3) & ~3;
  for (const [tag, data] of tables) {
    out.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += padded(data);
  }
  const font = new Uint8Array(offset);
  font.set(out.done(), 0);
  offset = 12 + 16 * n;
  let headOffset = 0;
  for (const [tag, data] of tables) {
    font.set(data, offset);
    if (tag === 'head') headOffset = offset;
    offset += padded(data);
  }
  const adjust = (0xb1b0afba - checksum(font)) >>> 0;
  font[headOffset + 8] = adjust >>> 24;
  font[headOffset + 9] = (adjust >>> 16) & 0xff;
  font[headOffset + 10] = (adjust >>> 8) & 0xff;
  font[headOffset + 11] = adjust & 0xff;
  return font;
}

/** ToUnicode：每个两字节编码映射成同一个 UTF-16 码元（按规范每段只变最后一个字节）。 */
function toUnicodeCMap(): string {
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
  for (let block = 0; block < 256; block += 100) {
    const count = Math.min(100, 256 - block);
    lines.push(`${count} beginbfrange`);
    for (let hi = block; hi < block + count; hi++) {
      lines.push(`<${hex(hi)}00> <${hex(hi)}FF> <${hex(hi)}00>`);
    }
    lines.push('endbfrange');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return lines.join('\n');
}

/** 在文档里放一份无字形字体，返回它的引用（每个文档只放一次）。 */
export function embedGlyphlessFont(doc: PDFDocument): PDFRef {
  const { context } = doc;
  const ttf = glyphlessTrueType();
  const fontFile = context.register(context.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: FONT_NAME,
      Flags: 5,
      FontBBox: [0, 0, UNITS_PER_EM, UNITS_PER_EM],
      ItalicAngle: 0,
      Ascent: UNITS_PER_EM,
      Descent: 0,
      CapHeight: UNITS_PER_EM,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  // 所有编码都用 1 号空字形（2 字节一项，共 65536 项）。
  const gids = new Uint8Array(65536 * 2);
  for (let i = 1; i < gids.length; i += 2) gids[i] = 1;
  const cidToGid = context.register(context.flateStream(gids));
  const cidFont = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: FONT_NAME,
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0,
      },
      FontDescriptor: descriptor,
      DW: UNITS_PER_EM,
      CIDToGIDMap: cidToGid,
    }),
  );
  const toUnicode = context.register(context.flateStream(toUnicodeCMap()));
  return context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: FONT_NAME,
      Encoding: 'Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    }),
  );
}

/** 一行字编码成 UTF-16BE 十六进制（每个码元一个编码）；宽度是码元数 × 1 em。 */
export function glyphlessText(text: string): { hex: PDFHexString; ems: number } {
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return { hex: PDFHexString.of(hex), ems: text.length };
}
