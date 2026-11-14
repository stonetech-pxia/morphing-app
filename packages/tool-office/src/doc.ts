import { buildTablePage, cachedLines, type BuildOptions } from './build';
import { assignLines, cleanRegions, lineShareIn, readingOrder, type LayoutRegion } from './layout';
import { findBarcodes, findTextTables, levelLines } from './text-table';
import { findLines } from './lines';
import { figureOwns, figureWorkingImage, planWordFigures } from './word-figures';
import { recoverPictureCards } from './word-cards';
import { restoreWordCellSpans } from './word-cell-spans';
import { withBullets } from './word-bullets';
import { ENDS_WITH_FILL, FILL_RUN, findFillIns, leaderDots, withFillIns } from './word-fill-ins';
import { restoreWordFormRows } from './word-form-rows';
import type { Box, OcrBox, RgbaImage, TableBlock, TableCell } from './types';

// 扫描件转 Word（D-328）：一页的识别结果 + 版面分析的区域 → DocDoc（编辑页改它，docx 每次从它重新生成）。
// 带线的表格和转 Excel 用同一套找线、组表（D-272）；其余的字按区域（没有区域的按位置聚成块）分段，
// 段落按 D-268 的规则接行；字号看行高（字写得够长、整页字体一致时看字宽，D-463），粗体看笔画粗细，颜色看文字像素。
// 上下重叠、左右分开的块放进并排行（D-331）。文字下面的下划线写成下划线（D-463）；删除线不画（只取字）。

/** 段落的样式：字号（磅）、粗体、斜体、下划线、颜色（RRGGBB）、对齐；没有的用文档默认的。 */
export interface DocStyle {
  size?: number;
  bold?: boolean;
  /** 编辑页里加的（D-465）；识别不出斜体。 */
  italic?: boolean;
  /** 原图里字下面有一条和字一样长的线（D-463）。 */
  underline?: boolean;
  color?: string;
  /** 来源色条跟随段落重排，不留在固定页底。 */
  fill?: string;
  align?: 'left' | 'center' | 'right';
}

/**
 * 一段字里样式不同的一截（D-465，编辑页里选中几个字加粗、改字号）：写了的就是这一截的样子
 * （bold: false 是这一截不加粗，哪怕整段是粗体），没写的跟着整段。
 */
export interface DocRun {
  text: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface DocParagraph extends DocStyle {
  kind: 'paragraph';
  text: string;
  /** 标题级别（1 或 2）；没有时是正文。 */
  heading?: 1 | 2;
  /** 和上一段之间原来空着（分段的空隙），写成段前间距。 */
  spaced?: boolean;
  /** 首行缩进（原图像素，D-330）：第一行比这一块其他行靠右多少。 */
  indent?: number;
  /**
   * 表单里配好的标签和值（D-332）：text 每行是「标签\t值」，tab 是值相对标签左边的位置（原图像素），
   * docx 里写成一个制表位。
   */
  tab?: number;
  /** 样式不同的几截（D-465）：有时连起来就是 text。 */
  runs?: DocRun[];
  box: Box;
}

export interface DocList extends DocStyle {
  kind: 'list';
  /** 编号列表（1. 2、 (3) ①）；否则是项目符号。 */
  ordered: boolean;
  /** 编号的写法（Word 的 lvlText，%1 是编号）：「%1.」「%1、」「(%1)」「%1)」。 */
  format?: string;
  /** 第一项的编号。 */
  start?: number;
  /** 每一项的文字（不含原来的编号和符号）。 */
  items: string[];
  /** 每一项样式不同的几截（D-465），和 items 一一对应；没有的项整项跟着列表的样式。 */
  itemRuns?: (DocRun[] | null)[];
  spaced?: boolean;
  box: Box;
}

/** 带线的表格：和转 Excel 的 TableBlock 一样（col 从 0 起），colWidths 是这张表每列的宽（原图像素）。 */
export interface DocTable {
  kind: 'table';
  /** 横向纸上转过 90 度的表格仍按来源方向写字，不把窄列中的词逐字折行。 */
  direction?: 'tbRl';
  /** 原图里没有线、按列对齐认出来的表（D-471）：画的时候不画边框。 */
  borderless?: boolean;
  table: TableBlock;
  colWidths: number[];
  /** 表里字的字号（磅，按表里文字的行高，D-335）；没有时用正文字号。写 docx 时随表的缩小一起缩小。 */
  size?: number;
  /** 每格原来各行字的位置；只生成普通段落的缩进/段前距，编辑增删行后失效。 */
  cellLayout?: {
    row: number;
    col: number;
    /** 原生填色覆盖整格时，底色随单元格走，不只随字行走。 */
    fill?: string;
    lines: (Box & { color?: string; fill?: string; tabs?: number[] })[];
  }[];
  box: Box;
}

/** 剪下来的图片：src 是剪好的 JPG（本次运行的文件）；还没剪时没有。 */
export interface DocImage {
  kind: 'image';
  box: Box;
  src?: string;
  /** 页面的纯装饰，不占文档流；旧版侧车也可能保留整个非正文绘图层。 */
  background?: true;
}

/** 已转到底图的图片原来占据的空白；不是透明图片，也不含正文。 */
export interface DocSpace {
  kind: 'space';
  box: Box;
}

/** 能单独放的块；并排行的格子里只放这些（不再套并排行）。 */
export type DocLeaf = DocParagraph | DocList | DocTable | DocImage | DocSpace;

/** 并排行的一格：width 是它在原图里的宽（像素，到下一格的左边为止），blocks 按阅读顺序。 */
export interface DocRowCell {
  width: number;
  blocks: DocLeaf[];
}

/**
 * 并排的一行（D-331）：上下范围重叠、左右分开的几块（左右两栏文字、并排的几张表、表单的左右两块），
 * docx 里写成一张无边框的排版表格的一行，每格里放各自的段落、表格。
 */
export interface DocRow {
  kind: 'row';
  /** 从左到右。 */
  cells: DocRowCell[];
  box: Box;
}

export type DocBlock = DocLeaf | DocRow;

/** 一页里所有能单独放的块（并排行展开成格子里的块），按顺序。 */
export function leafBlocks(page: { blocks: readonly DocBlock[] }): DocLeaf[] {
  return page.blocks.flatMap((b) => (b.kind === 'row' ? b.cells.flatMap((c) => c.blocks) : [b]));
}

/** 一栏里还有并排字段时，临时用普通排版表格；文件里的块和编辑引用不变。 */
export function flowCellBlocks(blocks: readonly DocLeaf[], h: number): readonly DocBlock[] {
  const parallel = blocks.some((a, i) =>
    blocks.slice(i + 1).some((b) => {
      const x = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
      const y =
        Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
      return x < h * 1.5 && y > Math.min(a.box.height, b.box.height) * 0.5;
    }),
  );
  return parallel
    ? arrangeUnits(
        blocks.map((b) => ({ box: b.box, blocks: [b] })),
        h,
      )
    : blocks;
}

export interface DocPage {
  /** 截原图核对用的那张图的 uri。 */
  source: string;
  /** box 的坐标系（和找线、认字那张图一样）。 */
  width: number;
  height: number;
  /** 这一页正文的字号（磅）：和它差不多的段落不单独写字号。 */
  bodySize: number;
  /** 来源纸张的物理尺寸（磅）；没有时沿用旧版的纵向 A4。 */
  paper?: { width: number; height: number };
  /** 从来源内容边界保留的页边距（磅）；旧文档没有时仍是 2 cm。 */
  margins?: { top: number; right: number; bottom: number; left: number };
  /** 按阅读顺序。 */
  blocks: DocBlock[];
}

export interface DocDoc {
  version: 1 | 2 | 3 | 4 | 5;
  pages: DocPage[];
}

export interface DocPageInput {
  /** 找线、量粗细和颜色用的图（增强后的那张，没有增强过就是原图）。 */
  image: RgbaImage;
  /** 识别出的行，坐标和 image 一样。 */
  lines: readonly OcrBox[];
  /** 版面分析的区域（模型没装时没有：只按位置分块，不认标题和图片）。 */
  regions?: readonly LayoutRegion[];
  /** 原始数字 PDF 已验证的整图（像素坐标）；先隔离图中字和网格，再按普通图片参与排版。 */
  nativeFigures?: readonly Box[];
  /** 原生 PDF 里没有画进整图剪图的字（像素坐标）：和它重叠的识别行不归图，留作正文。 */
  nativeText?: readonly Box[];
  /** 同页接管原生整图前的排版；图外字号、样式沿用它，不让移走图内标签改变正文统计。 */
  prior?: DocPage;
  source: string;
  /** PDF 渲染路径保留的物理尺寸；普通照片没有，不能凭像素猜票据的毫米数。 */
  paper?: { width: number; height: number };
  /** 已知的倾斜角（度），同 buildTablePage。 */
  skew?: number;
}

export interface DocBuildOptions extends BuildOptions {
  /** 接回的碎片或数字范围续行怎么接；其余段落、密集页保留 joinLines，避免扩大改动。 */
  joinParagraph?: (lines: readonly OcrBox[]) => string;
}

/** A4 的宽（磅）：整页宽度按 A4 换算字号。 */
export const A4_WIDTH_PT = 595;
/** 识别框的高度 → 字号：PP-OCR 的框比字高出一截（word-exp 的信件里 10 磅的正文框高约 11 磅）。 */
const BOX_TO_FONT = 0.9;
/**
 * 正文字号限制在这个范围：照片里的纸不一定是 A4（书页窄，按 A4 换算字会偏大），
 * 其他段落按和正文行高的比例算字号。表单页（D-335）按原图比例，最小到 6 磅，一页原件尽量还是一页；
 * 正文页（一半以上的字在长行里：书页、条款页）不小于 9 磅，字太小不好读，多排几页没关系。
 */
const BODY_MIN = 9;
const FORM_MIN = 6;
const BODY_MAX = 12;
/** 一页有这么多行字以上是密集的页（表单、税表）：正文也不抬到 9 磅，不然一页变两页。 */
const DENSE_LINES = 90;
/** 一页里至少这么多比例的字在长行（至少这么多比例的页宽）里，就是正文页（表单的标签、值、表格里的字都短）。 */
const PROSE_SHARE = 0.5;
const PROSE_LINE = 0.4;
/** 字号和正文差不到这么多（比例）就当正文（中文的引号让识别框高出一截，差 20% 很常见）。 */
const BODY_SNAP = 0.25;
/** 字母、数字少于这么多个的段落（「孩子。”」）行高不准，不单独算字号、不当标题（模型说是标题的除外）。 */
const SHORT_TEXT = 6;
/** 比正文大这么多倍、不超过两行的段落是标题；大这么多倍是一级标题。 */
const HEADING_RATIO = 1.3;
const HEADING1_RATIO = 1.8;
/**
 * 不当标题的段落（D-330）：引号开头的（对话），句号结尾而且字母数字超过 20 个的（一句话），
 * 或者字母数字超过 100 个的。版面模型和字号都可能把这些认成标题。
 */
const QUOTE_START = /^\s*[“"«「『‘'„]/;
const SENTENCE_END = /[.。!！?？]\s*$/;
/**
 * 只凭字大判断的标题（模型没说是标题）：以字母或数字开头，字母占不太少。
 * 扫描件里手写、打字机的字框高矮不齐，「Displays (8) 40 Floor (40)」「# Customers Attended 35」
 * 这种带符号、数字的行常被量成大字，不是标题。
 */
const HEADING_MIN_LETTERS = 0.7;
export const looksLikeHeading = (text: string) => {
  const chars = text.replace(/\s/g, '');
  const letters = chars.match(/\p{L}/gu)?.length ?? 0;
  return /^[\p{L}\p{N}]/u.test(chars) && letters >= HEADING_MIN_LETTERS * chars.length;
};
const notHeading = (text: string) => {
  const n = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return QUOTE_START.test(text) || (SENTENCE_END.test(text) && n > 20) || n > 100;
};
/** 首行缩进（D-330）：至少 0.8 个行高，最多 4 个行高、这一块宽度的一半（再多是居中、靠右或另一栏的短行）。 */
const INDENT_MIN = 0.8;
const INDENT_MAX = 0.5;
const INDENT_LINES = 4;
/** 笔画比这一页的中位数粗这么多倍算粗体。 */
export const BOLD_RATIO = 1.35;
/** 文字像素的色度（最大、最小通道之差）超过这么多算有颜色。 */
const COLOR_CHROMA = 60;
/** 段落：上下间距不超过 1.2 倍行高的算同一段（和 D-268 一样）。 */
const PARAGRAPH_GAP = 1.2;
/** 一行字的中线离整页中线不到页宽的这么多、左右都至少空着页宽的 15%（D-463）算居中。 */
const PAGE_CENTER = 0.06;
const PAGE_CENTER_MARGIN = 0.15;
/** 居中的行最宽占容器宽的这么多。 */
const CENTER_MAX_SHARE = 0.85;

/** 先确定容器，再判断对齐；页眉可额外按整页居中，栏内的字只看本栏。 */
function alignmentIn(
  box: Box,
  h: number,
  rows: number,
  left: number,
  right: number,
  pageWidth?: number,
): DocStyle['align'] {
  const leftGap = box.x - left;
  const rightGap = right - (box.x + box.width);
  // 差不多和容器一样宽的行（左右各空一点）不算居中：两边的空白是噪声（EU 样本 021 接了填写处的整行）。
  const centered =
    (leftGap > 2 * h &&
      rightGap > 2 * h &&
      box.width <= CENTER_MAX_SHARE * (right - left) &&
      Math.abs(leftGap - rightGap) < 0.2 * (leftGap + rightGap)) ||
    (pageWidth !== undefined &&
      rows === 1 &&
      Math.min(box.x, pageWidth - (box.x + box.width)) > PAGE_CENTER_MARGIN * pageWidth &&
      Math.abs(box.x - (pageWidth - box.x - box.width)) < PAGE_CENTER * pageWidth);
  return centered
    ? 'center'
    : leftGap > 6 * h && rightGap < 1.5 * h && rows <= 2
      ? 'right'
      : undefined;
}
/** 两行的中线相差不到这么多个行高（左边又不齐）算居中排的两行（D-463）。 */
const CENTER_PAIR = 0.2;
/**
 * 按字宽估字号（D-463）：PP-OCR、Vision 的框高随字母的上下伸出部分变（「Docteur」和「Ophtalmologiste」一样大，框高差 30%），
 * 字宽稳得多。一行的字宽（像素）÷ 这行字在 Arial 里有多少个字号宽 ≈ 字号（像素）。只看至少 8 个字母数字的行；
 * 整页正文行的估计要一致（四分位差不超过中位数的 15%，同一种字体）才用，和行高估的差不超过 1/3（别的字体、认错的字），
 * 否则还是看行高。用字宽估的段落和正文差 8% 以上就单独写字号。
 */
const WIDTH_MIN_CHARS = 8;
const WIDTH_SPREAD = 0.15;
const WIDTH_CLAMP = 4 / 3;
const WIDTH_SNAP = 0.08;
/** 列表项的开头（和 D-268 的 layoutOcrLines 一样）。 */
// 「7.29」「3)5」「-7.29」这样后面紧跟数字的是数（金额、条形码下面的号码），不是编号、不是项目符号（D-471）。
const LIST_ITEM = /^\s*(?:[•·*▪●○◦■□]|[-–—](?!\d)|\d{1,3}[.、)）](?!\d)|[(（]\d{1,3}[)）]|[①-⑳])/;
const ORDERED = /^\s*(?:(\d{1,3})([.、)）])(?!\d)|[(（](\d{1,3})[)）]|([①-⑳]))\s*/;
const BULLET = /^\s*(?:[•·*▪●○◦■□]|[-–—](?!\d))\s*/;
/**
 * 装饰：符号连着重复（「***」「--」）或者一行两头是同一种符号（「– Anmeldebestätigung –」「*** ATTO ***」），
 * 是标题、小票上的花边，不是列表的圆点。
 */
