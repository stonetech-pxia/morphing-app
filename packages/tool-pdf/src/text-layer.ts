import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  type PDFName,
  PDFNumber,
  type PDFPage,
  type PDFRef,
  PDFString,
  TextRenderingMode,
  beginText,
  endText,
  moveText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextRenderingMode,
  showText,
} from 'pdf-lib';

// 看不见的文字层用的字体（D-267）：文字层不画出来（渲染模式 3），所以字体不需要字形，
// 只要让阅读器知道每个字是什么（ToUnicode）、占多宽（W）。这里自己生成一个只有两个空字形的
// TrueType（不到 1 KB，所有字都映射到同一个空字形，和 Tesseract 的 GlyphLessFont 一个思路），
// 任何文字（中日韩、西里尔、阿拉伯……）都写得进去，不用打包字体文件，也没有字体许可证的问题。
// 字的编号（CID）按这个 PDF 里第一次出现的顺序给，所以 BMP 以外的字（生僻字、emoji）也能写。

const ASCENT = 800;
const DESCENT = -200;
/**
 * 全角字（中日韩、全角符号）占 1000，空格 250（和常见字体差不多；太宽的话 pdf.js 会把一行拆成几段），
 * 其余 500。整行再用 Tz 缩放到识别框的宽度。
 */
const WIDE = 1000;
const NARROW = 500;
const SPACE = 250;

function widthOf(char: string): number {
  const cp = char.codePointAt(0)!;
  return cp === 0x20 ? SPACE : isWide(cp) ? WIDE : NARROW;
}

/** 东亚宽字：中日韩统一表意文字、假名、谚文、全角形式等。 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

// --- 从右到左的行 ---

/** 双向算法里的字符类型（只用到没有显式嵌入的单个段落）。 */
type Bidi = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'NSM' | 'ON';

const inRanges = (cp: number, ranges: readonly (readonly [number, number])[]) =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

