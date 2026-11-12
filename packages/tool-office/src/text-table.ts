import type { Box, OcrBox, RgbaImage, TableBlock, TableCell } from './types';

// 转 Word 的通用版面修正（D-471，创始人 2026-11-06：小票「转化的很差」，按建议做、「不要做小票特殊规则」）：
// 1. 整页的倾斜：照片拍歪、纸弯了时，同一行右边的字比左边高（或低），按水平分行会把右边的字分到上一行。
//    先估出整页的斜率，按斜线分行。
// 2. 没有线的表：好几行都按同样的几列对齐（左边一段字、右边几列数字），按列排成一张没有边框的表，
//    不再把几列接成一句话。至少三列、三行，两列的「标签：值」照旧（D-332）。
// 3. 条形码：一片很密的竖条、里面没有字，当图片剪下来，不当成字。

const median = (values: readonly number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
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

// ---- 1. 倾斜 ----

/** 斜率的搜索范围（约 ±5°）和步长。 */
const MAX_SLOPE = 0.09;
const SLOPE_STEP = 0.0025;

/**
 * 整页的斜率（y 每往右 1 像素变多少）：试一串斜率，看哪个能让左右分开的行最多地对到同一高度。
 * 行太少、看不出来时是 0。
 */
export function pageSlope(lines: readonly OcrBox[], lineHeight: number): number {
  return slopeFit(lines, lineHeight).slope;
}

/** 斜率和有多少对左右分开的行在这个斜率下对到了同一高度（越多越可信）。 */
function slopeFit(lines: readonly OcrBox[], lineHeight: number): { slope: number; score: number } {
  if (lines.length < 4) return { slope: 0, score: 0 };
  const pts = lines.map((l) => ({
    cx: l.x + l.width / 2,
    cy: l.y + l.height / 2,
    left: l.x,
    right: l.x + l.width,
  }));
  const tol = 0.25 * lineHeight;
  let best = { slope: 0, score: -1 };
  for (let k = -Math.round(MAX_SLOPE / SLOPE_STEP); k <= Math.round(MAX_SLOPE / SLOPE_STEP); k++) {
    const s = k * SLOPE_STEP;
    let score = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        // 只看左右分开的两块（同一列上下的行不说明倾斜）。
        if (a.right > b.left && b.right > a.left) continue;
        const dy = a.cy - s * a.cx - (b.cy - s * b.cx);
        if (Math.abs(dy) < tol) score++;
      }
    }
    // 一样好时取更平的。
    if (score > best.score || (score === best.score && Math.abs(s) < Math.abs(best.slope))) {
      best = { slope: s, score };
    }
  }
  return best.score > 0 ? best : { slope: 0, score: 0 };
}

/** 按斜线拉平以后的样子（只改 y；x、大小不变）。 */
export function levelLine(line: OcrBox, slope: number, centerX: number): OcrBox {
  if (!slope) return line;
  return { ...line, y: Math.round(line.y - slope * (line.x + line.width / 2 - centerX)) };
}

/** 局部的斜率按多高的一段算（行高的倍数）：纸弯了时上下的斜率不一样。 */
const BAND_LINES = 6;
/** 一段里至少这么多对左右分开的行对上，这一段的斜率才可信。 */
const MIN_PAIRS = 3;

/**
 * 每一行拉平（D-471）：页面按高度分成几段（每段几个行高，上下各多看半段），每段自己估斜率
 * （小票这样弯的纸，上面和下面斜得不一样）；一段里的行太少时用整页的斜率。
 */
export function levelLines(
  lines: readonly OcrBox[],
  lineHeight: number,
  centerX: number,
): OcrBox[] {
  const whole = pageSlope(lines, lineHeight);
  const band = BAND_LINES * lineHeight;
  const cy = (l: OcrBox) => l.y + l.height / 2;
  const slopes = new Map<number, number>();
  // 第 k 段的斜率（中心在 (k + 0.5) × 段高）：对上的不到三对时不可信，用整页的。
  const slopeOf = (k: number) => {
    let s = slopes.get(k);
    if (s === undefined) {
      const near = lines.filter((l) => Math.abs(cy(l) - (k + 0.5) * band) <= band);
      const fit = slopeFit(near, lineHeight);
      s = fit.score >= MIN_PAIRS ? fit.slope : whole;
      slopes.set(k, s);
    }
    return s;
  };
  // 两段之间按位置平滑过渡：同一排的几块落在两段交界处时斜率差不多，不会被分开。
  const at = (y: number) => {
    const t = y / band - 0.5;
    const k = Math.floor(t);
    const f = t - k;
    return (1 - f) * slopeOf(Math.max(0, k)) + f * slopeOf(Math.max(0, k + 1));
  };
  return lines.map((l) => levelLine(l, at(cy(l)), centerX));
}