const DECORATED =
  /^\s*(?:([*•·▪●○◦■□])\s*\1|[-–—]\s*[-–—])|^\s*(?:([*•·▪●○◦■□]).*\2|[-–—].*[-–—])\s*$/;
const listStart = (text: string) => LIST_ITEM.test(text) && !DECORATED.test(text);

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1]! : 0;
};

const unionBox = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};

interface Row {
  lines: OcrBox[];
  box: Box;
  text: string;
}

/** 按竖直方向的重叠分成一排一排（D-268），每排从左到右。 */
function rowsOf(lines: readonly OcrBox[]): Row[] {
  const sorted = [...lines].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const groups: OcrBox[][] = [];
  for (const line of sorted) {
    const first = groups.at(-1)?.[0];
    if (first) {
      const ov = Math.min(first.y + first.height, line.y + line.height) - Math.max(first.y, line.y);
      if (ov >= 0.5 * Math.min(first.height, line.height)) {
        groups.at(-1)!.push(line);
        continue;
      }
    }
    groups.push([line]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    return { lines: g, box: unionBox(g), text: g.map((l) => l.text.trim()).join(' ') };
  });
}

/**
 * 没落进任何区域的行按位置聚成块：上下挨着（间距不超过 1.2 倍行高）而且左右有重叠的连在一起
 * （信头左边的地址和右边的日期分成两块）。
 */
export function clusterLines(lines: readonly OcrBox[], lineHeight: number): OcrBox[][] {
  const rows = rowsOf(lines).flatMap((r) => splitRow(r, lineHeight));
  const clusters: { rows: Row[]; box: Box }[] = [];
  for (const row of rows) {
    const near = clusters.filter((c) => {
      const gap = row.box.y - (c.box.y + c.box.height);
      const xOverlap =
        Math.min(c.box.x + c.box.width, row.box.x + row.box.width) - Math.max(c.box.x, row.box.x);
      return gap <= PARAGRAPH_GAP * lineHeight && gap > -0.5 * lineHeight && xOverlap > 0;
    });
    const target = near.at(-1);
    if (target) {
      target.rows.push(row);
      target.box = unionBox([target.box, row.box]);
    } else clusters.push({ rows: [row], box: row.box });
  }
  return clusters.map((c) => c.rows.flatMap((r) => r.lines));
}

/** 标签列和内容列之间的空隙至少这么多个行高。 */
const LABEL_GUTTER = 2;
/** 标签列的宽（最右到最左）不超过整页文字宽的这么多。 */
const LABEL_COLUMN_SHARE = 0.3;
/** 标签列、内容列至少各有这么多行；空隙处被盖住的行最多占这么多。 */
const LABEL_MIN_LINES = 4;
const LABEL_MAX_COVER = 0.25;

/**
 * 表单左边一列窄的标签（「Step 3: Claim Dependent and Other Credits」）、右边一列内容，中间有一条竖着的空隙，
 * 中间偶尔有一行横跨整页的字。找到这样的空隙就把行分成三类：横跨的、左边标签的、右边内容的，
 * 各自再按位置聚块；不然上面那行横跨的字和标签、内容 x 都有重叠，把左右两列连成一块，顺序全乱。
 * 没有这样的空隙（正文、两栏的论文）时原样返回一类。
 */
export function splitLabelColumn(
  lines: readonly OcrBox[],
  lineHeight: number,
): { across: OcrBox[]; labels: OcrBox[]; contents: OcrBox[] } | null {
  if (lines.length < 2 * LABEL_MIN_LINES) return null;
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.x + l.width));
  const span = right - left;
  // 每个横坐标被多少行盖住；空隙是标签列右边连续的一段、被盖住的行很少（只有偶尔横跨的几行）。
  // 只看整页文字左边 30% 以内：再往右的空隙是两栏正文的中缝。
  const step = Math.max(1, Math.round(lineHeight / 4));
  let best: { a: number; b: number } | null = null;
  let start: number | null = null;
  const limit = left + LABEL_COLUMN_SHARE * span;
  for (let x = left + 2 * lineHeight; x <= limit + step; x += step) {
    const open =
      x <= limit &&
      lines.filter((l) => l.x < x && l.x + l.width > x).length <= LABEL_MAX_COVER * lines.length;
    if (open && start === null) start = x;
    if (!open && start !== null) {
      if (x - start >= LABEL_GUTTER * lineHeight && (!best || x - start > best.b - best.a))
        best = { a: start, b: x };
      start = null;
    }
  }
  if (!best) return null;
  // 以空隙的中线为界：内容列的行左边常常比空隙的右沿差几个像素。
  const mid = (best.a + best.b) / 2;
  // 标签是窄的几个字；整行很宽的字就算落在空隙左边也是正文。
  const labels = lines.filter((l) => l.x + l.width <= mid && l.width <= LABEL_COLUMN_SHARE * span);
  const contents = lines.filter((l) => l.x >= mid);
  const across = lines.filter((l) => !labels.includes(l) && !contents.includes(l));
  if (labels.length < LABEL_MIN_LINES || contents.length < LABEL_MIN_LINES) return null;
  // 左边一列只有编号（「3.」「4.」）的是带编号的条文，编号属于右边那一项，不是标签列（EU 样本 032）。
  if (labels.every((l) => listStart(l.text) && !stripMarker(l.text))) return null;
  return { across, labels, contents };
}

type LabelSplit = NonNullable<ReturnType<typeof splitLabelColumn>>;

/** 一批行聚成块；整页有标签列时，这批行里左边标签、右边内容、横跨的各自成块（标记 side）。 */
function clustersOf(
  lines: readonly OcrBox[],
  lineHeight: number,
  split: LabelSplit | null,
): { lines: OcrBox[]; side?: 'label' | 'content' }[] {
  if (!split) return clusterLines(lines, lineHeight).map((c) => ({ lines: c }));
  const labels = new Set(split.labels);
  const contents = new Set(split.contents);
  const pick = (f: (l: OcrBox) => boolean) => lines.filter(f);
  return [
    ...clusterLines(
      pick((l) => !labels.has(l) && !contents.has(l)),
      lineHeight,
    ).map((c) => ({ lines: c })),
    ...clusterLines(
      pick((l) => labels.has(l)),
      lineHeight,
    ).map((c) => ({ lines: c, side: 'label' as const })),
    ...clusterLines(
      pick((l) => contents.has(l)),
      lineHeight,
    ).map((c) => ({ lines: c, side: 'content' as const })),
  ];
}

/** 短行后面至少空出这么多个行高（加上下一行的第一个词）才算放得下：栏和栏之间的空隙不算空着。 */
const ROOM_GUTTER = 3;
/** 一排里两块字隔得超过这么多个行高，分成左右两块（一行里词与词的空隙远小于一个行高）。 */
const ROW_SPLIT = 1.6;

/** 行首的编号和条文之间最多隔这么多个行高还算同一项。 */
const MARKER_GAP = 6;
/** 撑满的一行至少拆成这么多个词，词间空隙和中位数最多差这么多，才当成一行（不是几栏）。 */
const JUSTIFIED_MIN_WORDS = 3;
const JUSTIFIED_GAP_SPREAD = 0.2;

/**
 * 两端对齐、词少的一行（「dont   le   siège   est   fixé   à   (adresse   précise)」）词间空得很大，
 * 识别把每个词分成一块：每块只有一个词、空隙几乎一样大，是一行字，不是几栏（EU 样本 037）。
 * 几栏、信头左右两边的块里有好几个词，空隙也不会一样大。
 */
function justifiedWords(pieces: readonly (readonly OcrBox[])[]): boolean {
  if (pieces.length < JUSTIFIED_MIN_WORDS) return false;
  if (!pieces.every((p) => /^\S+$/u.test(p.map((l) => l.text.trim()).join('')))) return false;
  const gaps = pieces.slice(1).map((p, i) => {
    const prev = pieces[i]!.at(-1)!;
    return p[0]!.x - (prev.x + prev.width);
  });
  const mid = median(gaps);
  return gaps.every((g) => Math.abs(g - mid) <= JUSTIFIED_GAP_SPREAD * mid);
}

/** 一格里至少这么多排、除了最后一排每排至少这么多个字、宽度和最宽的一排差不多，才是一段正文。 */
const CELL_PROSE_ROWS = 3;
const CELL_PROSE_CHARS = 40;
const CELL_PROSE_WIDTH = 0.85;

/**
 * 格子里的几排字是一段折行的正文（每排很长、除了最后一排都写到头），不是一排一项（地址、日期，D-333）。
 */
function proseRows(rows: readonly Row[]): boolean {
  if (rows.length < CELL_PROSE_ROWS) return false;
  const widest = Math.max(...rows.map((r) => r.box.width));
  return rows
    .slice(0, -1)
    .every(
      (r) => [...r.text].length >= CELL_PROSE_CHARS && r.box.width >= CELL_PROSE_WIDTH * widest,
    );
}

/** 一排里隔得很远的几块分开（左右两栏、信头左右两边）。 */
function splitRow(row: Row, lineHeight: number): Row[] {
  const out: OcrBox[][] = [[row.lines[0]!]];
  for (const line of row.lines.slice(1)) {
    const prev = out.at(-1)!.at(-1)!;
    if (line.x - (prev.x + prev.width) > ROW_SPLIT * lineHeight) out.push([line]);
    else out.at(-1)!.push(line);
  }
  if (justifiedWords(out)) return [row];
  // 行首单独的编号（「3.」隔一大段才是条文，EU 样本 032 的符合性声明）和后面的字是同一项：分开了编号自成一栏，
  // 和条文并排时对不上行（「7.」排到了第 6 项的末行旁边）。
  const [first, second] = out;
  if (
    first?.length === 1 &&
    second &&
    listStart(first[0]!.text) &&
    !stripMarker(first[0]!.text) &&
    second[0]!.x - (first[0]!.x + first[0]!.width) <= MARKER_GAP * lineHeight
  )
    out.splice(0, 2, [...first, ...second]);
  return out.map((g) => ({
    lines: g,
    box: unionBox(g),
    text: g.map((l) => l.text.trim()).join(' '),
  }));
}

/**
 * 下一行的第一个词接在上一行后面放不放得下（左对齐的正文右边本来就参差不齐：上一行没写到头，
 * 是因为下一个词放不下才折行；放得下却换了行，才是段落的结尾）。词宽按下一行平均每个字的宽估。
 * 中日文没有空格，第一个字就可以折行。
 */
function fitsOnPrev(prev: Row, row: Row, right: number, typical: number): boolean {
  // 很短的行（表单的标签一列）长短不一是常事，不是折行；只对够长的行用这个判断。
  if ([...prev.text].length <= LABEL_MAX) return true;
  return prev.box.x + prev.box.width + firstWordWidth(row) <= right + 0.3 * typical;
}

/** 一行的第一个词（连同前面的空格）大约多宽：按这一行平均每个字的宽估。中日文的第一个字就可以折行。 */
function firstWordWidth(row: Row): number {
  const text = row.text.trim();
  const first = /^[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(text)
    ? text.slice(0, 1)
    : (text.split(/\s+/)[0] ?? '');
  const char = row.box.width / Math.max(1, text.length);
  return (first.length + 1) * char;
}

/** 一块里的行分成段落：空隙大、是列表项、上一行没写到右边（不是折行）、或者有缩进的地方开始新的一段。 */
export function paragraphsOf(
  lines: readonly OcrBox[],
  peers: readonly OcrBox[] = [],
  /** 整页文字（含表格）的右边；不给时按 peers 和这一块算。 */
  textRight?: number,
): { rows: Row[]; spaced: boolean; list: boolean }[] {
  const rows = rowsOf(lines);
  if (!rows.length) return [];
  const typical = median(rows.map((r) => median(r.lines.map((l) => l.height)))) || 1;
  const left = Math.min(...rows.map((r) => r.box.x));
  // 右边：行数多时用靠右的八成位置，一行特别长（网址、表格里漏进来的）不把右边撑出去。
  // 块外的行（peers）说明这一栏有多宽：几行短行自成一块时，最宽的那行不是栏的右边。
  // 和块同高、在块左右两边又在那一行横跨范围里有别的字，那一行横跨了别的栏，不算。
  const top = Math.min(...rows.map((r) => r.box.y));
  const bottom = Math.max(...rows.map((r) => r.box.y + r.box.height));
  const own = Math.max(...rows.map((r) => r.box.x + r.box.width));
  const beside = peers.filter(
    (q) => (q.x + q.width <= left || q.x >= own) && q.y < bottom && q.y + q.height > top,
  );
  const sameColumn = (p: OcrBox) => !beside.some((q) => q.x < p.x + p.width && q.x + q.width > p.x);
  // 左对齐的：左边对齐、字差不多高、上下挨着（三个行高以内）的行。
  const column = peers.filter(
    (p) =>
      Math.abs(p.x - left) <= typical &&
      Math.abs(p.height - typical) <= 0.5 * typical &&
      Math.max(p.y - bottom, top - (p.y + p.height)) <= 3 * typical &&
      sameColumn(p),
  );
  const rights = [
    ...rows.map((r) => r.box.x + r.box.width),
    ...column.map((p) => p.x + p.width),
  ].sort((a, b) => a - b);
  const right =
    rights.length >= 5 ? rights[Math.floor((rights.length - 1) * 0.85)]! : rights.at(-1)!;
  // 居中的：横跨块中线的行有多宽，居中的行就能排多宽。
  const middle = (left + own) / 2;
  const centeredWidth = Math.max(
    own - left,
    ...peers
      .filter((p) => p.x <= middle && p.x + p.width >= middle && sameColumn(p))
      .map((p) => p.width),
  );
  // 这一块的字右边能写到哪：块右边、上下三个行高以内最近的别的字（另一栏、另一块）的左边，
  // 没有时是整页文字的右边。
  const roomRight = Math.min(
    textRight ?? Math.max(own, ...peers.map((p) => p.x + p.width)),
    ...peers
      .filter((p) => p.x >= own && p.y < bottom + 3 * typical && p.y + p.height > top - 3 * typical)
      .map((p) => p.x),
  );
  const out: { rows: Row[]; spaced: boolean; list: boolean }[] = [];
  for (const [i, row] of rows.entries()) {
    const prev = rows[i - 1];
    const marker = listStart(row.text);
    const list = marker && /[\p{L}\p{N}]/u.test(stripMarker(row.text));
    const rangeTail =
      prev !== undefined && /\d[-–—]\s*$/.test(prev.text) && /^\s*\d+\.\s*$/.test(row.text);
    // 裸编号仍保留为独立标签；只有紧接数字范围的尾数可按折行接回，不能当新列表。
    const bareLabel = marker && !list && !rangeTail;
    const gap = prev ? row.box.y - (prev.box.y + prev.box.height) : 0;
    const h = median(row.lines.map((l) => l.height));
    const prevH = prev ? median(prev.lines.map((l) => l.height)) : h;
    // 居中排的几行（信头、处方的页眉，D-463）：中线对齐、左边不齐，是一行一行的，不是折行。
    const centerShift = prev
      ? Math.abs(prev.box.x + prev.box.width / 2 - (row.box.x + row.box.width / 2))
      : 0;
    const leftShift = prev ? Math.abs(prev.box.x - row.box.x) : 0;
    // 左边只差一点、中线对得比左边准得多的两行也是居中排的（左对齐的行左边只有几像素的抖动）：
    // 下一行的第一个词放得进居中能排的宽度却换了行，是一行一行排的，不是折行。
    const centeredLines =
      prev !== undefined &&
      centerShift <= CENTER_PAIR * typical &&
      leftShift > 0.2 * typical &&
      centerShift < leftShift / 4 &&
      prev.box.width + firstWordWidth(row) <= centeredWidth + 0.3 * typical;
    const centeredPair =
      prev !== undefined &&
      ((centerShift <= CENTER_PAIR * typical && leftShift > 0.5 * typical) || centeredLines);
    // 同一排左右各有「标签：值」是独立的信息行，不是上一段正文的折行。
    // 只看组外、隔开一栏的字段；正文两栏恰好对齐、字段值自己的续行都不因此拆段。
    const field = (text: string) => /^[^:：.!?。！？\n]{1,30}[:：]\s*\S/u.test(text.trim());
    const fieldRow =
      field(row.text) &&
      peers.some((p) => {
        const gap = Math.max(p.x - (row.box.x + row.box.width), row.box.x - (p.x + p.width));
        const overlap =
          Math.min(p.y + p.height, row.box.y + row.box.height) - Math.max(p.y, row.box.y);
        return (
          gap > ROW_SPLIT * typical &&
          overlap > 0.7 * Math.min(p.height, row.box.height) &&
          field(p.text)
        );
      });
    // 一叠短行（地址、信头、小票上的字段）：下一行的第一个词在上一行后面放得下（右边到下一块字、
    // 或者整页的右边还空着一大段），却换了行，是一行一行写的，不是折行（EU 样本 023、025、029）。
    const roomy =
      prev !== undefined &&
      [...prev.text].length <= LABEL_MAX &&
      [...row.text].length <= LABEL_MAX &&
      prev.box.x + prev.box.width + firstWordWidth(row) + ROOM_GUTTER * typical < roomRight;
    const wrapped =
      prev !== undefined &&
      !centeredPair &&
      !fieldRow &&
      !roomy &&
      // 以填写处结尾的行（「Name ……」）是一行一行的，不是折行。
      !ENDS_WITH_FILL.test(prev.text) &&
      gap <= PARAGRAPH_GAP * typical &&
      (prev.box.x + prev.box.width >= right - 1.2 * typical ||
        !fitsOnPrev(prev, row, right, typical)) &&
      prev.box.width >= 0.6 * (right - left) &&
      // 左边和块里最左的行差不多，或者和上一行左对齐（块并大了以后最左的行是别的段落的）。
      (row.box.x <= left + typical || Math.abs(row.box.x - prev.box.x) <= 0.5 * typical) &&
      !list &&
      !bareLabel &&
      Math.abs(h - prevH) <= 0.3 * Math.max(h, prevH);
    // 列表项下面接着的、有缩进的行（悬挂缩进）是这一项的折行。
    const last = out.at(-1);
    const hanging =
      last?.list === true &&
      prev !== undefined &&
      !fieldRow &&
      !ENDS_WITH_FILL.test(prev.text) &&
      gap <= PARAGRAPH_GAP * typical &&
      !list &&
      !bareLabel &&
      row.box.x > last.rows[0]!.box.x + 0.3 * typical &&
      prev.box.x + prev.box.width >= right - 2 * typical;
    if ((wrapped || hanging) && last) last.rows.push(row);
    else out.push({ rows: [row], spaced: gap > PARAGRAPH_GAP * typical, list });
  }
  return out;
}

/** 一行的笔画宽度（水平方向连续深色像素的中位数），和行高的比。没有深色像素时是 0。 */
export function strokeRatio(image: RgbaImage, box: Box): number {
  const x0 = Math.max(0, Math.floor(box.x));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y0 = Math.max(0, Math.floor(box.y + box.height * 0.2));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height * 0.8));
  if (x1 - x0 < 2 || y1 - y0 < 1) return 0;
  const { data, width } = image;
  const lum = (o: number) => (data[o]! * 299 + data[o + 1]! * 587 + data[o + 2]! * 114) / 1000;
  let lo = 255;
  let hi = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const v = lum((y * width + x) * 4);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (hi - lo < 40) return 0;
  const cut = (lo + hi) / 2;
  const runs: number[] = [];
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x < x1; x++) {
      if (lum((y * width + x) * 4) < cut) run++;
      else if (run) {
        runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
  }
  // 很长的一段是划线（下划线、删除线），不算笔画。
  const strokes = runs.filter((r) => r < box.height * 0.6);
  return strokes.length ? median(strokes) / box.height : 0;
}

