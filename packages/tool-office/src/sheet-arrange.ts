import {
  BOLD_RATIO,
  IMAGE_PAD,
  arrangeUnits,
  clusterLines,
  fontSizeOf,
  mergeTextRegions,
  type DocLeaf,
} from './doc';
import { cleanRegions, lineShareIn, type LayoutRegion } from './layout';
import type { Box, OcrBox, RgbaImage } from './types';

// 转 Excel 时表外的东西怎么排（D-520–D-522）：图片区域、左右两栏的文字、字号和粗体。
// 版面分析、分栏都用转 Word 的那一套（D-328、D-331），只是排到工作表的列上而不是 docx 的并排行里。
// 都在拉正后的坐标里算，build.ts 再按整页共用的列定每一块占哪几列。

/** 正文字号的范围（磅）：和转 Word 一样，照片里的纸不一定是 A4，按 A4 换算会偏大。 */
const BODY_MIN = 6;
const BODY_MAX = 12;
/** 标题等字号和正文差不到这么多（比例）就当正文；字母数字少于 SHORT_TEXT 个的行高不准，也当正文。 */
const BODY_SNAP = 0.25;
const SHORT_TEXT = 6;
/** 一张表的字号和正文差不到这么多（磅）就当正文，免得半磅的估计误差让同一页的表字号不一样。 */
const TABLE_SNAP = 0.5;
const TEXT_MAX = 48;

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

/** 单独一块字的左边离整页内容的左边至少这么多比例的页宽，才算靠右栏。 */
const RIGHT_COLUMN = 0.25;

/** 上下两排字的行高相差这么多倍以上，不是同一块（大标题和下面一行小字挨得很近）。 */
const SIZE_BREAK = 1.3;

/** 一块里的行按竖直方向的重叠分成一排一排，行高和上一排差得多的地方分开。 */
function splitBySize(lines: OcrBox[]): OcrBox[][] {
  const sorted = [...lines].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows: OcrBox[][] = [];
  for (const line of sorted) {
    const first = rows.at(-1)?.[0];
    const overlap = first
      ? Math.min(first.y + first.height, line.y + line.height) - Math.max(first.y, line.y)
      : 0;
    if (first && overlap >= 0.5 * Math.min(first.height, line.height)) rows.at(-1)!.push(line);
    else rows.push([line]);
  }
  const heightOf = (row: OcrBox[]) => median(row.map((l) => l.height));
  const parts: OcrBox[][] = [];
  for (const [i, row] of rows.entries()) {
    const ratio = i
      ? Math.max(heightOf(row), heightOf(rows[i - 1]!)) /
        Math.min(heightOf(row), heightOf(rows[i - 1]!))
      : 1;
    if (i && ratio < SIZE_BREAK) parts.at(-1)!.push(...row);
    else parts.push([...row]);
  }
  return parts;
}

/** 整页的正文字号（磅）：按整页文字的典型行高。 */
export const bodySizeOf = (lineHeight: number, pageWidth: number) =>
  Math.min(BODY_MAX, Math.max(BODY_MIN, fontSizeOf(lineHeight, pageWidth)));

/** 一张表的字号（磅）：按表里文字的行高，和正文差不多就是正文。 */
export function tableSizeOf(lineHeight: number, pageWidth: number, bodySize: number): number {
  const size = bodySizeOf(lineHeight, pageWidth);
  return Math.abs(size - bodySize) <= TABLE_SNAP ? bodySize : size;
}

/**
 * 版面分析的区域整理（原图坐标）：图片区域外面留一点边（和转 Word 一样剪下来时不贴着字），
 * 其余的（标题、正文、页码）用来把字分块（两栏的页，栏和栏之间的空隙窄时靠区域分开）。
 * 区域的整理（里面字太多的、占了半页的不当图片；模型的表格不用）也是转 Word 的 cleanRegions。
 */
