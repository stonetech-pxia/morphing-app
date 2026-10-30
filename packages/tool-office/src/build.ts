import {
  addSpan,
  coveredLength,
  findLines,
  findTables,
  type PageLines,
  type RuleLine,
  type TableLines,
} from './lines';
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
}

export interface PageInput {
  /** 找线用的图（增强后的那张，没有增强过就是原图）。 */
  image: RgbaImage;
  /** 识别出的行，坐标和 image 一样。 */
  lines: readonly OcrBox[];
  name: string;
  source: string;
  /** 已知的倾斜角（度）；增强过的图已经拉正，给 0。不给时估一个。 */
  skew?: number;
}

/** 网格的一条边界：lined 是有线的（没有线的是按文字空隙或文字行分出来的，两边不合并）。 */
interface Boundary {
  pos: number;
  lined: boolean;
}

interface Grid {
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
    const top = Math.min(...vs.map((v) => v.from));
    const bottom = Math.max(...vs.map((v) => v.to));
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
  const isOpen = (r: number) => firstCovered < 0 || r < firstCovered || r > lastCovered;
  const split: Boundary[] = [ys[0]!];
  const open: boolean[] = [];
  // 按排分出来的行，竖线够不够长按分之前的那一段算（弯的线、断线在一小行里容易不够一半）。
  const parentBand: ([number, number] | null)[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    const a = ys[r]!.pos;
    const b = ys[r + 1]!.pos;
    const rows = textRows(lines.filter((l) => centerY(l) >= a && centerY(l) < b));
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
      // 多数排只有一列有字（表单一格里的几行地址，别的列空着，D-315）不分。
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
      if (multi >= 2 && multi > rowsByCol.size / 2 && wide >= rows.length / 2) {
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
  if (!inner.length) {
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
 */
function dropTextStrokes(page: PageLines, lines: readonly OcrBox[]): PageLines {
  const inText = (h: RuleLine) =>
    lines.some((l) => {
      const inset = l.height * STROKE_INSIDE;
      if (h.pos <= l.y + inset || h.pos >= l.y + l.height - inset) return false;
      const overlap = Math.min(h.to, l.x + l.width) - Math.max(h.from, l.x);
      return overlap >= STROKE_SHARE * (h.to - h.from);
    });
  return { ...page, horizontal: page.horizontal.filter((h) => !inText(h)) };
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
  const votes: Record<CellAlign, number> = { left: 0, center: 0, right: 0 };
  for (const row of textRows(pieces)) {
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

/** 一页的 TablePage：找线、组表、填字、表外文字分段。 */
export function buildTablePage(input: PageInput, options: BuildOptions = {}): TablePage {
  const join = options.joinLines ?? defaultJoin;
  const { image } = input;
  const page = findLines(image, input.skew !== undefined ? { skew: input.skew } : {});
  const t = Math.tan((page.skew * Math.PI) / 180);
  const tol = Math.max(4, Math.max(image.width, image.height) * 0.008);
  // 识别框换到拉正后的坐标（只移动中心，大小不变）。
  const flat = input.lines
    .filter((l) => l.text.trim())
    .map((l): OcrBox => {
      const cx = centerX(l);
      const cy = centerY(l);
      return { ...l, x: cx + cy * t - l.width / 2, y: cy - cx * t - l.height / 2 };
    });
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
  const lineHeight = median(flat.map((l) => l.height)) || 20;
  const placed = new Set<OcrBox>();
  const tables: { block: TableBlock; flatBox: Box; xs: number[] }[] = [];
  for (const table of findTables(dropTextStrokes(page, flat))) {
    const { box } = table;
    const members = flat.filter(
      (l) =>
        !placed.has(l) &&
        centerX(l) >= box.x - tol &&
        centerX(l) <= box.x + box.width + tol &&
        centerY(l) >= box.y - tol &&
        centerY(l) <= box.y + box.height + tol,
    );
    // 里面没有字的不算表（例如表单里几条对齐的填空横线）。
    if (!members.length) continue;
    const grid = buildGrid(table, members, tol, lineHeight);
    if (!grid) continue;
    const texts = grid.cells.map(() => [] as OcrBox[]);
    for (const line of members) {
      for (const { cell, piece } of piecesOf(line, grid)) texts[cell]!.push(piece);
    }
    // 只有横线的表：至少两行有字、按文字空隙至少分出两列才算表（几条分隔线中间的正文分不出列）。
    const rowsWithText = new Set(grid.cells.filter((_, i) => texts[i]!.length).map((c) => c.row));
    if (!table.vs.length && (rowsWithText.size < 2 || grid.xs.length < 3)) continue;
    for (const line of members) placed.add(line);
    const cells = grid.cells.map((cell, i) => {
      const text = texts[i]!.length ? join(texts[i]!).trim() : '';
      const flatCell = cell.box!;
      const align = text
        ? alignOf(texts[i]!, flatCell.x, flatCell.x + flatCell.width, lineHeight, text)
        : undefined;
      return { ...cell, text, ...(align ? { align } : {}), box: back(flatCell) };
    });
    const flatBox: Box = {
      x: grid.xs[0]!.pos,
      y: grid.ys[0]!.pos,
      width: grid.xs.at(-1)!.pos - grid.xs[0]!.pos,
      height: grid.ys.at(-1)!.pos - grid.ys[0]!.pos,
    };
    tables.push({
      flatBox,
      xs: grid.xs.map((x) => x.pos),
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
  // 整页共用的列：每张表的格子换成共用列上的位置，原来一格跨过几条共用列线就是 colSpan 几。
  const shared = sharedColumns(
    tables.map((tb) => tb.xs),
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
  const colWidths = tables.length
    ? shared.pos.slice(1).map((x, c) => Math.round(x - shared.pos[c]!))
    : Array.from({ length: TEXT_ONLY_COLS }, () => Math.round(image.width / TEXT_ONLY_COLS));
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
      .filter((b) => b.block.kind === 'table' || b.block.text)
      .sort((a, b) => a.y - b.y)
      .map((b) => b.block),
  };
}