/** 文字像素的颜色（RRGGBB）；黑色、灰色时是 undefined。 */
export function textColor(image: RgbaImage, box: Box): string | undefined {
  const x0 = Math.max(0, Math.floor(box.x));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y0 = Math.max(0, Math.floor(box.y));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  const { data, width } = image;
  const lums: number[] = [];
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const o = (y * width + x) * 4;
      lums.push((data[o]! * 299 + data[o + 1]! * 587 + data[o + 2]! * 114) / 1000);
    }
  if (lums.length < 4) return undefined;
  const sorted = lums.sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)]!;
  const hi = sorted[Math.floor(sorted.length * 0.9)]!;
  if (hi - lo < 40) return undefined;
  // 最深的那部分像素（笔画中间，不受背景混色影响）。
  const cut = lo + (hi - lo) * 0.35;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      const v = (data[o]! * 299 + data[o + 1]! * 587 + data[o + 2]! * 114) / 1000;
      if (v <= cut) {
        r += data[o]!;
        g += data[o + 1]!;
        b += data[o + 2]!;
        n++;
      }
    }
  if (!n) return undefined;
  const rgb = [r / n, g / n, b / n].map(Math.round);
  if (Math.max(...rgb) - Math.min(...rgb) < COLOR_CHROMA) return undefined;
  return rgb
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** 图片区域剪下来时外面留的边（行高的倍数）：不能超过图和旁边文字的空隙（0.3 个行高），不然并排的图和字变成上下排。 */
export const IMAGE_PAD = 0.15;

/** 行数 × 列数到这么多，格子数又很少，才可能是版面网格。 */
const LAYOUT_MIN_POSITIONS = 40;
/** 格子数不到位置数的这个比例：版面网格（W-9 的上半页是 0.13–0.15；真的合并表一般 0.38 以上）。 */
const LAYOUT_MAX_FILL = 0.25;
/** 格子数不到这个比例、而且每格平均有这么多行字：格子里装的是整段话（W-4 是 0.29–0.35、每格 1.8 行），不是数据。 */
const LAYOUT_MAYBE_FILL = 0.4;
const LAYOUT_LINES_PER_CELL = 1.5;
/** 格子数到这么多才用「空格子比例」判断是不是真表格。 */
const GRID_MIN_CELLS = 30;
/** 有字的格子占不到这么多的大网格是表单的下划线、方框连出来的，不是表格。 */
const GRID_MIN_FILLED = 0.35;

/**
 * 表单的下划线、签字线、方框和字一起被连成了一张很大的网格（扫描的表单常见）：九成以上的格子是空的，
 * 有字的格子里的字还被竖线切碎。这样的不当表格，里面的字按位置排成普通的文字。
 * 版面网格（位置很多、格子很少，大块合并，格子里装整段话）也一样；
 * 但真的带边框的表单（订货单、工资单）也有大块合并，所以只在格子特别少、或者每格都是整段话时才判。
 * lineCount 是落在这张表里的识别行数。
 */
export function isRuleGrid(table: TableBlock, lineCount = 0): boolean {
  const positions = table.rows * table.cols;
  const fill = table.cells.length / Math.max(1, positions);
  if (positions >= LAYOUT_MIN_POSITIONS) {
    if (fill < LAYOUT_MAX_FILL) return true;
    if (fill < LAYOUT_MAYBE_FILL && lineCount >= LAYOUT_LINES_PER_CELL * table.cells.length)
      return true;
  }
  if (table.cells.length < GRID_MIN_CELLS) return false;
  const filled = table.cells.filter((c) => c.text.trim()).length;
  return filled < GRID_MIN_FILLED * table.cells.length;
}

/** 一排的编号格（表单左边的「Lfd. Nr.」列里的 1、2、3）：很短。 */
const ROW_NUMBER_CHARS = 4;
/** 空白表格的表头最多这么多排。 */
const HEADER_ROWS_MAX = 2;

/**
 * 留给人填的空白表格（EU 样本 001、004、006）：横竖线画满，下面的排没有合并格（每排的格子在同样的列线上分开），
 * 字只在表头（一两排，格子可以横跨几列；下面至少两排空着，最多每排第一格有个编号），或者只在第一列（标签），
 * 右边空着的格子至少和标签一样宽（议程、奖状边框、试卷的答题线空着的列比有字的窄，见 isSparseColumnLayout）。
 * 这样的表不按「空格子太多」当成表单的画线丢掉。
 */
export function isBlankFormGrid(table: TableBlock): boolean {
  if (table.rows < 2) return false;
  const rows = Array.from({ length: table.rows }, (_, r) =>
    table.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col),
  );
  const starts = (row: readonly TableCell[]) => row.map((c) => c.col).join(',');
  /** 从第 from 排起每排的格子都在同样的列线上分开、不跨排。 */
  const regular = (from: number) =>
    rows[from]!.length >= 2 &&
    rows
      .slice(from)
      .every((row) => row.every((c) => c.rowSpan === 1) && starts(row) === starts(rows[from]!));
  const has = (c: TableCell) => c.text.trim() !== '';
  // 表头一排（或两排：表头里的短横线把它分成了两排）有字、格子可以横跨几列，
  // 下面至少两排一样的空格子（第一格可以是编号）。
  for (let k = 1; k <= HEADER_ROWS_MAX && k + 2 <= table.rows; k++) {
    const head = rows.slice(0, k).flat();
    if (head.some((c) => c.row + c.rowSpan > k) || !regular(k)) continue;
    const filled = head.filter(has).length;
    if (
      filled >= 2 &&
      filled * 2 >= head.length &&
      rows
        .slice(k)
        .every((row) =>
          row.every((c, i) => !has(c) || (i === 0 && c.text.trim().length <= ROW_NUMBER_CHARS)),
        )
    )
      return true;
  }
  // 第一列是标签，右边的格子空着、至少和标签一样宽。
  if (!regular(0)) return false;
  const widthOf = (cells: readonly TableCell[]) =>
    cells.reduce((sum, c) => sum + (c.box?.width ?? 0), 0);
  return rows.every(
    ([label, ...rest]) =>
      has(label!) &&
      rest.every((c) => !has(c)) &&
      widthOf([label!]) > 0 &&
      widthOf(rest) >= widthOf([label!]),
  );
}

/** 空着的格子至少这么多个行高宽，是留着填写的栏，不并进左边（foldEmptyColumns）。 */
const FILL_IN_LINES = 3;

/** 小装饰网格不靠总格数放行：反复出现的两列数据才是表格证据，空列不能算。 */
function isSparseColumnLayout(table: TableBlock): boolean {
  if (table.rows < 3 || table.cols < 2) return false;
  const filled = table.cells.filter((c) => c.text.trim());
  if (filled.length * 3 > table.cells.length * 2) return false;
  const counts = new Map<number, number>();
  for (const cell of filled) counts.set(cell.row, (counts.get(cell.row) ?? 0) + 1);
  const paired = [...counts.values()].filter((n) => n >= 2).length;
  if (paired >= 2) return false;
  // 签到表：表头一排每列都有字，下面至少两排整排空着，是留给人填的表，不是装饰。
  const rowsWith = new Set(filled.map((c) => c.row));
  const header = filled.filter((c) => c.row === filled[0]!.row);
  if (
    paired === 1 &&
    rowsWith.size === 1 &&
    header.reduce((n, c) => n + c.colSpan, 0) === table.cols &&
    table.rows - 1 >= 2
  )
    return false;
  // 空白表单：标签都在同一列，右边整列空着、至少和标签列一样宽，是填写栏。
  // 装饰网格（议程、试卷的答题线、奖状边框）空着的列比有字的列窄。
  if (!paired && filled.every((c) => c.colSpan === 1 && c.col === filled[0]!.col)) {
    const widthOf = (col: number) =>
      Math.max(
        0,
        ...table.cells
          .filter((c) => c.col === col && c.colSpan === 1 && c.box)
          .map((c) => c.box!.width),
      );
    const label = filled[0]!.col;
    for (let col = label + 1; col < table.cols; col++) {
      const blank = table.cells.every(
        (c) => !(c.col <= col && c.col + c.colSpan > col) || !c.text.trim(),
      );
      if (blank && widthOf(label) > 0 && widthOf(col) >= widthOf(label)) return false;
    }
  }
  // 整页共用的列会给一张合并表添上空格子。已有一排真实列关系时，先折掉这些
  // 空列再看密度；不能把本来填得很满的合并表拆成散文，导致表单额外分页。
  const folded = paired ? foldEmptyColumns(table) : table;
  const occupied = folded.cells.filter((c) => c.text.trim()).length;
  return occupied * 3 <= folded.cells.length * 2;
}

/** 至少这么多行、这么多比例的字被列线从词中间切开，就是网格认错了（D-502）。 */
export const CHOP_MIN = 2;
export const CHOP_SHARE = 0.3;

/** 框的高是宽的这么多倍以上、至少两个字：竖排或旋转了的字。 */
const VERTICAL_RATIO = 2;
export const isVertical = (l: Box & { text: string }) =>
  l.height > VERTICAL_RATIO * l.width && l.text.replace(/\s/g, '').length >= 2;

/** 竖排的行按位置合成块（挨得近的连在一起），每块外面留一点边，剪成图片。 */
export function verticalBoxes(
  lines: readonly Box[],
  lineHeight: number,
  page: { width: number; height: number },
): Box[] {
  const groups: Box[] = [];
  for (const line of [...lines].sort((a, b) => a.x - b.x)) {
    const near = groups.findIndex(
      (g) =>
        line.x <= g.x + g.width + lineHeight &&
        line.x + line.width >= g.x - lineHeight &&
        line.y <= g.y + g.height + lineHeight &&
        line.y + line.height >= g.y - lineHeight,
    );
    if (near >= 0) groups[near] = unionBox([groups[near]!, line]);
    else groups.push({ ...line });
  }
  const pad = 0.3 * lineHeight;
  return groups.map((g) => {
    const x = Math.max(0, g.x - pad);
    const y = Math.max(0, g.y - pad);
    return {
      x,
      y,
      width: Math.min(page.width, g.x + g.width + pad) - x,
      height: Math.min(page.height, g.y + g.height + pad) - y,
    };
  });
}

/**
 * 读起来像页码的字：「3」「- 3 -」「2/3」「Page 2 of 5」「Seite 2 von 3」「iv」「第 2 页」。
 * 页码区域里只丢这样的字，别的照正文留下。
 */
const PAGE_NUMBER =
  /^\s*[-–—]?\s*(?:(?:pages?|pg|p|seite|s|pagina|pag|página|pág|strona|str|sida|side|blz|bladzijde|folio|fol|стр|第)\.?\s*)?(?:\d{1,4}|(?=[ivxlc])c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))(?:\s*(?:\/|of|von|de|di|sur|su|z|av|van|из|共)\s*\d{1,4})?\s*页?\s*[-–—]?\s*$/i;

/** 页边碎片（D-334）：不超过这么多个字（不算空格）。 */
const STRAY_CHARS = 3;
/** 离别的字至少这么多个行高才算孤立。 */
const STRAY_GAP = 3;
/** 置信度低于这个，或者框比正文行高这么多倍（污点、签名），就不像字。 */
const STRAY_SCORE = 0.7;
const STRAY_TALL = 2;
/** 贴着页边：离图的边不到长边的这么多（1%）。 */
const STRAY_EDGE = 0.01;

/**
 * 页边碎片（D-334）：很短、孤立（离别的字至少 3 个行高），而且贴着页边、置信度低或者框比正文高得多的，
 * 是页边的污点、装订孔、签名认成的字（条款页顶上的「00」），不写进文件。认得准、和正文一样高的短字照样留下。
 */
