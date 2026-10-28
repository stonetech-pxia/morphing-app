import { findSkew, localStats, sauvolaThreshold } from '@morph/tool-image';

import type { Box, RgbaImage } from './types';

// 找表格线（D-272）：局部阈值二值化（和扫描件增强的黑白模式同一个 Sauvola），按行、按列找长的深色段，
// 相邻的段接成一条线，再只留下和别的线连在一起的：横竖线交成网格的，或者至少 3 条左右对齐的横线
// （只有横线的表）。单独的横线（文字下面的划线、删除线、分隔线）不算表格线。
// 照片可能有一点倾斜：按 findSkew 估出的角度斜着扫描，线的坐标都是拉正后的（x' = x + y·t，y' = y − x·t）。

/** 一条线：横线的 pos 是 y、from / to 是 x；竖线反过来。坐标是拉正后的。 */
export interface RuleLine {
  pos: number;
  from: number;
  to: number;
  thickness: number;
  /** 有墨的几段（按 from 排好，不重叠）。 */
  spans: [number, number][];
}

export interface PageLines {
  width: number;
  height: number;
  /** 倾斜角（度）；坐标已经按它拉正。 */
  skew: number;
  horizontal: RuleLine[];
  vertical: RuleLine[];
}

/** 一张表的线和范围（拉正后的坐标）。 */
export interface TableLines {
  hs: RuleLine[];
  vs: RuleLine[];
  box: Box;
}

/** 分析用的图长边不超过这么大，超过就先缩小。 */
export const LINE_MAX_SIDE = 2000;
/** 段里允许的断口（像素）。 */
const MAX_GAP = 3;
/** 线的最短长度：max(40 像素, 页宽或页高的 3%)。 */
const MIN_LENGTH = 40;
const MIN_LENGTH_SHARE = 0.03;
/** 粗细超过页面的 1.5% 是色块，不是线。 */
const MAX_THICKNESS_SHARE = 0.015;
/** 相邻的段合并成一条线：位置差不超过长边的 0.4%。 */
const MERGE_SHARE = 0.004;
/** 同一条线上的两段，中间断开不超过页宽的 1.5% 时接起来（复印件常有断线）。 */
const JOIN_SHARE = 0.015;
/** 线和线算连在一起：端点离另一条线不超过长边的 1%。 */
const TOUCH_SHARE = 0.01;
/** 只有横线的表：左右两端对齐的误差（页宽的 2%），相邻两条最远隔页高的 40%（三线表的表身很高）。 */
const ALIGN_SHARE = 0.02;
const RULED_GAP_SHARE = 0.4;
const RULED_MIN = 3;

/** 墨水深浅：三个通道里最暗的那个（0 黑 – 1 白），红字、蓝字的线也算。 */
function inkOf(image: RgbaImage): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    out[p] = (r < g ? (r < b ? r : b) : g < b ? g : b) / 255;
  }
  return out;
}

/** 整数倍缩小（取每块里最暗的，细线不会被平均掉）。 */
function shrink(image: RgbaImage, k: number): RgbaImage {
  const width = Math.max(1, Math.floor(image.width / k));
  const height = Math.max(1, Math.floor(image.height / k));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 255 * 3 + 1;
      let at = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * image.width + x * k + dx) * 4;
          const s = image.data[i]! + image.data[i + 1]! + image.data[i + 2]!;
          if (s < best) {
            best = s;
            at = i;
          }
        }
      }
      const o = (y * width + x) * 4;
      data[o] = image.data[at]!;
      data[o + 1] = image.data[at + 1]!;
      data[o + 2] = image.data[at + 2]!;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** 二值化：Sauvola 局部阈值（统计图是半分辨率），1 是黑。 */
function darkMask(ink: Float32Array, width: number, height: number): Uint8Array {
  const stats = localStats(ink, width, height);
  const sw = stats.width;
  const thresholds = new Float32Array(sw * stats.height);
  for (let p = 0; p < thresholds.length; p++) {
    const mean = stats.data[p * 4]! / 255;
    const sd = stats.data[p * 4 + 1]! / 255 / 2;
    // 再加一道绝对门槛：浅灰的底纹、纸的纹理不算。
    thresholds[p] = Math.min(sauvolaThreshold(mean, sd), 0.75);
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(stats.height - 1, y >> 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, x >> 1);
      if (ink[y * width + x]! < thresholds[sy * sw + sx]!) mask[y * width + x] = 1;
    }
  }
  return mask;
}

interface Building {
  first: number;
  last: number;
  posSum: number;
  weight: number;
  from: number;
  to: number;
  spans: [number, number][];
}

/** 一组段（不重叠、排好）里加一段，重叠或挨着（gap 以内）的接起来。 */
export function addSpan(spans: [number, number][], a: number, b: number, gap: number): void {
  let i = 0;
  while (i < spans.length && spans[i]![1] + gap < a) i++;
  let lo = a;
  let hi = b;
  let j = i;
  while (j < spans.length && spans[j]![0] - gap <= hi) {
    lo = Math.min(lo, spans[j]![0]);
    hi = Math.max(hi, spans[j]![1]);
    j++;
  }
  spans.splice(i, j - i, [lo, hi]);
}

