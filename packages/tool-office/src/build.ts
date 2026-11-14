import {
  addSpan,
  coveredLength,
  findLines,
  findTables,
  type PageLines,
  type RuleLine,
  type TableLines,
} from './lines';
import { BOLD_RATIO, CHOP_MIN, CHOP_SHARE, isRuleGrid, strokeRatio } from './doc';
import { lineShareIn, type LayoutRegion } from './layout';
import { bodySizeOf, layoutRegions, planRest, tableSizeOf } from './sheet-arrange';
import { findTextTables, levelLines } from './text-table';
import type {
  Block,
  Box,
  CellAlign,
  OcrBox,
  RgbaImage,
  TableBlock,
  TableCell,
  TablePage,
} from './types';

// 一页：线 → 表格区域 → 网格和合并单元格 → 文字行放进格子 → 表外的文字分段（D-272）。
// 都在拉正后的坐标里算（x' = x + y·t，y' = y − x·t），存进 TablePage 前换回原图的坐标（截图核对用）。

export interface BuildOptions {
  /** 同一格（或同一段）里的几行接成文字；App 里用 D-268 的 layoutOcrLines 加上按语言整理。 */
  joinLines?: (lines: readonly OcrBox[]) => string;
  /**
   * 每张表放进格子的识别行（传进来的对象）：转 Word 时没放进表的行照样排成正文（D-501）。
   * chopped 是被列线从一个词中间切开的行数（D-502）：真的表里字不跨列线，跨了多半是网格认错了。
   */
  onTable?: (
    table: TableBlock,
    lines: readonly OcrBox[],
    check: { chopped: number; ruled: boolean },
  ) => void;
  /**
   * 带线的表以外也认没有线的表（D-506：和转 Word 同一套规则，D-471、D-502、D-503），默认认。
   * 转 Word 自己在去掉竖排、零星的字以后再认，不在这里认。
   */
  textTables?: boolean;
  /**
   * 转 Excel（D-520–D-522）：用版面分析的区域（图片区域剪成图片块、不当表格的网格里的字排成文字）、
   * 表外的字按转 Word 的并排规则分栏、估每块字和每张表的字号和粗体。不给时表外的字照旧每段一行（转 Word 自己排）。
   */
  arrange?: boolean;
  /** 很浅的表格线也找（findLines 的 light）：只给转 Word，转 Excel 不变。 */
  lightRules?: boolean;
  /** 共用外框、上下叠着的几张表分开（findTables 的 splitStacked）：只给转 Word。 */
  splitStacked?: boolean;
  /** 横竖线画满、里面一个字也没有的网格，紧挨在上面的一排字是它的表头（转 Word 用，withHeaderAbove）。 */
  headerAbove?: boolean;
}

export interface PageInput {
  /** 找线用的图（增强后的那张，没有增强过就是原图）。 */
  image: RgbaImage;
  /** 识别出的行，坐标和 image 一样。 */
  lines: readonly OcrBox[];
  name: string;
  source: string;
  /** 版面分析的区域（arrange 时用；没有时只按位置排）。 */
  regions?: readonly LayoutRegion[];
  /** 已知的倾斜角（度）；增强过的图已经拉正，给 0。不给时估一个。 */
  skew?: number;
}

/** 网格的一条边界：lined 是有线的（没有线的是按文字空隙或文字行分出来的，两边不合并）。 */
export interface Boundary {
  pos: number;
  lined: boolean;
}

export interface Grid {
  xs: Boundary[];
  ys: Boundary[];
  /** 每个位置属于哪个格子（r * cols + c → cells 的下标）。 */
  owner: Int32Array;
  cells: TableCell[];
}

/** 一个边上有线的长度不到一半就合并两边的格子。 */
const MERGE_COVERAGE = 0.5;
/** 至少这么多比例的文字行都在同一处空着，就是一条列分隔（只有横线的表）。 */
const GAP_ROW_SHARE = 0.6;
/** 列分隔的空隙至少是行高的这么多倍（比词和词之间的空格宽）。 */
const GAP_MIN_HEIGHTS = 0.6;
/** 竖线盖住、没有横线的一段至少有这么多排字才按排分行。 */
const SPLIT_MIN_ROWS = 3;
/** 一张表最多这么多格；更多的（方格纸）不当成表。 */
const MAX_TABLE_CELLS = 5000;
/** 段落：上下间距不超过 1.2 倍行高的算同一段（和 D-268 一样）。 */
const PARAGRAPH_GAP = 1.2;

/** 各张表的列线相差不到长边的这么多（1%）就对齐成整页共用的同一条列线（比单张表里去重的 0.8% 稍宽）。 */
const SHARED_COLUMN_SHARE = 0.01;
/** 没有表时，表外的文字从 A 列合并到 D 列。 */
const TEXT_ONLY_COLS = 4;
/** 对齐：文字两边的空白加起来不到一个行高时（字差不多占满格子）看不出对齐。 */
const ALIGN_MIN_SLACK = 1;
/** 左右空白之差占两边空白之和的比例超过这么多算靠一边，不到算居中。 */
const ALIGN_SIDE_SHARE = 0.35;

/** 认成线的粗体字：横线在一行字的框里（上下都离框边至少 20% 行高），大半截在框的左右范围里。 */
const STROKE_INSIDE = 0.2;
const STROKE_SHARE = 0.7;
/** 线和线算连在一起（和 lines.ts 的 TOUCH_SHARE 一样）：端点离另一条线不超过长边的 0.5%。 */
const STROKE_TOUCH_SHARE = 0.005;
const STROKE_MIN_JOINED = 3;
const STROKE_RULE_SHARE = 0.3;
/** 切口两边的字距比平常大这么多倍就是两段字之间的空隙，不是一个词的中间。 */
const CHOP_GAP = 1.8;
/** 没有线的表最外两条列线往外最多挪这么多个行高去对上别的表的列线（D-506，和 D-471 列间距的上限一样）。 */
const SNAP_REACH = 3;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1]! : 0;
};

const centerX = (b: Box) => b.x + b.width / 2;
const centerY = (b: Box) => b.y + b.height / 2;

/** 按竖直方向的重叠分成一排一排（和 D-268 的规则一样），每排从左到右。 */
function textRows<T extends Box>(lines: readonly T[]): T[][] {
  const sorted = [...lines].sort((a, b) => centerY(a) - centerY(b));
  const rows: T[][] = [];
  for (const line of sorted) {
    const first = rows.at(-1)?.[0];
    if (first) {
      const overlap =
        Math.min(first.y + first.height, line.y + line.height) - Math.max(first.y, line.y);
      if (overlap >= 0.5 * Math.min(first.height, line.height)) {
        rows.at(-1)!.push(line);
        continue;
      }
    }
    rows.push([line]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** 默认的接法：同一排用空格接，排和排之间换行。 */
/**
 * 识别把一条虚线、双线读成的字：至少两个「=」「_」「-」这类记号，其余的字（夹进来的杂字）不超过一半；
 * 只有一两个「-」的不算（格子里表示「无」的短横）。
 */
export function isRuleText(text: string): boolean {
  const chars = [...text.replace(/\s/g, '')];
  const marks = chars.filter((c) => /[=_~\-–—]/.test(c));
  return (
    marks.length >= 2 &&
    marks.length * 2 >= chars.length &&
    (marks.some((c) => /[=_~]/.test(c)) || marks.length >= 3)
  );
}

function defaultJoin(lines: readonly OcrBox[]): string {
  return textRows(lines)
    .map((row) => row.map((l) => l.text.trim()).join(' '))
    .join('\n');
}

/** 去掉挨得很近的重复位置（双线、同一条线的两段）。 */
function dedupe(values: readonly number[], tol: number): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length && v - out.at(-1)! <= tol) out[out.length - 1] = (out.at(-1)! + v) / 2;
    else out.push(v);
  }
  return out;
}

