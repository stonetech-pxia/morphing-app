import type { Box, OcrBox, RgbaImage } from './types';

// 扫描件转 Word（D-310）的版面分析：PP-DocLayout-S（扩展包 layout）的前后处理和区域整理，阅读顺序。
// 模型改成了一个 float32 输入（1×3×480×480，不保持宽高比缩放，ImageNet 归一化）、一个 float32 输出
// （N×6：类别、分数、x1、y1、x2、y2，坐标在 480×480 的输入里；NMS 在图里做好了），App 的 modelRun 直接能跑。

/** 模型输入的边长（PP-DocLayout-S）。 */
export const LAYOUT_INPUT = 480;

/** 模型的 23 个类别（官方 inference.yml 的顺序）。 */
export const LAYOUT_LABELS = [
  'paragraph_title',
  'image',
  'text',
  'number',
  'abstract',
  'content',
  'figure_title',
  'formula',
  'table',
  'table_title',
  'reference',
  'doc_title',
  'footnote',
  'header',
  'algorithm',
  'footer',
  'seal',
  'chart_title',
  'chart',
  'formula_number',
  'header_image',
  'footer_image',
  'aside_text',
] as const;

/** 转 Word 用到的几种区域：标题、正文、表格、图片、页码（不写进文件）。 */
export type RegionKind = 'title' | 'text' | 'table' | 'image' | 'pageNumber';

export interface LayoutRegion {
  kind: RegionKind;
  /** 模型的原始类别（doc_title 是一级标题）。 */
  label: string;
  score: number;
  box: Box;
}

const KIND_OF: Record<string, RegionKind> = {
  paragraph_title: 'title',
  doc_title: 'title',
  table: 'table',
  image: 'image',
  chart: 'image',
  seal: 'image',
  header_image: 'image',
  footer_image: 'image',
  number: 'pageNumber',
};

/** 分数线：实验（word-exp）里 0.5 漏掉很多正文块，0.3 漏得少；图片和表格误报多，要求高一点。 */
const MIN_SCORE = 0.3;
const MIN_SCORE_IMAGE = 0.45;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** 模型输入：整张图双线性缩放到 side × side（不保持宽高比，和训练时一样），按通道归一化，CHW。 */
export function layoutInput(image: RgbaImage, side = LAYOUT_INPUT): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(3 * side * side);
  const plane = side * side;
  const sx = width / side;
  const sy = height / side;
  for (let y = 0; y < side; y++) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < side; x++) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const a = (y0 * width + x0) * 4;
      const b = (y0 * width + x1) * 4;
      const c = (y1 * width + x0) * 4;
      const d = (y1 * width + x1) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = data[a + ch]! * (1 - wx) + data[b + ch]! * wx;
        const bottom = data[c + ch]! * (1 - wx) + data[d + ch]! * wx;
        const v = (top * (1 - wy) + bottom * wy) / 255;
        out[ch * plane + y * side + x] = (v - MEAN[ch]!) / STD[ch]!;
      }
    }
  }
  return out;
}

