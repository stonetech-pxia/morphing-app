import type { DocTable } from './doc';
import { lineShareIn } from './layout';
import { findLines, type PageLines } from './lines';
import type { Box, OcrBox, RgbaImage } from './types';

/** CTC 的字符间距证明列边界切在词中间，不能把正常列间空白当成断词。 */
export function cutsWord(line: OcrBox, x: number): boolean {
  const chars = line.chars;
  if (!chars?.length) return false;
  const typical = (chars.at(-1)!.at - chars[0]!.at) / Math.max(1, chars.length - 1);
  const i = chars.findIndex((ch) => ch.at >= (x - line.x) / line.width);
  const a = chars[i - 1],
    b = chars[i];
  return !!(
    a &&
    b &&
    /[\p{L}\p{N}]$/u.test(a.text) &&
    /^[\p{L}\p{N}]/u.test(b.text) &&
    b.at - a.at <= typical * 1.8
  );
}
export function crossesRule(line: OcrBox, x: number, rules: PageLines): boolean {
  const t = Math.tan((rules.skew * Math.PI) / 180),
    at = x + (line.y + line.height / 2) * t;
  const top = line.y - line.x * t,
    bottom = line.y + line.height - line.x * t;
  return rules.vertical.some(
    (v) =>
      Math.abs(v.pos - at) <= Math.max(v.thickness, line.height * 0.25) &&
      v.spans.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, bottom) - Math.max(a, top)), 0) >=
        line.height * 0.5,
  );
}

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
    let cells = block.table.cells
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
    const cutWord = cells.slice(1).some((c) => cutsWord(line, c.box!.x));
    if (!cutWord) continue;
    // 同一粗格可同时含前一个标签的尾部和后一个标签的头部；
    // 把与候选格相交的完整 OCR 行一起纳入，不能因为边界以外还有字而留下断词。
    const rowCells = block.table.cells.filter(
      (c) => c.box && c.rowSpan === 1 && c.row === cells[0]!.row,
    );
    for (let i = 0; i < rowCells.length; i++) {
      const x = cells[0]!.box!.x,
        end = cells.at(-1)!.box!.x + cells.at(-1)!.box!.width;
      const linked = lines.filter(
        (l) =>
          l.y + l.height / 2 >= cells[0]!.box!.y &&
          l.y + l.height / 2 < cells[0]!.box!.y + cells[0]!.box!.height &&
          l.x < end &&
          l.x + l.width > x,
      );
      const a = Math.min(x, ...linked.map((l) => l.x)),
        b = Math.max(end, ...linked.map((l) => l.x + l.width));
      const expanded = rowCells
        .filter((c) => c.box!.x < b && c.box!.x + c.box!.width > a)
        .sort((a, b) => a.col - b.col);
      if (expanded.length === cells.length) break;
      cells = expanded;
    }
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
    const ruled = cells
      .slice(1)
      .some((c) => members.some((l) => crossesRule(l, c.box!.x, pageLines!)));
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