// ---- 2. 没有线的表 ----

/** 一排里隔开的一段（一格的候选）。 */
interface Segment {
  lines: OcrBox[];
  x: number;
  right: number;
}

interface TextRow {
  lines: OcrBox[];
  segments: Segment[];
  top: number;
  bottom: number;
}

/** 拉平以后按高度分排（和上一排的中线差不到半个行高就是同一排），每排按空隙分段。 */
function textRows(lines: readonly OcrBox[], lineHeight: number): TextRow[] {
  const sorted = [...lines].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const groups: OcrBox[][] = [];
  for (const line of sorted) {
    const g = groups.at(-1);
    const mid = (l: OcrBox) => l.y + l.height / 2;
    if (g && Math.abs(mid(line) - median(g.map(mid))) < 0.5 * Math.min(lineHeight, line.height)) {
      g.push(line);
    } else groups.push([line]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    const segments: Segment[] = [];
    for (const line of g) {
      const last = segments.at(-1);
      // 挨得很近的两块是同一段（识别把一句话拆开了）。
      if (last && line.x - last.right < 0.6 * lineHeight) {
        last.lines.push(line);
        last.right = Math.max(last.right, line.x + line.width);
      } else segments.push({ lines: [line], x: line.x, right: line.x + line.width });
    }
    return {
      lines: g,
      segments,
      top: Math.min(...g.map((l) => l.y)),
      bottom: Math.max(...g.map((l) => l.y + l.height)),
    };
  });
}

/** 列：几排里的段大多落在同一段横向范围里；列和列之间是几乎没有字的空白。 */
function columnBands(rows: readonly TextRow[]): { x: number; right: number }[] {
  const multi = rows.filter((r) => r.segments.length >= 2);
  const left = Math.min(...rows.flatMap((r) => r.segments.map((s) => s.x)));
  const right = Math.max(...rows.flatMap((r) => r.segments.map((s) => s.right)));
  const width = Math.ceil(right - left) + 1;
  const cover = new Uint16Array(width);
  for (const row of multi) {
    for (const s of row.segments) {
      for (let x = Math.floor(s.x - left); x < Math.ceil(s.right - left); x++) cover[x]!++;
    }
  }
  // 只有一两排跨过去的地方也算空白（一排长的字跨了两列）。
  const empty = Math.max(1, Math.floor(multi.length * 0.12));
  const bands: { x: number; right: number }[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const on = x < width && cover[x]! > empty;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      bands.push({ x: left + start, right: left + x });
      start = -1;
    }
  }
  return bands;
}

/** 这一段落在哪几列（按和每列重叠的多少）。 */
function spanOf(seg: Segment, bands: readonly { x: number; right: number }[]): [number, number] {
  const hits = bands
    .map((b, i) => ({
      i,
      ov: Math.min(b.right, seg.right) - Math.max(b.x, seg.x),
    }))
    .filter((h) => h.ov > 0.3 * Math.min(seg.right - seg.x, bands[h.i]!.right - bands[h.i]!.x));
  if (!hits.length) {
    // 落在空白里：离中心最近的那列。
    const c = (seg.x + seg.right) / 2;
    let best = 0;
    bands.forEach((b, i) => {
      const d = Math.abs((b.x + b.right) / 2 - c);
      if (d < Math.abs((bands[best]!.x + bands[best]!.right) / 2 - c)) best = i;
    });
    return [best, best];
  }
  return [hits[0]!.i, hits.at(-1)!.i];
}

/** 一段字是一个数（金额、数量、比率）：有数字，字母不超过 3 个（「€」「kg」「%」这类单位）。 */
const isNumber = (s: Segment) => {
  const text = s.lines.map((l) => l.text).join(' ');
  return /\d/.test(text) && (text.match(/\p{L}/gu)?.length ?? 0) <= MAX_UNIT_LETTERS;
};

/**
 * 第 k 列和第 k + 1 列之间隔得很远时，右边是不是一列列的数、一排一排对着左边（D-502）：
 * 右边的段至少七成是数，右边有字的排至少七成在左边也有字、而且左右两边的高度差不到 1/4 个行高
 * （拍得很斜、没拉平的照片里，碰巧挨上的左右两段差得多，配成一排会把金额配到别的项目旁边），
 * 这样的排至少三排。
 */
