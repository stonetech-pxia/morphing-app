import {
  A4_WIDTH_PT,
  type DocBlock,
  type DocDoc,
  type DocList,
  type DocParagraph,
  type DocRun,
} from './doc';
import { OfficeImportFailure, openPackage, relKind, type OoxmlPackage } from './ooxml';
import type { Box, CellAlign, TableCell } from './types';
import { child, children, descendants, ownText, type XmlElement } from './xml';

// 外来的 docx（别的 App、电脑上的 Word 做的）→ DocDoc（D-509）：放上桌用同一个 Word 编辑器改，存的时候
// 照旧由 writeDocx 重新生成。按创始人「好用的顺序、表格和段落，不追求一模一样」（D-501 前后）：
// 读段落的文字、粗体 / 斜体 / 下划线 / 字号（整段一种颜色时也读颜色）、对齐、标题（1、2 级）、列表（每一级各成一个
// 列表，接着原来的编号）、表格（合并格子、列宽）、内嵌的图片（PNG / JPG / GIF / BMP）、分页符；
// 文本框里的字接在它所在的段落后面，脚注、尾注的字放到文末（正文里留 [1] 这样的记号），修订按「接受全部」显示
// （删掉的字不显示），域显示结果。不读的：页眉页脚、批注、字体、行距和缩进、高亮、删除线 / 上下标（字留着）、
// 页面大小和页边距（存的时候是 A4）、形状、图表、SmartArt、矢量图（EMF / WMF）、外部链接的图片（不联网）。
// 没有版面：box 只是占位（同文字转 Word，D-441），段落之间原来空着（空段落、段前段后距）的写 spaced。
// 纯 TS，在本机解析，不联网（不变量 1）；结果只在本机，不发给 AI（不变量 2）。

/** 读出来的图片：src 是它在包里的路径（DocImage.src 先写这个，放上桌时换成桌面里的文件）。 */
export interface ImportedImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg' | 'gif' | 'bmp';
}

export interface DocxImport {
  doc: DocDoc;
  images: Map<string, ImportedImage>;
}

/** 一份文档最多这么多块：再多编辑页（一个网页）就太慢了，当作太大。 */
export const MAX_IMPORT_BLOCKS = 5000;

/** 没有版面的占位框（同文字转 Word）。 */
const BOX: Box = { x: 0, y: 0, width: 1, height: 1 };
/** A4 的高（磅）：页面的坐标就是磅（宽是 A4_WIDTH_PT），图片、列宽按磅写。 */
const A4_HEIGHT_PT = 842;
/** writeDocx 的内容区宽（磅，A4 减去两边 2 厘米）：居中的图片按它摆。 */
const CONTENT_PT = (11906 - 2 * 1134) / 20;
/** 段前距加上一段的段后距至少这么多（twip，6 磅）算原来空着。 */
const SPACED_TWIP = 120;
/** 自动段距（网页来的文档）大约这么多 twip。 */
const AUTO_SPACING = 280;
/** Word 里没写字号时是 10 磅。 */
const DEFAULT_SIZE = 10;
const EMU_PER_PT = 12700;

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: number;
  color?: string;
  hidden?: boolean;
}

interface ParaProps {
  jc?: string;
  outline?: number;
  numId?: string;
  ilvl?: number;
  before?: number;
  after?: number;
  contextual?: boolean;
  pageBreakBefore?: boolean;
}

interface StyleDef {
  type: string;
  name: string;
  basedOn?: string;
  run: RunStyle;
  para: ParaProps;
  tblBorders?: XmlElement;
  isDefault: boolean;
}

/** 开关属性的值：1 / true / on 是开。 */
const flag = (v: string | undefined) =>
  v !== undefined && !['0', 'false', 'off', 'none'].includes(v.toLowerCase());

/** w:b 这种开关元素：没写 val 是开。 */
function onOff(el: XmlElement | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.attrs['w:val'];
  return v === undefined || flag(v);
}

const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function readRun(rPr: XmlElement | undefined): RunStyle {
  const out: RunStyle = {};
  if (!rPr) return out;
  const b = onOff(child(rPr, 'w:b'));
  if (b !== undefined) out.bold = b;
  const i = onOff(child(rPr, 'w:i'));
  if (i !== undefined) out.italic = i;
  const u = child(rPr, 'w:u');
  if (u) out.underline = (u.attrs['w:val'] ?? 'single') !== 'none';
  const sz = num(child(rPr, 'w:sz')?.attrs['w:val']);
  if (sz) out.size = sz / 2;
  const color = child(rPr, 'w:color')?.attrs['w:val'];
  if (color) out.color = color;
  const hidden = onOff(child(rPr, 'w:vanish'));
  if (hidden !== undefined) out.hidden = hidden;
  return out;
}

function readPara(pPr: XmlElement | undefined): ParaProps {
  const out: ParaProps = {};
  if (!pPr) return out;
  const jc = child(pPr, 'w:jc')?.attrs['w:val'];
  if (jc) out.jc = jc;
  const outline = num(child(pPr, 'w:outlineLvl')?.attrs['w:val']);
  if (outline !== undefined) out.outline = outline;
  const numPr = child(pPr, 'w:numPr');
  if (numPr) {
    const id = child(numPr, 'w:numId')?.attrs['w:val'];
    if (id !== undefined) out.numId = id;
    const ilvl = num(child(numPr, 'w:ilvl')?.attrs['w:val']);
    if (ilvl !== undefined) out.ilvl = ilvl;
  }
  const spacing = child(pPr, 'w:spacing');
  if (spacing) {
    const before = flag(spacing.attrs['w:beforeAutospacing'])
      ? AUTO_SPACING
      : num(spacing.attrs['w:before']);
    const after = flag(spacing.attrs['w:afterAutospacing'])
      ? AUTO_SPACING
      : num(spacing.attrs['w:after']);
    if (before !== undefined) out.before = before;
    if (after !== undefined) out.after = after;
  }
  const contextual = onOff(child(pPr, 'w:contextualSpacing'));
  if (contextual !== undefined) out.contextual = contextual;
  const pageBreak = onOff(child(pPr, 'w:pageBreakBefore'));
  if (pageBreak !== undefined) out.pageBreakBefore = pageBreak;
  return out;
}