const NSM: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
];
const HEBREW: readonly [number, number][] = [
  [0x0590, 0x05ff],
  [0x07c0, 0x085f],
  [0xfb1d, 0xfb4f],
  [0x10800, 0x10fff],
  [0x1e800, 0x1e8ff],
];
const ARABIC: readonly [number, number][] = [
  [0x0600, 0x07bf],
  [0x0860, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
  [0x1ec70, 0x1efff],
];
/** 不算方向的符号：通用标点、货币、箭头、数学符号、中日韩标点、全角标点等。 */
const NEUTRAL: readonly [number, number][] = [
  [0x2000, 0x2bff],
  [0x3000, 0x303f],
  [0xfe10, 0xfe6f],
  [0xff00, 0xff0f],
  [0xff1a, 0xff20],
];

function bidiType(cp: number): Bidi {
  if (cp >= 0x30 && cp <= 0x39) return 'EN';
  if ((cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9)) return 'AN';
  if (cp === 0x2b || cp === 0x2d || cp === 0x2212) return 'ES';
  if (cp === 0x2c || cp === 0x2e || cp === 0x2f || cp === 0x3a || cp === 0xa0) return 'CS';
  if (cp === 0x23 || cp === 0x24 || cp === 0x25 || (cp >= 0xa2 && cp <= 0xa5)) return 'ET';
  if (cp === 0xb0 || cp === 0x066a || (cp >= 0x20a0 && cp <= 0x20cf)) return 'ET';
  if (inRanges(cp, NSM)) return 'NSM';
  if (inRanges(cp, HEBREW)) return 'R';
  if (inRanges(cp, ARABIC)) return 'AL';
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'L';
  if (cp < 0xc0 || cp === 0xd7 || cp === 0xf7 || inRanges(cp, NEUTRAL)) return 'ON';
  return 'L';
}

/**
 * 识别结果是逻辑顺序（读的顺序），PDF 里的字是从左往右摆的（显示顺序）。有从右到左的字的行
 * 按 Unicode 双向算法（UAX #9，单个段落、没有显式嵌入：P2–P3、W1–W7、N1–N2、I1–I2、L2）
 * 换成显示顺序，取文字的程序（pdf.js、pdftotext、PDFKit）再按同一个算法还原成原来的读法。
 * 没有从右到左的字时原样返回。
 */
export function visualOrder(chars: readonly string[]): string[] {
  const types = chars.map((c) => bidiType(c.codePointAt(0)!));
  if (!types.some((t) => t === 'R' || t === 'AL')) return [...chars];
  const first = types.find((t) => t === 'L' || t === 'R' || t === 'AL');
  const base = first === 'L' ? 0 : 1;
  const sos: Bidi = base ? 'R' : 'L';
  const n = types.length;
  // W1：组合符号跟前一个字。W2：阿拉伯字母后面的数字是 AN。W3：AL 当作 R。
  let strong: Bidi = sos;
  for (let i = 0; i < n; i++) {
    if (types[i] === 'NSM') types[i] = i > 0 ? types[i - 1]! : sos;
    const t = types[i]!;
    if (t === 'L' || t === 'R' || t === 'AL') strong = t;
    else if (t === 'EN' && strong === 'AL') types[i] = 'AN';
  }
  for (let i = 0; i < n; i++) if (types[i] === 'AL') types[i] = 'R';
  // W4：两个同类数字中间夹一个分隔符时，分隔符也算数字。
  for (let i = 1; i + 1 < n; i++) {
    const [prev, t, next] = [types[i - 1], types[i], types[i + 1]];
    if (prev === 'EN' && next === 'EN' && (t === 'ES' || t === 'CS')) types[i] = 'EN';
    else if (prev === 'AN' && next === 'AN' && t === 'CS') types[i] = 'AN';
  }
  // W5：挨着 EN 的一串 ET 也是 EN。W6：剩下的分隔符和 ET 是中性。
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'ET') continue;
    let j = i;
    while (j < n && types[j] === 'ET') j++;
    const t = types[i - 1] === 'EN' || types[j] === 'EN' ? 'EN' : 'ON';
    for (let k = i; k < j; k++) types[k] = t;
    i = j - 1;
  }
  for (let i = 0; i < n; i++) if (types[i] === 'ES' || types[i] === 'CS') types[i] = 'ON';
  // W7：前面最近的强字是 L 时，EN 当作 L。
  strong = sos;
  for (let i = 0; i < n; i++) {
    const t = types[i]!;
    if (t === 'L' || t === 'R') strong = t;
    else if (t === 'EN' && strong === 'L') types[i] = 'L';
  }
  // N1–N2：一串中性字两边的方向相同（数字算 R）时跟着两边，否则跟段落方向。
  const side = (t: Bidi | undefined, edge: Bidi): Bidi =>
    t === undefined ? edge : t === 'L' ? 'L' : 'R';
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'ON') continue;
    let j = i;
    while (j < n && types[j] === 'ON') j++;
    const before = side(types[i - 1], sos);
    const after = side(types[j], sos);
    const t: Bidi = before === after ? before : sos;
    for (let k = i; k < j; k++) types[k] = t;
    i = j - 1;
  }
  // I1–I2：层级。L2：从最高层到最低的奇数层，每层把连续的一段倒过来。
  const levels = types.map((t) =>
    base === 0 ? (t === 'R' ? 1 : t === 'AN' || t === 'EN' ? 2 : 0) : t === 'R' ? 1 : 2,
  );
  const out = [...chars];
  const max = Math.max(...levels);
  for (let level = max; level >= 1; level--) {
    for (let i = 0; i < n; i++) {
      if (levels[i]! < level) continue;
      let j = i;
      while (j < n && levels[j]! >= level) j++;
      out.splice(i, j - i, ...out.slice(i, j).reverse());
      levels.splice(i, j - i, ...levels.slice(i, j).reverse());
      i = j - 1;
    }
  }
  return out;
}

// --- 只有空字形的 TrueType ---

function table(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

function nameTable(): Uint8Array {
  const names: [number, string][] = [
    [1, 'MorphGlyphless'],
    [2, 'Regular'],
    [4, 'MorphGlyphless'],
    [6, 'MorphGlyphless'],
  ];
  const strings = names.map(([, s]) => {
    const b = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) b[i * 2 + 1] = s.charCodeAt(i);
    return b;
  });
  const header = 6 + names.length * 12;
  const total = header + strings.reduce((n, s) => n + s.length, 0);
  const { bytes, view } = table(total);
  view.setUint16(2, names.length);
  view.setUint16(4, header);
  let offset = 0;
  names.forEach(([id], i) => {
    const r = 6 + i * 12;
    view.setUint16(r, 3); // Windows
    view.setUint16(r + 2, 1); // Unicode BMP
    view.setUint16(r + 4, 0x409);
    view.setUint16(r + 6, id);
    view.setUint16(r + 8, strings[i]!.length);
    view.setUint16(r + 10, offset);
    bytes.set(strings[i]!, header + offset);
    offset += strings[i]!.length;
  });
  return bytes;
}