/** 有线的长度占 [a, b] 的比例（端点各缩进一点，交叉处不算）。 */
function coverage(lines: readonly RuleLine[], pos: number, a: number, b: number, tol: number) {
  const spans: [number, number][] = [];
  for (const l of lines) {
    if (Math.abs(l.pos - pos) > tol) continue;
    for (const [s, e] of l.spans) addSpan(spans, s, e, 0);
  }
  const shrink = Math.min(tol, (b - a) * 0.25);
  const length = b - a - 2 * shrink;
  return length > 0 ? coveredLength(spans, a + shrink, b - shrink) / length : 0;
}

/** 只有横线的表：所有文字行在 x 方向的空白缝，至少 60% 的行都空着的地方是列分隔。 */
function gapColumns(lines: readonly OcrBox[], left: number, right: number, lineHeight: number) {
  const rows = textRows(lines);
  if (rows.length < 2) return [];
  const from = Math.max(left, Math.floor(Math.min(...lines.map((l) => l.x))));
  const to = Math.min(right, Math.ceil(Math.max(...lines.map((l) => l.x + l.width))));
  if (to - from < 2) return [];
  const empty = new Int32Array(to - from);
  for (const row of rows) {
    const used = new Uint8Array(to - from);
    for (const l of row) {
      const a = Math.max(0, Math.floor(l.x) - from);
      const b = Math.min(to - from, Math.ceil(l.x + l.width) - from);
      used.fill(1, a, Math.max(a, b));
    }
    for (let x = 0; x < used.length; x++) if (!used[x]) empty[x]!++;
  }
  const need = Math.ceil(rows.length * GAP_ROW_SHARE);
  const minWidth = lineHeight * GAP_MIN_HEIGHTS;
  const out: number[] = [];
  let start = -1;
  for (let x = 0; x <= empty.length; x++) {
    const open = x < empty.length && empty[x]! >= need;
    if (open && start < 0) start = x;
    if (!open && start >= 0) {
      if (x - start >= minWidth) out.push(from + (start + x) / 2);
      start = -1;
    }
  }
  return out;
}

const indexOf = (bounds: readonly Boundary[], v: number) => {
  let i = 0;
  while (i < bounds.length - 2 && v >= bounds[i + 1]!.pos) i++;
  return i;
};

/** 框里的字至少这么多排、至少这么多排是一整行宽的字（一个识别框占框宽的这么多），才算一段正文。 */
const PROSE_MIN_ROWS = 2;
const PROSE_WIDE_SHARE = 2 / 3;
const PROSE_LINE_WIDTH = 0.6;

/** 框里的字是正文：一排就是一个很宽的识别框（几栏、键值对的一排是隔开的几块）。 */
function isProse(lines: readonly OcrBox[], width: number): boolean {
  const rows = textRows(lines);
  if (rows.length < PROSE_MIN_ROWS) return false;
  const wide = rows.filter((row) => row.length === 1 && row[0]!.width >= PROSE_LINE_WIDTH * width);
  return wide.length >= PROSE_WIDE_SHARE * rows.length;
}

