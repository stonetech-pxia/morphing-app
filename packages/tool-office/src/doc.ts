import { buildTablePage, type BuildOptions } from './build';
import { assignLines, cleanRegions, readingOrder, type LayoutRegion } from './layout';
import type { Box, OcrBox, RgbaImage, TableBlock, TableCell } from './types';

// 扫描件转 Word（D-310）：一页的识别结果 + 版面分析的区域 → DocDoc（编辑页改它，docx 每次从它重新生成）。
// 带线的表格和转 Excel 用同一套找线、组表（D-272）；其余的字按区域（没有区域的按位置聚成块）分段，
// 段落按 D-268 的规则接行；字号看行高，粗体看笔画粗细，颜色看文字像素。删除线、文字下面的划线不画（只取字）。

/** 段落的样式：字号（磅）、粗体、颜色（RRGGBB）、对齐；没有的用文档默认的。 */
export interface DocStyle {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface DocParagraph extends DocStyle {
  kind: 'paragraph';
  text: string;
  /** 标题级别（1 或 2）；没有时是正文。 */
  heading?: 1 | 2;
  /** 和上一段之间原来空着（分段的空隙），写成段前间距。 */
  spaced?: boolean;
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
  spaced?: boolean;
  box: Box;
}

/** 带线的表格：和转 Excel 的 TableBlock 一样（col 从 0 起），colWidths 是这张表每列的宽（原图像素）。 */
export interface DocTable {
  kind: 'table';
  table: TableBlock;
  colWidths: number[];
  box: Box;
}

/** 剪下来的图片：src 是剪好的 JPG（本次运行的文件）；还没剪时没有。 */
export interface DocImage {
  kind: 'image';
  box: Box;
  src?: string;
}

export type DocBlock = DocParagraph | DocList | DocTable | DocImage;

export interface DocPage {
  /** 截原图核对用的那张图的 uri。 */
  source: string;
  /** box 的坐标系（和找线、认字那张图一样）。 */
  width: number;
  height: number;
  /** 这一页正文的字号（磅）：和它差不多的段落不单独写字号。 */
  bodySize: number;
  /** 按阅读顺序。 */
  blocks: DocBlock[];
}

export interface DocDoc {
  version: 1;
  pages: DocPage[];
}

export interface DocPageInput {
  /** 找线、量粗细和颜色用的图（增强后的那张，没有增强过就是原图）。 */
  image: RgbaImage;
  /** 识别出的行，坐标和 image 一样。 */
  lines: readonly OcrBox[];
  /** 版面分析的区域（模型没装时没有：只按位置分块，不认标题和图片）。 */
  regions?: readonly LayoutRegion[];
  source: string;
  /** 已知的倾斜角（度），同 buildTablePage。 */
  skew?: number;
}

/** A4 的宽（磅）：整页宽度按 A4 换算字号。 */
export const A4_WIDTH_PT = 595;
/** 识别框的高度 → 字号：PP-OCR 的框比字高出一截（word-exp 的信件里 10 磅的正文框高约 11 磅）。 */
const BOX_TO_FONT = 0.9;
/**
 * 正文字号限制在这个范围：照片里的纸不一定是 A4（书页窄，按 A4 换算字会偏大），
 * 其他段落按和正文行高的比例算字号。
 */
const BODY_MIN = 9;
const BODY_MAX = 12;
/** 字号和正文差不到这么多（比例）就当正文（中文的引号让识别框高出一截，差 20% 很常见）。 */
const BODY_SNAP = 0.25;
/** 字母、数字少于这么多个的段落（「孩子。”」）行高不准，不单独算字号、不当标题（模型说是标题的除外）。 */
const SHORT_TEXT = 6;
/** 比正文大这么多倍、不超过两行的段落是标题；大这么多倍是一级标题。 */
const HEADING_RATIO = 1.3;
const HEADING1_RATIO = 1.8;
/** 笔画比这一页的中位数粗这么多倍算粗体。 */
const BOLD_RATIO = 1.35;
/** 文字像素的色度（最大、最小通道之差）超过这么多算有颜色。 */
const COLOR_CHROMA = 60;
/** 段落：上下间距不超过 1.2 倍行高的算同一段（和 D-268 一样）。 */
const PARAGRAPH_GAP = 1.2;
/** 列表项的开头（和 D-268 的 layoutOcrLines 一样）。 */
const LIST_ITEM = /^\s*(?:[•·\-–—*▪●○◦■□]|\d{1,3}[.、)）]|[(（]\d{1,3}[)）]|[①-⑳])/;
const ORDERED = /^\s*(?:(\d{1,3})([.、)）])|[(（](\d{1,3})[)）]|([①-⑳]))\s*/;
const BULLET = /^\s*[•·\-–—*▪●○◦■□]\s*/;

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

