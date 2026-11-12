import type { DocBlock, DocPage, DocParagraph, DocTable } from './doc';
import type { Box, OcrBox, RgbaImage, TableCell } from './types';
import { lineShareIn } from './layout';

// 没有模型图框的卡片插图：只认同一网格里反复出现的、完全没有 OCR 文字的大块图像。
// 字仍用原单元格的完整内容；不把字段或带字的底色截图，也不改变普通数据表。
function pictureInCell(
  image: RgbaImage,
  cell: Box,
  lines: readonly OcrBox[],
  h: number,
): Box | null {
  if (
    ![cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) ||
    cell.width <= 0 ||
    cell.height <= 0
  )
    return null;
  const step = Math.max(3, Math.ceil(Math.max(cell.width, cell.height) / 70));
  const cols = Math.ceil(cell.width / step),
    rows = Math.ceil(cell.height / step);
  const filled = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let ink = 0,
        total = 0;
      for (const dy of [0.25, 0.75])
        for (const dx of [0.25, 0.75]) {
          const px = Math.floor(cell.x + (x + dx) * step),
            py = Math.floor(cell.y + (y + dy) * step);
          if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
          total++;
          const i = (py * image.width + px) * 4,
            r = image.data[i]!,
            g = image.data[i + 1]!,
            b = image.data[i + 2]!;
          if ((r * 299 + g * 587 + b * 114) / 1000 < 245) ink++;
        }
      if (total && ink / total >= 0.75) filled[y * cols + x] = 1;
    }
  const candidates: Box[] = [];
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== 1) continue;
    const queue = [i];
    filled[i] = 2;
    let left = cols,
      right = 0,
      top = rows,
      bottom = 0,
      count = 0;
    for (let n = 0; n < queue.length; n++) {
      const k = queue[n]!,
        x = k % cols,
        y = Math.floor(k / cols);
      count++;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx! < 0 || nx! >= cols || ny! < 0 || ny! >= rows) continue;
        const j = ny! * cols + nx!;
        if (filled[j] === 1) {
          filled[j] = 2;
          queue.push(j);
        }
      }
    }
    const box = {
      x: Math.max(0, cell.x + left * step),
      y: Math.max(0, cell.y + top * step),
      width: Math.min(cell.width - left * step, (right - left) * step),
      height: Math.min(cell.height - top * step, (bottom - top) * step),
    };
    if (
      count / ((right - left) * (bottom - top)) < 0.7 ||
      box.width < 0.35 * cell.width ||
      box.height < Math.max(2 * h, 0.15 * cell.height) ||
      box.height > 0.8 * cell.height
    )
      continue;
    if (lines.some((l) => lineShareIn(l, box) > 0.05)) continue;
    candidates.push(box);
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

export function recoverPictureCards(
  page: DocPage,
  image: RgbaImage,
  lines: readonly OcrBox[],
  h: number,
): DocPage {
  let changed = false;
  const blocks = page.blocks.flatMap((block): DocBlock[] => {
    if (block.kind !== 'table' || block.direction) return [block];
    const table = block as DocTable;
    const cells = table.table.cells;
    if (cells.length < 4 || cells.some((c) => c.rowSpan !== 1 || !c.box)) return [block];
    const pictures = new Map<TableCell, Box>();
    for (const cell of cells) {
      const own = lines.filter((l) => lineShareIn(l, cell.box!) >= 0.5);
      const picture = pictureInCell(image, cell.box!, own, h);
      if (picture && own.every((l) => l.y >= picture.y + picture.height - 0.2 * h))
        pictures.set(cell, picture);
    }
    if (
      pictures.size < 4 ||
      pictures.size < 0.75 * cells.length ||
      new Set([...pictures.keys()].map((c) => c.row)).size < 2 ||
      new Set([...pictures.keys()].map((c) => c.col)).size < 2
    )
      return [block];
    changed = true;
    const rows: DocBlock[] = [];
    for (const row of [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b)) {
      const own = cells.filter((c) => c.row === row).sort((a, b) => a.col - b.col);
      const left = Math.min(...own.map((c) => c.box!.x)),
        top = Math.min(...own.map((c) => c.box!.y));
      const right = Math.max(...own.map((c) => c.box!.x + c.box!.width)),
        bottom = Math.max(...own.map((c) => c.box!.y + c.box!.height));
      rows.push({
        kind: 'row',
        box: { x: left, y: top, width: right - left, height: bottom - top },
        cells: own.map((cell) => {
          const picture = pictures.get(cell);
          const textLines = lines.filter((l) => lineShareIn(l, cell.box!) >= 0.5);
          const textBox = textLines.length
            ? {
                x: Math.min(...textLines.map((l) => l.x)),
                y: Math.min(...textLines.map((l) => l.y)),
                width:
                  Math.max(...textLines.map((l) => l.x + l.width)) -
                  Math.min(...textLines.map((l) => l.x)),
                height:
                  Math.max(...textLines.map((l) => l.y + l.height)) -
                  Math.min(...textLines.map((l) => l.y)),
              }
            : cell.box!;
          const text: DocParagraph = {
            kind: 'paragraph',
            text: cell.text,
            size: table.size ?? page.bodySize,
            box: textBox,
          };
          return {
            width: cell.box!.width,
            blocks: [
              ...(picture ? [{ kind: 'image' as const, box: picture }] : []),
              ...(cell.text ? [text] : []),
            ],
          };
        }),
      });
    }
    return rows;
  });
  return changed ? { ...page, blocks } : page;
}
