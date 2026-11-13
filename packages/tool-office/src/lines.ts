import { findSkew, localStats, sauvolaThreshold } from '@morph/tool-image';

import type { Box, RgbaImage } from './types';

// 找表格线（D-272）：局部阈值二值化（和扫描件增强的黑白模式同一个 Sauvola），按行、按列找长的深色段，
// 相邻的段接成一条线，再只留下和别的线连在一起的：横竖线交成网格的（加上网格里只碰到一条线的 T 字形线），
// 或者至少 3 条左右对齐的横线（只有横线的表）。单独的横线（文字下面的划线、删除线、分隔线）不算表格线。
// 照片可能有一点倾斜：按 findSkew 估出的角度斜着扫描，线的坐标都是拉正后的（x' = x + y·t，y' = y − x·t）。

/** 一条线：横线的 pos 是 y、from / to 是 x；竖线反过来。坐标是拉正后的。 */
export interface RuleLine {
  pos: number;
  from: number;
  to: number;
  thickness: number;
  /** 有墨的几段（按 from 排好，不重叠）。 */
  spans: [number, number][];
  /** 实心横条的上边、下边（D-501）。 */
  band?: 'top' | 'bottom';
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
/**
 * 线的最短长度：max(24 像素, 页宽或页高的 1.5%)。真实的表单里一行只有 30 像素高，竖线也要认出来；
 * 粗体字连成的「线」在 build.ts 里按识别框去掉（dropTextStrokes）。
 */
const MIN_LENGTH = 24;
const MIN_LENGTH_SHARE = 0.015;
/** 粗细超过页面的 1.5% 是色块，不是线。 */
const MAX_THICKNESS_SHARE = 0.015;
/** 相邻的段合并成一条线：位置差不超过长边的 0.4%。 */
const MERGE_SHARE = 0.004;
/**
 * 同一条线上的两段，中间断开不超过 max(8 像素, 页宽的 0.5%) 时接起来（复印件常有断线）。
 * 再大会把上下挨着的两个框（工资单里隔 15–20 像素）的边接成一条。
 */
const JOIN_MIN = 8;
const JOIN_SHARE = 0.005;
/** 线和线算连在一起：端点离另一条线不超过长边的 0.5%（挨着的两个框不算连在一起）。 */
const TOUCH_SHARE = 0.005;
/**
 * 实心的横条（D-501：工资单、发票表头的深色底条，里面是白字）：比线粗、不超过页高的 6%，长至少是粗的 2 倍，
 * 六成以上是墨（字是白的）。只有至少两条竖线从它的上下边起止时（表格的列线）才算表格的一部分：
 * 当成一个框，上下边是两条横线、左右两头是两条竖线。横条里那一行没有竖线盖住，格子按上下的列线分
 * （表头格子之间的白缝在照片里常常看不出来，不靠它）。
 * 找竖线前先把它抹掉，不然从它下面往下画的竖线和它连成一大块，被当成色块整个丢掉。
 * 页边的黑边、彩色的箭头条、标志没有竖线起止，不算。
 */
const BAND_MAX_SHARE = 0.06;
const BAND_MIN_ELONGATION = 2;
const BAND_MIN_FILL = 0.6;
const BAND_MIN_ANCHORS = 2;
/** 只有横线的表：左右两端对齐的误差（页宽的 2%），相邻两条最远隔页高的 40%（三线表的表身很高）。 */
const ALIGN_SHARE = 0.02;
const RULED_GAP_SHARE = 0.4;
const RULED_MIN = 3;

/**
 * 很浅的表格线（转 Word 用，findLines 的 light）：电子版的发票模板、表单常用浅灰的线（最暗的通道 0.75–0.86），
 * Sauvola 在白纸上的阈值只有 0.7 左右，找不到。纸很白（整页一半以上的点至少 LIGHT_PAPER：电子版、干净的扫描件）时，
 * 比纸暗 LIGHT_CONTRAST 的点也算，但只算细的：横着找线时上下连着不超过 LIGHT_THICKNESS（竖线反过来）。
 * 浅色底纹的格子、色块又宽又高，不算（不然底纹的格子会被当成横条、把表切开）。照片的纸不够白，不受影响。
 */
const LIGHT_PAPER = 0.95;
const LIGHT_CONTRAST = 0.1;
const LIGHT_THICKNESS_SHARE = 0.004;

/** 整页纸的亮度：墨水深浅的中位数（按 1/256 分档）。 */
function paperOf(ink: Float32Array): number {
  const counts = new Uint32Array(257);
  for (let p = 0; p < ink.length; p++) counts[Math.round(ink[p]! * 256)]!++;
  let seen = 0;
  for (let v = 0; v <= 256; v++) {
    seen += counts[v]!;
    if (seen * 2 >= ink.length) return v / 256;
  }
  return 1;
}

/**
 * 在 mask 上加上浅的细线：比纸暗 LIGHT_CONTRAST、沿 across 方向连着不超过 max 个点、两边是白纸的。
 * vertical 为 true 时按列数连着的点（给横线用），否则按行数（给竖线用）。
 */
function addThinLight(
  mask: Uint8Array,
  ink: Float32Array,
  width: number,
  height: number,
  paper: number,
  max: number,
  vertical: boolean,
): Uint8Array {
  const limit = paper - LIGHT_CONTRAST;
  const bright = paper - LIGHT_CONTRAST / 2;
  const out = mask.slice();
  const outer = vertical ? width : height;
  const inner = vertical ? height : width;
  const at = (o: number, i: number) => (vertical ? i * width + o : o * width + i);
  for (let o = 0; o < outer; o++) {
    let start = -1;
    for (let i = 0; i <= inner; i++) {
      const dark = i < inner && ink[at(o, i)]! < limit;
      if (dark && start < 0) start = i;
      else if (!dark && start >= 0) {
        // 两边隔一个点（线边上的灰边）还得是白纸：浅色底纹里的噪点、底纹夹在两行字中间的窄条不算。
        const before = ink[at(o, Math.max(0, start - 2))]!;
        const after = ink[at(o, Math.min(inner - 1, i + 1))]!;
        if (i - start <= max && before >= bright && after >= bright)
          for (let k = start; k < i; k++) out[at(o, k)] = 1;
        start = -1;
      }
    }
  }
  return out;
}

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

/** 实心的横条：first、last 是上下两边的扫描行号，from、to 是左右（拉正后、换算前）。 */
interface Band {
  first: number;
  last: number;
  from: number;
  to: number;
  spans: [number, number][];
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
  /** 给了就收集实心的横条（BAND_MAX_SHARE），不当成线。 */
  bands?: Band[],
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
  if (bands) {
    for (const l of done) {
      const thickness = l.last - l.first + 1;
      const length = l.to - l.from + 1;
      if (
        thickness > maxThickness &&
        thickness <= across * BAND_MAX_SHARE &&
        length >= BAND_MIN_ELONGATION * thickness &&
        l.weight >= BAND_MIN_FILL * length * thickness
      )
        bands.push({ first: l.first, last: l.last, from: l.from, to: l.to, spans: l.spans });
    }
  }
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
    Math.max(JOIN_MIN, along * JOIN_SHARE),
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
          ...(a.band || b.band ? { band: a.band ?? b.band } : {}),
        };
        out.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** 抹掉横条（扫描行号 r 上的点在 y = r + x·t）。 */
function eraseBands(
  mask: Uint8Array,
  width: number,
  height: number,
  t: number,
  bands: readonly Band[],
): Uint8Array {
  if (!bands.length) return mask;
  const out = mask.slice();
  for (const b of bands) {
    for (let r = b.first; r <= b.last; r++) {
      for (let x = Math.max(0, b.from); x <= Math.min(width - 1, b.to); x++) {
        const y = Math.round(r + x * t);
        if (y >= 0 && y < height) out[y * width + x] = 0;
      }
    }
  }
  return out;
}

/** 从横条的上下边起止的竖线有几条（位置相同的算一条：穿过横条被切成两段的竖线）。 */
function bandAnchors(band: Band, vertical: readonly RuleLine[], t: number, tol: number): number {
  const shift = ((band.first + band.last) / 2) * t;
  const at: number[] = [];
  for (const v of vertical) {
    if (v.pos < band.from + shift - tol || v.pos > band.to + shift + tol) continue;
    const starts = Math.abs(v.from - band.last) <= tol;
    const ends = Math.abs(v.to - band.first) <= tol;
    if ((starts || ends) && at.every((p) => Math.abs(p - v.pos) > tol)) at.push(v.pos);
  }
  return at.length;
}

/** 横条的上下边，当成两条横线（坐标换到拉正后，和 scan 的一样）。 */
function bandEdges(band: Band, t: number): RuleLine[] {
  return [band.first, band.last].map((pos, i) => {
    const shift = pos * t;
    return {
      pos,
      from: band.from + shift,
      to: band.to + shift,
      thickness: 1,
      spans: band.spans.map(([a, b]) => [a + shift, b + shift] as [number, number]),
      band: i === 0 ? ('top' as const) : ('bottom' as const),
    };
  });
}

/** 横条的左右两头，当成两条竖线（坐标同 scan：x' = x + y'·t，沿线的 y' 就是扫描行号）。 */
function bandSides(band: Band, t: number): RuleLine[] {
  const shift = ((band.first + band.last) / 2) * t;
  return [band.from, band.to].map((x) => ({
    pos: x + shift,
    from: band.first,
    to: band.last,
    thickness: 1,
    spans: [[band.first, band.last]],
  }));
}

/**
 * 找一页里的横线和竖线。skew 不给时用 findSkew 估（增强过的图已经拉正，可以直接给 0）。
 * 图太大时先缩小，返回的坐标仍是这张图的像素。
 */
export function findLines(
  image: RgbaImage,
  options: { skew?: number; light?: boolean } = {},
): PageLines {
  const k = Math.max(1, Math.ceil(Math.max(image.width, image.height) / (LINE_MAX_SIDE * 1.05)));
  const work = k > 1 ? shrink(image, k) : image;
  const { width, height } = work;
  const ink = inkOf(work);
  const skew = options.skew ?? findSkew(ink, width, height);
  const t = Math.tan((skew * Math.PI) / 180);
  const mask = darkMask(ink, width, height);
  // 横线、竖线各用一张图：浅的细线只加在找它那个方向的图上（light）。
  let hMask = mask;
  let vMask = mask;
  const paper = options.light ? paperOf(ink) : 0;
  if (paper >= LIGHT_PAPER) {
    const max = Math.max(3, Math.round(Math.max(width, height) * LIGHT_THICKNESS_SHARE));
    hMask = addThinLight(mask, ink, width, height, paper, max, true);
    vMask = addThinLight(mask, ink, width, height, paper, max, false);
  }
  const candidates: Band[] = [];
  const horizontal = scan(hMask, width, height, t, true, candidates);
  let vertical = scan(eraseBands(vMask, width, height, t, candidates), width, height, t, false);
  const tol = Math.max(4, Math.max(width, height) * TOUCH_SHARE);
  const bands = candidates.filter((b) => bandAnchors(b, vertical, t, tol) >= BAND_MIN_ANCHORS);
  // 不算的横条不抹（抹了会把穿过它的竖线切断）。
  if (bands.length < candidates.length)
    vertical = scan(eraseBands(vMask, width, height, t, bands), width, height, t, false);
  if (bands.length) {
    const posTol = Math.max(2, Math.max(width, height) * MERGE_SHARE);
    horizontal.splice(
      0,
      horizontal.length,
      ...joinCollinear(
        [...horizontal, ...bands.flatMap((b) => bandEdges(b, t))],
        posTol,
        Math.max(JOIN_MIN, width * JOIN_SHARE),
      ),
    );
    vertical.push(...bands.flatMap((b) => bandSides(b, t)));
  }
  const scale = (l: RuleLine): RuleLine =>
    k === 1
      ? l
      : {
          pos: l.pos * k,
          from: l.from * k,
          to: l.to * k + k - 1,
          thickness: l.thickness * k,
          spans: l.spans.map(([a, b]) => [a * k, b * k + k - 1]),
          ...(l.band ? { band: l.band } : {}),
        };
  return {
    width: image.width,
    height: image.height,
    skew,
    horizontal: horizontal.map(scale),
    vertical: vertical.map(scale),
  };
}

/** 两条线（一横一竖）连在一起：交点在两条线上（端点允许差 tol）。 */
const touches = (h: RuleLine, v: RuleLine, tol: number) =>
  v.pos >= h.from - tol && v.pos <= h.to + tol && h.pos >= v.from - tol && h.pos <= v.to + tol;

/** 一条竖线在 [lo, hi] 里的那一段。 */
function clip(v: RuleLine, lo: number, hi: number): RuleLine {
  if (v.from >= lo && v.to <= hi) return v;
  const from = Math.max(v.from, lo);
  const to = Math.min(v.to, hi);
  return {
    ...v,
    from,
    to,
    spans: v.spans
      .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
      .filter(([a, b]) => b > a),
  };
}

/**
 * 叠着的几张表的分界（转 Word）：一条横贯整张表的横线，上面有里面的竖线（不算左右外框）止于它、
 * 下面有里面的竖线从它开始，而且上下的列线不一样（上面止的那条下面没有接着，下面起的那条上面没有）。
 * 表头一排横跨所有列（上面没有竖线）、列线一直往下的普通表都不分。
 */
function stackedCuts(hs: readonly RuleLine[], vs: readonly RuleLine[], tol: number): number[] {
  const left = Math.min(...hs.map((h) => h.from), ...vs.map((v) => v.pos));
  const right = Math.max(...hs.map((h) => h.to), ...vs.map((v) => v.pos));
  const inner = vs.filter((v) => v.pos > left + tol && v.pos < right - tol);
  const cuts: number[] = [];
  for (const h of hs) {
    if (h.from > left + tol || h.to < right - tol) continue;
    const ending = inner.filter((v) => Math.abs(v.to - h.pos) <= tol && v.from < h.pos - tol);
    const starting = inner.filter((v) => Math.abs(v.from - h.pos) <= tol && v.to > h.pos + tol);
    const at = (list: readonly RuleLine[], x: number) =>
      list.some((v) => Math.abs(v.pos - x) <= tol);
    if (
      ending.some((v) => !at(starting, v.pos)) &&
      starting.some((v) => !at(ending, v.pos)) &&
      cuts.every((c) => Math.abs(c - h.pos) > tol)
    )
      cuts.push(h.pos);
  }
  return cuts;
}

/**
 * 只有和别的线连在一起的线才算表格线，连在一起的线组成一张表：
 * 横线至少碰到 2 条竖线、竖线至少碰到 2 条横线；或者至少 3 条左右两端对齐、上下挨得不远的横线（只有横线的表）。
 */
export function findTables(
  page: PageLines,
  options: {
    /**
     * 转 Word：上下叠着的几张表共用外框（表单的整页大框里一节一张表，EU 样本 004）时，在列线换了的横线处分开，
     * 见 stackedCuts。转 Excel 不分（整页共用列线）。
     */
    splitStacked?: boolean;
  } = {},
): TableLines[] {
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
  // 只碰到一条线、整条在网格里面的线也算（T 字形：表头里没画到顶的竖线、只画了半行的横线）。
  const extent = new Map<number, { l: number; r: number; t: number; b: number }>();
  for (const i of used) {
    const root = find(i);
    const e = extent.get(root) ?? { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    if (i < hs.length) {
      const h = hs[i]!;
      e.l = Math.min(e.l, h.from);
      e.r = Math.max(e.r, h.to);
      e.t = Math.min(e.t, h.pos);
      e.b = Math.max(e.b, h.pos);
    } else {
      const v = vs[i - hs.length]!;
      e.l = Math.min(e.l, v.pos);
      e.r = Math.max(e.r, v.pos);
      e.t = Math.min(e.t, v.from);
      e.b = Math.max(e.b, v.to);
    }
    extent.set(root, e);
  }
  const within = (root: number, x0: number, x1: number, y0: number, y1: number) => {
    const e = extent.get(root)!;
    return x0 >= e.l - tol && x1 <= e.r + tol && y0 >= e.t - tol && y1 <= e.b + tol;
  };
  for (const [j, v] of vs.entries()) {
    if (vOk[j]) continue;
    const i = hs.findIndex((h, k) => hOk[k] && touches(h, v, tol));
    if (i >= 0 && within(find(i), v.pos, v.pos, v.from, v.to)) {
      vOk[j] = true;
      union(hs.length + j, i);
      used.add(hs.length + j);
    }
  }
  for (const [i, h] of hs.entries()) {
    if (hOk[i]) continue;
    const j = vs.findIndex((v, k) => vOk[k] && touches(h, v, tol));
    if (j >= 0 && within(find(hs.length + j), h.from, h.to, h.pos, h.pos)) {
      hOk[i] = true;
      union(i, hs.length + j);
      used.add(i);
    }
  }
  // 只有横线的表：按位置从上到下，左右两端都和上一条对齐、离得不远的接成一串。
  const align = page.width * ALIGN_SHARE;
  const maxGap = page.height * RULED_GAP_SHARE;
  // 一张网格的行高：网格里的横线相邻间距的中位数。
  const rowGapOf = (i: number) => {
    const ys = hs
      .filter((_, k) => hOk[k] && find(k) === find(i))
      .map((g) => g.pos)
      .sort((a, b) => a - b);
    const gaps = ys
      .slice(1)
      .map((y, k) => y - ys[k]!)
      .filter((g) => g > tol);
    return gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1]! : Infinity;
  };
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
      // 隔着一大段（比这一串的间距大一倍以上）、中间压着另一张网格的横线：上下是两串，不跨过网格接起来
      // （发票右边的填写横线，中间隔着整张商品栏，EU 样本 001）。一串紧挨着穿过网格的线照旧接
      // （IRS Schedule B 金额栏的横线一格一条，中间的分节线也是网格的线）。
      const step = c.length >= 2 ? last.pos - hs[c.at(-2)!]!.pos : null;
      if (
        !hOk[i] &&
        step !== null &&
        gap > 2 * step &&
        hs.some(
          (g, k) =>
            hOk[k] &&
            g.pos > last.pos + tol &&
            g.pos < h.pos - tol &&
            Math.min(g.to, h.to) - Math.max(g.from, h.from) > 0.5 * (h.to - h.from),
        )
      )
        return false;
      // 两张网格（各自有竖线）宽度一样、上下排着，不接成一张（中间常隔着一段文字）。
      if (hOk[i] && hOk[lastIndex]) return find(i) === find(lastIndex);
      // 从网格的线接到不在网格里的线（或反过来）：只有间距和上一格差不多（不到 2 倍）时才接，
      // 例如表头有竖线、下面只有横线的表；网格下面隔着标题的另一张只有横线的表不接上去。
      if (hOk[i] !== hOk[lastIndex]) {
        // 竖线画满了网格的好几行才停（超过两行，不像表头）：网格到这里就完了，下面只有横线的是另一张表
        // （中间的标题加留白可能不到两行高）。
        if (hOk[lastIndex] && c.filter((k) => hOk[k] && find(k) === find(lastIndex)).length > 3)
          return false;
        const prev = c.length >= 2 ? last.pos - hs[c.at(-2)!]!.pos : null;
        // 网格上面只有横线的一串往下接网格：间距还要和网格的行高差不多（表头上面的几行）。
        // 各节标题下的分隔线彼此隔着整段文字，比网格的行高得多，不是这张表的。
        if (hOk[i] && !c.some((k) => hOk[k]) && prev !== null && prev > 2 * rowGapOf(i))
          return false;
        return prev !== null && gap <= 2 * prev;
      }
      return true;
    });
    if (chain) chain.push(i);
    else chains.push([i]);
  }
  for (const chain of chains) {
    if (chain.length < RULED_MIN) continue;
    for (const i of chain) {
      union(i, chain[0]!);
      used.add(i);
    }
  }
  // 一张表套在另一张表里（表单的大框里画着一张小表）：合成一张，不然外面那张会把里面的字都拿走。
  const boxOf = (members: number[]) => {
    const th = members.filter((i) => i < hs.length).map((i) => hs[i]!);
    const tv = members.filter((i) => i >= hs.length).map((i) => vs[i - hs.length]!);
    return {
      left: Math.min(...th.map((h) => h.from), ...tv.map((v) => v.pos)),
      right: Math.max(...th.map((h) => h.to), ...tv.map((v) => v.pos)),
      top: Math.min(...th.map((h) => h.pos), ...tv.map((v) => v.from)),
      bottom: Math.max(...th.map((h) => h.pos), ...tv.map((v) => v.to)),
    };
  };
  let merged = true;
  while (merged) {
    merged = false;
    const groups = new Map<number, number[]>();
    for (const i of used) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }
    const list = [...groups.values()].map((m) => ({ root: find(m[0]!), box: boxOf(m) }));
    for (const a of list) {
      for (const b of list) {
        if (a.root === b.root || find(a.root) === find(b.root)) continue;
        const inside =
          b.box.left >= a.box.left - tol &&
          b.box.right <= a.box.right + tol &&
          b.box.top >= a.box.top - tol &&
          b.box.bottom <= a.box.bottom + tol;
        if (inside) {
          union(b.root, a.root);
          merged = true;
        }
      }
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
    const allH = members.filter((i) => i < hs.length).map((i) => hs[i]!);
    const allV = members.filter((i) => i >= hs.length).map((i) => vs[i - hs.length]!);
    // 表中间的实心横条（D-501）：上面有竖线止于它的上边，它是下面另一张表的表头
    // （工资单的明细表下面接着汇总表，两张表的列不一样），在它的上边分成两张。
    const cuts: number[] = allH
      .filter(
        (h) =>
          h.band === 'top' &&
          allV.some((v) => Math.abs(v.to - h.pos) <= tol && v.from < h.pos - tol),
      )
      .map((h) => h.pos);
    if (options.splitStacked) cuts.push(...stackedCuts(allH, allV, tol));
    cuts.sort((a, b) => a - b);
    const bounds = [-Infinity, ...cuts, Infinity];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [lo, hi] = [bounds[k]!, bounds[k + 1]!];
      const th = allH.filter((h) => h.pos >= lo - tol && h.pos <= hi + tol);
      // 分开叠着的表时，穿过分界线的竖线（外框的左右两边、上下共用的编号列线）两边各有一段。
      const tv = options.splitStacked
        ? allV.filter((v) => v.from < hi - tol && v.to > lo + tol).map((v) => clip(v, lo, hi))
        : allV.filter((v) => (v.from + v.to) / 2 > lo && (v.from + v.to) / 2 < hi);
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
  }
  return tables.sort((a, b) => a.box.y - b.box.y);
}
