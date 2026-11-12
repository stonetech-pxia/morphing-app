import { type DocLeaf, type DocPage } from './doc';
import type { Box } from './types';

export interface NativeGraphics {
  /** PDF 点坐标；App 只读取用户选择的原件副本。 */
  owned: Box[];
  colors: { box: Box; color: string }[];
}
const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** 仅替换已证明属于绘图的块；混合着正文的段落宁可保留，不能丢字。 */
export function applyNativeGraphics(page: DocPage, graphics: NativeGraphics, src: string): DocPage {
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
  const graphicBlanks = new Set<DocLeaf>();
  const convert = (block: DocLeaf): DocLeaf => {
    if (block.kind === 'image') return { kind: 'space', box: block.box };
    if (
      (block.kind === 'paragraph' || block.kind === 'list') &&
      owned.some((b) => overlap(block.box, b) >= area(block.box) * 0.95)
    ) {
      // 图中字原先占的是字行，不是图片高；用同字号的空行，避免空白变高造成分页回归。
      if (block.kind === 'paragraph') {
        const { runs: _runs, ...rest } = block;
        const blank = { ...rest, text: block.text.replace(/[^\n]/g, '') };
        graphicBlanks.add(blank);
        return blank;
      }
      const blank: DocLeaf = {
        kind: 'paragraph',
        text: block.items.map(() => '').join('\n'),
        box: block.box,
        ...(block.size ? { size: block.size } : {}),
      };
      graphicBlanks.add(blank);
      return blank;
    }
    if (block.kind === 'paragraph' || block.kind === 'list') {
      const color = colorOf(block.box);
      return color ? { ...block, color } : block;
    }
    return block;
  };
  const blocks = page.blocks.map((b) =>
    b.kind === 'row'
      ? { ...b, cells: b.cells.map((c) => ({ ...c, blocks: c.blocks.map(convert) })) }
      : convert(b),
  );
  // 页尾的图已固定在底图上，末尾空白只会把 Word 必须有的表后段落挤到新的一页。
  const trim = (leaves: DocLeaf[]) => {
    while (leaves.length && (leaves.at(-1)?.kind === 'space' || graphicBlanks.has(leaves.at(-1)!)))
      leaves.pop();
  };
  for (;;) {
    const last = blocks.at(-1);
    if (!last) break;
    if (last.kind === 'space' || (last.kind !== 'row' && graphicBlanks.has(last))) {
      blocks.pop();
      continue;
    }
    if (last.kind === 'row') {
      for (const cell of last.cells) trim(cell.blocks);
      if (last.cells.every((c) => c.blocks.length === 0)) {
        blocks.pop();
        continue;
      }
    }
    break;
  }
  // 底图不参与正文的边界、缩进或分页计算。
  return {
    ...page,
    blocks: [
      {
        kind: 'image',
        background: true,
        src,
        box: { x: 0, y: 0, width: page.width, height: page.height },
      },
      ...blocks,
    ],
  };
}