function isStray(
  line: OcrBox,
  all: readonly OcrBox[],
  lineHeight: number,
  page: { width: number; height: number },
): boolean {
  if (line.text.replace(/\s/g, '').length > STRAY_CHARS) return false;
  const edge = Math.max(page.width, page.height) * STRAY_EDGE;
  const atEdge =
    line.x <= edge ||
    line.y <= edge ||
    line.x + line.width >= page.width - edge ||
    line.y + line.height >= page.height - edge;
  const unsure = line.score !== undefined && line.score < STRAY_SCORE;
  const tall = line.height > STRAY_TALL * lineHeight;
  if (!atEdge && !unsure && !tall) return false;
  return all.every((o) => {
    if (o === line) return true;
    const dx = Math.max(0, Math.max(o.x, line.x) - Math.min(o.x + o.width, line.x + line.width));
    const dy = Math.max(0, Math.max(o.y, line.y) - Math.min(o.y + o.height, line.y + line.height));
    return Math.max(dx, dy) > STRAY_GAP * lineHeight;
  });
}

/** Arial 里 ASCII 字符的宽（千分之一字号，32–126）。 */
const ARIAL_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * 一行字在 Arial 里有多少个字号宽（D-463）：带重音的字母按不带的算，中日韩的字和全角符号算 1，其他文字（西里尔、希腊）算 0.556。
 */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text.trim().normalize('NFD')) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x300 && code < 0x370) continue;
    if (code >= 32 && code <= 126) em += ARIAL_WIDTHS[code - 32]! / 1000;
    else if (code >= 0x2e80) em += 1;
    else em += 0.556;
  }
  return em;
}

/** 按字宽估的字号（像素）；字太少时是 0。 */
function widthSizeOf(line: OcrBox): number {
  const n = line.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const em = textEm(line.text);
  return n >= WIDTH_MIN_CHARS && em > 0 ? line.width / em : 0;
}

/**
 * 字下面有没有下划线（D-463）：框的下部到框下面 0.3 个行高之间，有一排像素九成以上是深色的，
 * 而且这条线在字的左右两边（各出去 0.6 个行高）就没有了（更长的是分隔线、表格线，不是这行字的下划线）。
 */
export function hasUnderline(image: RgbaImage, box: Box): boolean {
  const { data, width, height } = image;
  const x0 = Math.max(0, Math.floor(box.x + box.width * 0.03));
  const x1 = Math.min(width, Math.ceil(box.x + box.width * 0.97));
  const y0 = Math.max(0, Math.floor(box.y + box.height * 0.7));
  const y1 = Math.min(height, Math.ceil(box.y + box.height * 1.3));
  if (x1 - x0 < 4 || y1 <= y0) return false;
  const lum = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    return (data[o]! * 299 + data[o + 1]! * 587 + data[o + 2]! * 114) / 1000;
  };
  let lo = 255;
  let hi = 0;
  for (let y = Math.max(0, Math.floor(box.y)); y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const v = lum(x, y);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  if (hi - lo < 40) return false;
  const cut = (lo + hi) / 2;
  const outL = Math.round(box.x - 0.6 * box.height);
  const outR = Math.round(box.x + box.width + 0.6 * box.height);
  for (let y = y0; y < y1; y++) {
    let dark = 0;
    for (let x = x0; x < x1; x++) if (lum(x, y) < cut) dark++;
    if (dark < 0.9 * (x1 - x0)) continue;
    const beyond = [outL, outR].some((x) => x >= 0 && x < width && lum(x, y) < cut);
    if (!beyond) return true;
  }
  return false;
}

/** 按行高估字号（磅，取到半磅）。 */
export function fontSizeOf(lineHeightPx: number, pageWidthPx: number): number {
  const pt = (lineHeightPx * A4_WIDTH_PT * BOX_TO_FONT) / pageWidthPx;
  return Math.min(48, Math.max(6, Math.round(pt * 2) / 2));
}

/** 列表项的编号写法。 */
function listMarker(text: string): { ordered: boolean; format?: string; start?: number } {
  const m = ORDERED.exec(text);
  if (!m) return { ordered: false };
  if (m[4]) return { ordered: true, format: '%1', start: m[4].charCodeAt(0) - 0x2460 + 1 };
  if (m[3]) return { ordered: true, format: '(%1)', start: Number(m[3]) };
  return { ordered: true, format: `%1${m[2] === '）' ? ')' : m[2]}`, start: Number(m[1]) };
}

const stripMarker = (text: string) => text.replace(ORDERED, '').replace(BULLET, '').trim();

/**
 * 整列都空着的格子并进左边的格子（D-328）：转 Excel 时整页共用一套列线（D-272），一张表会多出只有别的表才有的列，
 * 在 Word 里就是一列空格子。只并没有跨行的格子；列线不变（格子用 colSpan 跨过去）。
 */
export function foldEmptyColumns(table: TableBlock, keepWidth = Infinity): TableBlock {
  let cells = table.cells;
  for (let c = table.cols - 1; c > 0; c--) {
    const at = (r: number, col: number) =>
      cells.find(
        (x) => x.row <= r && r < x.row + x.rowSpan && x.col <= col && col < x.col + x.colSpan,
      );
    const pairs: { left: TableCell; empty: TableCell }[] = [];
    let ok = true;
    for (let r = 0; r < table.rows && ok; r++) {
      const empty = at(r, c);
      const left = at(r, c - 1);
      // 这一行已经有一格横跨这条列线：不用并。
      if (empty && empty === left) continue;
      ok =
        !!empty &&
        !!left &&
        empty.col === c &&
        !empty.text.trim() &&
        empty.rowSpan === 1 &&
        left.rowSpan === 1;
      if (ok) pairs.push({ left: left!, empty: empty! });
    }
    if (!ok || !pairs.length) continue;
    // 填写栏：空格子都够宽（keepWidth，像素），留着给人填。
    if (pairs.every((p) => (p.empty.box?.width ?? 0) >= keepWidth)) continue;
    const drop = new Set(pairs.map((p) => p.empty));
    const grow = new Map(pairs.map((p) => [p.left, p.empty.colSpan]));
    cells = cells
      .filter((x) => !drop.has(x))
      .map((x) => (grow.has(x) ? { ...x, colSpan: x.colSpan + grow.get(x)! } : x));
  }
  return cells === table.cells ? table : { ...table, cells };
}

/** 默认的接法（测试用）：一段里的行用空格接（中文之间不加）。 */
function defaultJoin(lines: readonly OcrBox[]): string {
  return rowsOf(lines)
    .map((r) => r.text)
    .join(' ');
}

/** A3 的长短边（磅）；比它还大一点的纸算作量错了的纸。 */
const A3_PT = { short: 841.9, long: 1190.6 };
const A3_SLACK = 1.05;

/**
 * 比 A3 还大的 PDF 页（扫描件按 1 像素 = 1 磅存成的 87 × 124 cm）不照抄成 Word 的纸：按原来的高宽比
 * 缩到 A4 宽（横向按 A4 长边），和没有纸张信息的照片一样。字号本来就按 A4 宽估，这样字和纸的比例才对。
 */
export function fitPaper(paper: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const short = Math.min(paper.width, paper.height);
  const long = Math.max(paper.width, paper.height);
  if (short <= A3_PT.short * A3_SLACK && long <= A3_PT.long * A3_SLACK) return paper;
  const width = paper.width > paper.height ? 841.9 : 595.3;
  return { width, height: Math.round(((width * paper.height) / paper.width) * 10) / 10 };
}

/** 一页的 DocPage。 */
export function buildDocPage(input: DocPageInput, options: DocBuildOptions = {}): DocPage {
  if (input.paper) input = { ...input, paper: fitPaper(input.paper) };
  const page = buildPage(input, options, true);
  const next = recoverPictureCards(
    page,
    input.image,
    input.lines,
    median(input.lines.map((l) => l.height)) || 20,
  );
  const form = leafBlocks(next).find(
    (b) =>
      b.kind === 'table' &&
      !b.borderless &&
      b.box.height > input.image.height * 0.5 &&
      b.box.y < input.image.height * 0.3,
  );
  if (form) {
    const header = next.blocks.filter((b) => b.box.y + b.box.height <= form.box.y);
    const leaves = leafBlocks({ blocks: header });
    const compact = (s: string) => s.replace(/\s/g, '');
    let split = false;
    const parts = leaves.flatMap((b): DocLeaf[] => {
      if (b.kind !== 'paragraph' || b.text.length > 160) return [b];
      const rows = rowsOf(input.lines.filter((l) => lineShareIn(l, b.box) >= 0.8));
      if (
        rows.length < 2 ||
        rows.length > 6 ||
        compact(rows.map((r) => r.text).join('')) !== compact(b.text)
      )
        return [b];
      split = true;
      const { runs: _runs, ...style } = b;
      return rows.map((r) => ({ ...style, text: r.text, box: r.box }));
    });
    if (split || header.length > 1)
      next.blocks = [
        ...arrangeUnits(
          parts.map((b) => ({ box: b.box, blocks: [b] })),
          median(input.lines.map((l) => l.height)) || 20,
        ),
        ...next.blocks.filter((b) => !header.includes(b)),
      ];
  }
  for (const block of leafBlocks(next)) {
    if (block.kind !== 'table' || block.direction) continue;
    restoreWordFormRows(block, input.image, input.lines, options.joinLines ?? defaultJoin);
    restoreWordCellSpans(block, input.image, input.lines, options.joinLines ?? defaultJoin);
    const layout: NonNullable<DocTable['cellLayout']> = [];
    for (const cell of block.table.cells) {
      const box = cell.box;
      if (!box || !cell.text.trim()) continue;
      const lines = input.lines.filter((l) => {
        const x = l.x + l.width / 2,
          y = l.y + l.height / 2;
        return (
          x >= box.x &&
          x < box.x + box.width &&
          y >= box.y &&
          y < box.y + box.height &&
          l.x >= box.x - 2 &&
          l.x + l.width <= box.x + box.width + 2
        );
      });
      const rows = rowsOf(lines);
      // 跨格识别行已在组表时按字符切过；不能拿整行框给某一格定位。
      const compact = (s: string) => s.replace(/\s/g, '');
      if (
        rows.length !== cell.text.split('\n').length ||
        compact(rows.map((r) => r.text).join('')) !== compact(cell.text)
      )
        continue;
      layout.push({
        row: cell.row,
        col: cell.col,
        lines: rows.map((r, i) => ({
          ...r.box,
          ...(r.lines.length > 1 && cell.text.split('\n')[i]?.split('\t').length === r.lines.length
            ? { tabs: r.lines.slice(1).map((l) => l.x) }
            : {}),
        })),
      });
    }
    if (layout.length) block.cellLayout = layout;
  }
  if (input.prior && input.nativeFigures?.length) {
    const candidate = insertWordFigures(input.prior, input.nativeFigures);
    // 只换图且可编辑块完全相同时保留原分栏顺序；组表或正文有变化时仍用隔离后的重建结果。
    const signature = (page: DocPage) =>
      leafBlocks(page)
        .filter((b) => b.kind !== 'image')
        .map((b) => {
          if (b.kind === 'table')
            return JSON.stringify([
              b.kind,
              b.table.rows,
              b.table.cols,
              b.table.cells.map((c) => [c.row, c.col, c.rowSpan, c.colSpan, c.text]),
            ]);
          return JSON.stringify([
            b.kind,
            b.kind === 'paragraph' ? b.text : b.kind === 'list' ? b.items : b.box,
          ]);
        })
        .sort()
        .join('\n');
    if (
      signature(candidate) === signature(next) &&
      leafBlocks(candidate).filter((b) => b.kind === 'image').length ===
        leafBlocks(next).filter((b) => b.kind === 'image').length
    )
      return candidate;
  }
  return next;
}

/** 补回原生整图时保留文字与来源顺序；跨多个横带的页边图与这些横带共用一张排版表。 */
export function insertWordFigures(page: DocPage, boxes: readonly Box[]): DocPage {
  const owned = (b: DocLeaf) => boxes.some((box) => lineShareIn(b.box, box) >= 0.8);
  const blocks = page.blocks.flatMap((b): DocBlock[] => {
    if (b.kind !== 'row') return owned(b) ? [] : [b];
    const cells = b.cells
      .map((c) => ({ ...c, blocks: c.blocks.filter((x) => !owned(x)) }))
      .filter((c) => c.blocks.length);
    return cells.length
      ? [{ ...b, box: unionBox(cells.flatMap((c) => c.blocks.map((x) => x.box))), cells }]
      : [];
  });
  for (const box of [...boxes].sort((a, b) => b.width - a.width)) {
    const image: DocImage = { kind: 'image', box };
    if (box.width < page.width * 0.12 && box.height > box.width * 3) {
      const band = blocks.filter((b) => {
        const overlap =
          Math.min(b.box.y + b.box.height, box.y + box.height) - Math.max(b.box.y, box.y);
        return (
          overlap >= Math.min(b.box.height, box.height) * 0.3 &&
          leafBlocks({ blocks: [b] }).every(
            (l) => box.x + box.width <= l.box.x + 2 || box.x >= l.box.x + l.box.width - 2,
          )
        );
      });
      if (band.length > 1) {
        const content = leafBlocks({ blocks: band });
        const bounds = unionBox(content.map((b) => b.box));
        const left = box.x < bounds.x;
        const cells = left
          ? [
              { width: bounds.x - box.x, blocks: [image] },
              { width: bounds.width, blocks: content },
            ]
          : [
              { width: box.x - bounds.x, blocks: content },
              { width: box.width, blocks: [image] },
            ];
        const index = blocks.indexOf(band[0]!);
        const next: DocRow = { kind: 'row', box: unionBox([bounds, box]), cells };
        blocks.splice(index, 1, next);
        for (const b of band.slice(1)) blocks.splice(blocks.indexOf(b), 1);
        continue;
      }
    }
    // 分栏里的图（只在某一栏里）放回那一栏、按上下位置插进去，不挪到整个分栏行的后面。
    const column = blocks.flatMap((b) => {
      if (b.kind !== 'row' || b.cells.length < 2) return [];
      const overlap =
        Math.min(b.box.y + b.box.height, box.y + box.height) - Math.max(b.box.y, box.y);
      if (overlap < 0.5 * box.height) return [];
      const xs = b.cells.map((c) => Math.min(...c.blocks.map((x) => x.box.x)));
      const cell = b.cells.findIndex((_, i) => {
        const right = xs[i + 1] ?? b.box.x + b.box.width;
        const inside = Math.min(right, box.x + box.width) - Math.max(xs[i]!, box.x);
        return inside >= 0.8 * box.width;
      });
      return cell >= 0 ? [{ row: b, cell: b.cells[cell]! }] : [];
    })[0];
    if (column) {
      const { row, cell } = column;
      const at = cell.blocks.findIndex((b) => b.box.y > box.y);
      cell.blocks.splice(at < 0 ? cell.blocks.length : at, 0, image);
      row.box = unionBox([row.box, box]);
      continue;
    }
    const index = blocks.findIndex((b) => {
      const overlap =
        Math.min(b.box.y + b.box.height, box.y + box.height) - Math.max(b.box.y, box.y);
      return (
        overlap >= 0.3 * Math.min(b.box.height, box.height) &&
        (box.x >= b.box.x + b.box.width || box.x + box.width <= b.box.x)
      );
    });
    if (index >= 0) {
      const old = blocks[index]!;
      const cells = (
        old.kind === 'row' ? old.cells : [{ width: old.box.width, blocks: [old] }]
      ).concat([{ width: box.width, blocks: [image] }]);
      const slots = cells
        .map((c) => ({
          cell: c,
          x: Math.min(...c.blocks.map((b) => b.box.x)),
          right: Math.max(...c.blocks.map((b) => b.box.x + b.box.width)),
        }))
        .sort((a, b) => a.x - b.x);
      blocks[index] = {
        kind: 'row',
        box: unionBox([old.box, box]),
        cells: slots.map((s, i) => ({ ...s.cell, width: (slots[i + 1]?.x ?? s.right) - s.x })),
      };
    } else {
      const index = blocks.findIndex((b) => {
        const body = leafBlocks({ blocks: [b] }).filter((x) => x.kind !== 'image');
        return (body.length ? Math.min(...body.map((x) => x.box.y)) : b.box.y) > box.y;
      });
      blocks.splice(index < 0 ? blocks.length : index, 0, image);
    }
  }
  return { ...page, blocks };
}