/** 去掉值是 undefined 的项（合并样式时不覆盖上一级）。 */
const defined = <T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

/** 样式表：每个样式顺着 basedOn 合起来的样子（父样式在前、自己的覆盖）。 */
function readStyles(root: XmlElement | undefined) {
  const defs = new Map<string, StyleDef>();
  const defaults = child(root, 'w:docDefaults');
  const baseRun = readRun(child(child(defaults, 'w:rPrDefault'), 'w:rPr'));
  const basePara = readPara(child(child(defaults, 'w:pPrDefault'), 'w:pPr'));
  for (const s of children(root, 'w:style')) {
    const id = s.attrs['w:styleId'];
    if (!id) continue;
    defs.set(id, {
      type: s.attrs['w:type'] ?? 'paragraph',
      name: (child(s, 'w:name')?.attrs['w:val'] ?? id).toLowerCase(),
      ...(child(s, 'w:basedOn')?.attrs['w:val']
        ? { basedOn: child(s, 'w:basedOn')!.attrs['w:val']! }
        : {}),
      run: readRun(child(s, 'w:rPr')),
      para: readPara(child(s, 'w:pPr')),
      ...(child(child(s, 'w:tblPr'), 'w:tblBorders')
        ? { tblBorders: child(child(s, 'w:tblPr'), 'w:tblBorders')! }
        : {}),
      isDefault: flag(s.attrs['w:default']),
    });
  }
  const chain = (id: string | undefined): StyleDef[] => {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    for (let cur = id; cur && defs.has(cur) && !seen.has(cur); cur = defs.get(cur)!.basedOn) {
      seen.add(cur);
      out.unshift(defs.get(cur)!);
    }
    return out;
  };
  const defaultOf = (type: string) =>
    [...defs.entries()].find(([, d]) => d.type === type && d.isDefault)?.[0];
  const defaultPara = defaultOf('paragraph');
  const runCache = new Map<string, RunStyle>();
  const paraCache = new Map<string, ParaProps>();
  return {
    baseRun,
    basePara,
    defaultPara,
    /** 段落样式（没写时用默认段落样式）的字的样子。 */
    paraRun(id: string | undefined): RunStyle {
      const key = id ?? defaultPara ?? '';
      if (!runCache.has(key)) {
        runCache.set(
          key,
          Object.assign({}, baseRun, ...chain(key).map((d) => defined(d.run))) as RunStyle,
        );
      }
      return runCache.get(key)!;
    },
    para(id: string | undefined): ParaProps {
      const key = id ?? defaultPara ?? '';
      if (!paraCache.has(key)) {
        paraCache.set(
          key,
          Object.assign({}, basePara, ...chain(key).map((d) => defined(d.para))) as ParaProps,
        );
      }
      return paraCache.get(key)!;
    },
    charRun(id: string | undefined): RunStyle {
      return Object.assign({}, ...chain(id).map((d) => defined(d.run))) as RunStyle;
    },
    name: (id: string | undefined) => defs.get(id ?? defaultPara ?? '')?.name ?? '',
    tableBorders(id: string | undefined): XmlElement | undefined {
      return chain(id)
        .reverse()
        .find((d) => d.tblBorders)?.tblBorders;
    },
    numPrOfStyle(id: string): ParaProps {
      return Object.assign({}, ...chain(id).map((d) => defined(d.para))) as ParaProps;
    },
  };
}

type Styles = ReturnType<typeof readStyles>;

interface Level {
  fmt: string;
  text: string;
  start: number;
}