function lockedRows(
  spans: readonly { s: Segment; span: [number, number] }[][],
  k: number,
  lineHeight: number,
  textColumns = false,
): boolean {
  const mid = (seg: Segment) => median(seg.lines.map((l) => l.y + l.height / 2));
  const right = spans.filter((row) => row.some((x) => x.span[0] > k));
  const both = right.filter((row) => {
    const l = row.filter((x) => x.span[1] <= k).map((x) => mid(x.s));
    const r = row.filter((x) => x.span[0] > k).map((x) => mid(x.s));
    return l.length > 0 && Math.abs(median(l) - median(r)) <= LOCKED_SKEW * lineHeight;
  });
  const segs = right.flatMap((row) => row.filter((x) => x.span[0] > k).map((x) => x.s));
  return (
    both.length >= MIN_ROWS &&
    both.length >= LOCKED_SHARE * right.length &&
    (textColumns || segs.filter(isNumber).length >= LOCKED_SHARE * segs.length)
  );
}

export interface TextTable {
  /** 拉平以后的行（从 free 里拿掉）。 */
  lines: OcrBox[];
  table: TableBlock;
  /** 每列的宽（原图像素）。 */
  colWidths: number[];
  /** 每列的字从哪到哪（x）：列线可以放在两列之间的空白里任何地方（D-506）。 */
  bands: { x: number; right: number }[];
  box: Box;
}

/**
 * 一张没有线的表至少三列、三排分成了几段、其中两排用到了三列以上；格子里的字大多是短的
 * （三栏排的文章每段都长，不当表）。
 */
const MIN_COLS = 3;
const MIN_ROWS = 3;
const MIN_WIDE_ROWS = 2;
const MAX_CELL_CHARS = 24;
const MAX_COL_GAP = 3;
/** 隔得远的右边几列：至少这么多比例是数、这么多比例的排在左边有字（D-502）。 */
const LOCKED_SHARE = 0.7;
const LOCKED_SKEW = 0.25;
const MAX_UNIT_LETTERS = 3;
/** 表上下的排算紧挨着：和表的隔开不超过表里最大的排间空隙再多这么多个行高（D-506）。 */
const NEAR_SLACK = 0.5;

/** 这一排能按这张表的列排：至少两段，每段从不同的列开始（没有两段挤在同一列，跨到下一列的截到那一列为止）。 */
function fitsBands(row: TextRow, bands: readonly Band[]): boolean {
  const starts = row.segments.map((seg) => spanOf(seg, bands)[0]);
  return starts.length >= 2 && new Set(starts).size === starts.length;
}

/**
 * 找没有线的表：连续几排（中间可以夹着只有一段的排，空隙不大），按列对齐，至少三列、三排用到三列以上。
 * lines 是拉平以后的行；original 把拉平的行换回原来的（格子在原图里的位置，截图核对、原图小窗用）。
 */
export function findTextTables(
  lines: readonly OcrBox[],
  lineHeight: number,
  original: (l: OcrBox) => OcrBox = (l) => l,
  /** 已被可信表格区域圈定：仍要求多排对齐，但隔得远的列也可以是姓名、状态等文字。 */
  textColumns = false,
): TextTable[] {
  const rows = textRows(lines, lineHeight);
  // 先找三列以上的表，再在剩下的排里找两列的清单（D-503）：两列的「项目 → 金额」不能抢三列的表的排
  // （小票的合计把下面的 GST 汇总吞进一张两列的表、压成两列，或者先拿走汇总上面的几排、汇总凑不成表）。
  const wide = runTables(rows, lineHeight, original, false, textColumns);
  const used = new Set(wide.flatMap(({ from, to }) => rows.slice(from, to + 1)));
  // 三列以上的表下面紧挨着的一两排、自己凑不成表（小票的 GST 汇总：表头一排、数一排）：
  // 能按这张表的列排（每段从不同的列开始），就接到这张表下面，列不重算（D-503）。
  // 加进来一起算列的话，汇总的表头横在两列之间，会把三列并成两列。
  for (const w of wide) {
    const tail: TextRow[] = [];
    for (let k = w.to + 1; k < rows.length && !used.has(rows[k]!); k++) {
      if (rows[k]!.top - rows[k - 1]!.bottom > 1.8 * lineHeight) break;
      if (!fitsBands(rows[k]!, w.bands)) break;
      tail.push(rows[k]!);
    }
    if (!tail.length || tail.length >= MIN_ROWS) continue;
    w.table = buildTable(rows.slice(w.from, w.to + 1 + tail.length), w.bands, original);
    for (const row of tail) used.add(row);
  }
  const out = wide.map(({ table }) => table);
  let group: TextRow[] = [];
  for (const row of [...rows, null]) {
    if (row && !used.has(row)) {
      group.push(row);
      continue;
    }
    if (group.length) out.push(...runTables(group, lineHeight, original, true).map((t) => t.table));
    group = [];
  }
  return out.sort((x, y) => x.box.y - y.box.y);
}