/** 比这更竖长（高/宽）的照片不是一页纸（小票、长条截图）：不设纸，按旧版连续排在 A4 上、自然分页。 */
const PAGE_LIKE_RATIO = 1.6;
/** 照片的高宽比和 A4 差不到这么多时直接用 A4。 */
const A4_ASPECT_SNAP = 0.03;

/**
 * 没有物理尺寸的照片按 A4 宽估纸（横向按 A4 长边），纸的高宽比跟照片一样：横竖同一个比例，不压扁。
 * 比一页纸还竖长的（小票）不设纸，按旧版连续排在 A4 上、自然分页，不做成一张又窄又长的怪纸。
 */
function photoPaper(image: { width: number; height: number }) {
  if (image.width > image.height)
    return { width: 841.9, height: (841.9 * image.height) / image.width };
  const ratio = image.height / image.width;
  if (Math.abs(ratio / (841.9 / 595.3) - 1) <= A4_ASPECT_SNAP)
    return { width: 595.3, height: 841.9 };
  return ratio > PAGE_LIKE_RATIO ? undefined : { width: 595.3, height: 595.3 * ratio };
}

function buildPage(
  input: DocPageInput,
  options: DocBuildOptions,
  protectFigures: boolean,
  repairTables = true,
  repairBarcodes = true,
): DocPage {
  const join = options.joinLines ?? defaultJoin;
  const { image } = input;
  const paper = input.paper ?? photoPaper(image);
  // 按 Word 的纸宽估字：窄幅 PDF 按它的物理宽度；横向的纸（横向 A4 的 PDF、横拍的照片）按 842 磅宽，
  // 不按竖向 A4 的 595 磅，不然字整体只有原来的 0.71 倍。比 A3 大的纸已经由 fitPaper 缩过，不会因此放大字。
  const fontWidthPx = (image.width * A4_WIDTH_PT) / (paper?.width ?? A4_WIDTH_PT);
  const lines = input.lines.filter((l) => l.text.trim());
  const joinParagraph = lines.length < DENSE_LINES ? (options.joinParagraph ?? join) : join;
  const rotatedLines = lines.filter((l) => l.text.trim().length >= 4 && l.height > 2 * l.width);
  const rotated =
    !!input.paper &&
    image.width > image.height &&
    rotatedLines.length >= 4 &&
    rotatedLines.reduce((n, l) => n + l.text.length, 0) >=
      0.7 * lines.reduce((n, l) => n + l.text.length, 0);
  const lineHeight =
    median(lines.map((l) => (rotated ? Math.min(l.width, l.height) : l.height))) || 20;
  const cropLineHeight = rotated ? median(lines.map((l) => l.height)) || 20 : lineHeight;
  const native = protectFigures && input.nativeFigures?.length ? input.nativeFigures : undefined;
  const sourceRegions: readonly LayoutRegion[] = native
    ? [
        ...(input.regions ?? []).filter(
          (r) => !native.some((b) => lineShareIn(r.box, b) >= (r.kind === 'image' ? 0.5 : 0.8)),
        ),
        ...native.map((box): LayoutRegion => ({ kind: 'image', label: 'image', score: 1, box })),
      ]
    : (input.regions ?? []);
  const figures = native
    ? sourceRegions
        .filter((r) => native.includes(r.box))
        .map((region) => ({ region, box: region.box }))
    : protectFigures
      ? planWordFigures(image, lines, sourceRegions, lineHeight)
      : [];
  const previous = native
    ? input.prior
    : figures.length
      ? buildPage(input, options, false, repairTables, repairBarcodes)
      : undefined;
  // 旧路径已经完整保图且没有输出图内文字/表格时，不重排原本正确的页。
  if (
    previous &&
    !native &&
    figures.every(
      (f) =>
        leafBlocks(previous).some((b) => b.kind === 'image' && lineShareIn(f.box, b.box) >= 0.9) &&
        !leafBlocks(previous).some((b) => b.kind !== 'image' && lineShareIn(b.box, f.box) >= 0.2),
    )
  )
    return previous;
  // 原生整图：图里的字只有画进了剪图才归图。和剪图外的原生字（nativeText）重叠的识别行留作正文，
  // 不然一段只有一部分在图里的 PDF 文字（轴标签和图旁的说明连在一起）在图里、正文里都没有。
  const owns = (box: Box) =>
    native
      ? figures.some((f) => lineShareIn(box, f.box) > 0.8) &&
        !input.nativeText?.some((t) => lineShareIn(box, t) >= 0.5)
      : figureOwns(box, figures);
  const available = figures.length ? lines.filter((l) => !owns(l)) : lines;
  // 表单的点线（填写处）先从找线、组表用的图里抹掉，后面接进标签那一行（EU 样本 021）。
  const { dots, erased: working } = leaderDots(
    figureWorkingImage(image, figures, lineHeight),
    lines,
    lineHeight,
  );
  // 抹掉图形不能顺带改变图外网格的坐标系；倾斜仍按原图估计。
  const tableSkew = input.skew ?? (figures.length ? findLines(image).skew : undefined);
  const layout = figures.length
    ? sourceRegions.flatMap((r) => {
        const owned = figures.find((f) => f.region === r);
        if (owned) return [{ ...r, box: owned.box }];
        return r.kind !== 'image' && owns(r.box) ? [] : [r];
      })
    : sourceRegions;
  // 带线的表格（和转 Excel 一样）；放进表格的行不再参加分段。
  const placedIn = new Map<TableBlock, readonly OcrBox[]>();
  const choppedIn = new Map<TableBlock, number>();
  // 横竖线画满的网格（格子都是线分出来的），只有这样的才可能是留给人填的空白表格。
  const ruledGrids = new Set<TableBlock>();
  const blankForm = (t: TableBlock) => ruledGrids.has(t) && isBlankFormGrid(t);
  const tableInput = {
    image: working,
    lines: available,
    name: '',
    source: input.source,
    ...(tableSkew !== undefined ? { skew: tableSkew } : {}),
  };
  // 格子里的字按原图一排一行（D-333）：表单一格里的地址、日期各占一行，不接成一段（Word 里格子宽按原图，字号按比例）。
  // 没有线的表在下面去掉竖排、零星的字以后再认（D-471）。
  const tableOptions = (splitStacked: boolean): BuildOptions => ({
    ...options,
    textTables: false,
    // 电子版模板常用很浅的灰线画表（EU 样本 001、006），转 Word 时也找。
    lightRules: true,
    // 空白的商品栏：表头写在网格上面（EU 样本 001）。
    headerAbove: true,
    splitStacked,
    joinLines: (cell) => {
      const rows = rowsOf(cell);
      // 一格里是一段正文（框起来的提示，EU 样本 038）：接成一段，在 Word 里能重新折行。
      if (proseRows(rows)) return joinParagraph(rows.flatMap((r) => r.lines)).trim();
      return rows.map((r) => join(r.lines).trim()).join('\n');
    },
    onTable: (table, placed, { chopped, ruled }) => {
      placedIn.set(table, placed);
      choppedIn.set(table, chopped);
      if (ruled) ruledGrids.add(table);
    },
  });
  const sheet = buildTablePage(tableInput, tableOptions(false));
  const tol = lineHeight * 0.3;
  const inBox = (l: Box, box: Box) => {
    const cx = l.x + l.width / 2;
    const cy = l.y + l.height / 2;
    return (
      cx >= box.x - tol &&
      cx <= box.x + box.width + tol &&
      cy >= box.y - tol &&
      cy <= box.y + box.height + tol
    );
  };
  // 列线把很多行字从词中间切开的表（D-502）：网格认错了（字的笔画、折痕当成了列线），不当表，
  // 里面的字按行排（没有线的表照样能认出来）。
  const chopsMuch = (t: TableBlock) => {
    const chopped = choppedIn.get(t) ?? 0;
    return chopped >= CHOP_MIN && chopped >= CHOP_SHARE * (placedIn.get(t)?.length ?? 0);
  };
  // 图内的网格（表大半在图里）不要；图跨过表的好几格时（整页的版式框把图表框在里面，D-533）也不要。
  // 图在表的一格里（表单的证件照占着合并的一格）时表照样要。
  const outsideFigures = (b: TableBlock) =>
    !figures.some(
      (f) =>
        lineShareIn(b.box, f.box) >= 0.5 ||
        (lineShareIn(f.box, b.box) >= 0.2 &&
          !b.cells.some((c) => c.box && lineShareIn(f.box, c.box) >= 0.8)),
    );
  const sheetTables = sheet.blocks.filter((b): b is TableBlock => b.kind === 'table');
  const ruledCandidates = sheetTables.filter(
    (b) =>
      outsideFigures(b) &&
      (blankForm(b) || !isRuleGrid(b, lines.filter((l) => inBox(l, b.box)).length)) &&
      !chopsMuch(b),
  );
  const sparse = (t: TableBlock) => repairTables && !blankForm(t) && isSparseColumnLayout(t);
  const colWidthsOf = new Map(sheetTables.map((t) => [t, sheet.colWidths] as const));
  // 共用一个外框、上下叠着的几张表（EU 样本 004 的登记表）连成了一张：在列线换了的横线处分开（findTables 的
  // splitStacked），每张各自判断。原来要当表的，分开后能当表的部分当表（都不能时照旧整张）；原来被当成表单画线
  // 丢掉、或者太空被拆开的，只把其中的空白表格（isBlankFormGrid）留下当表，别的部分照旧排成文字。
  const stacked = buildTablePage(tableInput, tableOptions(true));
  const stackedTables = stacked.blocks.filter((b): b is TableBlock => b.kind === 'table');
  const ruled: TableBlock[] = [];
  const rejected: TableBlock[] = [];
  for (const t of sheetTables) {
    const kept = ruledCandidates.includes(t) && !sparse(t);
    const parts = stackedTables.filter((p) => lineShareIn(p.box, t.box) >= 0.9);
    const keep =
      parts.length < 2
        ? []
        : parts.filter(
            (p) =>
              outsideFigures(p) &&
              !chopsMuch(p) &&
              (blankForm(p) ||
                (kept &&
                  !isRuleGrid(p, lines.filter((l) => inBox(l, p.box)).length) &&
                  !sparse(p))),
          );
    if (keep.length) {
      for (const p of keep) colWidthsOf.set(p, stacked.colWidths);
      ruled.push(...keep);
    } else if (kept) ruled.push(t);
    else if (ruledCandidates.includes(t)) rejected.push(t);
  }
  const tables: DocTable[] = ruled.map((table) => {
    // 表里的字号按表里文字的行高（D-335），和正文分开算。
    const h = median(lines.filter((l) => inBox(l, table.box)).map((l) => l.height));
    return {
      kind: 'table',
      ...(rotated ? { direction: 'tbRl' as const } : {}),
      // 空着的列够写字（填写栏）时不并：只并双线之间、细缝那样的窄列。
      table: foldEmptyColumns({ ...table, col: 0 }, FILL_IN_LINES * lineHeight),
      colWidths: colWidthsOf.get(table)!.slice(table.col, table.col + table.cols),
      ...(h ? { size: Math.min(BODY_MAX, Math.max(FORM_MIN, fontSizeOf(h, fontWidthPx))) } : {}),
      box: table.box,
    };
  });
  // 按实际放进格子的行算（D-501）：表格边线外面、横跨列线的字没放进表，照样排成正文，不丢。
  const inTable = new Set(ruled.flatMap((t) => placedIn.get(t) ?? []));
  // 整页的倾斜（D-471）：照片拍歪、纸弯了时按斜线分行；拉平以后的行只用来分行、分段、排位置，
  // 量笔画、颜色、下划线还是看原图里原来的位置。
  const outside = available.filter((l) => !inTable.has(l) && !isStray(l, lines, lineHeight, image));
  // 竖排、旋转的字（页边的竖排标志、侧边的说明、条码旁的编号）：认出来的字多半是乱的，
  // 放进正文又会把字号撑得很大。整块剪成图片，原样保留。
  const upright = outside.filter((l) => !isVertical(l));
  // 表单的填写处（一串点、标签右边的横线）接进同一排的标签后面，或者自成一行（EU 样本 021、030）。
  const fills = findFillIns(
    working,
    dots,
    cachedLines(working, { ...(tableSkew !== undefined ? { skew: tableSkew } : {}), light: true }),
    upright,
    lineHeight,
    [...tables.map((t) => t.box), ...figures.map((f) => f.box)],
  );
  const { lines: filled, source: fillSource } = withFillIns(upright, fills, lineHeight);
  const synthetic = new Set(filled.filter((l) => !fillSource.has(l) && !upright.includes(l)));
  // 识别漏了的列表记号（「•」「-」）补在行的前面（EU 样本 026、027）。
  const { lines: kept, source: bulletSource } = withBullets(image, filled);
  const verticals = verticalBoxes(outside.filter(isVertical), cropLineHeight, {
    width: image.width,
    height: image.height,
  });
  const originalOf = new Map<OcrBox, OcrBox>();
  const leveled = levelLines(kept, lineHeight, image.width / 2);
  leveled.forEach((flat, k) => originalOf.set(flat, kept[k]!));
  // 原来的识别行（接了填写处的行换回识别出的那一行：量笔画、颜色、下划线，找它在哪张表里）。
  const orig = (l: OcrBox) => {
    const o = originalOf.get(l) ?? l;
    const b = bulletSource.get(o) ?? o;
    return fillSource.get(b) ?? b;
  };
  const releasedCells = new Map<OcrBox, TableCell>();
  for (const table of rejected) {
    for (const l of placedIn.get(table) ?? []) {
      const cell = table.cells.find((c) => c.box && lineShareIn(l, c.box) >= 0.5);
      if (cell) releasedCells.set(l, cell);
    }
  }
  // 没有线的表（D-471）：几排按三列以上对齐的，排成没有边框的表，不接成一句话。
  // 模型只提供范围，不能凭模型直接造表。范围内仍要有三列、多排同时对齐；
  // 已经被带线表接管的范围不重建，整页其余的字沿用原来的严格规则。
  const boundedLines = new Set<OcrBox>();
  const textTables = (repairTables ? (input.regions ?? []) : [])
    .filter((r) => r.kind === 'table' && !ruled.some((t) => lineShareIn(r.box, t.box) >= 0.5))
    .flatMap((r) => {
      const members = leveled.filter(
        (l) => !boundedLines.has(l) && lineShareIn(orig(l), r.box) >= 0.5,
      );
      const found = findTextTables(members, lineHeight, orig, true);
      for (const t of found) for (const l of t.lines) boundedLines.add(l);
      return found;
    });
  const repairBoxes = [...rejected.map((t) => t.box), ...textTables.map((t) => t.box)];
  const repairBaseline = repairBoxes.length
    ? buildPage(input, options, protectFigures, false, repairBarcodes)
    : undefined;
  textTables.push(
    ...findTextTables(
      leveled.filter((l) => !boundedLines.has(l)),
      lineHeight,
      orig,
    ),
  );
  const inTextTable = new Set(textTables.flatMap((t) => t.lines));
  for (const t of textTables) {
    const h = median(t.lines.map((l) => l.height));
    tables.push({
      kind: 'table',
      table: t.table,
      colWidths: t.colWidths,
      borderless: true,
      ...(h ? { size: Math.min(BODY_MAX, Math.max(FORM_MIN, fontSizeOf(h, fontWidthPx))) } : {}),
      box: t.box,
    });
  }
  // 条形码（D-471）：剪成图片，里面认出来的零星的字不要。
  // 带线的表里一段没字的地方（几条平行的列线）不是条形码（D-501）。
  const oldBarcodes = findBarcodes(working, kept, lineHeight);
  const barcodes = (
    repairBarcodes && !oldBarcodes.length
      ? findBarcodes(working, available, lineHeight, true)
      : oldBarcodes
  ).filter((b) => !tables.some((t) => !t.borderless && inBox(b, t.box)));
  if (repairBarcodes && protectFigures && repairTables && !oldBarcodes.length && barcodes.length) {
    const baseline = buildPage(input, options, protectFigures, repairTables, false);
    const pictures = leafBlocks(baseline).filter((b) => b.kind === 'image');
    const missing = barcodes.filter((b) => !pictures.some((p) => lineShareIn(b, p.box) >= 0.8));
    return missing.length ? insertWordFigures(baseline, missing) : baseline;
  }
  const inBarcode = (l: OcrBox) => {
    const cx = l.x + l.width / 2;
    const cy = l.y + l.height / 2;
    return barcodes.some(
      (b) => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height,
    );
  };
  const free = leveled.filter((l) => !inTextTable.has(l) && !inBarcode(orig(l)));
  const size = { width: image.width, height: image.height };
  const protectedImages = new Set(layout.filter((r) => figures.some((f) => r.box === f.box)));
  const regions = cleanRegions(layout, free, size, image, protectedImages).filter(
    // 和表格重叠一大半的区域（表格的标题行、表格里认成正文的）不要。
    (r) => {
      const overlaps = tables.map(({ box }) => {
        const ix = Math.min(box.x + box.width, r.box.x + r.box.width) - Math.max(box.x, r.box.x);
        const iy = Math.min(box.y + box.height, r.box.y + r.box.height) - Math.max(box.y, r.box.y);
        return ix > 0 && iy > 0 ? ix * iy : 0;
      });
      const half = 0.5 * r.box.width * r.box.height;
      // 图片区域几张表格合起来盖住一大半也算（表单里一格一张的小表，D-524）。
      const covered = r.kind === 'image' ? overlaps.reduce((a, b) => a + b, 0) : 0;
      return covered <= half && overlaps.every((o) => o <= half);
    },
  );
  // 接管是整页事务：后续去重或表格过滤若淘汰了任一整图，撤销 OCR/像素隔离，沿用原路径。
  // 非原生整图时 previous 就是同样参数的原路径结果，不再重建一遍。
  if (figures.some((f) => !regions.some((r) => r.kind === 'image' && r.box === f.box)))
    return !native && previous
      ? previous
      : buildPage(input, options, false, repairTables, repairBarcodes);
  const merged = mergeTextRegions(regions, lineHeight);
  regions.splice(0, regions.length, ...merged);
  const owner = assignLines(free, regions);
  // 行首单独的编号跟着同一排右边的条文进同一个区域（版面模型常把编号划进旁边的大区域，EU 样本 032）。
  for (const [i, l] of free.entries()) {
    if (!listStart(l.text) || stripMarker(l.text)) continue;
    const next = free
      .map((t, k) => ({ t, k }))
      .filter(
        ({ t }) =>
          t.x > l.x + l.width &&
          t.x - (l.x + l.width) <= MARKER_GAP * lineHeight &&
          Math.min(t.y + t.height, l.y + l.height) - Math.max(t.y, l.y) >=
            0.5 * Math.min(t.height, l.height),
      )
      .sort((a, b) => a.t.x - b.t.x)[0];
    if (next && regions[owner[next.k]!]?.kind !== 'image') owner[i] = owner[next.k]!;
  }
  if (native)
    for (const [i, l] of free.entries()) {
      const region = regions[owner[i] ?? -1];
      if (region?.kind === 'image' && figures.some((f) => f.box === region.box) && !owns(l))
        owner[i] = -1;
    }
  // 整页的标签列（W-4 的「Step 3:」一列）：版面模型把每一步切成很小的区域，要在整页上找。
  const labelSplit = splitLabelColumn(free, lineHeight);
  // 区域里的行；页码区域的字不要；图片区域里的少量字（标志、照片里的字）也不要。
  let groups: Group[] = [];
  // 版面模型也把条形码认成了图片区域时，只用区域那一张（不然同一个条形码出现两次）。
  const pictured = regions.filter((r) => r.kind === 'image').map((r) => r.box);
  const images: DocImage[] = [
    ...barcodes.filter((b) => !pictured.some((r) => lineShareIn(b, r) >= 0.8)),
    ...verticals,
  ].map((box) => ({ kind: 'image', box }));
  for (const [i, region] of regions.entries()) {
    const members = free.filter((_, k) => owner[k] === i);
    if (region.kind === 'image') {
      // 模型的框常常贴着图的边，剪下来留一点边。
      const pad = native?.includes(region.box) ? 0 : IMAGE_PAD * lineHeight;
      const x = Math.max(0, region.box.x - pad);
      const y = Math.max(0, region.box.y - pad);
      images.push({
        kind: 'image',
        box: {
          x,
          y,
          width: Math.min(size.width, region.box.x + region.box.width + pad) - x,
          height: Math.min(size.height, region.box.y + region.box.height + pad) - y,
        },
      });
      continue;
    }
    // 页码区域只丢读起来像页码的字（D-334）：版面模型也把「Art. 1」「n.a.」这类短字认成页码，丢了就是丢字。
    const kept =
      region.kind === 'pageNumber' ? members.filter((l) => !PAGE_NUMBER.test(l.text)) : members;
    if (!kept.length) continue;
    const title = region.kind === 'title' ? (region.label === 'doc_title' ? 1 : 2) : 0;
    // 一个很大的正文区域（整张小票被认成一块，D-471）里隔得远的几块照样分开：表格的行拿走以后，
    // 上面的店名和下面的号码不再连成一块、把整页的顺序打乱。
    const clusters = title ? [{ lines: kept }] : clustersOf(kept, lineHeight, labelSplit);
    for (const { lines: part, side } of clusters) {
      groups.push({
        lines: part,
        title,
        box: unionBox(part),
        region: region.box,
        ...(side ? { side } : {}),
      });
    }
  }
  const unowned = free.filter((_, k) => owner[k] === -1);
  for (const { lines: cluster, side } of clustersOf(unowned, lineHeight, labelSplit)) {
    groups.push({ lines: cluster, title: 0, box: unionBox(cluster), ...(side ? { side } : {}) });
  }
  // 表单：左边一列标签、右边一列值的两块按行配好（D-332）。
  groups = pairForms(groups, lineHeight);
  // 字号和笔画：先量出整页的正文字号和笔画粗细，再和它比。
  const strokes = new Map<OcrBox, number>();
  for (const l of free) strokes.set(l, synthetic.has(orig(l)) ? 0 : strokeRatio(image, orig(l)));
  const pageStroke = median([...strokes.values()].filter((v) => v > 0));
  const bodyHeight = median(
    groups.filter((g) => !g.title).flatMap((g) => g.lines.map((l) => l.height)),
  );
  const bodyH = bodyHeight || lineHeight;
  // 正文页还是表单页（D-335）：数长行（至少四成页宽）里的字占整页（含表格）的多少。
  const charsOf = (ls: readonly OcrBox[]) => ls.reduce((n, l) => n + l.text.length, 0);
  const prose =
    charsOf(lines.filter((l) => l.width >= PROSE_LINE * image.width)) >=
    PROSE_SHARE * charsOf(lines);
  // 只改图的归属，不让移除图内标签改变整页的默认字号。
  const bodySize =
    repairBaseline?.bodySize ??
    previous?.bodySize ??
    Math.min(
      BODY_MAX,
      Math.max(
        prose && lines.length < DENSE_LINES ? BODY_MIN : FORM_MIN,
        fontSizeOf(bodyH, fontWidthPx),
      ),
    );
  // 正文行高按纸宽换算、还没限制范围的字号。
  const rawBodySize = (bodyH * A4_WIDTH_PT * BOX_TO_FONT) / fontWidthPx;
  // 按字宽估字号（D-463）：正文行的估计够一致时才用。
  const bodyWidths = groups
    .filter((g) => !g.title)
    .flatMap((g) => g.lines.map(widthSizeOf))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const bodyW = median(bodyWidths);
  const widthTrusted =
    bodyWidths.length >= 3 &&
    bodyWidths[Math.floor(bodyWidths.length * 0.75)]! -
      bodyWidths[Math.floor(bodyWidths.length * 0.25)]! <=
      WIDTH_SPREAD * bodyW;
  // 整页文字的左右边（判断居中）。
  const textLeft = Math.min(...free.map((l) => l.x), ...tables.map((t) => t.box.x));
  const textRight = Math.max(
    ...free.map((l) => l.x + l.width),
    ...tables.map((t) => t.box.x + t.box.width),
  );
  // 先排好块（区域、表格、图片）的阅读顺序，块里的段落保持从上到下。
  const units: Unit[] = [
    ...tables.map((t) => ({ box: t.box, blocks: [t] as DocLeaf[] })),
    ...images.map((im) => ({ box: im.box, blocks: [im] as DocLeaf[] })),
  ];
  const alignment = new Map<DocParagraph, { h: number; rows: number }>();
  const styleOf = (paraLines: readonly OcrBox[], text: string, title: number) => {
    const h = median(paraLines.map((l) => l.height));
    const short = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < SHORT_TEXT && !title;
    const byHeight = h / bodyH;
    const w = widthTrusted ? median(paraLines.map(widthSizeOf).filter((v) => v > 0)) : 0;
    const byWidth =
      w > 0 && w / bodyW <= byHeight * WIDTH_CLAMP && w / bodyW >= byHeight / WIDTH_CLAMP
        ? w / bodyW
        : 0;
    let size = Math.min(48, Math.max(6, Math.round(bodySize * (byWidth || byHeight) * 2) / 2));
    const snap = byWidth ? WIDTH_SNAP : BODY_SNAP;
    if (short || Math.abs(size - bodySize) <= snap * bodySize) size = bodySize;
    // 已知纸张尺寸时，不能让正文的最小字号把大标题按比例再次放大。
    if (input.paper && !short && size >= HEADING_RATIO * bodySize) {
      // 全大写的行没有下伸的字母，框比同字号的行矮，按自己的框高会读小（16.3 磅读成 13 磅）：
      // 保留按字宽的比例，只去掉正文被最小字号抬高的那一截。
      if (/\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text))
        size = Math.min(size, Math.max(6, Math.round(((size * rawBodySize) / bodySize) * 2) / 2));
      else size = Math.min(size, fontSizeOf(h, fontWidthPx));
    }
    const bold =
      pageStroke > 0 && median(paraLines.map((l) => strokes.get(l) ?? 0)) > BOLD_RATIO * pageStroke;
    const color = textColor(image, orig(paraLines[0]!));
    // 下划线：每一行下面都有（D-463）。
    const underline = paraLines.every((l) => hasUnderline(image, orig(l)));
    const style: DocStyle = {
      ...(size !== bodySize ? { size } : {}),
      ...(bold ? { bold: true } : {}),
      ...(underline ? { underline: true } : {}),
      ...(color ? { color } : {}),
    };
    return { h, short, size, style };
  };
  // 密集页保留原来的分组，避免改动已有的跨页排版；只拼接推断字号、粗体等一致的碎片。
  const origin = new Map(groups.flatMap((group) => group.lines.map((l) => [l, group] as const)));
  if (lines.length < DENSE_LINES)
    groups = reconcileTextGroups(groups, free, lineHeight, (a, b) => {
      const left = styleOf(a, join(a).trim(), 0);
      const right = styleOf(b, join(b).trim(), 0);
      return left.size === right.size && JSON.stringify(left.style) === JSON.stringify(right.style);
    });
  for (const group of groups) {
    const blocks: DocLeaf[] = [];
    units.push({ box: group.box, blocks });
    if (group.pairs) {
      // 一行一对：标签、制表符、值（D-332）。
      const text = group.pairs
        .map(([label, value]) => `${join(label).trim()}\t${join(value).trim()}`)
        .join('\n');
      const left = Math.min(...group.pairs.flatMap(([label]) => label.map((l) => l.x)));
      const valueLeft = Math.min(...group.pairs.flatMap(([, value]) => value.map((l) => l.x)));
      blocks.push({
        kind: 'paragraph',
        text,
        ...styleOf(group.lines, text, 0).style,
        tab: Math.round(valueLeft - left),
        spaced: true,
        box: group.box,
      });
      continue;
    }
    const members = new Set(group.lines);
    const paragraphs = paragraphsOf(
      group.lines,
      free.filter((l) => !members.has(l)),
      textRight,
    ).flatMap((para) => {
      const chunks: (typeof para)[] = [];
      let previousCell: TableCell | undefined;
      let previousReleased = false;
      for (const row of para.rows) {
        const cells = new Set(row.lines.map((l) => releasedCells.get(orig(l))).filter(Boolean));
        const cell = cells.size === 1 ? [...cells][0] : undefined;
        const released = cells.size > 0;
        const previous = chunks.at(-1);
        // 误判网格的不同格子仍是独立信息行，不能因去掉边框就把两条议程接成一段；
        // 网格外的正文和网格里的第一行也不接（一边是原来的段落，一边是去掉边框后放出来的行）。
        if (
          previous &&
          released === previousReleased &&
          (!cell || !previousCell || cell === previousCell)
        )
          previous.rows.push(row);
        else chunks.push({ ...para, rows: [row], spaced: chunks.length ? false : para.spaced });
        previousCell = cell;
        previousReleased = released;
      }
      return chunks;
    });
    // 一块的第一段和前面的块之间原来就空着。
    if (paragraphs[0]) paragraphs[0].spaced = true;
    let list: DocList | null = null;
    const groupLeft = Math.min(...group.lines.map((l) => l.x));
    const groupWidth = Math.max(...group.lines.map((l) => l.x + l.width)) - groupLeft;
    for (const para of paragraphs) {
      const paraLines = para.rows.flatMap((r) => r.lines);
      const box = unionBox(paraLines);
      const repaired =
        new Set(paraLines.map((l) => origin.get(l))).size > 1 ||
        para.rows.some(
          (r, i) =>
            i > 0 && /\d[-–—]\s*$/.test(para.rows[i - 1]!.text) && /^\s*\d+\.?\s*$/.test(r.text),
        );
      const text = (repaired ? joinParagraph : join)(paraLines).trim();
      if (!text) continue;
      const { h, short, size, style } = styleOf(paraLines, text, group.title);
      // 去掉编号以后没有字的（「(3).」）不当列表项。
      // 从误判网格释放的文字保留原有题号/标号，不再凭这几行另造自动编号。
      const released = paraLines.some((l) =>
        rejected.some((t) => placedIn.get(t)?.includes(orig(l))),
      );
      if (para.list && !released && /[\p{L}\p{N}]/u.test(stripMarker(text))) {
        const marker = listMarker(para.rows[0]!.text);
        // 同一种编号接着上一个列表；换了写法另起一个。编号不是接着上一项的（议程 1–6 后面的「1. Délibérations」）
        // 也另起：列表只记第一项的编号，接进去就把后面的编号改成了 7、8（EU 样本 037）。
        if (
          list &&
          list.ordered === marker.ordered &&
          list.format === marker.format &&
          (!marker.ordered || marker.start === (list.start ?? 1) + list.items.length) &&
          !para.spaced
        ) {
          list.items.push(stripMarker(text));
          list.box = unionBox([list.box, box]);
          continue;
        }
        list = {
          kind: 'list',
          ...marker,
          items: [stripMarker(text)],
          ...style,
          ...(para.spaced ? { spaced: true } : {}),
          box,
        };
        if (!marker.format) delete list.format;
        if (marker.start === undefined) delete list.start;
        blocks.push(list);
        continue;
      }
      list = null;
      // 标题：模型说是标题（字不比正文小），或者字明显比正文大、不超过两行；对话和整句不算（D-330）。
      const big =
        !short &&
        size >= HEADING_RATIO * bodySize &&
        para.rows.length <= 2 &&
        looksLikeHeading(text);
      // 模型说是标题的区域里和正文一样大、不加粗的行（信头的地址、电话）是正文（D-463）。
      const titled = group.title > 0 && (size > bodySize || style.bold === true);
      const headingLike = (titled || big) && !notHeading(text);
      const heading: 0 | 1 | 2 = headingLike
        ? (titled && group.title === 1) || size >= HEADING1_RATIO * bodySize
          ? 1
          : 2
        : 0;
      const pageCenteredHeading =
        input.paper &&
        heading &&
        para.rows.length <= 2 &&
        Math.min(box.x, image.width - box.x - box.width) > PAGE_CENTER_MARGIN * image.width &&
        Math.abs(box.x - (image.width - box.x - box.width)) < PAGE_CENTER * image.width;
      // 几行左边对齐、右边参差的是左对齐的段落，哪怕整段左右空得差不多（EU 样本 036：满版的图把页边压没了）。
      const lefts = para.rows.map((r) => r.box.x);
      const rights = para.rows.map((r) => r.box.x + r.box.width);
      const raggedRight =
        para.rows.length >= 2 &&
        Math.max(...lefts) - Math.min(...lefts) <= 0.5 * h &&
        Math.max(...rights) - Math.min(...rights) > 1.5 * h;
      const boxAlign = alignmentIn(box, h, para.rows.length, textLeft, textRight, image.width);
      const align = pageCenteredHeading
        ? 'center'
        : boxAlign === 'center' && raggedRight
          ? undefined
          : boxAlign;
      const centered = align === 'center';
      const right = align === 'right';
      // 首行缩进：第一行的左边和其他行比，最多 4 个行高（D-330）。只有一行的段落不写首行缩进（D-463）：
      // docx 里每段的左缩进按它在原图里的左边写（书页里单独一行的对话也一样缩进），再加首行缩进就缩了两遍。
      const first = para.rows[0]!.box.x;
      const base = Math.min(...para.rows.slice(1).map((r) => r.box.x));
      const indent = Math.round(first - base);
      const indented =
        para.rows.length > 1 &&
        !heading &&
        !centered &&
        !right &&
        indent >= INDENT_MIN * h &&
        indent <= Math.min(INDENT_MAX * groupWidth, INDENT_LINES * h);
      const paragraph: DocParagraph = {
        kind: 'paragraph',
        text,
        ...(heading ? { heading } : {}),
        ...style,
        // 标题写明自己的字号（D-463）：不然按标题样式放大 1.3、1.6 倍，比原件大。
        ...(heading ? { size } : {}),
        ...(centered ? { align: 'center' as const } : right ? { align: 'right' as const } : {}),
        ...(para.spaced ? { spaced: true } : {}),
        ...(indented ? { indent } : {}),
        box,
      };
      blocks.push(paragraph);
      alignment.set(paragraph, { h, rows: para.rows.length });
    }
  }
  const page: DocPage = {
    source: input.source,
    width: image.width,
    height: image.height,
    ...(paper ? { paper } : {}),
    bodySize,
    blocks: arrangeUnits(units, lineHeight, {
      // 密集页沿用原来的局部并排行；长表格的标题 keepNext 会改变跨页行为，另行处理分页。
      dense: lines.length >= DENSE_LINES,
      onColumns: (row) => {
        let left = row.box.x;
        for (const cell of row.cells) {
          for (const block of cell.blocks) {
            if (block.kind !== 'paragraph') continue;
            const source = alignment.get(block);
            if (!source) continue;
            const align = alignmentIn(block.box, source.h, source.rows, left, left + cell.width);
            if (align) block.align = align;
            else delete block.align;
          }
          left += cell.width;
        }
      },
    }),
  };
  page.blocks = joinListContinuations(page.blocks, lineHeight);
  if (repairBaseline) {
    // 组表会改变整页字号、分组统计。只替换修复范围中的顶层块，范围外继续用原来的
    // 段落和并排行（包括它们的顺序和样式），避免修一张表挪动上方的日期、署名。
    // 按识别行归属换块：两边分段不同（修复范围上面的段落接进了网格的第一行）时，
    // 一行字所在的块两边一起换，直到两边换的块装着同一批行，不丢字也不重复。
    // 自成一行的填写处（一串点）也算一行，它在哪一块里按位置找。
    const every = [...lines, ...synthetic];
    const linesOf = (b: DocBlock) => {
      const boxes = leafBlocks({ blocks: [b] }).map((leaf) => leaf.box);
      return every.filter((l) => {
        const cx = l.x + l.width / 2,
          cy = l.y + l.height / 2;
        return boxes.some(
          (box) =>
            cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height,
        );
      });
    };
    const oldLines = new Map(repairBaseline.blocks.map((b) => [b, linesOf(b)] as const));
    const newLines = new Map(page.blocks.map((b) => [b, linesOf(b)] as const));
    const owned = new Set(
      every.filter((l) => repairBoxes.some((box) => lineShareIn(l, box) >= 0.5)),
    );
    const touches = (members: readonly OcrBox[]) => members.some((l) => owned.has(l));
    for (let size = -1; size !== owned.size;) {
      size = owned.size;
      for (const members of [...oldLines.values(), ...newLines.values()])
        if (touches(members)) for (const l of members) owned.add(l);
    }
    const merged = readingOrder(
      [
        ...repairBaseline.blocks.filter((b) => !touches(oldLines.get(b)!)),
        ...page.blocks.filter((b) => touches(newLines.get(b)!)),
      ],
      lineHeight * 0.3,
    );
    // 拼好以后的字必须和整页重建的字一样多：对不上（行和块对不准）就不修这一页。
    const words = (blocks: readonly DocBlock[]) =>
      leafBlocks({ blocks })
        .flatMap((b) =>
          b.kind === 'paragraph'
            ? [b.text]
            : b.kind === 'list'
              ? b.items
              : b.kind === 'table'
                ? b.table.cells.map((c) => c.text)
                : [],
        )
        .join(' ')
        // 填写处（「....」「____」）的长短跟着它接在哪一行，不算字。
        .replace(FILL_RUN, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
    if (words(merged) !== words(page.blocks)) return repairBaseline;
    page.blocks = merged;
  }
  if (previous) {
    const outside = (b: DocLeaf) => figures.every((f) => lineShareIn(b.box, f.box) === 0);
    const oldParagraphs = leafBlocks(previous).filter(
      (b): b is DocParagraph => b.kind === 'paragraph' && outside(b),
    );
    // 图内网格消失会改变整页共用的列线。图外同位置的表仍用原来的完整表示，
    // 不让纯粹的共享列坐标变化撤销已确认的整图；边界或内容发生变化仍交给下面的回退检查。
    const oldTables = new Map(
      leafBlocks(previous)
        .filter((b) => b.kind === 'table' && outside(b))
        .map((b) => [JSON.stringify(b.box), b]),
    );
    const restoreOutside = (b: DocLeaf): DocLeaf => {
      if (!outside(b)) return b;
      if (b.kind === 'table') return oldTables.get(JSON.stringify(b.box)) ?? b;
      if (b.kind === 'paragraph') {
        const matches = oldParagraphs.filter(
          (old) =>
            old.text === b.text &&
            Math.abs(old.box.x - b.box.x) <= 3 * lineHeight &&
            Math.abs(old.box.y - b.box.y) <= 3 * lineHeight &&
            Math.abs(old.box.width - b.box.width) <= 3 * lineHeight &&
            Math.abs(old.box.height - b.box.height) <= 3 * lineHeight,
        );
        if (matches.length === 1) return matches[0]!;
      }
      return b;
    };
    page.blocks = page.blocks.map((b) =>
      b.kind === 'row'
        ? { ...b, cells: b.cells.map((c) => ({ ...c, blocks: c.blocks.map(restoreOutside) })) }
        : restoreOutside(b),
    );
    const compact = (s: string) => s.replace(/\s/g, '');
    const editable = compact(
      leafBlocks(page)
        .flatMap((b) =>
          b.kind === 'paragraph'
            ? [b.text]
            : b.kind === 'list'
              ? b.items
              : b.kind === 'table'
                ? b.table.cells.map((c) => c.text)
                : [],
        )
        .join(' '),
    );
    const recovered = (b: DocLeaf) =>
      b.kind === 'table' &&
      outside(b) &&
      leafBlocks(previous).some(
        (old) =>
          old.kind === 'table' &&
          !outside(old) &&
          lineShareIn(b.box, old.box) >= 0.5 &&
          available
            .filter((l) => lineShareIn(l, old.box) >= 0.5)
            .every((l) => editable.includes(compact(l.text))),
      );
    const artifacts = (p: DocPage) =>
      leafBlocks(p)
        .filter(
          (b) =>
            (b.kind === 'table' || b.kind === 'image') &&
            outside(b) &&
            !(p === page && recovered(b)),
        )
        .map((b) => JSON.stringify(b))
        .sort()
        .join('\n');
    const styles = new Map(
      leafBlocks(previous)
        .filter((b) => b.kind === 'paragraph' && outside(b))
        .map((b) => [JSON.stringify(b.box), b]),
    );
    const styleOf = (b: DocLeaf) =>
      JSON.stringify(
        b.kind === 'paragraph'
          ? [b.size, b.bold, b.underline, b.color, b.heading, b.align, b.indent, b.tab]
          : [],
      );
    // 图外的网格、条码和字体也可能依赖整页统计；有任何连带变化就整页回退，不局部拼补。
    if (
      !native &&
      (previous.bodySize !== page.bodySize ||
        artifacts(previous) !== artifacts(page) ||
        leafBlocks(page).some((b) => {
          const old = styles.get(JSON.stringify(b.box));
          return old && b.kind === 'paragraph' && outside(b) && styleOf(old) !== styleOf(b);
        }) ||
        leafBlocks(previous).some((old) => {
          if (old.kind !== 'paragraph' || !outside(old)) return false;
          const matching = leafBlocks(page).filter(
            (b) => b.kind === 'paragraph' && b.text === old.text && outside(b),
          );
          return matching.length > 0 && matching.every((b) => styleOf(old) !== styleOf(b));
        }))
    )
      return previous;
  }
  // 页边距按字算：贴着纸边的图（满版的色带、页脚的花纹）会把边距压成 0，居中的段落就从纸边排到纸边（EU 样本 036）。
  // 页上只有图时按图算。
  const leaves = leafBlocks(page);
  const texts = leaves.filter((b) => b.kind !== 'image');
  const content = texts.length ? texts : leaves;
  if (content.length && paper) {
    // 横竖各用自己的比例（近似 A4 的照片按 A4 纸，两个比例只差一点点）。
    const k = paper.width / image.width;
    const ky = paper.height / image.height;
    const max = Math.min(56.7, paper.width / 10, paper.height / 10);
    const margin = (v: number) => Math.round(Math.max(0, Math.min(max, v)) * 100) / 100;
    page.margins = {
      left: margin(Math.min(...content.map((b) => b.box.x)) * k),
      right: margin((image.width - Math.max(...content.map((b) => b.box.x + b.box.width))) * k),
      top: margin(Math.min(...content.map((b) => b.box.y)) * ky),
      bottom: margin(paper.height - Math.max(...content.map((b) => b.box.y + b.box.height)) * ky),
    };
  }
  return page;
}