export function layoutRegions(
  regions: readonly LayoutRegion[],
  lines: readonly OcrBox[],
  image: RgbaImage,
  lineHeight: number,
): { figures: Box[]; text: LayoutRegion[] } {
  const size = { width: image.width, height: image.height };
  const pad = IMAGE_PAD * lineHeight;
  // D-530 的弱证据恢复先限定在 Word；新增框会重分工作表列线，不能顺带改变 Excel 的列宽和分页。
  const cleaned = cleanRegions(
    regions.filter((r) => !r.wordOnly),
    lines,
    size,
    image,
  );
  return {
    figures: cleaned
      .filter((r) => r.kind === 'image')
      .map((r) => {
        const x = Math.max(0, r.box.x - pad);
        const y = Math.max(0, r.box.y - pad);
        return {
          x,
          y,
          width: Math.min(size.width, r.box.x + r.box.width + pad) - x,
          height: Math.min(size.height, r.box.y + r.box.height + pad) - y,
        };
      }),
    text: cleaned.filter((r) => r.kind !== 'image'),
  };
}

/** 一块要排的东西：文字或图片；range 是它占的左右范围（拉正后的像素），没有时横跨整页。 */
export type Draft = (
  | { kind: 'text'; text: string; lines: OcrBox[]; size?: number; bold?: boolean }
  | { kind: 'image' }
  /** 已经找好的表（第几张）：只用来排并排的带，表自己的列已经有了。 */
  | { kind: 'table'; index: number }
) & { box: Box; band?: number; range?: [number, number] };

export interface RestPlan {
  /** 从上到下；一组是并排的一带（几块各占一栏）或单独的一块。 */
  groups: { y: number; drafts: Draft[] }[];
}

export interface RestInput {
  /** 表外的行（拉正后的坐标）。 */
  lines: readonly OcrBox[];
  /** 图片区域（拉正后的坐标）。 */
  figures: readonly Box[];
  /** 版面分析的文字区域（标题、正文）：同一个区域里的字才连成块；没有区域或字不在任何区域里的按位置聚块。 */
  regions: readonly LayoutRegion[];
  /** 找好的几张表的位置（拉正后的坐标）：和文字、图片一起排并排的带（表在左栏、字在右栏）。 */
  tables: readonly Box[];
  lineHeight: number;
  /** 估字号用的行高：照片拍歪时长行的框比字高，要扣掉倾斜多出来的一截；baseHeight 是整页文字的典型值。 */
  sizeHeight: (line: OcrBox) => number;
  baseHeight: number;
  bodySize: number;
  /** 同一段的几行接成文字。 */
  join: (lines: readonly OcrBox[]) => string;
  /** 一行字的笔画粗细和行高的比；整页的典型值。 */
  strokeOf: (line: OcrBox) => number;
  pageStroke: number;
}

/**
 * 表外的字按位置聚成块（转 Word 的 clusterLines：上下挨着、左右有重叠的连在一起，一排里隔得远的左右分开），
 * 加上图片，用转 Word 的并排规则（arrangeUnits，D-331）排：上下范围重叠、左右分开的块是并排的一带，
 * 每一栏有自己的左右范围，一栏里的块接在一起。每块字估字号（按行高和正文的比）和粗体（笔画比整页粗得多）。
 */