/** 一张表的网格：横线定行，竖线定列（没有中间的竖线时按文字空隙分列），边上线不够的两格合并。 */
function buildGrid(
  table: TableLines,
  lines: readonly OcrBox[],
  tol: number,
  lineHeight: number,
): Grid | null {
  const { hs, vs, box } = table;
  const left = box.x;
  const right = box.x + box.width;
  // 行。
  let ys: Boundary[] = dedupe(
    hs.map((h) => h.pos),
    tol,
  ).map((pos) => ({ pos, lined: true }));
  if (vs.length) {
    // 按左右边框的竖线往上下伸（D-501）：中间的列线伸出去的一截常常是接上了表格外面字的笔画
    // （工资单底下紧挨着的一行页脚），会把表外的字圈进来。没有边框的竖线时看所有的竖线。
    const sides = vs.filter((v) => v.pos <= left + tol || v.pos >= right - tol);
    const ends = sides.length ? sides : vs;
    const top = Math.min(...ends.map((v) => v.from));
    const bottom = Math.max(...ends.map((v) => v.to));
    if (top < ys[0]!.pos - tol) ys.unshift({ pos: top, lined: false });
    if (bottom > ys.at(-1)!.pos + tol) ys.push({ pos: bottom, lined: false });
  }
  // 列。
  let xs: Boundary[] = dedupe(
    vs.map((v) => v.pos),
    tol,
  ).map((pos) => ({ pos, lined: true }));
  if (!xs.length || xs[0]!.pos > left + tol) xs.unshift({ pos: left, lined: false });
  if (xs.at(-1)!.pos < right - tol) xs.push({ pos: right, lined: false });
  const inner = vs.filter((v) => v.pos > xs[0]!.pos + tol && v.pos < xs.at(-1)!.pos - tol);
  // 没有竖线盖住的行（只有横线的表，或者表头下面没有竖线的部分）：两边不合并，一格里有几排字就分成几行。
  const bandCovered = (a: number, b: number) =>
    inner.some((v) => Math.min(v.to, b) - Math.max(v.from, a) >= 0.5 * (b - a));
  const covered = ys.slice(0, -1).map((y, r) => bandCovered(y.pos, ys[r + 1]!.pos));
  const firstCovered = covered.indexOf(true);
  const lastCovered = covered.lastIndexOf(true);
  // 四边有框、里面没有列线、字是一段一段的正文（Cerfa 表格上的提示框，EU 样本 038）：是框起来的一段话，
  // 不按排分成一行一格（一行字一格，改一个字整段就乱了），也不按字的空隙分列。
  const framedProse =
    !inner.length && xs[0]!.lined && xs.at(-1)!.lined && isProse(lines, right - left);
  const isOpen = (r: number) =>
    !framedProse && (firstCovered < 0 || r < firstCovered || r > lastCovered);
  const split: Boundary[] = [ys[0]!];
  const open: boolean[] = [];
  // 按排分出来的行，竖线够不够长按分之前的那一段算（弯的线、断线在一小行里容易不够一半）。
  const parentBand: ([number, number] | null)[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    const a = ys[r]!.pos;
    const b = ys[r + 1]!.pos;
    const inBand = lines.filter((l) => centerY(l) >= a && centerY(l) < b);
    // 上下的横线在这一列没画（左边一大格跨好几排：电费单黄底的「QUOTA FISSA」，EU 样本 057）：
    // 这一列的字属于跨排的大格，不按它分排。
    const spans = (c: number) =>
      [ys[r]!, ys[r + 1]!].some(
        (y) => y.lined && coverage(hs, y.pos, xs[c]!.pos, xs[c + 1]!.pos, tol) < MERGE_COVERAGE,
      );
    const rows = textRows(
      isOpen(r) ? inBand : inBand.filter((l) => !spans(indexOf(xs, centerX(l)))),
    );
    // 上下两排字中间的位置。
    const between = (i: number) =>
      (Math.max(...rows[i - 1]!.map((l) => l.y + l.height)) +
        Math.min(...rows[i]!.map((l) => l.y))) /
      2;
    let bySplit = false;
    if (isOpen(r)) {
      for (let i = 1; i < rows.length; i++) {
        split.push({ pos: between(i), lined: false });
        open.push(true);
        parentBand.push(null);
      }
    } else if (rows.length >= SPLIT_MIN_ROWS) {
      // 竖线盖住、中间没有横线的一段（工资单、账单的表身）：一半以上有字的列里都有几排字，
      // 而且至少一半的排在两列以上有字（一排一项），就按排分行。
      // 只有个别列里有几排（一格里折行的字）、只有两排（折成两行的表头）、
      // 多数排只有一列有字（表单一格里的几行地址，别的列空着，D-333）不分。
      const rowsByCol = new Map<number, Set<number>>();
      let wide = 0;
      for (const [i, row] of rows.entries()) {
        const cols = new Set<number>();
        for (const l of row) {
          const c = indexOf(xs, centerX(l));
          cols.add(c);
          if (!rowsByCol.has(c)) rowsByCol.set(c, new Set());
          rowsByCol.get(c)!.add(i);
        }
        if (cols.size >= 2) wide++;
      }
      const multi = [...rowsByCol.values()].filter((g) => g.size >= 2).length;
      // 有字的列按整段的字数（跨排的大格那一列也算，只是不按它分排）。
      const used = new Set(inBand.map((l) => indexOf(xs, centerX(l)))).size;
      if (multi >= 2 && multi > used / 2 && wide >= rows.length / 2) {
        for (let i = 1; i < rows.length; i++) {
          split.push({ pos: between(i), lined: false });
          open.push(false);
          parentBand.push([a, b]);
        }
        bySplit = true;
      }
    }
    split.push(ys[r + 1]!);
    open.push(isOpen(r));
    parentBand.push(bySplit ? [a, b] : null);
  }
  ys = split;
  if (!inner.length && !framedProse) {
    const gaps = gapColumns(lines, left, right, lineHeight);
    xs = [xs[0]!, ...gaps.map((pos) => ({ pos, lined: false })), xs.at(-1)!];
  }
  const rows = ys.length - 1;
  const cols = xs.length - 1;
  if (rows < 1 || cols < 1 || rows * cols > MAX_TABLE_CELLS) return null;
  const straddled = (r: number, x: number) =>
    lines.some(
      (l) =>
        centerY(l) >= ys[r]!.pos &&
        centerY(l) < ys[r + 1]!.pos &&
        x > l.x + l.height * 0.5 &&
        x < l.x + l.width - l.height * 0.5,
    );
  // 合并：并查集，每个位置一个。
  const parent = Array.from({ length: rows * cols }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 右边的边（竖线）。
      // 没有竖线盖住的行只在一行字横跨这条边时合并（表头的大标题），否则按上下的竖线分列。
      if (c + 1 < cols && xs[c + 1]!.lined && (!open[r] || straddled(r, xs[c + 1]!.pos))) {
        const [top, bottom] = parentBand[r] ?? [ys[r]!.pos, ys[r + 1]!.pos];
        const cov = coverage(vs, xs[c + 1]!.pos, top, bottom, tol);
        if (cov < MERGE_COVERAGE) parent[find(r * cols + c)] = find(r * cols + c + 1);
      }
      // 下边的边（横线）。
      if (r + 1 < rows && ys[r + 1]!.lined) {
        const cov = coverage(hs, ys[r + 1]!.pos, xs[c]!.pos, xs[c + 1]!.pos, tol);
        if (cov < MERGE_COVERAGE) parent[find(r * cols + c)] = find((r + 1) * cols + c);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows * cols; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  const owner = new Int32Array(rows * cols);
  const cells: TableCell[] = [];
  const add = (r0: number, c0: number, r1: number, c1: number) => {
    const index = cells.length;
    cells.push({
      row: r0,
      col: c0,
      rowSpan: r1 - r0 + 1,
      colSpan: c1 - c0 + 1,
      text: '',
      box: {
        x: xs[c0]!.pos,
        y: ys[r0]!.pos,
        width: xs[c1 + 1]!.pos - xs[c0]!.pos,
        height: ys[r1 + 1]!.pos - ys[r0]!.pos,
      },
    });
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) owner[r * cols + c] = index;
  };
  for (const members of [...groups.values()].sort((a, b) => a[0]! - b[0]!)) {
    const rs = members.map((i) => Math.floor(i / cols));
    const cs = members.map((i) => i % cols);
    const r0 = Math.min(...rs);
    const r1 = Math.max(...rs);
    const c0 = Math.min(...cs);
    const c1 = Math.max(...cs);
    // 合并出来不是长方形的：退回不合并。
    if ((r1 - r0 + 1) * (c1 - c0 + 1) === members.length) add(r0, c0, r1, c1);
    else
      for (const i of members) add(Math.floor(i / cols), i % cols, Math.floor(i / cols), i % cols);
  }
  const order = cells
    .map((cell, i) => ({ cell, i }))
    .sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col);
  const remap = new Int32Array(cells.length);
  order.forEach(({ i }, k) => (remap[i] = k));
  for (let p = 0; p < owner.length; p++) owner[p] = remap[owner[p]!]!;
  return { xs, ys, owner, cells: order.map((o) => o.cell) };
}

/** 表格最上面至少这么多行、每行最多一格有字，才算表单的框（不是表的标题）。 */
const FORM_MIN_ROWS = 4;
/** 去掉那几行以后，剩下的至少要有这么多行有两格以上有字，才是真的表。 */
const FORM_BODY_ROWS = 2;

/**
 * 表单的框和下面的表格连成了一张网格（D-520，F4）：最上面连着好几行，每一行最多一格有字
 * （一个框里标签一行、值一行，框和框之间空着），下面才是每行好几格都有字的表格。上面那几行不是表的行
 * （表的标题只有一两行），去掉它们，里面的字照表外的文字排；没有这样的几行（或者去掉以后剩下的不像表）时 null。
 * 合并格子跨着切口的位置不能切。
 */