/**
 * 列表项的折行被版面模型分到了另一块（EU 样本 026、027）：紧接在列表下面、左边和项目的字对齐（比记号靠右）、
 * 不比列表宽、字号样式一样的一段，接回最后一项。
 */
export function joinListContinuations(blocks: readonly DocBlock[], lineHeight: number): DocBlock[] {
  const out: DocBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'row') {
      out.push({
        ...b,
        cells: b.cells.map((c) => ({
          ...c,
          blocks: joinListContinuations(c.blocks, lineHeight) as DocLeaf[],
        })),
      });
      continue;
    }
    const list = out.at(-1);
    if (
      list?.kind === 'list' &&
      !list.ordered &&
      !list.itemRuns &&
      b.kind === 'paragraph' &&
      !b.heading &&
      !b.runs &&
      !b.tab &&
      !b.align &&
      !listStart(b.text) &&
      b.box.y - (list.box.y + list.box.height) <= PARAGRAPH_GAP * lineHeight &&
      b.box.y >= list.box.y + list.box.height - 0.5 * lineHeight &&
      b.box.x - list.box.x >= 0.5 * lineHeight &&
      b.box.x - list.box.x <= 3 * lineHeight &&
      b.box.x + b.box.width <= list.box.x + list.box.width + lineHeight &&
      b.size === list.size &&
      b.bold === list.bold &&
      b.underline === list.underline &&
      b.color === list.color
    ) {
      const items = [...list.items];
      items[items.length - 1] = `${items.at(-1)!} ${b.text.replace(/\n/g, ' ')}`;
      out[out.length - 1] = {
        ...list,
        items,
        box: unionBox([list.box, b.box]),
      };
      continue;
    }
    out.push(b);
  }
  return out;
}