export function planRest(input: RestInput): RestPlan {
  const { lineHeight, bodySize, pageStroke } = input;
  const drafts: Draft[] = [];
  // 字分块：区域里的字（标题整块一个）各自聚块，不在任何区域里的按位置聚块（和转 Word 一样，D-328）。
  // 和表格重叠一大半的区域（表格的标题行、表格里认成正文的）不要。
  const overTable = (r: LayoutRegion) =>
    input.tables.some((box) => {
      const ix = Math.min(box.x + box.width, r.box.x + r.box.width) - Math.max(box.x, r.box.x);
      const iy = Math.min(box.y + box.height, r.box.y + r.box.height) - Math.max(box.y, r.box.y);
      return ix > 0 && iy > 0 && ix * iy > 0.5 * r.box.width * r.box.height;
    });
  const regions = mergeTextRegions(
    input.regions.filter((r) => !overTable(r)),
    lineHeight,
  );
  // 每行归包住它（至少一半在里面）的最小的区域：模型常给出几个互相套着的正文区域（一个盖住两三段的大区域，
  // 加上每段自己的小区域），按包住的比例选会让一段的最后一行落进大区域，一段被切成两块。
  const owner = input.lines.map((line) => {
    let best = -1;
    for (const [i, r] of regions.entries()) {
      if (lineShareIn(line, r.box) < 0.5) continue;
      if (
        best < 0 ||
        r.box.width * r.box.height < regions[best]!.box.width * regions[best]!.box.height
      )
        best = i;
    }
    return best;
  });
  const clusters: OcrBox[][] = [];
  for (const [i, region] of regions.entries()) {
    const members = input.lines.filter((_, k) => owner[k] === i);
    if (!members.length) continue;
    if (region.kind === 'title') clusters.push(members);
    else clusters.push(...clusterLines(members, lineHeight));
  }
  const unowned = input.lines.filter((_, k) => owner[k] === -1);
  if (unowned.length) clusters.push(...clusterLines(unowned, lineHeight));
  for (const lines of clusters.flatMap(splitBySize)) {
    const text = input.join(lines).trim();
    if (!text) continue;
    const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const raw = (median(lines.map(input.sizeHeight)) / input.baseHeight) * bodySize;
    let size = Math.min(TEXT_MAX, Math.max(BODY_MIN, Math.round(raw * 2) / 2));
    if (letters < SHORT_TEXT || Math.abs(size - bodySize) <= BODY_SNAP * bodySize) size = bodySize;
    const bold = pageStroke > 0 && median(lines.map(input.strokeOf)) > BOLD_RATIO * pageStroke;
    drafts.push({
      kind: 'text',
      text,
      lines,
      ...(size !== bodySize ? { size } : {}),
      ...(bold ? { bold: true } : {}),
      box: unionBox(lines),
    });
  }
  for (const box of input.figures) drafts.push({ kind: 'image', box });
  for (const [index, box] of input.tables.entries()) drafts.push({ kind: 'table', index, box });
  // 排成并排的带：每一块用一个占位的图片块带着它的下标，排好以后换回来。
  const units = drafts.map((d, i) => ({
    box: d.box,
    blocks: [{ kind: 'image', box: d.box, src: String(i) }] as DocLeaf[],
  }));
  const indexOf = (leaf: DocLeaf) => Number((leaf as { src: string }).src);
  const own = (d: Draft): [number, number] => [d.box.x, d.box.x + d.box.width];
  const groups: RestPlan['groups'] = [];
  let band = 0;
  // 整页内容的左右边（靠右栏的字、表在左边的字用）。
  const pageLeft = Math.min(...drafts.map((d) => d.box.x));
  const pageRight = Math.max(...drafts.map((d) => d.box.x + d.box.width));
  const pageWidth = pageRight - pageLeft;
  for (const block of arrangeUnits(units, lineHeight)) {
    if (block.kind !== 'row') {
      const d = drafts[indexOf(block)]!;
      if (d.kind === 'image') d.range = own(d);
      // 单独一块、不在并排的带里、靠右栏的字（一栏的开头落在另一栏的段落上方）：从它的左边起排到整页的右边，
      // 不横跨整页（居中的标题左右空白差不多，不算）。
      else if (
        d.kind === 'text' &&
        d.box.x - pageLeft >= RIGHT_COLUMN * pageWidth &&
        d.box.x - pageLeft >= 1.3 * (pageRight - (d.box.x + d.box.width))
      )
        d.range = [d.box.x, pageRight];
      groups.push({ y: d.box.y, drafts: [d] });
      continue;
    }
    const id = band++;
    const group: Draft[] = [];
    for (const cell of block.cells) {
      const at = cell.blocks.map(indexOf);
      const left = Math.min(...at.map((i) => drafts[i]!.box.x));
      for (const i of at) {
        const d = drafts[i]!;
        d.band = id;
        // 文字占这一栏的整个宽度（到下一栏的左边为止）；图片只占它自己的位置。
        if (d.kind === 'image') d.range = own(d);
        else if (d.kind === 'text') d.range = [left, left + cell.width];
        group.push(d);
      }
    }
    groups.push({ y: block.box.y, drafts: group });
  }
  return { groups };
}
