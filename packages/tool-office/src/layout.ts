import type { Box, OcrBox, RgbaImage } from './types';

// 扫描件转 Word（D-328）的版面分析：PP-DocLayout-S（扩展包 layout）的前后处理和区域整理，阅读顺序。
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
  /** 单个类别都不够图片线，靠几个类别同框加起来才留下的图片（D-524）：里面一个字都不能有。 */
  fused?: boolean;
  /** 三类弱分恢复仅供 Word：加入工作表共用列线可能改变已有列宽和打印分页。 */
  wordOnly?: true;
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
/**
 * 模型常把一张图的分数拆给几个类别（image / chart / header_image / footer_image），在差不多同一个框上各得 0.2–0.4，
 * 单看都过不了图片线（D-524）：这样的同框检测按类别（每个类别取最高分）加起来再和图片线比。
 * 低于 FIGURE_PART_MIN 的零星检测不参与；同一个类别重复不叠加；印章不参与（有自己的规则）。
 */
const FIGURE_PART_MIN = 0.15;
/** 两个框交并比达到这么多才算「同一个框」。 */
const FIGURE_SAME_BOX_IOU = 0.7;
/** 更弱的辅类只走独立恢复路径：主类 ≥ 0.3、至少三类各 ≥ 0.1、总分 ≥ 0.55、框几乎重合。 */
const FIGURE_SUPPORT_MIN = 0.1;
const FIGURE_SUPPORT_SUM = 0.55;
const FIGURE_SUPPORT_IOU = 0.9;

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
  const parts: LayoutRegion[] = [];
  for (let i = 0; i + 5 < output.length; i += 6) {
    const label = LAYOUT_LABELS[Math.round(output[i]!)];
    const score = output[i + 1]!;
    if (!label) continue;
    const kind = KIND_OF[label] ?? 'text';
    const figurePart = kind === 'image' && label !== 'seal' && score >= FIGURE_SUPPORT_MIN;
    if (score < (kind === 'image' || kind === 'table' ? MIN_SCORE_IMAGE : MIN_SCORE) && !figurePart)
      continue;
    const x1 = Math.max(0, output[i + 2]! * kx);
    const y1 = Math.max(0, output[i + 3]! * ky);
    const x2 = Math.min(size.width, output[i + 4]! * kx);
    const y2 = Math.min(size.height, output[i + 5]! * ky);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    const region = { kind, label, score, box: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } };
    (figurePart ? parts : regions).push(region);
  }
  // 已有图片仍用原来的输入和分数；辅类不能改变已通过的框、分数或去重顺序。
  const figures = fuseFigures(parts.filter((p) => p.score >= FIGURE_PART_MIN));
  const existing = [...regions.filter((r) => r.kind === 'image'), ...figures];
  return [...regions, ...figures, ...corroboratedFigures(parts, existing)];
}

/** 三类几乎同框才补收；不替换任何旧图片，仍标为 fused，后续只准保留完全无字的框。 */
function corroboratedFigures(
  parts: readonly LayoutRegion[],
  existing: readonly LayoutRegion[],
): LayoutRegion[] {
  const recovered: LayoutRegion[] = [];
  for (const anchor of [...parts].sort((a, b) => b.score - a.score)) {
    if (anchor.score < MIN_SCORE) break;
    if (
      [...existing, ...recovered].some(
        (r) => overlap(r.box, anchor.box) > 0.5 * Math.min(area(r.box), area(anchor.box)),
      )
    )
      continue;
    const best = new Map<string, number>();
    for (const p of parts) {
      if (iou(anchor.box, p.box) >= FIGURE_SUPPORT_IOU)
        best.set(p.label, Math.max(best.get(p.label) ?? 0, p.score));
    }
    const score = [...best.values()].reduce((a, b) => a + b, 0);
    if (best.size >= 3 && score >= FIGURE_SUPPORT_SUM)
      recovered.push({ ...anchor, score, fused: true, wordOnly: true });
  }
  return recovered;
}