/** 一串连着的排里找表：从上往下，每处取最长的、还能成表的一段。twoColumns 时也收两列的清单。 */
function runTables(
  rows: readonly TextRow[],
  lineHeight: number,
  original: (l: OcrBox) => OcrBox,
  twoColumns: boolean,
  textColumns = false,
): { table: TextTable; bands: Band[]; from: number; to: number }[] {
  const out: { table: TextTable; bands: Band[]; from: number; to: number }[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.segments.length < 2) {
      i++;
      continue;
    }
    // 往下接：有两段以上的排，或者夹在两段以上的排之间、空隙不大的一段的排。
    let j = i;
    let lastMulti = i;
    while (j + 1 < rows.length) {
      const next = rows[j + 1]!;
      if (next.top - rows[j]!.bottom > 1.8 * lineHeight) break;
      j++;
      if (next.segments.length >= 2) lastMulti = j;
      else if (j - lastMulti > 2) break;
    }
    // 上下两部分的列不一样时（小票的商品和下面的合计）整段凑不成一张表：取从这里开始最长的、还能成表的一段。
    let found: { table: TextTable; bands: Band[]; end: number } | null = null;
    for (let end = lastMulti; end >= i + MIN_ROWS - 1 && !found; end--) {
      if (rows[end]!.segments.length < 2) continue;
      // 表上下紧挨着的两排（隔着不到 1.8 个行高）：看隔得远的数列有没有错位（D-502）。
      // 错开的数是这张表自己的那列数，和表里的排一样密；隔得比表里任何两排之间都明显远（多半个行高以上）的
      // 是另一块（发票表下面右边两列的 Subtotal / VAT / Total），不算错开的数（D-506）。
      let spacing = 0;
      for (let k = i + 1; k <= end; k++) {
        spacing = Math.max(spacing, rows[k]!.top - rows[k - 1]!.bottom);
      }
      const close = (gap: number) =>
        gap <= Math.min(1.8 * lineHeight, Math.max(0, spacing) + NEAR_SLACK * lineHeight);
      const near: TextRow[] = [];
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
        if (!close(rows[k + 1]!.top - rows[k]!.bottom)) break;
        near.push(rows[k]!);
      }
      for (let k = end + 1; k <= Math.min(rows.length - 1, end + 2); k++) {
        if (!close(rows[k]!.top - rows[k - 1]!.bottom)) break;
        near.push(rows[k]!);
      }
      const hit = tableOf(
        rows.slice(i, end + 1),
        lineHeight,
        original,
        near,
        twoColumns,
        textColumns,
      );
      if (hit) found = { ...hit, end };
    }
    if (found) {
      out.push({ table: found.table, bands: found.bands, from: i, to: found.end });
      i = found.end + 1;
    } else i++;
  }
  return out;
}