function dropLeadingRows(
  grid: Grid,
  lines: readonly OcrBox[],
): { grid: Grid; lines: OcrBox[] } | null {
  const rows = grid.ys.length - 1;
  const cols = grid.xs.length - 1;
  const filled = grid.cells.map(() => false);
  for (const line of lines) for (const { cell } of piecesOf(line, grid)) filled[cell] = true;
  const perRow = new Array<number>(rows).fill(0);
  grid.cells.forEach((c, i) => {
    if (filled[i]) perRow[c.row]!++;
  });
  let cut = 0;
  for (let r = 1; r < rows && perRow[r - 1]! <= 1; r++) {
    if (!grid.cells.some((c) => c.row < r && c.row + c.rowSpan > r)) cut = r;
  }
  if (cut < FORM_MIN_ROWS || rows - cut < 2) return null;
  if (perRow.slice(cut).filter((n) => n >= 2).length < FORM_BODY_ROWS) return null;
  const y = grid.ys[cut]!.pos;
  const kept = lines.filter((l) => centerY(l) >= y);
  const cells = grid.cells.filter((c) => c.row >= cut).map((c) => ({ ...c, row: c.row - cut }));
  // 位置到格子的对应：行往上移，格子的下标按新的顺序。
  const index = new Map<TableCell, number>(cells.map((c, i) => [c, i]));
  const old = grid.cells.filter((c) => c.row >= cut);
  const remap = new Map(old.map((c, i) => [grid.cells.indexOf(c), index.get(cells[i]!)!]));
  const owner = new Int32Array((rows - cut) * cols);
  for (let r = cut; r < rows; r++) {
    for (let c = 0; c < cols; c++)
      owner[(r - cut) * cols + c] = remap.get(grid.owner[r * cols + c]!)!;
  }
  return { grid: { xs: grid.xs, ys: grid.ys.slice(cut), owner, cells }, lines: kept };
}

/**
 * 只有横线的表最下面几排各只有一行横跨各列的字（小票上表格下面居中的「Vielen Dank / Auf Wiedersehen」，
 * 下面再有一条分隔线，EU 样本 003）：是表下面的话，不是表的行；去掉这几排，字照表外的文字排。
 * 去掉以后至少两排、其中至少 FORM_BODY_ROWS 排有两格以上有字才去；不然 null。
 */
export function dropTrailingRows(
  grid: Grid,
  lines: readonly OcrBox[],
): { grid: Grid; lines: OcrBox[] } | null {
  const rows = grid.ys.length - 1;
  const cols = grid.xs.length - 1;
  if (cols < 2 || grid.xs.slice(1, -1).some((x) => x.lined)) return null;
  const rowLines = (r: number) => lines.filter((l) => indexOf(grid.ys, centerY(l)) === r);
  // 这一排只有一行字，横跨了按空隙分出的列。
  const spanning = (r: number) => {
    const own = rowLines(r);
    return (
      own.length === 1 &&
      grid.xs
        .slice(1, -1)
        .some(
          (x) =>
            x.pos > own[0]!.x + own[0]!.height &&
            x.pos < own[0]!.x + own[0]!.width - own[0]!.height,
        )
    );
  };
  let cut = rows;
  let closing = false;
  while (cut > 0 && (spanning(cut - 1) || !rowLines(cut - 1).length)) {
    closing ||= spanning(cut - 1);
    cut--;
  }
  if (!closing || cut < 2 || !rowLines(cut - 1).length) return null;
  const columns = (r: number) => new Set(rowLines(r).map((l) => indexOf(grid.xs, centerX(l)))).size;
  if (
    Array.from({ length: cut }, (_, r) => columns(r)).filter((n) => n >= 2).length < FORM_BODY_ROWS
  )
    return null;
  if (grid.cells.some((c) => c.row < cut && c.row + c.rowSpan > cut)) return null;
  const y = grid.ys[cut]!.pos;
  const cells = grid.cells.filter((c) => c.row < cut);
  const keep = new Map(cells.map((c, i) => [grid.cells.indexOf(c), i]));
  const owner = new Int32Array(cut * cols);
  for (let p = 0; p < owner.length; p++) owner[p] = keep.get(grid.owner[p]!)!;
  return {
    grid: { xs: grid.xs, ys: grid.ys.slice(0, cut + 1), owner, cells },
    lines: lines.filter((l) => centerY(l) < y),
  };
}

/**
 * 这一行被有线的列线从一个词中间切开（D-502）：列线两边不是同一格，而且切口两边的字挨着
 * （不是空格、字距也不比平常大）。PP-OCR 把相邻两格认成一行时，列线落在两段字之间的空隙里，不算。
 * 没有每个字的位置时看不出来，不算。
 */
function chopsWord(line: OcrBox, grid: Grid): boolean {
  const chars = line.chars;
  if (!chars || chars.length < 2) return false;
  const cols = grid.xs.length - 1;
  const row = indexOf(grid.ys, centerY(line));
  const margin = line.height * 0.5;
  const at = chars.map((ch) => line.x + ch.at * line.width);
  const steps = at.slice(1).map((x, i) => x - at[i]!);
  const typical = [...steps].sort((a, b) => a - b)[steps.length >> 1]!;
  for (let c = 1; c < cols; c++) {
    if (!grid.xs[c]!.lined) continue;
    const x = grid.xs[c]!.pos;
    if (x <= line.x + margin || x >= line.x + line.width - margin) continue;
    if (grid.owner[row * cols + c - 1] === grid.owner[row * cols + c]) continue;
    const right = at.findIndex((p) => p >= x);
    if (right <= 0) continue;
    const gap = at[right]! - at[right - 1]!;
    const blank = !chars[right]!.text.trim() || !chars[right - 1]!.text.trim();
    if (!blank && gap < CHOP_GAP * typical) return true;
  }
  return false;
}

/**
 * 一行文字放进格子：横跨了竖线（PP-OCR 把相邻两格认成了一行）而且有每个字的位置时，在竖线处切开。
 * 返回切开后的几段，每段按中心点放进一格。
 */
function piecesOf(line: OcrBox, grid: Grid): { cell: number; piece: OcrBox }[] {
  const cols = grid.xs.length - 1;
  const row = indexOf(grid.ys, centerY(line));
  const cellAt = (c: number) => grid.owner[row * cols + c]!;
  const margin = line.height * 0.5;
  const cuts: number[] = [];
  if (line.chars?.length) {
    for (let c = 1; c < cols; c++) {
      // 只在竖线处切；按文字空隙分的列不切（空隙本来就在字和字之间）。
      if (!grid.xs[c]!.lined) continue;
      const x = grid.xs[c]!.pos;
      if (x > line.x + margin && x < line.x + line.width - margin && cellAt(c - 1) !== cellAt(c))
        cuts.push(x);
    }
  }
  const whole = () => [{ cell: cellAt(indexOf(grid.xs, centerX(line))), piece: line }];
  if (!cuts.length) return whole();
  const chars = line.chars!;
  const charWidth = line.width / chars.length;
  const parts: { text: string; first: number; last: number }[] = [];
  for (const ch of chars) {
    const x = line.x + ch.at * line.width;
    const k = cuts.filter((cut) => x >= cut).length;
    const part = (parts[k] ??= { text: '', first: x, last: x });
    part.text += ch.text;
    part.last = x;
  }
  const out: { cell: number; piece: OcrBox }[] = [];
  for (const part of parts) {
    if (!part || !part.text.trim()) continue;
    const x = Math.max(line.x, part.first - charWidth / 2);
    const piece: OcrBox = {
      text: part.text.trim(),
      x,
      y: line.y,
      width: Math.min(line.x + line.width, part.last + charWidth / 2) - x,
      height: line.height,
    };
    out.push({ cell: cellAt(indexOf(grid.xs, centerX(piece))), piece });
  }
  return out.length ? out : whole();
}