/** 模型输出（N×6）→ 原图坐标里的区域；没用的类别和低分的去掉。 */
export function parseLayout(
  output: ArrayLike<number>,
  size: { width: number; height: number },
  side = LAYOUT_INPUT,
): LayoutRegion[] {
  const kx = size.width / side;
  const ky = size.height / side;
  const regions: LayoutRegion[] = [];
  for (let i = 0; i + 5 < output.length; i += 6) {
    const label = LAYOUT_LABELS[Math.round(output[i]!)];
    const score = output[i + 1]!;
    if (!label) continue;
    const kind = KIND_OF[label] ?? 'text';
    if (score < (kind === 'image' || kind === 'table' ? MIN_SCORE_IMAGE : MIN_SCORE)) continue;
    const x1 = Math.max(0, output[i + 2]! * kx);
    const y1 = Math.max(0, output[i + 3]! * ky);
    const x2 = Math.min(size.width, output[i + 4]! * kx);
    const y2 = Math.min(size.height, output[i + 5]! * ky);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    regions.push({ kind, label, score, box: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  }
  return regions;
}

const area = (b: Box) => b.width * b.height;
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** 一行文字有多少在这个区域里（按行的面积算）。 */
export const lineShareIn = (line: Box, region: Box) => overlap(line, region) / (area(line) || 1);

/** 图片区域里最多这么多行字（标志、照片里的字）；更多的是认错了的正文。 */
const IMAGE_MAX_LINES = 3;
/** 图片里的字加起来最多这么多个。 */
const IMAGE_MAX_CHARS = 30;
/** 图片最多占整页的这么多：整页都是「图片」是密集的表单、正文认错了（实验里 19 页有 5 页这样）。 */
const IMAGE_MAX_PAGE_SHARE = 0.5;

/**
 * 整理模型给的区域（D-310）：图片里字太多、或者大得占了半页的不当图片（那些字按正文排）；
 * 模型的表格不用（表格只认带线的，和转 Excel 一样，D-272；无线表留给第三期），里面的字按正文排；
 * 一行字只能属于一个区域。
 */
export function cleanRegions(
  regions: readonly LayoutRegion[],
  lines: readonly OcrBox[],
  size: { width: number; height: number },
): LayoutRegion[] {
  const pageArea = size.width * size.height;
  // 同一张图常被认成两个区域（image 和 header_image）：和更高分的图片重叠一半以上的不要。
  const images = regions.filter((r) => r.kind === 'image').sort((a, b) => b.score - a.score);
  const duplicate = new Set(
    images.filter((r, i) =>
      images
        .slice(0, i)
        .some((s) => overlap(r.box, s.box) > 0.5 * Math.min(area(r.box), area(s.box))),
    ),
  );
  return regions.filter((r) => {
    if (duplicate.has(r)) return false;
    if (r.kind === 'table') return false;
    if (r.kind !== 'image') return true;
    if (area(r.box) > IMAGE_MAX_PAGE_SHARE * pageArea) return false;
    const inside = lines.filter((l) => lineShareIn(l, r.box) >= 0.5);
    const chars = inside.reduce((n, l) => n + [...l.text.trim()].length, 0);
    return inside.length <= IMAGE_MAX_LINES && chars <= IMAGE_MAX_CHARS;
  });
}

/**
 * 每行字属于哪个区域（下标；不属于任何区域时是 -1）：一行至少一半在区域里；几个区域都包住它时
 * 选包住得最多的，一样多时选小的（标题框常常在正文框里面）。
 */
export function assignLines(lines: readonly Box[], regions: readonly { box: Box }[]): number[] {
  return lines.map((line) => {
    let best = -1;
    let bestShare = 0.5;
    for (const [i, r] of regions.entries()) {
      const share = lineShareIn(line, r.box);
      if (
        share > bestShare + 0.01 ||
        (best >= 0 && Math.abs(share - bestShare) <= 0.01 && area(r.box) < area(regions[best]!.box))
      ) {
        best = i;
        bestShare = Math.max(share, bestShare);
      }
    }
    return best;
  });
}

/**
 * 一组区间按重叠连成几段，只在最宽的空隙（和差不多宽的）处断开：小的空隙留给下一层再切
 * （两栏的段落之间也有窄的横向空隙，先在那里横着切会把两栏的段落交错排）。gap 以下的不算空隙。
 */
function bands(
  spans: readonly [number, number][],
  gap: number,
): { groups: number[][]; widest: number } {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]![0] - spans[b]![0]);
  const runs: { members: number[]; gapBefore: number }[] = [];
  let end = -Infinity;
  for (const i of order) {
    const [a, b] = spans[i]!;
    if (runs.length && a < end + gap) {
      runs.at(-1)!.members.push(i);
      end = Math.max(end, b);
    } else {
      runs.push({ members: [i], gapBefore: runs.length ? a - end : 0 });
      end = b;
    }
  }
  const widest = Math.max(0, ...runs.map((r) => r.gapBefore));
  const groups: number[][] = [];
  for (const run of runs) {
    if (groups.length && run.gapBefore < 0.8 * widest) groups.at(-1)!.push(...run.members);
    else groups.push([...run.members]);
  }
  return { groups, widest };
}

/**
 * 阅读顺序（XY 切分）：横着能切开就分成上下几段、从上到下，竖着能切开就分成几栏、从左到右，
 * 两种都能切时按空隙宽的那种切（两栏之间的空隙比栏里段落之间的宽）；都切不开时按上边、再按左边排。
 * gap 是算作空隙的最小宽度（防止紧挨着的两块被切开）。
 */
export function readingOrder<T extends { box: Box }>(items: readonly T[], gap = 0): T[] {
  if (items.length <= 1) return [...items];
  const rows = bands(
    items.map((it) => [it.box.y, it.box.y + it.box.height]),
    gap,
  );
  const cols = bands(
    items.map((it) => [it.box.x, it.box.x + it.box.width]),
    gap,
  );
  const split =
    rows.groups.length > 1 && (cols.groups.length < 2 || rows.widest >= cols.widest)
      ? rows.groups
      : cols.groups.length > 1
        ? cols.groups
        : null;
  if (!split) return [...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return split.flatMap((group) =>
    readingOrder(
      group.map((i) => items[i]!),
      gap,
    ),
  );
}