/** numbering.xml：编号 → 每一级的编号格式、写法、起始号。 */
function readNumbering(root: XmlElement | undefined, styles: Styles) {
  const abstracts = new Map<string, { levels: Map<number, Level>; link?: string }>();
  const readLevel = (lvl: XmlElement): Level => ({
    fmt: child(lvl, 'w:numFmt')?.attrs['w:val'] ?? 'decimal',
    text: child(lvl, 'w:lvlText')?.attrs['w:val'] ?? '',
    start: num(child(lvl, 'w:start')?.attrs['w:val']) ?? 1,
  });
  for (const a of children(root, 'w:abstractNum')) {
    const id = a.attrs['w:abstractNumId'];
    if (id === undefined) continue;
    const levels = new Map<number, Level>();
    for (const lvl of children(a, 'w:lvl'))
      levels.set(num(lvl.attrs['w:ilvl']) ?? 0, readLevel(lvl));
    const link = child(a, 'w:numStyleLink')?.attrs['w:val'];
    abstracts.set(id, { levels, ...(link ? { link } : {}) });
  }
  const nums = new Map<string, { abstract: string; overrides: Map<number, Partial<Level>> }>();
  for (const n of children(root, 'w:num')) {
    const id = n.attrs['w:numId'];
    const abstract = child(n, 'w:abstractNumId')?.attrs['w:val'];
    if (id === undefined || abstract === undefined) continue;
    const overrides = new Map<number, Partial<Level>>();
    for (const o of children(n, 'w:lvlOverride')) {
      const ilvl = num(o.attrs['w:ilvl']) ?? 0;
      const lvl = child(o, 'w:lvl');
      const start = num(child(o, 'w:startOverride')?.attrs['w:val']);
      overrides.set(ilvl, {
        ...(lvl ? readLevel(lvl) : {}),
        ...(start !== undefined ? { start } : {}),
      });
    }
    nums.set(id, { abstract, overrides });
  }
  const levelOf = (numId: string, ilvl: number, depth = 0): Level | undefined => {
    const n = nums.get(numId);
    if (!n) return undefined;
    let a = abstracts.get(n.abstract);
    // 列表样式（numStyleLink）：定义在那个样式的编号上。
    if (a?.link && a.levels.size === 0 && depth < 3) {
      const linked = styles.numPrOfStyle(a.link).numId;
      if (linked && linked !== numId) return levelOf(linked, ilvl, depth + 1);
      a = undefined;
    }
    const base = a?.levels.get(ilvl);
    const own = n.overrides.get(ilvl);
    if (!base && !own) return undefined;
    return { fmt: 'decimal', text: '', start: 1, ...base, ...own };
  };
  return { levelOf };
}

/** 一截有样式的字（样式是算好的，不是相对整段的）。 */
interface Piece {
  text: string;
  style: RunStyle;
}

type Inline =
  | { kind: 'text'; piece: Piece }
  | { kind: 'image'; src: string; width: number; height: number }
  | { kind: 'pageBreak' }
  | { kind: 'boxes'; content: XmlElement };

/** 图片的格式（按文件开头的几个字节）；网页里显示不了的（EMF、WMF、TIFF、SVG）返回 null。 */
export function imageExt(bytes: Uint8Array): ImportedImage['ext'] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return null;
}