/**
 * 版面模型常把一段话从中间切开（行距和段距差不多的正文，每个「段」只有一两行）。上下紧挨着（间距不超过一个行高）、
 * 左边对齐、宽度重叠的两个正文区域并成一个，分段交给折行的判断（右边放不放得下下一个词）。
 * 左右两栏的区域左边不齐，不会并。
 */
export function mergeTextRegions<T extends { kind: string; box: Box }>(
  regions: readonly T[],
  lineHeight: number,
): T[] {
  const sorted = [...regions].sort((a, b) => a.box.y - b.box.y);
  const out: T[] = [];
  for (const r of sorted) {
    const idx = out.findIndex((o) => {
      if (o.kind !== 'text' || r.kind !== 'text') return false;
      const gap = r.box.y - (o.box.y + o.box.height);
      const ov =
        Math.min(o.box.x + o.box.width, r.box.x + r.box.width) - Math.max(o.box.x, r.box.x);
      return (
        gap <= lineHeight &&
        gap >= -0.5 * lineHeight &&
        Math.abs(o.box.x - r.box.x) <= lineHeight &&
        ov >= 0.8 * Math.min(o.box.width, r.box.width)
      );
    });
    if (idx >= 0) out[idx] = { ...out[idx]!, box: unionBox([out[idx]!.box, r.box]) };
    else out.push(r);
  }
  return out;
}

/** 一块字（区域或按位置聚成的块）；pairs 是配好的表单标签和值（D-332）。 */
interface Group {
  lines: OcrBox[];
  title: 0 | 1 | 2;
  box: Box;
  pairs?: [OcrBox[], OcrBox[]][];
  /** 分出来的标签列、内容列：标签列和内容列之间不再按冒号标签配对（两列的行不是一行对一行）。 */
  side?: 'label' | 'content';
  /** 原来的模型区域；没有时是未归属的行。仅构建时使用，不写入文件。 */
  region?: Box;
}

/**
 * 模型区域是归属提示，不是段落边界。只接回未归属的碎片或嵌套区域切开的折行；
 * 并列区域、标题、表单列和真正的段距/缩进仍保留，整行只会进入一个组。
 */