/** 两个字形（.notdef 和一个空字形），都没有轮廓，宽 500。 */
function glyphlessFont(): Uint8Array {
  const head = table(54);
  head.view.setUint32(0, 0x00010000);
  head.view.setUint32(4, 0x00010000);
  head.view.setUint32(12, 0x5f0f3cf5);
  head.view.setUint16(16, 0x000b);
  head.view.setUint16(18, 1000);
  // 创建和修改时间：2026-01-01（从 1904 年起的秒数）。
  head.view.setUint32(24, 3850070400);
  head.view.setUint32(32, 3850070400);
  head.view.setInt16(38, DESCENT);
  head.view.setInt16(40, NARROW);
  head.view.setInt16(42, ASCENT);
  head.view.setUint16(46, 3);
  head.view.setInt16(48, 2);

  const hhea = table(36);
  hhea.view.setUint32(0, 0x00010000);
  hhea.view.setInt16(4, ASCENT);
  hhea.view.setInt16(6, DESCENT);
  hhea.view.setUint16(10, NARROW);
  hhea.view.setInt16(18, 1);
  hhea.view.setUint16(34, 2);

  const maxp = table(32);
  maxp.view.setUint32(0, 0x00010000);
  maxp.view.setUint16(4, 2);
  maxp.view.setUint16(14, 2);

  const os2 = table(96);
  os2.view.setUint16(0, 4);
  os2.view.setInt16(2, NARROW);
  os2.view.setUint16(4, 400);
  os2.view.setUint16(6, 5);
  os2.bytes.set([0x4d, 0x52, 0x50, 0x48], 58); // achVendID 'MRPH'
  os2.view.setUint16(62, 0x40);
  os2.view.setUint16(64, 0x20);
  os2.view.setUint16(66, 0xffff);
  os2.view.setInt16(68, ASCENT);
  os2.view.setInt16(70, DESCENT);
  os2.view.setUint16(74, ASCENT);
  os2.view.setUint16(76, -DESCENT);
  os2.view.setUint32(78, 1);
  os2.view.setUint16(92, 0x20);
  os2.view.setUint16(94, 1);

  const hmtx = table(8);
  hmtx.view.setUint16(0, NARROW);
  hmtx.view.setUint16(4, NARROW);

  // cmap 只有格式 4 的结尾段：字都经 CIDToGIDMap 找字形，不经 cmap。
  const cmap = table(36);
  cmap.view.setUint16(2, 1);
  cmap.view.setUint16(4, 3);
  cmap.view.setUint16(6, 1);
  cmap.view.setUint32(8, 12);
  cmap.view.setUint16(12, 4);
  cmap.view.setUint16(14, 24);
  cmap.view.setUint16(18, 2);
  cmap.view.setUint16(20, 2);
  cmap.view.setUint16(26, 0xffff);
  cmap.view.setUint16(30, 0xffff);
  cmap.view.setUint16(32, 1);

  const post = table(32);
  post.view.setUint32(0, 0x00030000);
  post.view.setInt16(8, -100);
  post.view.setInt16(10, 50);

  // 两个字形都是空的：.notdef 是没有轮廓的 12 个字节（pdf.js 不认长度为 0 的 glyf 表），1 号长度为 0。
  const glyf = table(12);
  const loca = table(6);
  loca.view.setUint16(2, 6);
  loca.view.setUint16(4, 6);

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2.bytes],
    ['cmap', cmap.bytes],
    ['glyf', glyf.bytes],
    ['head', head.bytes],
    ['hhea', hhea.bytes],
    ['hmtx', hmtx.bytes],
    ['loca', loca.bytes],
    ['maxp', maxp.bytes],
    ['name', nameTable()],
    ['post', post.bytes],
  ];
  const headerSize = 12 + tables.length * 16;
  const total = tables.reduce((n, [, b]) => n + ((b.length + 3) & ~3), headerSize);
  const { bytes, view } = table(total);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  const pow = 2 ** Math.floor(Math.log2(tables.length));
  view.setUint16(6, pow * 16);
  view.setUint16(8, Math.log2(pow));
  view.setUint16(10, tables.length * 16 - pow * 16);
  let offset = headerSize;
  let headOffset = 0;
  tables.forEach(([tag, b], i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) bytes[r + k] = tag.charCodeAt(k);
    view.setUint32(r + 4, checksum(b));
    view.setUint32(r + 8, offset);
    view.setUint32(r + 12, b.length);
    bytes.set(b, offset);
    if (tag === 'head') headOffset = offset;
    offset += (b.length + 3) & ~3;
  });
  view.setUint32(headOffset + 8, (0xb1b0afba - checksum(bytes)) >>> 0);
  return bytes;
}

// --- 文字层 ---

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

function utf16Hex(char: string): string {
  let out = '';
  for (let i = 0; i < char.length; i++) out += hex4(char.charCodeAt(i));
  return out;
}