/** 图片类检测按同框合并：分数从高到低，和某一组领头的框交并比够高的并进去；组分 = 每个类别最高分之和，不够图片线的丢掉。 */
function fuseFigures(parts: readonly LayoutRegion[]): LayoutRegion[] {
  const groups: LayoutRegion[][] = [];
  for (const p of [...parts].sort((a, b) => b.score - a.score)) {
    const g = groups.find((m) => iou(m[0]!.box, p.box) >= FIGURE_SAME_BOX_IOU);
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups.flatMap((g) => {
    const best = new Map<string, number>();
    for (const p of g) best.set(p.label, Math.max(best.get(p.label) ?? 0, p.score));
    const score = [...best.values()].reduce((a, b) => a + b, 0);
    if (score < MIN_SCORE_IMAGE) return [];
    return [
      g[0]!.score >= MIN_SCORE_IMAGE ? { ...g[0]!, score } : { ...g[0]!, score, fused: true },
    ];
  });
}

const area = (b: Box) => b.width * b.height;
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const iou = (a: Box, b: Box) => {
  const inter = overlap(a, b);
  return inter / (area(a) + area(b) - inter || 1);
};

/** 一行文字有多少在这个区域里（按行的面积算）。 */
export const lineShareIn = (line: Box, region: Box) => overlap(line, region) / (area(line) || 1);

/** 图片区域里最多这么多行字（标志、照片里的字）；更多的是认错了的正文。 */
const IMAGE_MAX_LINES = 3;
/** 图片里的字加起来最多这么多个。 */
const IMAGE_MAX_CHARS = 30;
/**
 * 印章（模型的 seal，D-463）里本来就都是字（一圈机构名、地址），认出来是乱的（「WPANTIMN」），
 * 当图片剪下来放进文件（和原件一样）；不超过这么多行、这么多个字，更多的是认错了的正文。
 */
const SEAL_MAX_LINES = 6;
const SEAL_MAX_CHARS = 100;
/** 图片最多占整页的这么多：整页都是「图片」是密集的表单、正文认错了（实验里 19 页有 5 页这样）。 */
const IMAGE_MAX_PAGE_SHARE = 0.5;

/**
 * 整理模型给的区域（D-328）：图片里字太多、或者大得占了半页的不当图片（那些字按正文排；印章里的字多一些也还是图片，D-463）；
 * 模型的表格不用（表格只认带线的，和转 Excel 一样，D-272；无线表留给第三期），里面的字按正文排；
 * 一行字只能属于一个区域。
 */
export function cleanRegions(
  regions: readonly LayoutRegion[],
  lines: readonly OcrBox[],
  size: { width: number; height: number },
  image?: RgbaImage,
  protectedImages: ReadonlySet<LayoutRegion> = new Set(),
): LayoutRegion[] {
  const pageArea = size.width * size.height;
  // 同一张图常被认成两个区域（image 和 header_image）：和更高分的图片重叠一半以上的不要。
  // 占了半页以上的「图片」不参与：它本来就要丢，不能让它把里面真正的小图当成重复一起带走（D-524）。
  const images = regions
    .filter(
      (r) =>
        r.kind === 'image' &&
        (protectedImages.has(r) || area(r.box) <= IMAGE_MAX_PAGE_SHARE * pageArea),
    )
    .sort((a, b) => b.score - a.score);
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
    if (protectedImages.has(r)) return true;
    if (area(r.box) > IMAGE_MAX_PAGE_SHARE * pageArea) return false;
    const inside = lines.filter((l) => lineShareIn(l, r.box) >= 0.5);
    const chars = inside.reduce((n, l) => n + [...l.text.trim()].length, 0);
    if (r.label === 'seal') return inside.length <= SEAL_MAX_LINES && chars <= SEAL_MAX_CHARS;
    // 靠同框加分才留下的图片证据弱：里面有字就不信（字会被吞进图里；表单里的格子也是短字加框线），也不走示意图那条路（D-524）。
    if (r.fused) return inside.length === 0;
    if (inside.length <= IMAGE_MAX_LINES && chars <= IMAGE_MAX_CHARS) return true;
    return image !== undefined && isDiagram(image, r.box, inside);
  });
}

