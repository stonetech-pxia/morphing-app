import { leafBlocks, type DocLeaf, type DocPage } from './doc';
import type { Box } from './types';

export interface NativeGraphics {
  /** PDF 点坐标；App 只读取用户选择的原件副本。 */
  owned: Box[];
  colors: { box: Box; color: string }[];
  fills?: { box: Box; color: string }[];
  /** 这些框所在的 PDF 页大小（点）；Word 的纸缩过时（fitPaper）和 page.paper 不一样。 */
  paper?: { width: number; height: number };
}
/** 旋转文字的整图所有权还不能可靠推断，仍用已有的文字方向/裁图路径。 */
export function canUseNativeGraphics(page: DocPage): boolean {
  return !leafBlocks(page).some((b) => b.kind === 'table' && b.direction !== undefined);
}

const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * 几个框在 box 里一共盖住多大面积，重叠的地方只算一次：PDF 常把同一条粗边画好几遍（每格一段，再按整张表画一段），
 * 框还都往外放宽了几个像素；按面积直接相加，一条边就「盖满」了旁边很窄的一格（EU 样本 016 的整列黑格子）。
 */
function coveredArea(box: Box, rects: readonly Box[]): number {
  const parts = rects
    .map((r) => {
      const x = Math.max(box.x, r.x);
      const y = Math.max(box.y, r.y);
      return {
        x,
        y,
        right: Math.min(box.x + box.width, r.x + r.width),
        bottom: Math.min(box.y + box.height, r.y + r.height),
      };
    })
    .filter((r) => r.right > r.x && r.bottom > r.y);
  const xs = [...new Set(parts.flatMap((r) => [r.x, r.right]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, x1] = [xs[i]!, xs[i + 1]!];
    const spans = parts
      .filter((r) => r.x <= x0 && r.right >= x1)
      .map((r) => [r.y, r.bottom] as const)
      .sort((a, b) => a[0] - b[0]);
    let length = 0;
    let end = -Infinity;
    for (const [y0, y1] of spans) {
      if (y1 <= end) continue;
      length += y1 - Math.max(y0, end);
      end = y1;
    }
    total += (x1 - x0) * length;
  }
  return total;
}

/** 底色和字至少差这么多（WCAG 的对比度，1 是一样，21 是黑白）。 */
const MIN_FILL_CONTRAST = 2;

/** 两种颜色（六位十六进制）的对比度。 */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** 给已隔离、参与正文排版的整图接上原生剪图；只有纯装饰可以留在页底。 */
export function applyNativeGraphics(
  page: DocPage,
  graphics: NativeGraphics,
  sources: readonly string[],
  background?: string,
): DocPage {
  const paper = graphics.paper ?? page.paper;
  const kx = page.width / (paper?.width ?? 595.3);
  const ky = page.height / (paper?.height ?? 841.9);
  const pixel = (b: Box): Box => ({
    x: b.x * kx,
    y: b.y * ky,
    width: b.width * kx,
    height: b.height * ky,
  });
  const owned = graphics.owned.map(pixel);
  const colors = graphics.colors
    .filter((c) => /^[0-9A-F]{6}$/i.test(c.color))
    .map((c) => ({ ...c, box: pixel(c.box) }));
  const fills = (graphics.fills ?? [])
    .filter((c) => /^[0-9A-F]{6}$/i.test(c.color))
    .map((c) => ({ ...c, box: pixel(c.box) }));
  const colorOf = (box: Box) => {
    const votes = new Map<string, number>();
    for (const c of colors) {
      const n = overlap(box, c.box);
      if (n > 0) votes.set(c.color, (votes.get(c.color) ?? 0) + n);
    }
    const entries = [...votes].sort((a, b) => b[1] - a[1]);
    return entries[0] && entries[0][1] >= entries.reduce((n, c) => n + c[1], 0) * 0.8
      ? entries[0][0]
      : undefined;
  };
  // 从小到大累计每种颜色盖住的面积：先盖满八成的颜色在最上面。一段字横跨同色的几张卡片时，
  // 合起来算（不然会落到卡片下面整页的深色底上，深色字写在深色底上看不见）。
  const bySize = [...fills].sort((a, b) => area(a.box) - area(b.box));
  const fillOf = (box: Box) => {
    const covered = new Map<string, Box[]>();
    for (const f of bySize) {
      if (overlap(box, f.box) <= 0) continue;
      const rects = [...(covered.get(f.color) ?? []), f.box];
      if (coveredArea(box, rects) >= area(box) * 0.8) return f.color;
      covered.set(f.color, rects);
    }
    return undefined;
  };
  // 底色和字的颜色差不多（黑字落在 PDF 用黑色实心框画出来的边框上，EU 样本 062）：字会看不见，宁可不加底色。
  // 不知道字的颜色时照旧。
  const legibleFill = (fill: string | undefined, color: string | undefined) =>
    fill && fill !== 'FFFFFF' && (!color || contrast(fill, color) >= MIN_FILL_CONTRAST)
      ? fill
      : undefined;
  const convert = (block: DocLeaf): DocLeaf => {
    if (block.kind === 'image') {
      const i = owned.findIndex(
        (b) => overlap(block.box, b) >= Math.max(area(block.box), area(b)) * 0.98,
      );
      return i >= 0 && sources[i] ? { ...block, src: sources[i] } : block;
    }
    if (block.kind === 'table')
      return {
        ...block,
        cellLayout: block.table.cells.map((cell) => {
          const previous = block.cellLayout?.find((c) => c.row === cell.row && c.col === cell.col);
          const found = cell.box ? fillOf(cell.box) : undefined;
          const fill = cell.text.trim() && cell.box ? legibleFill(found, colorOf(cell.box)) : found;
          return {
            ...previous,
            row: cell.row,
            col: cell.col,
            ...(fill && fill !== 'FFFFFF' ? { fill } : {}),
            lines: (previous?.lines ?? []).map((line) => {
              const color = colorOf(line);
              const fill = legibleFill(fillOf(line), color);
              return {
                ...line,
                ...(color && (color !== 'FFFFFF' || fill) ? { color } : {}),
                ...(fill ? { fill } : {}),
              };
            }),
          };
        }),
      };
    if (block.kind !== 'paragraph' && block.kind !== 'list') return block;
    const color = colorOf(block.box);
    const fill = legibleFill(fillOf(block.box), color);
    return {
      ...block,
      ...(color ? { color: color === 'FFFFFF' && !fill && !background ? '000000' : color } : {}),
      ...(fill && fill !== 'FFFFFF' ? { fill } : {}),
    };
  };
  const blocks = page.blocks.map((b) =>
    b.kind === 'row'
      ? { ...b, cells: b.cells.map((c) => ({ ...c, blocks: c.blocks.map(convert) })) }
      : convert(b),
  );
  return {
    ...page,
    blocks: [
      ...(background
        ? [
            {
              kind: 'image' as const,
              background: true as const,
              src: background,
              box: { x: 0, y: 0, width: page.width, height: page.height },
            },
          ]
        : []),
      ...blocks,
    ],
  };
}