function tableOf(
  run: readonly TextRow[],
  lineHeight: number,
  original: (l: OcrBox) => OcrBox,
  near: readonly TextRow[] = [],
  twoColumns = false,
  textColumns = false,
): { table: TextTable; bands: Band[] } | null {
  const bands = columnBands(run);
  if (bands.length < 2) return null;
  const spans = run.map((row) => row.segments.map((s) => ({ s, span: spanOf(s, bands) })));
  // 列和列隔得太远（超过 3 个行高）的是并排的两块（左边地址、右边「标签：值」），不是一张表（和分块的规则一样）。
  // 除非远处那几列是数，而且每一排的数在左边都有字（D-502：工资单、账单的表身，左边一列项目名、
  // 隔得很远的右边几列金额；表格线没认出来时也按排排成表，不把项目名和金额分成两块，排对不上）。
  const far = bands
    .slice(1)
    .map((b, k) => k)
    .filter((k) => bands[k + 1]!.x - bands[k]!.right > MAX_COL_GAP * lineHeight);
  if (far.some((k) => !lockedRows(spans, k, lineHeight, textColumns))) return null;
  // 表上下紧挨着有只在远处那几列、左边没字的数：数列整体错开了几排（拍得很斜、没拉平的照片，
  // 碰巧对齐的是别的项目），按排配会配错，不成表（D-502）。
  const stray = (row: TextRow, k: number) =>
    row.segments.some(isNumber) && row.segments.every((x) => spanOf(x, bands)[0] > k);
  if (far.some((k) => near.some((row) => stray(row, k)))) return null;
  // 两列的也算（D-502）：左边项目、隔得很远的右边一列数（小票的合计、账单的费用清单），一排一排对着；
  // 隔得近的两列「标签：值」照旧（D-332）。
  const minCols = twoColumns && bands.length === 2 && far.length === 1 ? 2 : MIN_COLS;
  if (bands.length < minCols) return null;
  const wide = spans.filter((r) => new Set(r.map((x) => x.span[0])).size >= minCols).length;
  if (wide < MIN_WIDE_ROWS) return null;
  if (run.filter((r) => r.segments.length >= 2).length < MIN_ROWS) return null;
  const lengths = run.flatMap((r) =>
    r.segments.map((seg) => seg.lines.reduce((n, l) => n + l.text.trim().length, 0)),
  );
  if (median(lengths) > MAX_CELL_CHARS) return null;
  return { table: buildTable(run, bands, original), bands };
}

type Band = { x: number; right: number };

/** 按给定的列把几排排成一张表。 */
function buildTable(
  run: readonly TextRow[],
  bands: readonly Band[],
  original: (l: OcrBox) => OcrBox,
): TextTable {
  const spans = run.map((row) => row.segments.map((s) => ({ s, span: spanOf(s, bands) })));
  const cells: TableCell[] = [];
  for (const [r, row] of spans.entries()) {
    // 同一列里的几段接起来；跨列的段占几列。
    const byCol = new Map<number, { segs: Segment[]; end: number }>();
    for (const { s, span } of row) {
      const at = byCol.get(span[0]);
      if (at) {
        at.segs.push(s);
        at.end = Math.max(at.end, span[1]);
      } else byCol.set(span[0], { segs: [s], end: span[1] });
    }
    let c = 0;
    const starts = [...byCol.keys()].sort((a, b) => a - b);
    for (const start of starts) {
      if (start < c) continue;
      for (; c < start; c++) cells.push(emptyCell(r, c));
      const { segs, end } = byCol.get(start)!;
      const last = Math.max(
        start,
        Math.min(end, (starts.find((k) => k > start) ?? bands.length) - 1),
      );
      const segLines = segs.flatMap((s) => s.lines);
      const box = unionBox(segLines.map(original));
      const band = { x: bands[start]!.x, right: bands[last]!.right };
      const segLeft = Math.min(...segs.map((s) => s.x));
      const segRight = Math.max(...segs.map((s) => s.right));
      // 数字一列常常靠右对齐：右边贴着、左边空得多。
      const align =
        segRight - segLeft < 0.7 * (band.right - band.x) &&
        band.right - segRight < 0.5 * (segLeft - band.x)
          ? 'right'
          : undefined;
      cells.push({
        row: r,
        col: start,
        rowSpan: 1,
        colSpan: last - start + 1,
        text: segs.map((s) => s.lines.map((l) => l.text.trim()).join(' ')).join(' '),
        ...(align ? { align } : {}),
        box,
      });
      c = last + 1;
    }
    for (; c < bands.length; c++) cells.push(emptyCell(r, c));
  }
  // 对齐按列定：一列里大多数格子靠右，整列都靠右（一列里有的靠右、有的靠左看着乱）。
  for (let c = 0; c < bands.length; c++) {
    const inCol = cells.filter((x) => x.col === c && x.colSpan === 1 && x.text);
    const right = inCol.filter((x) => x.align === 'right').length;
    for (const x of inCol) {
      if (right * 2 >= inCol.length && right > 0) x.align = 'right';
      else delete x.align;
    }
  }
  const all = run.flatMap((row) => row.lines);
  const box = unionBox(all.map(original));
  // 列宽：列和列之间的空白平分给两边。
  const edges = [
    box.x,
    ...bands.slice(1).map((b, k) => (bands[k]!.right + b.x) / 2),
    box.x + box.width,
  ];
  const colWidths = bands.map((_, k) => Math.max(1, Math.round(edges[k + 1]! - edges[k]!)));
  return {
    lines: all,
    table: { kind: 'table', rows: run.length, col: 0, cols: bands.length, cells, box },
    colWidths,
    bands: bands.map(({ x, right }) => ({ x, right })),
    box,
  };
}