/** 示意图里标注的字：每行最多这么多个字、中位数最多这么多个，行数最多这么多。 */
const DIAGRAM_LINE_CHARS = 28;
const DIAGRAM_MEDIAN_CHARS = 16;
const DIAGRAM_MAX_LINES = 60;
/** 框里字以外有图形（线、箭头、色块）的像素至少占这么多。 */
const DIAGRAM_MIN_INK = 0.12;

/**
 * 带很多标注的示意图、流程图（模型认成图片，但里面的字多于标志里的字）：字都是短标注（没有成行的正文），
 * 而且框里除了字以外有不少线、箭头、色块——表单里认错了的「图片」是成行的字加几条横线，图形占得很少。
 * 这样的整张剪成图片，标注文字留在图里。
 */
export function isDiagram(image: RgbaImage, box: Box, inside: readonly OcrBox[]): boolean {
  if (inside.length === 0 || inside.length > DIAGRAM_MAX_LINES) return false;
  const lens = inside.map((l) => [...l.text.trim()].length).sort((a, b) => a - b);
  if (
    lens.at(-1)! > DIAGRAM_LINE_CHARS ||
    lens[Math.floor(lens.length / 2)]! > DIAGRAM_MEDIAN_CHARS
  )
    return false;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  // 隔几个像素取一个点，够判断占比。
  const step = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) / 200));
  let total = 0;
  let ink = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      total++;
      if (inside.some((l) => x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height))
        continue;
      const o = (y * image.width + x) * 4;
      const r = image.data[o]!;
      const g = image.data[o + 1]!;
      const b = image.data[o + 2]!;
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 200 || chroma > 25) ink++;
    }
  }
  return total > 0 && ink / total >= DIAGRAM_MIN_INK;
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

/** 各栏共用的一排表头最多这么多行高。 */
const HEADER_ROW_LINES = 3;

/**
 * 竖着切开的几栏里，有一栏只有最上面的一排短字（框起来的表单的列标题「CONCEPTO  BASE  TIPO  APORTACIÓN」，
 * 下面的填写处没有字，EU 样本 016）：这一排是各栏共用的表头，不是一栏。整块落在这一排里的字先排（按左右），
 * 剩下的再排；不然右边的列标题排到左边所有的项目后面。这一排不超过 HEADER_ROW_LINES 个行高，
 * 至少两栏各有一块整块在这一排里（两栏正文的段落比这一排高，不受影响）。
 */
function headerRow<T extends { box: Box }>(
  items: readonly T[],
  groups: readonly number[][],
  gap: number,
  lineHeight: number,
): [T[], T[]] | null {
  const bottomOf = (it: T) => it.box.y + it.box.height;
  const top = Math.min(...items.map((it) => it.box.y));
  const bottoms = groups.map((g) => Math.max(...g.map((i) => bottomOf(items[i]!))));
  // 只有这一排的几栏：整栏不超过 HEADER_ROW_LINES 个行高。
  const short = bottoms.filter((b) => b - top <= HEADER_ROW_LINES * lineHeight);
  if (!short.length || short.length === bottoms.length) return null;
  const row = Math.max(...short);
  const inRow = (it: T) => bottomOf(it) <= row + gap;
  if (groups.filter((g) => g.some((i) => inRow(items[i]!))).length < 2) return null;
  return [items.filter(inRow), items.filter((it) => !inRow(it))];
}

/**
 * 阅读顺序（XY 切分）：横着能切开就分成上下几段、从上到下，竖着能切开就分成几栏、从左到右，
 * 两种都能切时按空隙宽的那种切（两栏之间的空隙比栏里段落之间的宽）；都切不开时按上边、再按左边排。
 * gap 是算作空隙的最小宽度（防止紧挨着的两块被切开）。
 */
export function readingOrder<T extends { box: Box }>(
  items: readonly T[],
  gap = 0,
  /** 正文行高：给了才认各栏共用的一排表头（headerRow）。 */
  lineHeight?: number,
): T[] {
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
  if (split !== rows.groups && lineHeight) {
    const head = headerRow(items, split, gap, lineHeight);
    if (head)
      return [...readingOrder(head[0], gap, lineHeight), ...readingOrder(head[1], gap, lineHeight)];
  }
  return split.flatMap((group) =>
    readingOrder(
      group.map((i) => items[i]!),
      gap,
      lineHeight,
    ),
  );
}
