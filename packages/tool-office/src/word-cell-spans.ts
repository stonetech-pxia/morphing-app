import type { DocTable } from './doc';
import { lineShareIn } from './layout';
import { findLines, type PageLines } from './lines';
import type { Box, OcrBox, RgbaImage } from './types';

/** 填写框的短竖线在标签上方结束时，不能把标签也从词中间切开。只合并完整、单排的标签。 */
export function restoreWordCellSpans(
  block: DocTable,
  image: RgbaImage,
  lines: readonly OcrBox[],
  join: (lines: readonly OcrBox[]) => string,
  rules: () => PageLines = () => findLines(image),
): void {
  if (block.borderless || block.direction) return;
  let pageLines: PageLines | undefined;
  const compact = (s: string) => [...s.replace(/\s/g, '')].sort().join('');
  for (const line of lines) {
    if (lineShareIn(line, block.box) < 0.95) continue;
    const cy = line.y + line.height / 2;
    const cells = block.table.cells
      .filter(
        (c) =>
          c.box &&
          c.rowSpan === 1 &&
          cy >= c.box.y &&
          cy < c.box.y + c.box.height &&
          c.box.x < line.x + line.width - line.height * 0.2 &&
          c.box.x + c.box.width > line.x + line.height * 0.2,
      )
      .sort((a, b) => a.col - b.col);
    if (cells.length < 2 || cells.some((c) => c.row !== cells[0]!.row)) continue;
    const chars = line.chars;
    if (!chars?.length) continue;
    const typical = (chars.at(-1)!.at - chars[0]!.at) / Math.max(1, chars.length - 1);
    const cutWord = cells.slice(1).some((c) => {
      const at = (c.box!.x - line.x) / line.width;
      const i = chars.findIndex((ch) => ch.at >= at);
      const a = chars[i - 1],
        b = chars[i];
      return (
        a &&
        b &&
        /[\p{L}\p{N}]$/u.test(a.text) &&
        /^[\p{L}\p{N}]/u.test(b.text) &&
        b.at - a.at <= typical * 1.8
      );
    });
    if (!cutWord) continue;
    const first = cells[0]!,
      last = cells.at(-1)!;
    if (cells.some((c, i) => i > 0 && cells[i - 1]!.col + cells[i - 1]!.colSpan !== c.col))
      continue;
    const box: Box = {
      x: first.box!.x,
      y: first.box!.y,
      width: last.box!.x + last.box!.width - first.box!.x,
      height: first.box!.height,
    };
    if (line.x < box.x - 2 || line.x + line.width > box.x + box.width + 2) continue;
    const members = lines.filter(
      (l) =>
        l.y + l.height / 2 >= box.y &&
        l.y + l.height / 2 < box.y + box.height &&
        l.x >= box.x - 2 &&
        l.x + l.width <= box.x + box.width + 2,
    );
    if (
      members.some((l) => Math.abs(l.y + l.height / 2 - cy) > Math.min(l.height, line.height) * 0.5)
    )
      continue;
    const text = members
      .sort((a, b) => a.x - b.x)
      .map((l) => join([l]).trim())
      .join('\t');
    if (compact(text) !== compact(cells.map((c) => c.text).join(''))) continue;
    pageLines ??= rules();
    const t = Math.tan((pageLines.skew * Math.PI) / 180);
    const top = line.y - line.x * t,
      bottom = line.y + line.height - line.x * t;
    const boundaries = cells.slice(1).map((c) => c.box!.x + cy * t);
    const ruled = boundaries.some((x) =>
      pageLines!.vertical.some(
        (v) =>
          Math.abs(v.pos - x) <= Math.max(v.thickness, line.height * 0.25) &&
          v.spans.reduce(
            (n, [a, b]) => n + Math.max(0, Math.min(b, bottom) - Math.max(a, top)),
            0,
          ) >=
            line.height * 0.5,
      ),
    );
    if (ruled) continue;
    const merged = {
      ...first,
      colSpan: last.col + last.colSpan - first.col,
      text,
      box,
      align: 'left' as const,
    };
    block.table = {
      ...block.table,
      cells: block.table.cells.flatMap((c) =>
        c === first ? [merged] : cells.includes(c) ? [] : [c],
      ),
    };
  }
}