/**
 * 去掉落在文字行里面的「横线」：粗体、压扁的字一排连起来，按行扫描时像一条粗线（工资单的项目名称）。
 * 真的线在字的上下，不会在一行字的中间。
 * 竖线也一样（D-463）：加了下划线的粗体标题，字的竖笔画连着下划线，按列扫描时像一排短竖线，
 * 和字顶的横笔画、下划线交成一张「表」（每格一两个字母）。整条在一行字的框里（上下最多出框 20% 行高）的竖线是字的笔画；
 * 真的竖线是格子的边，比格子里的字高。
 */
function dropTextStrokes(page: PageLines, lines: readonly OcrBox[]): PageLines {
  const inText = (h: RuleLine) =>
    lines.some((l) => {
      const inset = l.height * STROKE_INSIDE;
      if (h.pos <= l.y + inset || h.pos >= l.y + l.height - inset) return false;
      const overlap = Math.min(h.to, l.x + l.width) - Math.max(h.from, l.x);
      return overlap >= STROKE_SHARE * (h.to - h.from);
    });
  const inTextV = (v: RuleLine) =>
    lines.some((l) => {
      const out = l.height * STROKE_INSIDE;
      return (
        v.pos > l.x && v.pos < l.x + l.width && v.from >= l.y - out && v.to <= l.y + l.height + out
      );
    });
  const vertical = page.vertical.filter((v) => !inTextV(v));
  // 至少三成页宽、连着至少三条竖线的横线是表格线（左右两边加中间至少一条列线），哪怕压在一行字的框里
  // （D-501：照片里弯的一行页脚，识别框很高，罩住了表格的底线）。字的笔画、纸的折痕没有这么长，
  // 上下两行字的竖笔画连起来的短竖线也常常碰到粗体字的横笔画。
  const tol = Math.max(4, Math.max(page.width, page.height) * STROKE_TOUCH_SHARE);
  const joined = (h: RuleLine) =>
    h.to - h.from >= STROKE_RULE_SHARE * page.width &&
    vertical.filter(
      (v) =>
        v.pos >= h.from - tol &&
        v.pos <= h.to + tol &&
        h.pos >= v.from - tol &&
        h.pos <= v.to + tol,
    ).length >= STROKE_MIN_JOINED;
  return {
    ...page,
    horizontal: page.horizontal.filter((h) => !inText(h) || joined(h)),
    vertical,
  };
}