function reconcileTextGroups(
  groups: readonly Group[],
  lines: readonly OcrBox[],
  h: number,
  compatible: (a: readonly OcrBox[], b: readonly OcrBox[]) => boolean,
): Group[] {
  const contains = (a: Box, b: Box) =>
    // 模型框的边有几像素抖动；只容许不到三分之一行高的近似嵌套，不放宽行归属门槛。
    a.x <= b.x + 0.3 * h &&
    a.y <= b.y + 0.3 * h &&
    a.x + a.width >= b.x + b.width - 0.3 * h &&
    a.y + a.height >= b.y + b.height - 0.3 * h;
  let out = [...groups].sort((a, b) => a.box.y - b.box.y);
  for (;;) {
    let merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!,
          b = out[j]!;
        if (a.title || b.title || a.pairs || b.pairs || a.side || b.side) continue;
        if ((!a.region && !b.region) || a.region === b.region) continue;
        if (a.region && b.region && !contains(a.region, b.region) && !contains(b.region, a.region))
          continue;
        const gap = b.box.y - a.box.y - a.box.height;
        if (gap < -0.5 * h || gap > PARAGRAPH_GAP * h || Math.abs(a.box.x - b.box.x) > h) continue;
        const ar = rowsOf(a.lines),
          br = rowsOf(b.lines),
          last = ar.at(-1)!,
          first = br[0]!;
        const range = /\d[-–—]\s*$/.test(last.text) && /^\s*\d+\.?\s*$/.test(first.text);
        const members = new Set([...a.lines, ...b.lines]),
          peers = lines.filter((l) => !members.has(l));
        const tail = paragraphsOf(
          a.lines,
          lines.filter((l) => !a.lines.includes(l)),
        ).at(-1)!;
        const head = paragraphsOf(
          b.lines,
          lines.filter((l) => !b.lines.includes(l)),
        )[0]!;
        // 看真正相邻的两个段落片段，不能借同一区域里别的长段落当作元数据的折行证据。
        if (
          !range &&
          (tail.rows.length + head.rows.length < 3 || Math.max(a.box.width, b.box.width) < 8 * h)
        )
          continue;
        if (
          !compatible(
            tail.rows.flatMap((r) => r.lines),
            head.rows.flatMap((r) => r.lines),
          )
        )
          continue;
        // 同栏中间还有别的行，不能越过去接。
        if (
          peers.some(
            (l) =>
              l.y + l.height / 2 > last.box.y + last.box.height / 2 &&
              l.y + l.height / 2 < first.box.y + first.box.height / 2 &&
              l.x < Math.min(a.box.x + a.box.width, b.box.x + b.box.width) &&
              l.x + l.width > Math.max(a.box.x, b.box.x),
          )
        )
          continue;
        const paras = paragraphsOf([...a.lines, ...b.lines], peers);
        if (
          !paras.some(
            (p) =>
              p.rows.some((r) => r.lines.some((l) => a.lines.includes(l))) &&
              p.rows.some((r) => r.lines.some((l) => b.lines.includes(l))),
          )
        )
          continue;
        const region =
          a.region && b.region
            ? contains(a.region, b.region)
              ? a.region
              : b.region
            : (a.region ?? b.region);
        out.splice(j, 1);
        out[i] = {
          lines: [...a.lines, ...b.lines],
          title: 0,
          box: unionBox([a.box, b.box]),
          ...(region ? { region } : {}),
        };
        merged = true;
        break;
      }
    if (!merged) return out;
    out.sort((a, b) => a.box.y - b.box.y);
  }
}

/** 配对的几行里最高的行不超过最矮的这么多倍。 */
const PAIR_HEIGHT_RATIO = 1.6;

/** 标签：冒号结尾，或者在一列左对齐、不超过这么多个字的短文字（D-332）。 */
const LABEL_MAX = 30;
const LABEL_COLON = /[:：]\s*$/;

/**
 * 表单的标签和值（D-332）：一块（标签）的连续几行和右边另一块（值）的连续几行一行对一行（上下重叠、值在标签右边），
 * 标签都是冒号结尾，或者有两对以上、标签左对齐、不超过 30 个字、每行单独成段（不是折行的正文）时，
 * 这几行配成一块；两块里没配上的行（上面、下面）各自另成一块。
 */
function pairForms(groups: readonly Group[], lineHeight: number): Group[] {
  let out = [...groups];
  for (;;) {
    let next: Group[] | null = null;
    for (const left of out) {
      for (const right of out) {
        if (left === right || left.title || right.title || left.pairs || right.pairs) continue;
        const found = pairRows(left.lines, right.lines, lineHeight);
        // 标签列和内容列：只有每一行都配上了才配（W-4 的「Step 3:」只配上第一行，其余几行留着，把两列搅乱）。
        const partial = left.side === 'label' && right.side === 'content' && found?.length !== 1;
        if (found && !partial) {
          next = [...out.filter((g) => g !== left && g !== right), ...found];
          break;
        }
      }
      if (next) break;
    }
    if (!next) return out;
    out = next;
  }
}

function pairRows(
  labelLines: readonly OcrBox[],
  valueLines: readonly OcrBox[],
  lineHeight: number,
): Group[] | null {
  const labels = rowsOf(labelLines);
  const values = rowsOf(valueLines);
  const matchOf = (i: number) =>
    values.findIndex((v) => {
      const a = labels[i]!.box;
      const b = v.box;
      const ov = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return ov >= 0.5 * Math.min(a.height, b.height) && b.x > a.x + a.width;
    });
  // 第一段连续配上的行。
  const a = labels.findIndex((_, i) => matchOf(i) >= 0);
  if (a < 0) return null;
  const c = matchOf(a);
  let n = 1;
  while (a + n < labels.length && matchOf(a + n) === c + n) n++;
  const pairedLabels = labels.slice(a, a + n);
  // 行高差得很远的（标志、大标题和小字）不是一列标签：配成一对会按中位行高写字号，大标题缩成小字。
  const heightOf = (r: Row) => median(r.lines.map((l) => l.height));
  const heights = pairedLabels.map(heightOf);
  if (n >= 2 && Math.max(...heights) >= PAIR_HEIGHT_RATIO * Math.min(...heights)) return null;
  const colon = pairedLabels.every((r) => LABEL_COLON.test(r.text));
  const column =
    n >= 2 &&
    pairedLabels.every(
      (r) =>
        [...r.text].length <= LABEL_MAX && Math.abs(r.box.x - pairedLabels[0]!.box.x) <= lineHeight,
    ) &&
    paragraphsOf(pairedLabels.flatMap((r) => r.lines)).length === n;
  if (!colon && !column) return null;
  const pairs = pairedLabels.map((r, k): [OcrBox[], OcrBox[]] => [r.lines, values[c + k]!.lines]);
  const lines = pairs.flat(2);
  const group = (rows: Row[]): Group[] => {
    const ls = rows.flatMap((r) => r.lines);
    return ls.length ? [{ lines: ls, title: 0, box: unionBox(ls) }] : [];
  };
  return [
    { lines, title: 0, box: unionBox(lines), pairs },
    ...group(labels.slice(0, a)),
    ...group(labels.slice(a + n)),
    ...group(values.slice(0, c)),
    ...group(values.slice(c + n)),
  ];
}

/** 一块（区域、表格、图片）和它排好的块。 */
interface Unit {
  box: Box;
  blocks: DocLeaf[];
}

/** 上下范围重叠超过矮的那块高度的这么多，算并排（D-331）。 */
const SIDE_OVERLAP = 0.5;

/**
 * 块排成文件里的顺序（D-331）：上下范围明显重叠的块连成一带，一带一带从上到下；
 * 一带里左右能分成几栏（左右不重叠，并排的表格之间常常只隔一个行高）的写成并排行，每格里按阅读顺序；分不开的按阅读顺序排。
 */
/**
 * 上下紧挨着的两个并排行，列数一样、每一列的左边和宽度都差不多（双栏正文，左栏里有标题、小节，
 * 把右栏的段落切到了不同的带里），合并成一个并排行：每一栏的块接在一起，读起来是先读完左栏再读右栏。
 */
const COLUMN_SAME = 1.5;
const COLUMN_WIDTH_SAME = 0.2;
export function mergeColumnRows(blocks: readonly DocBlock[], lineHeight: number): DocBlock[] {
  const lefts = (row: DocRow) => row.cells.map((c) => Math.min(...c.blocks.map((b) => b.box.x)));
  const out: DocBlock[] = [];
  for (const block of blocks) {
    const prev = out.at(-1);
    if (
      prev?.kind === 'row' &&
      block.kind === 'row' &&
      prev.cells.length === block.cells.length &&
      prev.cells.length >= 2
    ) {
      const a = lefts(prev);
      const b = lefts(block);
      const same = prev.cells.every(
        (c, i) =>
          Math.abs(a[i]! - b[i]!) <= COLUMN_SAME * lineHeight &&
          Math.abs(c.width - block.cells[i]!.width) <= COLUMN_WIDTH_SAME * c.width,
      );
      if (same) {
        out[out.length - 1] = {
          kind: 'row',
          cells: prev.cells.map((c, i) => ({
            width: c.width,
            blocks: [...c.blocks, ...block.cells[i]!.blocks],
          })),
          box: unionBox([prev.box, block.box]),
        };
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

export function arrangeUnits(
  units: readonly Unit[],
  lineHeight: number,
  options: { dense?: boolean; onColumns?: (row: DocRow) => void } = {},
): DocBlock[] {
  const paragraphs = units
    .flatMap((u) => u.blocks)
    .filter((b) => b.kind === 'paragraph' || b.kind === 'image');
  const separated = units.flatMap((unit): Unit[] => {
    const parallel = unit.blocks.some((a) =>
      paragraphs.some((b) => {
        if (a === b || (a.kind !== 'paragraph' && a.kind !== 'image')) return false;
        const x =
          Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
        const y =
          Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
        return (
          x > 0 &&
          x < lineHeight * (a.kind === 'image' || b.kind === 'image' ? 3 : 1.5) &&
          y > SIDE_OVERLAP * Math.min(a.box.height, b.box.height)
        );
      }),
    );
    if (!parallel) return [unit];
    // 同一个模型文字区里也可能有并排的抬头/选项。框边轻微膨胀不能把整带串成一列。
    return unit.blocks.map((block) => ({
      box: {
        ...block.box,
        width: Math.max(1, block.box.width - lineHeight * (block.kind === 'image' ? 3.5 : 2)),
      },
      blocks: [block],
    }));
  });
  const bands = mergeColumnRows(arrangeBands(separated, lineHeight), lineHeight);
  return options.dense ? bands : retainProseColumns(bands, lineHeight, options.onColumns);
}

/**
 * 有长正文作证的双栏保持到跨栏内容或明显空隙为止，不因某一带缺少另一栏而退回整页宽。
 * 短标签、并排字段没有这个证据，仍走原来的局部并排行。只复用 DocRow，不增加文件格式。
 */
function retainProseColumns(
  blocks: readonly DocBlock[],
  h: number,
  onColumns?: (row: DocRow) => void,
): DocBlock[] {
  const extent = (cell: DocRowCell) => unionBox(cell.blocks.map((b) => b.box));
  const evidence = (row: DocRow) =>
    row.cells.length === 2 &&
    row.cells.every((c) => extent(c).width >= 6 * h) &&
    row.cells.some((c) =>
      c.blocks.some(
        (b) =>
          b.kind === 'paragraph' &&
          !b.heading &&
          !b.tab &&
          b.box.height >= 3 * h &&
          b.box.width >= 8 * h,
      ),
    );
  const out: DocBlock[] = [];
  for (let i = 0; i < blocks.length;) {
    const seed = blocks[i]!;
    if (seed.kind !== 'row' || !evidence(seed)) {
      out.push(seed);
      i++;
      continue;
    }
    const edges = seed.cells.map(extent);
    const columnOf = (b: DocLeaf) =>
      edges.findIndex(
        (e) => b.box.x >= e.x - COLUMN_SAME * h && b.box.x + b.box.width <= e.x + e.width + h * 0.3,
      );
    let end = i + 1;
    let rowBottom = seed.box.y + seed.box.height;
    let bottom = rowBottom;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j]!;
      if (b.box.y - bottom > 4 * h) break;
      if (b.kind === 'row') {
        if (
          b.cells.length !== 2 ||
          !b.cells.every((c, k) => Math.abs(extent(c).x - edges[k]!.x) <= COLUMN_SAME * h)
        )
          break;
        const next = b.cells.map(extent);
        // 两栏之间必须仍有空白；真正横跨中缝的块结束这一段双栏。
        if (next[0]!.x + next[0]!.width + h * 0.3 > next[1]!.x) break;
        next.forEach((e, k) => {
          edges[k] = unionBox([edges[k]!, e]);
        });
        rowBottom = Math.max(rowBottom, b.box.y + b.box.height);
        end = j + 1;
      } else {
        if (columnOf(b) < 0) break;
        // 孤立尾行只能紧跟已经证实的栏；更远的页脚不靠连续短行无限延长作用域。
        if (b.box.y <= rowBottom + COLUMN_SAME * h) end = j + 1;
      }
      bottom = Math.max(bottom, b.box.y + b.box.height);
    }
    const leading: DocBlock[] = [];
    let top = seed.box.y;
    while (out.length) {
      const before = out.at(-1)!;
      if (before.kind === 'row') {
        if (
          top - before.box.y - before.box.height > COLUMN_SAME * h ||
          before.cells.length !== 2 ||
          !before.cells.every((c, k) => Math.abs(extent(c).x - edges[k]!.x) <= COLUMN_SAME * h)
        )
          break;
        const previous = before.cells.map(extent);
        if (previous[0]!.x + previous[0]!.width + h * 0.3 > previous[1]!.x) break;
        previous.forEach((e, k) => {
          edges[k] = unionBox([edges[k]!, e]);
        });
        top = before.box.y;
      } else if (columnOf(before) < 0 || before.box.y + before.box.height < top - 0.5 * h) break;
      leading.unshift(before);
      out.pop();
    }
    const cells: DocRowCell[] = edges.map((e, k) => ({
      width: (edges[k + 1]?.x ?? e.x + e.width) - e.x,
      blocks: [],
    }));
    for (const b of [...leading, ...blocks.slice(i, end)]) {
      if (b.kind === 'row') b.cells.forEach((c, k) => cells[k]!.blocks.push(...c.blocks));
      else cells[columnOf(b)]!.blocks.push(b);
    }
    const row: DocRow = {
      kind: 'row',
      cells,
      box: unionBox([...leading, ...blocks.slice(i, end)].map((b) => b.box)),
    };
    onColumns?.(row);
    out.push(row);
    i = end;
  }
  return out;
}

function arrangeBands(units: readonly Unit[], lineHeight: number): DocBlock[] {
  const parent = units.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!.box;
      const b = units[j]!.box;
      const ov = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ov > SIDE_OVERLAP * Math.min(a.height, b.height)) parent[root(i)] = root(j);
    }
  }
  const bands = new Map<number, Unit[]>();
  units.forEach((u, i) => {
    const r = root(i);
    bands.set(r, [...(bands.get(r) ?? []), u]);
  });
  const top = (band: Unit[]) => Math.min(...band.map((u) => u.box.y));
  const gap = lineHeight * 0.3;
  return [...bands.values()]
    .sort((a, b) => top(a) - top(b))
    .flatMap((band): DocBlock[] => {
      const cols = columnsOf(band, gap);
      if (cols.length < 2) return readingOrder(band, gap).flatMap((u) => u.blocks);
      const lefts = cols.map((c) => Math.min(...c.map((u) => u.box.x)));
      const right = Math.max(...cols.at(-1)!.map((u) => u.box.x + u.box.width));
      return [
        {
          kind: 'row',
          cells: cols.map((c, k) => ({
            width: (lefts[k + 1] ?? right) - lefts[k]!,
            blocks: readingOrder(c, gap).flatMap((u) => u.blocks),
          })),
          box: unionBox(band.map((u) => u.box)),
        },
      ];
    });
}

/** 按左右范围分栏：和前一栏左右不重叠、隔开至少 gap 的另起一栏。 */
function columnsOf(units: readonly Unit[], gap: number): Unit[][] {
  const cols: Unit[][] = [];
  let end = -Infinity;
  for (const u of [...units].sort((a, b) => a.box.x - b.box.x)) {
    const right = u.box.x + u.box.width;
    // 整图的留边可能占掉白色栏缝；两张仍不重叠的图不能因此变成上下排列。
    const pictureGap =
      u.blocks.length > 0 &&
      u.blocks.every((b) => b.kind === 'image') &&
      cols.at(-1)?.every((old) => old.blocks.every((b) => b.kind === 'image'))
        ? 0
        : gap;
    if (cols.length && u.box.x < end + pictureGap) {
      cols.at(-1)!.push(u);
      end = Math.max(end, right);
    } else {
      cols.push([u]);
      end = right;
    }
  }
  return cols;
}
