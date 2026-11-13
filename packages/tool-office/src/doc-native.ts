import { leafBlocks, type DocLeaf, type DocPage } from './doc';
import type { Box } from './types';

export interface NativeGraphics {
  /** PDF 点坐标；App 只读取用户选择的原件副本。 */
  owned: Box[];
  colors: { box: Box; color: string }[];
  fills?: { box: Box; color: string }[];
}
/** 旋转文字的整图所有权还不能可靠推断，仍用已有的文字方向/裁图路径。 */
export function canUseNativeGraphics(page: DocPage): boolean {
  return !leafBlocks(page).some((b) => b.kind === 'table' && b.direction !== undefined);
}

const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** 给已隔离、参与正文排版的整图接上原生剪图；只有纯装饰可以留在页底。 */
export function applyNativeGraphics(
  page: DocPage,
  graphics: NativeGraphics,
  sources: readonly string[],
  background?: string,
): DocPage {
  const kx = page.width / (page.paper?.width ?? 595.3);
  const ky = page.height / (page.paper?.height ?? 841.9);
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
  const fillOf = (box: Box) =>
    fills
      .filter((f) => overlap(box, f.box) >= area(box) * 0.8)
      .sort((a, b) => area(a.box) - area(b.box))[0]?.color;
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
          const fill = cell.box ? fillOf(cell.box) : undefined;
          return {
            ...previous,
            row: cell.row,
            col: cell.col,
            ...(fill && fill !== 'FFFFFF' ? { fill } : {}),
            lines: (previous?.lines ?? []).map((line) => {
              const color = colorOf(line);
              const fill = fillOf(line);
              return {
                ...line,
                ...(color && (color !== 'FFFFFF' || fill) ? { color } : {}),
                ...(fill && fill !== 'FFFFFF' ? { fill } : {}),
              };
            }),
          };
        }),
      };
    if (block.kind !== 'paragraph' && block.kind !== 'list') return block;
    const color = colorOf(block.box);
    const fill = fillOf(block.box);
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