/** 图片在页面上的位置（PDF 坐标，原点在左下角）。 */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一行字：像素坐标，原点在左上角。 */
export interface LayerLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 一个 PDF 共用一套字体：先画各页，最后 finish() 才写出字体对象（宽度表和 ToUnicode 要等所有字都用过才知道）。
 */
export class InvisibleText {
  private readonly ref: PDFRef;
  private readonly cids = new Map<string, number>();
  private readonly chars: string[] = [''];

  constructor(private readonly doc: PDFDocument) {
    this.ref = doc.context.nextRef();
  }

  private cid(char: string): number | null {
    let id = this.cids.get(char);
    if (id === undefined) {
      if (this.chars.length > 0xffff) return null;
      id = this.chars.length;
      this.cids.set(char, id);
      this.chars.push(char);
    }
    return id;
  }

  /**
   * 每行用渲染模式「不可见」画在识别框的位置，横向缩放到框的宽度；基线比框的底边高 0.2 个字高
   * （字体的下沿就是 -0.2），所以选中时高亮的范围和识别框重合。
   */
  drawLines(
    page: PDFPage,
    placement: Placement,
    size: { width: number; height: number },
    lines: readonly LayerLine[],
  ): void {
    if (!(size.width > 0 && size.height > 0)) return;
    const sx = placement.width / size.width;
    const sy = placement.height / size.height;
    // 这一页真的画了字才把字体放进页面资源（否则 finish() 可能不写字体，留下指向空对象的引用）。
    let key: PDFName | undefined;
    for (const line of lines) {
      const text = line.text.trim();
      const fontSize = line.height * sy;
      if (!text || !(fontSize > 0) || !(line.width > 0)) continue;
      const chars = visualOrder([...text]);
      const ids = chars.map((c) => this.cid(c));
      if (ids.some((id) => id === null)) continue;
      const natural = (chars.reduce((n, c) => n + widthOf(c), 0) / 1000) * fontSize;
      const x = placement.x + line.x * sx;
      const y =
        placement.y + placement.height - (line.y + line.height) * sy - (DESCENT / 1000) * fontSize;
      key ??= page.node.newFontDictionary('MorphText', this.ref);
      page.pushOperators(
        beginText(),
        setFontAndSize(key, fontSize),
        setTextRenderingMode(TextRenderingMode.Invisible),
        setCharacterSqueeze(((line.width * sx) / natural) * 100),
        moveText(x, y),
        showText(PDFHexString.of(ids.map((id) => hex4(id!)).join(''))),
        endText(),
      );
    }
  }

  /** 写出字体：Type0（Identity-H）→ CIDFontType2 → 空字形的 TrueType。没用到字时什么都不写。 */
  finish(): void {
    const n = this.chars.length;
    if (n === 1) return;
    const { context } = this.doc;
    const font = glyphlessFont();
    const fontFile = context.register(context.flateStream(font, { Length1: font.length }));
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: 'MorphGlyphless',
        Flags: 4,
        FontBBox: [0, DESCENT, WIDE, ASCENT],
        ItalicAngle: 0,
        Ascent: ASCENT,
        Descent: DESCENT,
        CapHeight: ASCENT,
        StemV: 80,
        FontFile2: fontFile,
      }),
    );
    // 所有字都用 1 号空字形（0 号是 .notdef）。
    const gids = new Uint8Array(n * 2);
    for (let i = 1; i < n; i++) gids[i * 2 + 1] = 1;
    const cidToGid = context.register(context.flateStream(gids));
    // 宽度：只列不是半角的字（DW 是半角）。
    const widths = PDFArray.withContext(context);
    for (let i = 1; i < n; i++) {
      const width = widthOf(this.chars[i]!);
      if (width === NARROW) continue;
      widths.push(PDFNumber.of(i));
      widths.push(context.obj([width]));
    }
    const cidFont = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: 'MorphGlyphless',
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: NARROW,
        W: widths,
        CIDToGIDMap: cidToGid,
      }),
    );
    context.assign(
      this.ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: 'MorphGlyphless',
        Encoding: 'Identity-H',
        DescendantFonts: [cidFont],
        ToUnicode: context.register(context.flateStream(toUnicode(this.chars))),
      }),
    );
  }
}

/** ToUnicode CMap：每个 CID 对应原来的字（UTF-16BE，BMP 以外的字是代理对）；每段最多 100 个。 */
function toUnicode(chars: readonly string[]): string {
  const entries: string[] = [];
  for (let i = 1; i < chars.length; i++) entries.push(`<${hex4(i)}> <${utf16Hex(chars[i]!)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}