const emptyCell = (row: number, col: number): TableCell => ({
  row,
  col,
  rowSpan: 1,
  colSpan: 1,
  text: '',
});

// ---- 3. 条形码 ----

/** 一条横线上黑白交替至少这么多次（条形码有几十条竖线；一行字也会，所以有字的地方不看）。 */
const BAR_TRANSITIONS = 24;
/** 相邻两条横线上至少这么多比例的黑白交替位置对得上，才是同一片竖条。 */
const BAR_MATCH = 0.7;

/**
 * 条形码这样的一片竖条：从上到下几条横线都有很多次黑白交替、而且那里没有认出来的字。
 * 返回它们的范围（原图像素）；高度不到一个行高的不要。
 */
export function findBarcodes(
  image: RgbaImage,
  lines: readonly OcrBox[],
  lineHeight: number,
): Box[] {
  const { width, height, data } = image;
  const step = Math.max(2, Math.round(lineHeight / 4));
  const pad = 0.3 * lineHeight;
  const covered = (y: number) => lines.some((l) => y >= l.y - pad && y <= l.y + l.height + pad);
  const hits: { y: number; x0: number; x1: number; edges: number[] }[] = [];
  // 有字的横线不看；记下来：条形码中间夹着一行认出来的零星的字时，上下两半还是同一片。
  const skipped = new Set<number>();
  for (let y = 0; y < height; y += step) {
    if (covered(y)) {
      skipped.add(y);
      continue;
    }
    // 这一行的亮度，用这一行的平均值分黑白。
    const lum = new Float32Array(width);
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      lum[x] = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
      sum += lum[x]!;
    }
    const mean = sum / width;
    let prev = lum[0]! < mean;
    let count = 0;
    let x0 = -1;
    let x1 = -1;
    const edges: number[] = [];
    for (let x = 1; x < width; x++) {
      const dark = lum[x]! < mean;
      if (dark !== prev) {
        count++;
        edges.push(x);
        if (x0 < 0) x0 = x;
        x1 = x;
      }
      prev = dark;
    }
    // 只算差别够大的（纯白纸上的噪点不算）。
    let min = 255;
    let max = 0;
    for (let x = 0; x < width; x++) {
      min = Math.min(min, lum[x]!);
      max = Math.max(max, lum[x]!);
    }
    if (count >= BAR_TRANSITIONS && max - min > 80) hits.push({ y, x0, x1, edges });
  }
  // 竖条上下是同一根：相邻两条横线上的黑白交替大多在同样的位置（字的笔画、照片的纹理不会）。
  const sameBars = (a: number[], b: number[]) => {
    const tol = Math.max(2, Math.round(width / 400));
    let j = 0;
    let match = 0;
    for (const x of a) {
      while (j < b.length && b[j]! < x - tol) j++;
      if (j < b.length && Math.abs(b[j]! - x) <= tol) match++;
    }
    return match >= BAR_MATCH * Math.max(a.length, b.length);
  };
  // 连着的几条横线合成一片。
  const out: Box[] = [];
  let group: typeof hits = [];
  const flush = () => {
    if (group.length >= 2 && group.at(-1)!.y - group[0]!.y + step >= lineHeight) {
      const x0 = median(group.map((g) => g.x0));
      const x1 = median(group.map((g) => g.x1));
      const y0 = group[0]!.y;
      const y1 = Math.min(height, group.at(-1)!.y + step);
      out.push({
        x: Math.max(0, Math.round(x0)),
        y: y0,
        width: Math.round(x1 - x0),
        height: y1 - y0,
      });
    }
    group = [];
  };
  for (const h of hits) {
    const last = group.at(-1);
    let apart = last ? h.y - last.y : 0;
    if (last) {
      // 中间跳过的都是有字的横线时不算隔开。
      for (let y = last.y + step; y < h.y && skipped.has(y); y += step) apart -= step;
    }
    if (last && (apart > 2 * step || !sameBars(last.edges, h.edges))) flush();
    group.push(h);
  }
  flush();
  return out;
}