/** 金额一类的纯数字（可以带正负号、货币符号、千分位的空格或逗号、百分号）：判断不出对齐时靠右。 */
const AMOUNT = /^[-−+(]?\s?[$€£¥￥]?\s?\d[\d\s.,'’]*%?\s?[$€£¥￥元]?\)?$/;

/**
 * 水平对齐：每排字看它离格子左右边的空白（left、right 是格子的左右边），多数排怎么放就是什么；
 * 字占满格子的排不算。都判断不出时，金额靠右，别的不写（Excel 的「常规」：文字靠左）。
 */
function alignOf(
  pieces: readonly OcrBox[],
  left: number,
  right: number,
  lineHeight: number,
  text: string,
): CellAlign | undefined {
  const rows = textRows(pieces);
  // 好几排左边对齐的字是左对齐的一段（框起来的正文左右留的空一样宽，每排看着都像居中，EU 样本 038）。
  // 只看每排都是字的：一列一样宽的金额左边也对齐，但它们靠右。
  const lefts = rows.map((row) => Math.min(...row.map((p) => p.x)));
  if (
    rows.length > PROSE_MIN_ROWS &&
    rows.every((row) => row.some((p) => /\p{L}{3}/u.test(p.text))) &&
    Math.max(...lefts) - Math.min(...lefts) <= 0.5 * lineHeight
  )
    return 'left';
  const votes: Record<CellAlign, number> = { left: 0, center: 0, right: 0 };
  for (const row of rows) {
    const l = Math.min(...row.map((p) => p.x)) - left;
    const r = right - Math.max(...row.map((p) => p.x + p.width));
    const slack = l + r;
    if (slack < ALIGN_MIN_SLACK * lineHeight) continue;
    const d = (l - r) / slack;
    votes[d < -ALIGN_SIDE_SHARE ? 'left' : d > ALIGN_SIDE_SHARE ? 'right' : 'center']++;
  }
  const best = (['left', 'center', 'right'] as const).reduce((a, b) =>
    votes[b] > votes[a] ? b : a,
  );
  if (votes[best] > 0) return best;
  return AMOUNT.test(text.trim()) ? 'right' : undefined;
}

/**
 * 整页共用的列线（D-272）：各张表的列边界从左到右排开，相差不到 tol 的并成一条（取平均）；
 * 同一张表的两条边界不并在一起（那样会少一列）。返回共用列线的位置，和每张表的每条边界对应第几条共用列线。
 */
export function sharedColumns(
  tables: readonly (readonly number[])[],
  tol: number,
): { pos: number[]; maps: number[][] } {
  const items = tables
    .flatMap((xs, t) => xs.map((x, i) => ({ x, t, i })))
    .sort((a, b) => a.x - b.x);
  const groups: { sum: number; members: { t: number; i: number }[] }[] = [];
  for (const item of items) {
    const g = groups.at(-1);
    if (g && item.x - g.sum / g.members.length <= tol && !g.members.some((m) => m.t === item.t)) {
      g.sum += item.x;
      g.members.push(item);
    } else groups.push({ sum: item.x, members: [item] });
  }
  const maps = tables.map((xs) => xs.map(() => 0));
  groups.forEach((g, k) => {
    for (const m of g.members) maps[m.t]![m.i] = k;
  });
  return { pos: groups.map((g) => g.sum / g.members.length), maps };
}

/** 同一张图、同样的参数找过的线（转 Word 会对同一页组两次表：分不分开叠着的表）。 */
const linesCache = new WeakMap<RgbaImage, Map<string, PageLines>>();
export function cachedLines(
  image: RgbaImage,
  options: { skew?: number; light?: boolean },
): PageLines {
  const key = JSON.stringify(options);
  let byOptions = linesCache.get(image);
  if (!byOptions) linesCache.set(image, (byOptions = new Map()));
  let found = byOptions.get(key);
  if (!found) byOptions.set(key, (found = findLines(image, options)));
  return found;
}

/** 空白网格至少要有这么多排、这么多列，才去找它上面的表头。 */
const HEADER_GRID_MIN_ROWS = 3;
const HEADER_GRID_MIN_COLS = 2;
/** 表头那排字的底边离网格的上边不超过这么多个行高。 */
const HEADER_GAP_LINES = 1.5;

/**
 * 横竖线画满、里面没有字的网格（留着填的商品栏）：紧挨在上面、一列一个的那排字是表头。
 * 找到时在表头上面补一条横线、把竖线往上接到它，表头成为网格的第一排；
 * 表头的字至少落在一半的列里（至少两列），而且每段字都在一列里面（不跨列线）。
 */
function withHeaderAbove(
  table: TableLines,
  lines: readonly OcrBox[],
  tol: number,
  lineHeight: number,
): { table: TableLines; lines: OcrBox[] } | null {
  const { box, hs, vs } = table;
  const top = box.y;
  const bottom = box.y + box.height;
  const cols = vs.length - 1;
  if (hs.length - 1 < HEADER_GRID_MIN_ROWS || cols < HEADER_GRID_MIN_COLS) return null;
  // 每条竖线都从上到下画满（是一张规整的网格，不是框里的几条线）。
  if (vs.some((v) => v.from > top + tol || v.to < bottom - tol)) return null;
  const near = lines.filter(
    (l) =>
      centerX(l) > box.x &&
      centerX(l) < box.x + box.width &&
      l.y + l.height <= top + tol &&
      l.y + l.height >= top - HEADER_GAP_LINES * lineHeight,
  );
  if (!near.length) return null;
  // 只取最下面那一排（中心和最下面的一段差不到半个行高）。
  const lowest = Math.max(...near.map(centerY));
  const row = near.filter((l) => lowest - centerY(l) <= 0.5 * lineHeight);
  const inner = vs.slice(1, -1).map((v) => v.pos);
  const pad = 0.25 * lineHeight;
  if (row.some((l) => inner.some((x) => x > l.x + pad && x < l.x + l.width - pad))) return null;
  const hit = new Set(
    row.map((l) => vs.findIndex((v, i) => i < cols && centerX(l) < vs[i + 1]!.pos)),
  );
  if (hit.size < HEADER_GRID_MIN_COLS || hit.size * 2 < cols) return null;
  const pos = Math.min(...row.map((l) => l.y)) - 0.3 * lineHeight;
  const ruleAbove: RuleLine = {
    pos,
    from: box.x,
    to: box.x + box.width,
    thickness: 1,
    spans: [[box.x, box.x + box.width]],
  };
  return {
    table: {
      hs: [ruleAbove, ...hs],
      vs: vs.map((v) => ({ ...v, from: pos, spans: [[pos, v.to] as [number, number]] })),
      box: { ...box, y: pos, height: bottom - pos },
    },
    lines: row,
  };
}

/** 一页的 TablePage：找线、组表、填字、表外文字分段。 */
export function buildTablePage(input: PageInput, options: BuildOptions = {}): TablePage {
  const join = options.joinLines ?? defaultJoin;
  const { image } = input;
  const page = cachedLines(image, {
    ...(input.skew !== undefined ? { skew: input.skew } : {}),
    ...(options.lightRules ? { light: true } : {}),
  });
  const t = Math.tan((page.skew * Math.PI) / 180);
  const tol = Math.max(4, Math.max(image.width, image.height) * 0.008);
  const arrange = options.arrange === true;
  // 识别框换到拉正后的坐标（只移动中心，大小不变）。
  let source = input.lines.filter((l) => l.text.trim());
  // 图片区域（转 Excel，D-520）：里面的字是图的一部分，不参加组表、也不排成文字。
  const found =
    arrange && input.regions?.length
      ? layoutRegions(input.regions, source, image, median(source.map((l) => l.height)) || 20)
      : { figures: [], text: [] };
  const { figures } = found;
  if (figures.length) {
    source = source.filter((l) => !figures.some((f) => lineShareIn(l, f) >= 0.5));
  }
  const flat = source.map((l): OcrBox => {
    const cx = centerX(l);
    const cy = centerY(l);
    return { ...l, x: cx + cy * t - l.width / 2, y: cy - cx * t - l.height / 2 };
  });
  const sourceOf = new Map(flat.map((l, i) => [l, source[i]!]));
  // 拉正后的框 → 原图里包住它的框。
  const back = (b: Box): Box => {
    if (t === 0) return b;
    const corners = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => [x! - y! * t, y! + x! * t] as const);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };
  // 原图里的框 → 拉正后的位置（只移动中心，和识别框一样）。
  const flatBox = (b: Box): Box => {
    const cx = centerX(b);
    const cy = centerY(b);
    return {
      x: cx + cy * t - b.width / 2,
      y: cy - cx * t - b.height / 2,
      width: b.width,
      height: b.height,
    };
  };
  const lineHeight = median(flat.map((l) => l.height)) || 20;
  // 估字号用的行高（D-521）：拍歪的页，长行的识别框比字高出 宽 × 斜率 一截，扣掉。
  const tilt = Math.abs(t);
  const sizeHeight = (l: Box) => Math.max(0.6 * l.height, l.height - tilt * l.width);
  const baseHeight = median(flat.map(sizeHeight)) || lineHeight;
  const bodySize = bodySizeOf(baseHeight, image.width);
  // 字的笔画粗细（粗体，D-521）：按原图里的位置量；只在转 Excel 时用。
  const strokes = new Map<OcrBox, number>();
  const strokeOf = (l: OcrBox) => {
    if (!strokes.has(l)) strokes.set(l, strokeRatio(image, sourceOf.get(l) ?? back(l)));
    return strokes.get(l)!;
  };
  const pageStroke = arrange ? median(flat.map(strokeOf).filter((v) => v > 0)) : 0;
  const placed = new Set<OcrBox>();
  const tables: {
    block: TableBlock;
    flatBox: Box;
    xs: number[];
    lines: OcrBox[];
    chopped: number;
    /** 每条行线、列线都是画出来的（不是按文字空隙分的）。 */
    ruled: boolean;
  }[] = [];
  for (const found of findTables(dropTextStrokes(page, flat), {
    ...(options.splitStacked ? { splitStacked: true } : {}),
    text: flat,
  })) {
    let table = found;
    let { box } = table;
    // 大半在图片区域里的「表」是图里的线（示意图、图表的网格）。
    if (
      figures.some((f) => {
        const ix = Math.min(box.x + box.width, f.x + f.width) - Math.max(box.x, f.x);
        const iy = Math.min(box.y + box.height, f.y + f.height) - Math.max(box.y, f.y);
        return ix > 0 && iy > 0 && ix * iy > 0.5 * box.width * box.height;
      })
    )
      continue;
    let members = flat.filter(
      (l) =>
        !placed.has(l) &&
        centerX(l) >= box.x - tol &&
        centerX(l) <= box.x + box.width + tol &&
        centerY(l) >= box.y - tol &&
        centerY(l) <= box.y + box.height + tol,
    );
    // 空白表格的表头写在网格上面（发票模板的商品栏，EU 样本 001）：表头那一排算进表里。
    if (!members.length && options.headerAbove) {
      const headed = withHeaderAbove(
        table,
        flat.filter((l) => !placed.has(l)),
        tol,
        lineHeight,
      );
      if (headed) {
        table = headed.table;
        box = table.box;
        members = headed.lines;
      }
    }
    // 压在表里一条横线上、只有「=」「_」「-」这类记号的识别行是这条线（虚线、双线）本身（EU 样本 020）：
    // 算表里的（不排成正文），但不占一排、不写进格子。
    const ruleText = new Set(
      members.filter(
        (l) =>
          isRuleText(l.text) &&
          table.hs.some(
            (h) =>
              Math.abs(h.pos - centerY(l)) <= Math.max(4, 0.6 * l.height) &&
              h.from <= l.x + l.width &&
              h.to >= l.x,
          ),
      ),
    );
    // 里面没有字的不算表（例如表单里几条对齐的填空横线）。
    if (members.length === ruleText.size) continue;
    const built = buildGrid(
      table,
      members.filter((l) => !ruleText.has(l)),
      tol,
      lineHeight,
    );
    if (!built) continue;
    let grid: Grid = built;
    // 中心在最外一条横线外面、又横跨了列线的字不是表里的（D-501：照片里弯的一行页脚压着表格的底线，
    // 放进表里会在列线处切碎）。只落在一列里的照旧放进表（表格底线下面的合计行）。
    const top = grid.ys[0]!;
    const bottom = grid.ys.at(-1)!;
    let inside = members.filter((l) => {
      const out = (top.lined && centerY(l) < top.pos) || (bottom.lined && centerY(l) > bottom.pos);
      const across = grid.xs.some(
        (x, c) =>
          c > 0 &&
          c < grid.xs.length - 1 &&
          x.lined &&
          x.pos > l.x + l.height * 0.5 &&
          x.pos < l.x + l.width - l.height * 0.5,
      );
      // 整行都在最上面一条横线上面的字（表头横条上面紧挨着的一行说明）不是表里的。
      const above = top.lined && l.y + l.height <= top.pos;
      return !(out && across) && !above;
    });
    if (!inside.length) continue;
    // 表单的框连着好几行（D-520）：上面的几行不是表的行，字留给表外的文字。
    const trimmed = arrange ? dropLeadingRows(grid, inside) : null;
    if (trimmed) {
      grid = trimmed.grid;
      inside = trimmed.lines;
      if (!inside.length) continue;
    }
    const tail = dropTrailingRows(grid, inside);
    if (tail) {
      grid = tail.grid;
      inside = tail.lines;
    }
    const texts = grid.cells.map(() => [] as OcrBox[]);
    for (const line of inside) {
      if (ruleText.has(line)) continue;
      for (const { cell, piece } of piecesOf(line, grid)) texts[cell]!.push(piece);
    }
    const chopped = inside.filter((l) => !ruleText.has(l) && chopsWord(l, grid)).length;
    // 只有横线的表：至少两行有字、按文字空隙至少分出两列才算表（几条分隔线中间的正文分不出列）。
    const rowsWithText = new Set(grid.cells.filter((_, i) => texts[i]!.length).map((c) => c.row));
    if (!table.vs.length && (rowsWithText.size < 2 || grid.xs.length < 3)) continue;
    // 表里文字的字号（磅）：和正文差不多就不单独写。
    const tableSize = arrange
      ? tableSizeOf(median(inside.map(sizeHeight)), image.width, bodySize)
      : bodySize;
    // 粗体按整行定：一格一格看笔画，短的数字常被误认成粗体、表头里也会漏一格；
    // 一行里有字的格子过半看着粗，整行粗，否则整行都不粗（D-521）。
    const thickCell = grid.cells.map(
      (_, i) =>
        arrange &&
        texts[i]!.length > 0 &&
        pageStroke > 0 &&
        median(texts[i]!.map(strokeOf)) > BOLD_RATIO * pageStroke,
    );
    const boldRows = new Set<number>();
    for (const row of new Set(grid.cells.map((c) => c.row))) {
      const filled = grid.cells.flatMap((c, i) => (c.row === row && texts[i]!.length ? [i] : []));
      if (filled.filter((i) => thickCell[i]).length * 2 > filled.length) boldRows.add(row);
    }
    const cells = grid.cells.map((cell, i) => {
      const text = texts[i]!.length ? join(texts[i]!).trim() : '';
      const flatCell = cell.box!;
      const align = text
        ? alignOf(texts[i]!, flatCell.x, flatCell.x + flatCell.width, lineHeight, text)
        : undefined;
      const bold = text !== '' && boldRows.has(cell.row);
      return {
        ...cell,
        text,
        ...(align ? { align } : {}),
        ...(arrange && tableSize !== bodySize ? { size: tableSize } : {}),
        ...(bold ? { bold: true } : {}),
        box: back(flatCell),
      };
    });
    // 表单的下划线、方框连成的大网格、列线把字从词中间切开的网格（D-502）：不当表，里面的字按位置排成文字（F4）。
    if (
      arrange &&
      (isRuleGrid(
        { kind: 'table', rows: grid.ys.length - 1, col: 0, cols: grid.xs.length - 1, cells, box },
        inside.length,
      ) ||
        (chopped >= CHOP_MIN && chopped >= CHOP_SHARE * inside.length))
    )
      continue;
    for (const line of inside) placed.add(line);
    const flatBox: Box = {
      x: grid.xs[0]!.pos,
      y: grid.ys[0]!.pos,
      width: grid.xs.at(-1)!.pos - grid.xs[0]!.pos,
      height: grid.ys.at(-1)!.pos - grid.ys[0]!.pos,
    };
    tables.push({
      flatBox,
      xs: grid.xs.map((x) => x.pos),
      lines: inside.map((l) => sourceOf.get(l)!),
      chopped,
      // 外边的两条竖线可以不画（只有横线和内部列线的「开口」表格），表头写在第一条横线上面时最上边也没有线
      // （EU 样本 031）：内部列线和第一条以下的横线都画了就算画满。
      ruled:
        grid.xs.length > 2 &&
        grid.xs.slice(1, -1).every((x) => x.lined) &&
        grid.ys.slice(1).every((y) => y.lined),
      block: {
        kind: 'table',
        rows: grid.ys.length - 1,
        col: 0,
        cols: grid.xs.length - 1,
        cells,
        box: back(flatBox),
      },
    });
  }
  // 没有线的表（D-506）：找线没找到的表（很浅的细线、只按空白对齐的列）用剩下的行按列对齐认，
  // 和转 Word 一样先按局部的斜率拉平再分排。
  if (options.textTables !== false) {
    const rest = flat.filter((l) => !placed.has(l));
    const leveled = levelLines(rest, lineHeight, image.width / 2);
    const flatOf = new Map(leveled.map((l, k) => [l, rest[k]!]));
    const toFlat = (l: OcrBox) => flatOf.get(l) ?? l;
    for (const found of findTextTables(leveled, lineHeight, toFlat)) {
      const members = found.lines.map(toFlat);
      for (const line of members) placed.add(line);
      const textSize = tableSizeOf(median(members.map(sizeHeight)), image.width, bodySize);
      let x = found.box.x;
      const xs = [x, ...found.colWidths.map((w) => (x += w))];
      // 整页共用一套列（D-272）：没有线的表的列线可以放在两列之间的空白里任何地方，最外两条可以往外挪
      // （不超过 3 个行高，和 D-471 列和列隔开的上限一样）。那里有别的表的列线时对上它，
      // 不然一张表的列线挨着另一张表的列线，整页多出一条窄列，把格子劈成两半（发票表下面的合计）。
      const others = tables.flatMap((tb) => tb.xs);
      const { bands } = found;
      const reach = SNAP_REACH * lineHeight;
      xs.forEach((at, e) => {
        const lo = e === 0 ? at - reach : bands[e - 1]!.right;
        const hi = e === bands.length ? at + reach : bands[e]!.x;
        const near = others.filter((o) => o >= lo && o <= hi);
        if (near.length) {
          xs[e] = near.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
        }
      });
      tables.push({
        flatBox: found.box,
        xs,
        lines: members.map((l) => sourceOf.get(l)!),
        chopped: 0,
        ruled: false,
        block: {
          ...found.table,
          cells: found.table.cells.map((c) => ({
            ...(c.box ? { ...c, box: back(c.box) } : c),
            ...(arrange && textSize !== bodySize ? { size: textSize } : {}),
          })),
          box: back(found.box),
        },
      });
    }
  }
  // 转 Excel：表外的字和图片怎么排（D-520–D-522）。有左右范围的（分栏的文字、图片）也参加整页共用的列：
  // 栏和栏之间的分界、图片的左右边都是列线；没有表时再加上所有内容的左右边，这样整页有宽度。
  const plan = arrange
    ? planRest({
        lines: flat.filter((l) => !placed.has(l)),
        figures: figures.map(flatBox),
        regions: found.text,
        tables: tables.map((tb) => tb.flatBox),
        lineHeight,
        sizeHeight,
        baseHeight,
        bodySize,
        join,
        strokeOf,
        pageStroke,
      })
    : null;
  const ranged = (plan?.groups.flatMap((g) => g.drafts) ?? []).filter((d) => d.range);
  const extra = ranged.map((d) => [...d.range!]);
  if (!tables.length && ranged.length) {
    const all = (plan?.groups ?? []).flatMap((g) => g.drafts);
    // 离已有的列线不到两个行高的那一边不加：标题比栏的边靠外一点，不为它多出一条很窄的列（文字横跨合并，照样放得下）。
    const edges = extra.flat();
    const far = (x: number) => edges.every((e) => Math.abs(e - x) >= 2 * lineHeight);
    extra.push(
      [
        Math.min(...all.map((d) => d.box.x)),
        Math.max(...all.map((d) => d.box.x + d.box.width)),
      ].filter(far),
    );
  }
  // 整页共用的列：每张表的格子换成共用列上的位置，原来一格跨过几条共用列线就是 colSpan 几。
  const shared = sharedColumns(
    [...tables.map((tb) => tb.xs), ...extra],
    Math.max(tol, Math.max(image.width, image.height) * SHARED_COLUMN_SHARE),
  );
  tables.forEach((tb, k) => {
    const map = shared.maps[k]!;
    const first = map[0]!;
    tb.block.col = first;
    tb.block.cols = map.at(-1)! - first;
    tb.block.cells = tb.block.cells.map((cell) => ({
      ...cell,
      col: map[cell.col]! - first,
      colSpan: map[cell.col + cell.colSpan]! - map[cell.col]!,
    }));
  });
  for (const tb of tables)
    options.onTable?.(tb.block, tb.lines, { chopped: tb.chopped, ruled: tb.ruled });
  const colWidths =
    tables.length || ranged.length
      ? shared.pos.slice(1).map((x, c) => Math.round(x - shared.pos[c]!))
      : Array.from({ length: TEXT_ONLY_COLS }, () => Math.round(image.width / TEXT_ONLY_COLS));
  if (plan) {
    // 每一块占哪几列：它的左右范围在共用列里的位置。
    const spans = new Map(
      ranged.map((d, k) => {
        const map = shared.maps[tables.length + k]!;
        return [d, { col: map[0]!, cols: map[1]! - map[0]! }] as const;
      }),
    );
    // 没有表时看不出整页的左右，只有分栏、图片时才有（居中的标题）。
    const aligned = tables.length > 0 || ranged.length > 0;
    const entries: { y: number; blocks: Block[] }[] = [
      ...plan.groups.map((g) => ({
        y: g.y,
        blocks: g.drafts.map((d): Block => {
          if (d.kind === 'table') {
            const block = tables[d.index]!.block;
            if (d.band !== undefined) block.band = d.band;
            return block;
          }
          const span = spans.get(d);
          const at = span ? { col: span.col, cols: span.cols } : {};
          const band = d.band !== undefined ? { band: d.band } : {};
          if (d.kind === 'image') {
            return {
              kind: 'image',
              ...at,
              ...band,
              col: span!.col,
              cols: span!.cols,
              box: back(d.box),
            };
          }
          const [left, right] = d.range ?? [shared.pos[0]!, shared.pos.at(-1)!];
          const align = aligned ? alignOf(d.lines, left, right, lineHeight, d.text) : undefined;
          return {
            kind: 'text',
            text: d.text,
            ...(align ? { align } : {}),
            ...at,
            ...band,
            ...(d.size !== undefined ? { size: d.size } : {}),
            ...(d.bold ? { bold: true } : {}),
            box: back(d.box),
          };
        }),
      })),
    ];
    return {
      name: input.name,
      source: input.source,
      width: image.width,
      height: image.height,
      lineHeight: Math.round(lineHeight),
      colWidths,
      bodySize,
      blocks: entries.sort((a, b) => a.y - b.y).flatMap((e) => e.blocks),
    };
  }
  // 表外的文字：按排从上到下，间距超过 1.2 倍行高、或者中间隔着一张表的地方分段。
  const rest = textRows(flat.filter((l) => !placed.has(l)));
  const paragraphs: OcrBox[][] = [];
  let prevBottom = -Infinity;
  for (const row of rest) {
    const top = Math.min(...row.map((l) => l.y));
    const bottom = Math.max(...row.map((l) => l.y + l.height));
    const tableBetween = tables.some(
      (tb) => tb.flatBox.y >= prevBottom - tol && tb.flatBox.y + tb.flatBox.height <= top + tol,
    );
    if (paragraphs.length && top - prevBottom <= PARAGRAPH_GAP * lineHeight && !tableBetween)
      paragraphs.at(-1)!.push(...row);
    else paragraphs.push([...row]);
    prevBottom = bottom;
  }
  const blocks: { y: number; block: Block }[] = [
    ...tables.map((tb) => ({ y: tb.flatBox.y, block: tb.block as Block })),
    ...paragraphs.map((lines) => {
      const x = Math.min(...lines.map((l) => l.x));
      const y = Math.min(...lines.map((l) => l.y));
      const box = {
        x,
        y,
        width: Math.max(...lines.map((l) => l.x + l.width)) - x,
        height: Math.max(...lines.map((l) => l.y + l.height)) - y,
      };
      const text = join(lines).trim();
      // 表外的文字按整页共用列的左右边判断对齐（居中的标题）；没有表时看不出，不写。
      const align = tables.length
        ? alignOf(lines, shared.pos[0]!, shared.pos.at(-1)!, lineHeight, text)
        : undefined;
      return {
        y,
        block: { kind: 'text' as const, text, ...(align ? { align } : {}), box: back(box) },
      };
    }),
  ];
  return {
    name: input.name,
    source: input.source,
    width: image.width,
    height: image.height,
    lineHeight: Math.round(lineHeight),
    colWidths,
    blocks: blocks
      .filter((b) => b.block.kind !== 'text' || b.block.text)
      .sort((a, b) => a.y - b.y)
      .map((b) => b.block),
  };
}

/** 转 Excel 的一页（D-520–D-522）：和 buildTablePage 一样，加上图片区域、分栏的文字、字号（见 BuildOptions.arrange）。 */
export const buildSheetPage = (input: PageInput, options: BuildOptions = {}): TablePage =>
  buildTablePage(input, { ...options, arrange: true });