/** 一组段在 [a, b] 里盖住的长度。 */
export function coveredLength(spans: readonly (readonly [number, number])[], a: number, b: number) {
  let sum = 0;
  for (const [s, e] of spans) {
    const lo = Math.max(s, a);
    const hi = Math.min(e, b);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/**
 * 一个方向的线。horizontal 时沿 x 扫描每一行（行号是拉正后的 y），否则沿 y 扫描每一列。
 * t 是倾斜角的正切：横线上 y = r + x·t，竖线上 x = c − y·t。
 */
function scan(
  mask: Uint8Array,
  width: number,
  height: number,
  t: number,
  horizontal: boolean,
): RuleLine[] {
  const along = horizontal ? width : height;
  const across = horizontal ? height : width;
  const minLength = Math.max(MIN_LENGTH, along * MIN_LENGTH_SHARE);
  const maxThickness = Math.max(3, across * MAX_THICKNESS_SHARE);
  const slope = horizontal ? t : -t;
  const lo = Math.floor(Math.min(0, -along * slope));
  const hi = Math.ceil(Math.max(across, across - along * slope));
  const done: Building[] = [];
  let open: Building[] = [];
  for (let r = lo; r < hi; r++) {
    // 这一行（列）的长段。
    const runs: [number, number][] = [];
    let start = -1;
    let lastDark = -1;
    for (let i = 0; i <= along; i++) {
      let dark = false;
      if (i < along) {
        const j = Math.round(r + i * slope);
        if (j >= 0 && j < across) dark = mask[horizontal ? j * width + i : i * width + j] === 1;
      }
      if (dark) {
        if (start < 0) start = i;
        lastDark = i;
      } else if (start >= 0 && (i - lastDark > MAX_GAP || i === along)) {
        if (lastDark - start + 1 >= minLength) runs.push([start, lastDark]);
        start = -1;
      }
    }
    for (const [a, b] of runs) {
      let target: Building | undefined;
      for (const line of open) {
        const overlap = Math.min(b, line.to) - Math.max(a, line.from);
        if (line.last >= r - 2 && overlap >= 0.5 * Math.min(b - a, line.to - line.from)) {
          target = line;
          break;
        }
      }
      const length = b - a + 1;
      if (target) {
        target.last = r;
        target.posSum += r * length;
        target.weight += length;
        target.from = Math.min(target.from, a);
        target.to = Math.max(target.to, b);
        addSpan(target.spans, a, b, MAX_GAP);
      } else {
        open.push({
          first: r,
          last: r,
          posSum: r * length,
          weight: length,
          from: a,
          to: b,
          spans: [[a, b]],
        });
      }
    }
    const still: Building[] = [];
    for (const line of open) (line.last < r - 2 ? done : still).push(line);
    open = still;
  }
  done.push(...open);
  // 沿线方向的坐标也换到拉正后的：横线上 x' ≈ x + y'·t，竖线上 y' ≈ y − x'·t。
  const lines = done
    .filter((l) => l.last - l.first + 1 <= maxThickness)
    .map((l) => {
      const pos = l.posSum / l.weight;
      const shift = horizontal ? pos * t : -pos * t;
      return {
        pos,
        from: l.from + shift,
        to: l.to + shift,
        thickness: l.last - l.first + 1,
        spans: l.spans.map(([a, b]) => [a + shift, b + shift] as [number, number]),
      };
    });
  return joinCollinear(
    lines,
    Math.max(2, Math.max(width, height) * MERGE_SHARE),
    along * JOIN_SHARE,
  );
}

/** 同一位置上的几段接成一条（断线、和别的线交叉处断开的）。 */
function joinCollinear(lines: RuleLine[], posTol: number, gapTol: number): RuleLine[] {
  const out = [...lines].sort((a, b) => a.pos - b.pos || a.from - b.from);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (b.pos - a.pos > posTol) break;
        const gap = Math.max(a.from, b.from) - Math.min(a.to, b.to);
        if (gap > gapTol) continue;
        const la = a.to - a.from;
        const lb = b.to - b.from;
        const spans = a.spans.map((s) => [...s] as [number, number]);
        for (const [s, e] of b.spans) addSpan(spans, s, e, MAX_GAP);
        out[i] = {
          pos: (a.pos * la + b.pos * lb) / Math.max(1, la + lb),
          from: Math.min(a.from, b.from),
          to: Math.max(a.to, b.to),
          thickness: Math.max(a.thickness, b.thickness),
          spans,
        };
        out.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * 找一页里的横线和竖线。skew 不给时用 findSkew 估（增强过的图已经拉正，可以直接给 0）。
 * 图太大时先缩小，返回的坐标仍是这张图的像素。
 */
export function findLines(image: RgbaImage, options: { skew?: number } = {}): PageLines {
  const k = Math.max(1, Math.ceil(Math.max(image.width, image.height) / (LINE_MAX_SIDE * 1.05)));
  const work = k > 1 ? shrink(image, k) : image;
  const { width, height } = work;
  const ink = inkOf(work);
  const skew = options.skew ?? findSkew(ink, width, height);
  const t = Math.tan((skew * Math.PI) / 180);
  const mask = darkMask(ink, width, height);
  const scale = (l: RuleLine): RuleLine =>
    k === 1
      ? l
      : {
          pos: l.pos * k,
          from: l.from * k,
          to: l.to * k + k - 1,
          thickness: l.thickness * k,
          spans: l.spans.map(([a, b]) => [a * k, b * k + k - 1]),
        };
  return {
    width: image.width,
    height: image.height,
    skew,
    horizontal: scan(mask, width, height, t, true).map(scale),
    vertical: scan(mask, width, height, t, false).map(scale),
  };
}

/** 两条线（一横一竖）连在一起：交点在两条线上（端点允许差 tol）。 */
const touches = (h: RuleLine, v: RuleLine, tol: number) =>
  v.pos >= h.from - tol && v.pos <= h.to + tol && h.pos >= v.from - tol && h.pos <= v.to + tol;

/**
 * 只有和别的线连在一起的线才算表格线，连在一起的线组成一张表：
 * 横线至少碰到 2 条竖线、竖线至少碰到 2 条横线；或者至少 3 条左右两端对齐、上下挨得不远的横线（只有横线的表）。
 */
export function findTables(page: PageLines): TableLines[] {
  const long = Math.max(page.width, page.height);
  const tol = Math.max(4, long * TOUCH_SHARE);
  const hs = page.horizontal;
  const vs = page.vertical;
  // 网格：反复去掉连得不够的线，直到不再变化。
  const hOk = hs.map(() => true);
  const vOk = vs.map(() => true);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [i, h] of hs.entries()) {
      if (!hOk[i]) continue;
      if (vs.filter((v, j) => vOk[j] && touches(h, v, tol)).length < 2) {
        hOk[i] = false;
        changed = true;
      }
    }
    for (const [j, v] of vs.entries()) {
      if (!vOk[j]) continue;
      if (hs.filter((h, i) => hOk[i] && touches(h, v, tol)).length < 2) {
        vOk[j] = false;
        changed = true;
      }
    }
  }
  // 只有横线的表：按位置从上到下，左右两端都和上一条对齐、离得不远的接成一串。
  const align = page.width * ALIGN_SHARE;
  const maxGap = page.height * RULED_GAP_SHARE;
  const chains: number[][] = [];
  const order = hs.map((_, i) => i).sort((a, b) => hs[a]!.pos - hs[b]!.pos);
  for (const i of order) {
    const h = hs[i]!;
    const chain = chains.find((c) => {
      const lastIndex = c.at(-1)!;
      const last = hs[lastIndex]!;
      const gap = h.pos - last.pos;
      if (gap > maxGap || Math.abs(h.from - last.from) > align || Math.abs(h.to - last.to) > align)
        return false;
      // 从网格的线接到不在网格里的线（或反过来）：只有间距和上一格差不多（不到 2 倍）时才接，
      // 例如表头有竖线、下面只有横线的表；网格下面隔着标题的另一张只有横线的表不接上去。
      if (hOk[i] !== hOk[lastIndex]) {
        const prev = c.length >= 2 ? last.pos - hs[c.at(-2)!]!.pos : null;
        return prev !== null && gap <= 2 * prev;
      }
      return true;
    });
    if (chain) chain.push(i);
    else chains.push([i]);
  }
  // 并查集：横线 0..H-1，竖线 H..H+V-1。
  const parent = [...hs, ...vs].map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const used = new Set<number>();
  for (const [i, h] of hs.entries()) {
    if (!hOk[i]) continue;
    for (const [j, v] of vs.entries()) {
      if (vOk[j] && touches(h, v, tol)) {
        union(i, hs.length + j);
        used.add(i).add(hs.length + j);
      }
    }
  }
  for (const chain of chains) {
    if (chain.length < RULED_MIN) continue;
    for (const i of chain) {
      union(i, chain[0]!);
      used.add(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of used) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  const tables: TableLines[] = [];
  for (const members of groups.values()) {
    const th = members.filter((i) => i < hs.length).map((i) => hs[i]!);
    const tv = members.filter((i) => i >= hs.length).map((i) => vs[i - hs.length]!);
    if (th.length < 2) continue;
    const left = Math.min(...th.map((h) => h.from), ...tv.map((v) => v.pos));
    const right = Math.max(...th.map((h) => h.to), ...tv.map((v) => v.pos));
    const top = Math.min(...th.map((h) => h.pos), ...tv.map((v) => v.from));
    const bottom = Math.max(...th.map((h) => h.pos), ...tv.map((v) => v.to));
    tables.push({
      hs: th.sort((a, b) => a.pos - b.pos),
      vs: tv.sort((a, b) => a.pos - b.pos),
      box: { x: left, y: top, width: right - left, height: bottom - top },
    });
  }
  return tables.sort((a, b) => a.box.y - b.box.y);
}