/** VML 的长度（style 里的 width:72pt、1in、96px、2.54cm）→ 磅。 */
function vmlLength(style: string, key: string): number | undefined {
  const m = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([\\d.]+)\\s*(pt|in|px|cm|mm)?`, 'i').exec(style);
  if (!m) return undefined;
  const v = Number(m[1]);
  const unit = (m[2] ?? 'px').toLowerCase();
  const k = { pt: 1, in: 72, px: 0.75, cm: 72 / 2.54, mm: 72 / 25.4 }[unit] ?? 1;
  return v * k;
}

class DocxReader {
  private readonly styles: Styles;
  private readonly numbering: ReturnType<typeof readNumbering>;
  private readonly rels: ReturnType<OoxmlPackage['rels']>;
  readonly images = new Map<string, ImportedImage>();
  /** 脚注、尾注：引用的先后 → 编号（[1]、[2]），文末按这个顺序写出它们的字。 */
  private readonly notes: { kind: 'footnote' | 'endnote'; id: string }[] = [];
  private readonly pages: DocBlock[][] = [[]];
  /** 每一块的字原来的样子（磅、粗细）：全部读完、知道正文字号以后再写成相对整段的。 */
  private readonly pieces = new Map<DocParagraph | DocList | DocTableLike, Piece[][]>();
  private spacedNext = false;
  private prev: { after: number; style: string | undefined } | null = null;
  private list: { numId: string; ilvl: number; block: DocList } | null = null;
  private readonly counters = new Map<string, number[]>();
  private blockCount = 0;

  constructor(
    private readonly pkg: OoxmlPackage,
    private readonly main: string,
  ) {
    this.rels = pkg.rels(main);
    const rel = (kind: string) =>
      [...this.rels.values()].find((r) => relKind(r) === kind && !r.external);
    const stylesPart = rel('styles')?.target;
    this.styles = readStyles(stylesPart ? pkg.xml(stylesPart) : undefined);
    const numberingPart = rel('numbering')?.target;
    this.numbering = readNumbering(numberingPart ? pkg.xml(numberingPart) : undefined, this.styles);
  }

  private get blocks() {
    return this.pages.at(-1)!;
  }

  private push(block: DocBlock) {
    if (++this.blockCount > MAX_IMPORT_BLOCKS) throw new OfficeImportFailure('tooLarge');
    this.blocks.push(block);
  }

  private newPage() {
    this.closeList();
    if (this.blocks.length) this.pages.push([]);
    this.spacedNext = false;
    this.prev = null;
  }

  private closeList() {
    this.list = null;
  }

  read(): DocxImport {
    const root = this.pkg.xml(this.main);
    const body = child(root, 'w:body');
    if (!body) throw new OfficeImportFailure('damaged');
    this.blockLevel(body);
    this.closeList();
    this.writeNotes();
    return { doc: this.finish(), images: this.images };
  }

  /** 正文（或文本框、格子外的内容）里的一串块。 */
  private blockLevel(el: XmlElement) {
    for (const c of children(el)) {
      switch (c.name) {
        case 'w:p':
          this.paragraph(c);
          break;
        case 'w:tbl':
          this.table(c);
          break;
        case 'w:sdt':
          this.blockLevel(child(c, 'w:sdtContent') ?? c);
          break;
        case 'w:customXml':
        case 'w:ins':
        case 'w:moveTo':
          this.blockLevel(c);
          break;
        case 'mc:AlternateContent':
          this.blockLevel(this.choice(c));
          break;
      }
    }
  }

  /** 兼容内容：用第一个 Choice（新格式），没有时用 Fallback；不两个都读（同一份内容写了两遍）。 */
  private choice(alt: XmlElement): XmlElement {
    return (
      child(alt, 'mc:Choice') ?? child(alt, 'mc:Fallback') ?? { name: '', attrs: {}, children: [] }
    );
  }

  /** 一段的行内内容，按出现的顺序。 */
  private inlines(p: XmlElement, paraRun: RunStyle): Inline[] {
    const out: Inline[] = [];
    const walk = (el: XmlElement) => {
      for (const c of children(el)) {
        switch (c.name) {
          case 'w:r':
            this.run(c, paraRun, out);
            break;
          case 'w:hyperlink':
          case 'w:smartTag':
          case 'w:customXml':
          case 'w:ins':
          case 'w:moveTo':
          case 'w:fldSimple':
          case 'w:dir':
          case 'w:bdo':
            walk(c);
            break;
          case 'w:sdt':
            walk(child(c, 'w:sdtContent') ?? c);
            break;
          case 'mc:AlternateContent':
            walk(this.choice(c));
            break;
          case 'm:oMath':
          case 'm:oMathPara': {
            // 公式只留字（上下标、分数的排法不留）。
            const text = descendants(c, 'm:t').map(ownText).join('');
            if (text) out.push({ kind: 'text', piece: { text, style: paraRun } });
            break;
          }
          // w:del、w:moveFrom：修订里删掉的字不显示（按「接受全部」）；书签、批注的范围不要。
        }
      }
    };
    walk(p);
    return out;
  }

  private run(r: XmlElement, paraRun: RunStyle, out: Inline[]) {
    const rPr = child(r, 'w:rPr');
    const style: RunStyle = {
      ...paraRun,
      ...defined(this.styles.charRun(child(rPr, 'w:rStyle')?.attrs['w:val'])),
      ...defined(readRun(rPr)),
    };
    if (style.hidden) return;
    const text = (t: string) => {
      if (t) out.push({ kind: 'text', piece: { text: t, style } });
    };
    for (const c of children(r)) {
      switch (c.name) {
        case 'w:t':
          text(ownText(c));
          break;
        case 'w:tab':
        case 'w:ptab':
          text('\t');
          break;
        case 'w:br':
          if (c.attrs['w:type'] === 'page') out.push({ kind: 'pageBreak' });
          else text('\n');
          break;
        case 'w:cr':
          text('\n');
          break;
        case 'w:noBreakHyphen':
          text('-');
          break;
        case 'w:footnoteReference':
        case 'w:endnoteReference': {
          const id = c.attrs['w:id'];
          if (id === undefined) break;
          const kind = c.name === 'w:footnoteReference' ? 'footnote' : 'endnote';
          this.notes.push({ kind, id });
          text(`[${this.notes.length}]`);
          break;
        }
        case 'w:drawing':
          this.drawing(c, out);
          break;
        case 'w:pict':
        case 'w:object':
          this.vml(c, out);
          break;
        case 'mc:AlternateContent': {
          const alt = this.choice(c);
          this.run({ ...r, children: [...(rPr ? [rPr] : []), ...alt.children] }, paraRun, out);
          break;
        }
        // w:instrText（域的代码）、w:delText、w:fldChar、w:sym、批注的记号：不要。
      }
    }
  }

  /** 图片关系 → 包里的图片（认得出格式的才要）。 */
  private image(rid: string | undefined): string | null {
    const rel = rid ? this.rels.get(rid) : undefined;
    if (!rel || rel.external) return null;
    if (this.images.has(rel.target)) return rel.target;
    const bytes = this.pkg.bytes(rel.target);
    const ext = bytes ? imageExt(bytes) : null;
    if (!bytes || !ext) return null;
    this.images.set(rel.target, { bytes, ext });
    return rel.target;
  }

  /** DrawingML：图片（组合里的也算）和文本框；图表、SmartArt、形状不要。 */
  private drawing(d: XmlElement, out: Inline[]) {
    const frame = child(d, 'wp:inline') ?? child(d, 'wp:anchor');
    const extent = child(frame, 'wp:extent');
    const pics: XmlElement[] = [];
    const boxes: XmlElement[] = [];
    const walk = (el: XmlElement) => {
      for (const c of children(el)) {
        if (c.name === 'pic:pic') pics.push(c);
        else if (c.name === 'w:txbxContent') boxes.push(c);
        else walk(c);
      }
    };
    walk(d);
    for (const pic of pics) {
      const src = this.image(descendants(pic, 'a:blip')[0]?.attrs['r:embed']);
      if (!src) continue;
      // 组合里的图片用它自己的大小，单独一张用外框的大小。
      const own = descendants(child(pic, 'pic:spPr'), 'a:ext')[0];
      const size = pics.length === 1 && extent ? extent : (own ?? extent);
      const width = (num(size?.attrs.cx) ?? 200 * EMU_PER_PT) / EMU_PER_PT;
      const height = (num(size?.attrs.cy) ?? 150 * EMU_PER_PT) / EMU_PER_PT;
      out.push({ kind: 'image', src, width: Math.max(1, width), height: Math.max(1, height) });
    }
    for (const content of boxes) out.push({ kind: 'boxes', content });
  }

  /** VML（老的 Word 写的图片、文本框，w:object 的预览图）。 */
  private vml(el: XmlElement, out: Inline[]) {
    const walk = (e: XmlElement) => {
      for (const c of children(e)) {
        if (c.name === 'w:txbxContent') {
          out.push({ kind: 'boxes', content: c });
          continue;
        }
        if (c.name === 'v:imagedata') {
          const src = this.image(c.attrs['r:id']);
          const style = e.attrs.style ?? '';
          if (src) {
            out.push({
              kind: 'image',
              src,
              width: vmlLength(style, 'width') ?? 200,
              height: vmlLength(style, 'height') ?? 150,
            });
          }
          continue;
        }
        walk(c);
      }
    };
    walk(el);
  }

  private paraInfo(p: XmlElement) {
    const pPr = child(p, 'w:pPr');
    const styleId = child(pPr, 'w:pStyle')?.attrs['w:val'];
    const props: ParaProps = { ...this.styles.para(styleId), ...defined(readPara(pPr)) };
    return { styleId, props, run: this.styles.paraRun(styleId) };
  }

  /** 标题级别：样式名是 heading 1 / 2（或 Title）、大纲级别是 1 / 2 级；更低的标题当正文（字号、粗细照原样）。 */
  private headingOf(styleId: string | undefined, props: ParaProps): 1 | 2 | undefined {
    const name = this.styles.name(styleId);
    const m = /^heading\s*([1-9])$/.exec(name);
    const level = m
      ? Number(m[1])
      : name === 'title'
        ? 1
        : props.outline !== undefined && props.outline < 9
          ? props.outline + 1
          : undefined;
    return level === 1 || level === 2 ? level : undefined;
  }

  private paragraph(p: XmlElement) {
    const { styleId, props, run } = this.paraInfo(p);
    if (props.pageBreakBefore) this.newPage();
    const items = this.inlines(p, run);
    const level =
      props.numId && props.numId !== '0'
        ? this.numbering.levelOf(props.numId, props.ilvl ?? 0)
        : undefined;
    const numbered = !!level && level.fmt !== 'none' && level.text !== '';
    // 没有编号定义、字里写着符号或编号再跟一个制表符的段落（macOS 的「文本编辑」、textutil 存的 Word）：也当列表项。
    const typed = numbered ? null : typedMarker(items);
    const isList = numbered || typed !== null;
    const heading = this.headingOf(styleId, props);
    // 段前距（这一段的段前加上一段的段后，同一个样式又写了「不加段距」的不算）。
    const gap =
      this.prev && !(props.contextual && this.prev.style === styleId)
        ? (props.before ?? 0) + this.prev.after
        : (props.before ?? 0);
    let spaced = this.spacedNext || (this.prev !== null && gap >= SPACED_TWIP);
    let pieces: Piece[] = [];
    let wrote = false;
    let listed = false;
    const deferred: XmlElement[] = [];
    const flush = () => {
      const text = pieces.map((x) => x.text).join('');
      if (!text.trim()) {
        pieces = [];
        return;
      }
      if (isList && !listed) {
        if (typed) this.listItem(typed.key, 0, typed.level, pieces, spaced, typed.n);
        else this.listItem(props.numId!, props.ilvl ?? 0, level!, pieces, spaced);
        listed = true;
      } else {
        this.closeList();
        const block: DocParagraph = {
          kind: 'paragraph',
          text,
          ...(heading ? { heading } : {}),
          ...(alignOf(props.jc) ? { align: alignOf(props.jc)! } : {}),
          ...(spaced ? { spaced: true } : {}),
          box: BOX,
        };
        this.pieces.set(block, [pieces]);
        this.push(block);
      }
      wrote = true;
      spaced = false;
      pieces = [];
    };
    for (const item of items) {
      if (item.kind === 'text') pieces.push(item.piece);
      else if (item.kind === 'boxes') deferred.push(item.content);
      else if (item.kind === 'pageBreak') {
        flush();
        this.newPage();
        spaced = false;
      } else {
        flush();
        this.closeList();
        const center = alignOf(props.jc);
        const width = Math.min(item.width, CONTENT_PT);
        const x =
          center === 'center'
            ? (CONTENT_PT - width) / 2
            : center === 'right'
              ? CONTENT_PT - width
              : 0;
        this.push({
          kind: 'image',
          src: item.src,
          box: { x: Math.max(0, x), y: 0, width: item.width, height: item.height },
        });
        wrote = true;
        spaced = false;
      }
    }
    flush();
    if (wrote) {
      this.spacedNext = false;
      this.prev = { after: props.after ?? 0, style: styleId };
    } else if (this.prev || this.blocks.length) {
      // 空段落：下一块和它前面的之间原来空着。
      this.spacedNext = true;
    }
    // 文本框里的字接在它所在的段落后面。
    for (const content of deferred) this.blockLevel(content);
  }

  private listItem(
    numId: string,
    ilvl: number,
    level: Level,
    pieces: Piece[],
    spaced: boolean,
    /** 字里写着的编号（没有编号定义的列表）：和接着数的对不上时另起一个列表。 */
    typed?: number,
  ) {
    // 编号：每个列表每一级数到第几了；上一级出现时下面几级重新数。
    const counts = this.counters.get(numId) ?? [];
    for (let k = ilvl + 1; k < counts.length; k++) counts[k] = 0;
    const next = counts[ilvl] ? counts[ilvl]! + 1 : level.start;
    const n = typed ?? next;
    counts[ilvl] = n;
    this.counters.set(numId, counts);
    const text = pieces.map((x) => x.text).join('');
    const open = this.list;
    if (open && open.numId === numId && open.ilvl === ilvl && n === next) {
      open.block.items.push(text);
      this.pieces.get(open.block)!.push(pieces);
      return;
    }
    const ordered = level.fmt !== 'bullet';
    const own = `%${ilvl + 1}`;
    // 编号的写法只留这一级的（「%1.%2.」这种多级的写成「%1.」）。
    const format = ordered
      ? level.text.includes(own) && !/%[1-9]/.test(level.text.split(own).join(''))
        ? level.text.split(own).join('%1')
        : '%1.'
      : undefined;
    const block: DocList = {
      kind: 'list',
      ordered,
      ...(format ? { format } : {}),
      // 「%1」不带符号时 writeDocx 写成带圈的数字（D-328）：原来就是带圈的才写起始号。
      ...(ordered && (format !== '%1' || level.fmt === 'decimalEnclosedCircle')
        ? { start: n }
        : {}),
      items: [text],
      ...(spaced ? { spaced: true } : {}),
      box: BOX,
    };
    this.pieces.set(block, [pieces]);
    this.push(block);
    this.list = { numId, ilvl, block };
  }

  /** 格子里的字：段落一行一行；列表项前面加上符号、编号；嵌套的表一行一行、格子之间用制表符。 */
  private cellText(tc: XmlElement, images: Inline[], pieces: Piece[]): string {
    const lines: string[] = [];
    const counters = new Map<string, number>();
    const walk = (el: XmlElement) => {
      for (const c of children(el)) {
        if (c.name === 'w:p') {
          const { props, run } = this.paraInfo(c);
          const items = this.inlines(c, run);
          let text = '';
          for (const item of items) {
            if (item.kind === 'text') {
              text += item.piece.text;
              pieces.push(item.piece);
            } else if (item.kind === 'image') images.push(item);
            else if (item.kind === 'pageBreak') text += '\n';
            else {
              const inner: string[] = [];
              for (const p of descendants(item.content, 'w:p')) {
                inner.push(
                  this.inlines(p, run)
                    .map((x) => (x.kind === 'text' ? x.piece.text : ''))
                    .join(''),
                );
              }
              text += (text ? '\n' : '') + inner.join('\n');
            }
          }
          const level =
            props.numId && props.numId !== '0'
              ? this.numbering.levelOf(props.numId, props.ilvl ?? 0)
              : undefined;
          if (level && level.fmt !== 'none' && level.text && text.trim()) {
            const key = `${props.numId}/${props.ilvl ?? 0}`;
            const n = (counters.get(key) ?? level.start - 1) + 1;
            counters.set(key, n);
            text = `${level.fmt === 'bullet' ? '•' : `${n}.`} ${text}`;
          }
          lines.push(text);
        } else if (c.name === 'w:tbl') {
          for (const tr of this.rowsOf(c)) {
            lines.push(
              this.cellsOf(tr)
                .map((cell) => this.cellText(cell, images, pieces).replace(/\n/g, ' '))
                .join('\t'),
            );
          }
        } else if (c.name === 'w:sdt') walk(child(c, 'w:sdtContent') ?? c);
        else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') walk(c);
      }
    };
    walk(tc);
    // 格子末尾的空行（Word 的格子总以一个段落结尾）不要。
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    return lines.join('\n');
  }

  private rowsOf(tbl: XmlElement): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (el: XmlElement) => {
      for (const c of children(el)) {
        if (c.name === 'w:tr') out.push(c);
        else if (c.name === 'w:sdt') walk(child(c, 'w:sdtContent') ?? c);
        else if (c.name === 'w:customXml' || c.name === 'w:ins') walk(c);
      }
    };
    walk(tbl);
    return out;
  }

  private cellsOf(tr: XmlElement): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (el: XmlElement) => {
      for (const c of children(el)) {
        if (c.name === 'w:tc') out.push(c);
        else if (c.name === 'w:sdt') walk(child(c, 'w:sdtContent') ?? c);
        else if (c.name === 'w:customXml') walk(c);
      }
    };
    walk(tr);
    return out;
  }

  private table(tbl: XmlElement) {
    this.closeList();
    const grid = children(child(tbl, 'w:tblGrid'), 'w:gridCol').map(
      (g) => (num(g.attrs['w:w']) ?? 0) / 20,
    );
    const tblPr = child(tbl, 'w:tblPr');
    const cells: TableCell[] = [];
    /** 每一行每个位置属于第几个格子。 */
    const owner: number[][] = [];
    const images: Inline[] = [];
    const pieces: Piece[] = [];
    let visible = false;
    const rows = this.rowsOf(tbl);
    rows.forEach((tr, r) => {
      owner[r] = [];
      const trPr = child(tr, 'w:trPr');
      let col = num(child(trPr, 'w:gridBefore')?.attrs['w:val']) ?? 0;
      for (const tc of this.cellsOf(tr)) {
        const tcPr = child(tc, 'w:tcPr');
        const span = Math.max(1, num(child(tcPr, 'w:gridSpan')?.attrs['w:val']) ?? 1);
        const vMerge = child(tcPr, 'w:vMerge');
        const hMerge = child(tcPr, 'w:hMerge');
        const borders = child(tcPr, 'w:tcBorders');
        if (borders && hasVisibleBorder(borders)) visible = true;
        const text = this.cellText(tc, images, pieces);
        // 竖着合并的续格：接到上一行同一列的格子上。
        const above = r > 0 ? owner[r - 1]![col] : undefined;
        if (vMerge && vMerge.attrs['w:val'] !== 'restart' && above !== undefined) {
          const cell = cells[above]!;
          if (cell.col === col && cell.row + cell.rowSpan === r) {
            cell.rowSpan++;
            for (let k = col; k < col + cell.colSpan; k++) owner[r]![k] = above;
            col += span;
            continue;
          }
        }
        // 老的横着合并（hMerge）：续格并进左边那一格。
        const left = col > 0 ? owner[r]![col - 1] : undefined;
        if (hMerge && hMerge.attrs['w:val'] !== 'restart' && left !== undefined) {
          const cell = cells[left]!;
          if (cell.row === r) {
            cell.colSpan += span;
            for (let k = col; k < col + span; k++) owner[r]![k] = left;
            col += span;
            continue;
          }
        }
        const jc = this.paraInfo(child(tc, 'w:p') ?? tc).props.jc;
        const i = cells.length;
        cells.push({
          row: r,
          col,
          rowSpan: 1,
          colSpan: span,
          text,
          ...(alignOf(jc) ? { align: alignOf(jc)! } : {}),
        });
        for (let k = col; k < col + span; k++) owner[r]![k] = i;
        col += span;
      }
    });
    const cols = Math.max(grid.length, ...owner.map((row) => row.length), 0);
    if (!rows.length || !cols) return;
    // 网格里没有格子的位置（gridBefore / gridAfter、行比别的行短）补空格子：每个位置正好属于一个格子。
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (owner[r]![c] === undefined) {
          owner[r]![c] = cells.length;
          cells.push({ row: r, col: c, rowSpan: 1, colSpan: 1, text: '' });
        }
      }
    }
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    // 列宽：网格里写的（磅）；没写、写成 0 的平分内容区。
    const fallback = CONTENT_PT / cols;
    const colWidths = Array.from({ length: cols }, (_, c) =>
      grid[c] && grid[c]! > 1 ? grid[c]! : fallback,
    );
    const direct = child(tblPr, 'w:tblBorders');
    const styled = this.styles.tableBorders(child(tblPr, 'w:tblStyle')?.attrs['w:val']);
    if ((direct ?? styled) && hasVisibleBorder((direct ?? styled)!)) visible = true;
    const width = colWidths.reduce((a, b) => a + b, 0);
    const table: DocTableLike = {
      kind: 'table',
      ...(visible ? {} : { borderless: true }),
      table: { kind: 'table', rows: rows.length, col: 0, cols, cells, box: { ...BOX, width } },
      colWidths,
      box: { ...BOX, width },
    };
    this.pieces.set(table, [pieces]);
    this.push(table);
    this.spacedNext = false;
    this.prev = { after: 0, style: undefined };
    // 格子里的图片放在表后面（格子里只放字）。
    for (const item of images) {
      if (item.kind !== 'image') continue;
      this.push({
        kind: 'image',
        src: item.src,
        box: { x: 0, y: 0, width: item.width, height: item.height },
      });
    }
  }

  /** 脚注、尾注的字放到文末，一条一段，前面是正文里的记号。 */
  private writeNotes() {
    if (!this.notes.length) return;
    const parts = new Map<string, Map<string, XmlElement>>();
    const partOf = (kind: 'footnote' | 'endnote') => {
      if (!parts.has(kind)) {
        const rel = [...this.rels.values()].find((r) => relKind(r) === `${kind}s` && !r.external);
        const root = rel ? this.pkg.xml(rel.target) : undefined;
        parts.set(
          kind,
          new Map(children(root, `w:${kind}`).map((n) => [n.attrs['w:id'] ?? '', n])),
        );
      }
      return parts.get(kind)!;
    };
    let first = true;
    this.notes.forEach((note, i) => {
      const el = partOf(note.kind).get(note.id);
      if (!el) return;
      const body: Piece[] = [];
      children(el, 'w:p').forEach((p, k) => {
        const { run } = this.paraInfo(p);
        if (k) body.push({ text: ' ', style: run });
        for (const item of this.inlines(p, run)) {
          if (item.kind === 'text') body.push(item.piece);
        }
      });
      // 脚注里原来的记号后面跟着一个空格：去掉开头的空白，记号换成 [n]。
      while (body.length && !body[0]!.text.trim()) body.shift();
      if (!body.length) return;
      body[0] = { ...body[0]!, text: body[0]!.text.trimStart() };
      const pieces = [{ text: `[${i + 1}] `, style: body[0]!.style }, ...body];
      const text = pieces.map((x) => x.text).join('');
      const block: DocParagraph = {
        kind: 'paragraph',
        text,
        ...(first ? { spaced: true } : {}),
        box: BOX,
      };
      first = false;
      this.pieces.set(block, [pieces]);
      this.push(block);
    });
  }

  /** 读完了：按全文最多的字号定正文字号，每一块的字写成相对整段的样子。 */
  private finish(): DocDoc {
    const sizes = new Map<number, number>();
    for (const [block, lists] of this.pieces) {
      if (block.kind === 'paragraph' && block.heading) continue;
      for (const list of lists) {
        for (const p of list) {
          const n = p.text.replace(/\s/g, '').length;
          const size = p.style.size ?? DEFAULT_SIZE;
          sizes.set(size, (sizes.get(size) ?? 0) + n);
        }
      }
    }
    const bodySize =
      [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      this.styles.paraRun(undefined).size ??
      DEFAULT_SIZE;
    for (const [block, lists] of this.pieces) {
      if (block.kind === 'table') {
        const size = dominant(lists.flat(), (s) => s.size ?? DEFAULT_SIZE);
        if (size !== undefined && Math.abs(size - bodySize) >= 0.5) block.size = size;
        continue;
      }
      const all = lists.flat();
      const base: RunStyle = defined({
        size: dominant(all, (s) => s.size ?? DEFAULT_SIZE),
        bold: dominant(all, (s) => !!s.bold),
        italic: dominant(all, (s) => !!s.italic),
        underline: dominant(all, (s) => !!s.underline),
      });
      const heading = block.kind === 'paragraph' && block.heading;
      if (base.size !== undefined && (heading || Math.abs(base.size - bodySize) >= 0.5))
        block.size = base.size;
      if (base.bold) block.bold = true;
      if (base.italic) block.italic = true;
      if (base.underline) block.underline = true;
      // 颜色只能整段一种：整段的字都是同一个颜色（不是黑色、自动）时才写。
      const colors = new Set(all.filter((p) => p.text.trim()).map((p) => colorOf(p.style.color)));
      if (colors.size === 1) {
        const color = [...colors][0];
        if (color) block.color = color;
      }
      const own = lists.map((pieces) => ownRuns(pieces, base));
      if (block.kind === 'paragraph') {
        if (own[0]) block.runs = own[0];
      } else if (own.some(Boolean)) block.itemRuns = own.map((r) => r ?? null);
    }
    const pages = this.pages.filter((p, i) => p.length || i === 0);
    return {
      version: 1,
      pages: pages.map((blocks) => ({
        source: '',
        width: A4_WIDTH_PT,
        height: A4_HEIGHT_PT,
        bodySize,
        blocks,
      })),
    };
  }
}

/** 字里的列表记号：开头（可以先有一个制表符）是符号或 1–3 位的编号（后面可以有 . 或 )），再跟一个制表符。 */
const TYPED_MARKER = /^\t?(?:([•◦▪●○■□–·-])|(\d{1,3})[.)]?)\t/;

/** 段落开头写着列表记号时去掉它（改的是这一段读出来的字），返回当作哪种列表。 */
function typedMarker(items: Inline[]): { key: string; level: Level; n?: number } | null {
  const texts = items.filter((i): i is Extract<Inline, { kind: 'text' }> => i.kind === 'text');
  const head = texts
    .map((i) => i.piece.text)
    .join('')
    .slice(0, 8);
  const m = TYPED_MARKER.exec(head);
  if (!m) return null;
  let left = m[0].length;
  for (const item of texts) {
    if (!left) break;
    const cut = Math.min(left, item.piece.text.length);
    item.piece = { ...item.piece, text: item.piece.text.slice(cut) };
    left -= cut;
  }
  return m[1]
    ? { key: '#typed-bullet', level: { fmt: 'bullet', text: '•', start: 1 } }
    : { key: '#typed-number', level: { fmt: 'decimal', text: '%1.', start: 1 }, n: Number(m[2]) };
}

/** DocTable 的样子（读的时候还要改 size）。 */
type DocTableLike = Extract<DocBlock, { kind: 'table' }>;

function hasVisibleBorder(borders: XmlElement): boolean {
  return children(borders).some((b) => !['nil', 'none'].includes(b.attrs['w:val'] ?? 'none'));
}

function alignOf(jc: string | undefined): CellAlign | undefined {
  if (jc === 'center') return 'center';
  if (jc === 'right' || jc === 'end') return 'right';
  return undefined;
}

const colorOf = (c: string | undefined) =>
  c && /^[0-9a-fA-F]{6}$/.test(c) && c !== '000000' ? c.toUpperCase() : undefined;

/** 一组字里占字数最多的那个值（空白不算；全是空白时按长度）。 */
function dominant<T>(pieces: readonly Piece[], read: (s: RunStyle) => T): T | undefined {
  const count = new Map<T, number>();
  for (const p of pieces) {
    const n = p.text.replace(/\s/g, '').length || p.text.length * 0.001;
    count.set(read(p.style), (count.get(read(p.style)) ?? 0) + n);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 和整段不一样的几截（同 doc-runs 的 ownRuns）：一样的项不写，相邻样式一样的并成一截。 */
function ownRuns(pieces: readonly Piece[], base: RunStyle): DocRun[] | undefined {
  const out: DocRun[] = [];
  for (const p of pieces) {
    if (!p.text) continue;
    const run: DocRun = { text: p.text };
    const size = p.style.size ?? DEFAULT_SIZE;
    if (base.size !== undefined && Math.abs(size - base.size) >= 0.5) run.size = size;
    if (!!p.style.bold !== !!base.bold) run.bold = !!p.style.bold;
    if (!!p.style.italic !== !!base.italic) run.italic = !!p.style.italic;
    if (!!p.style.underline !== !!base.underline) run.underline = !!p.style.underline;
    const last = out.at(-1);
    if (last && sameRun(last, run)) {
      last.text += run.text;
      continue;
    }
    out.push(run);
  }
  return out.some((r) => Object.keys(r).length > 1) ? out : undefined;
}

const sameRun = (a: DocRun, b: DocRun) =>
  a.size === b.size && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;

/** 读一份外来的 docx。加了密码、不是 docx、坏了、太大时抛 OfficeImportFailure。 */
export function importDocx(data: Uint8Array): DocxImport {
  const pkg = openPackage(
    data,
    (name) =>
      /\.(xml|rels)$/i.test(name) || /^word\/media\//i.test(name) || /\/media\//i.test(name),
    (name) => /\/media\//i.test(name),
  );
  const main = pkg.main() ?? (pkg.xml('word/document.xml') ? 'word/document.xml' : undefined);
  const root = main ? pkg.xml(main) : undefined;
  if (!main || !root) throw new OfficeImportFailure('notOffice');
  if (root.name !== 'w:document') throw new OfficeImportFailure('notOffice');
  return new DocxReader(pkg, main).read();
}