/** 一排里隔得很远（超过 3 个行高）的几块分开（左右两栏、信头左右两边）。 */
function splitRow(row: Row, lineHeight: number): Row[] {
  const out: OcrBox[][] = [[row.lines[0]!]];
  for (const line of row.lines.slice(1)) {
    const prev = out.at(-1)!.at(-1)!;
    if (line.x - (prev.x + prev.width) > 3 * lineHeight) out.push([line]);
    else out.at(-1)!.push(line);
  }
  return out.map((g) => ({
    lines: g,
    box: unionBox(g),
    text: g.map((l) => l.text.trim()).join(' '),
  }));
}

/** 一块里的行分成段落：空隙大、是列表项、上一行没写到右边（不是折行）、或者有缩进的地方开始新的一段。 */
export function paragraphsOf(
  lines: readonly OcrBox[],
): { rows: Row[]; spaced: boolean; list: boolean }[] {
  const rows = rowsOf(lines);
  if (!rows.length) return [];
  const typical = median(rows.map((r) => median(r.lines.map((l) => l.height)))) || 1;
  const left = Math.min(...rows.map((r) => r.box.x));
  const right = Math.max(...rows.map((r) => r.box.x + r.box.width));
  const out: { rows: Row[]; spaced: boolean; list: boolean }[] = [];
  for (const [i, row] of rows.entries()) {
    const prev = rows[i - 1];
    const list = LIST_ITEM.test(row.text);
    const gap = prev ? row.box.y - (prev.box.y + prev.box.height) : 0;
    const h = median(row.lines.map((l) => l.height));
    const prevH = prev ? median(prev.lines.map((l) => l.height)) : h;
    const wrapped =
      prev !== undefined &&
      gap <= PARAGRAPH_GAP * typical &&
      prev.box.x + prev.box.width >= right - 1.2 * typical &&
      prev.box.width >= 0.6 * (right - left) &&
      row.box.x <= left + typical &&
      !list &&
      Math.abs(h - prevH) <= 0.3 * Math.max(h, prevH);
    // 列表项下面接着的、有缩进的行（悬挂缩进）是这一项的折行。
    const last = out.at(-1);
    const hanging =
      last?.list === true &&
      prev !== undefined &&
      gap <= PARAGRAPH_GAP * typical &&
      !list &&
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
 * 整列都空着的格子并进左边的格子（D-310）：转 Excel 时整页共用一套列线（D-272），一张表会多出只有别的表才有的列，
 * 在 Word 里就是一列空格子。只并没有跨行的格子；列线不变（格子用 colSpan 跨过去）。
 */
export function foldEmptyColumns(table: TableBlock): TableBlock {
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

/** 一页的 DocPage。 */
export function buildDocPage(input: DocPageInput, options: BuildOptions = {}): DocPage {
  const join = options.joinLines ?? defaultJoin;
  const { image } = input;
  const lines = input.lines.filter((l) => l.text.trim());
  const lineHeight = median(lines.map((l) => l.height)) || 20;
  // 带线的表格（和转 Excel 一样）；表格里的行不再参加分段。
  const sheet = buildTablePage(
    {
      image,
      lines,
      name: '',
      source: input.source,
      ...(input.skew !== undefined ? { skew: input.skew } : {}),
    },
    options,
  );
  const tol = lineHeight * 0.3;
  const tables: DocTable[] = sheet.blocks
    .filter((b): b is TableBlock => b.kind === 'table')
    .map((table) => ({
      kind: 'table',
      table: foldEmptyColumns({ ...table, col: 0 }),
      colWidths: sheet.colWidths.slice(table.col, table.col + table.cols),
      box: table.box,
    }));
  const inTable = (l: Box) =>
    tables.some(({ box }) => {
      const cx = l.x + l.width / 2;
      const cy = l.y + l.height / 2;
      return (
        cx >= box.x - tol &&
        cx <= box.x + box.width + tol &&
        cy >= box.y - tol &&
        cy <= box.y + box.height + tol
      );
    });
  const free = lines.filter((l) => !inTable(l));
  const size = { width: image.width, height: image.height };
  const regions = cleanRegions(input.regions ?? [], free, size).filter(
    // 和表格重叠一大半的区域（表格的标题行、表格里认成正文的）不要。
    (r) =>
      !tables.some(({ box }) => {
        const ix = Math.min(box.x + box.width, r.box.x + r.box.width) - Math.max(box.x, r.box.x);
        const iy = Math.min(box.y + box.height, r.box.y + r.box.height) - Math.max(box.y, r.box.y);
        return ix > 0 && iy > 0 && ix * iy > 0.5 * r.box.width * r.box.height;
      }),
  );
  const owner = assignLines(free, regions);
  // 区域里的行；页码区域的字不要；图片区域里的少量字（标志、照片里的字）也不要。
  const groups: { lines: OcrBox[]; title: 0 | 1 | 2; box: Box }[] = [];
  const images: DocImage[] = [];
  for (const [i, region] of regions.entries()) {
    const members = free.filter((_, k) => owner[k] === i);
    if (region.kind === 'image') {
      images.push({ kind: 'image', box: region.box });
      continue;
    }
    if (region.kind === 'pageNumber' || !members.length) continue;
    groups.push({
      lines: members,
      title: region.kind === 'title' ? (region.label === 'doc_title' ? 1 : 2) : 0,
      box: unionBox(members),
    });
  }
  for (const cluster of clusterLines(
    free.filter((_, k) => owner[k] === -1),
    lineHeight,
  )) {
    groups.push({ lines: cluster, title: 0, box: unionBox(cluster) });
  }
  // 字号和笔画：先量出整页的正文字号和笔画粗细，再和它比。
  const strokes = new Map<OcrBox, number>();
  for (const l of free) strokes.set(l, strokeRatio(image, l));
  const pageStroke = median([...strokes.values()].filter((v) => v > 0));
  const bodyHeight = median(
    groups.filter((g) => !g.title).flatMap((g) => g.lines.map((l) => l.height)),
  );
  const bodyH = bodyHeight || lineHeight;
  const bodySize = Math.min(BODY_MAX, Math.max(BODY_MIN, fontSizeOf(bodyH, image.width)));
  // 整页文字的左右边（判断居中）。
  const textLeft = Math.min(...free.map((l) => l.x), ...tables.map((t) => t.box.x));
  const textRight = Math.max(
    ...free.map((l) => l.x + l.width),
    ...tables.map((t) => t.box.x + t.box.width),
  );
  // 先排好块（区域、表格、图片）的阅读顺序，块里的段落保持从上到下。
  const units: { box: Box; blocks: DocBlock[] }[] = [
    ...tables.map((t) => ({ box: t.box, blocks: [t] as DocBlock[] })),
    ...images.map((im) => ({ box: im.box, blocks: [im] as DocBlock[] })),
  ];
  for (const group of groups) {
    const blocks: DocBlock[] = [];
    units.push({ box: group.box, blocks });
    const paragraphs = paragraphsOf(group.lines);
    // 一块的第一段和前面的块之间原来就空着。
    if (paragraphs[0]) paragraphs[0].spaced = true;
    let list: DocList | null = null;
    for (const para of paragraphs) {
      const paraLines = para.rows.flatMap((r) => r.lines);
      const box = unionBox(paraLines);
      const h = median(paraLines.map((l) => l.height));
      const text = join(paraLines).trim();
      if (!text) continue;
      const short = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < SHORT_TEXT && !group.title;
      let size = Math.min(48, Math.max(6, Math.round(((bodySize * h) / bodyH) * 2) / 2));
      if (short || Math.abs(size - bodySize) <= BODY_SNAP * bodySize) size = bodySize;
      const bold =
        pageStroke > 0 &&
        median(paraLines.map((l) => strokes.get(l) ?? 0)) > BOLD_RATIO * pageStroke;
      const color = textColor(image, paraLines[0]!);
      const style: DocStyle = {
        ...(size !== bodySize ? { size } : {}),
        ...(bold ? { bold: true } : {}),
        ...(color ? { color } : {}),
      };
      // 去掉编号以后没有字的（「(3).」）不当列表项。
      if (para.list && /[\p{L}\p{N}]/u.test(stripMarker(text))) {
        const marker = listMarker(para.rows[0]!.text);
        // 同一种编号接着上一个列表；换了写法另起一个。
        if (
          list &&
          list.ordered === marker.ordered &&
          list.format === marker.format &&
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
      // 标题：模型说是标题（字不比正文小），或者字明显比正文大、不超过两行。
      const big = !short && size >= HEADING_RATIO * bodySize && para.rows.length <= 2;
      const titled = group.title > 0 && size >= bodySize;
      const heading: 0 | 1 | 2 =
        titled || big
          ? (titled && group.title === 1) || size >= HEADING1_RATIO * bodySize
            ? 1
            : 2
          : 0;
      const leftGap = box.x - textLeft;
      const rightGap = textRight - (box.x + box.width);
      const centered =
        leftGap > 2 * h &&
        rightGap > 2 * h &&
        Math.abs(leftGap - rightGap) < 0.2 * (leftGap + rightGap);
      const right = !centered && leftGap > 6 * h && rightGap < 1.5 * h && para.rows.length <= 2;
      blocks.push({
        kind: 'paragraph',
        text,
        ...(heading ? { heading } : {}),
        ...style,
        ...(centered ? { align: 'center' as const } : right ? { align: 'right' as const } : {}),
        ...(para.spaced ? { spaced: true } : {}),
        box,
      });
    }
  }
  return {
    source: input.source,
    width: image.width,
    height: image.height,
    bodySize,
    blocks: readingOrder(units, lineHeight * 0.3).flatMap((u) => u.blocks),
  };
}
