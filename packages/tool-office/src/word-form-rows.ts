import type { DocTable } from './doc';
import { findLines, type PageLines } from './lines';
import type { Box, OcrBox, RgbaImage, TableCell } from './types';
import { crossesRule, cutsWord } from './word-cell-spans';

const compact = (s: string) => [...s.replace(/\s/g, '')].sort().join('');
const bounds = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};
function textRows(lines: readonly OcrBox[]): OcrBox[][] {
  const rows: OcrBox[][] = [];
  for (const line of [...lines].sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2)) {
    const previous = rows.at(-1)?.[0];
    if (
      previous &&
      Math.min(previous.y + previous.height, line.y + line.height) - Math.max(previous.y, line.y) >=
        Math.min(previous.height, line.height) * 0.5
    )
      rows.at(-1)!.push(line);
    else rows.push([line]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}
/** 横贯表格的同色条，而不是照片或几个不同颜色的卡片。 */
function colorBand(image: RgbaImage, row: readonly OcrBox[], box: Box): boolean {
  const b = bounds(row),
    y = Math.min(image.height - 1, Math.max(0, Math.round(b.y + b.height / 2)));
  const colors = new Map<number, number>();
  let total = 0;
  for (
    let x = Math.max(0, Math.ceil(box.x));
    x < Math.min(image.width, box.x + box.width);
    x += Math.max(1, Math.floor(box.width / 80))
  ) {
    const i = (y * image.width + x) * 4,
      r = image.data[i]!,
      g = image.data[i + 1]!,
      b = image.data[i + 2]!;
    total++;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24 || Math.max(r, g, b) > 235) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...colors.values()) >= total * 0.7;
}
function sectionHeader(image: RgbaImage, row: readonly OcrBox[], box: Box): boolean {
  const line = row[0];
  if (
    !line ||
    !(/^[\p{Lu}\p{M}]{4,}(?:[\s(]|$)/u.test(line.text) || /^[\p{Script=Han}]{2,}/u.test(line.text))
  )
    return false;
  if (
    row.length !== 1 ||
    !line ||
    line.text.length > 100 ||
    line.width > box.width * 0.8 ||
    !colorBand(image, row, box)
  )
    return false;
  return !line.chars?.some(
    (c, i) => i > 0 && (c.at - line.chars![i - 1]!.at) * line.width > line.height * 1.5,
  );
}

/** 把填写框下面的整行标签从粗网格行中分开；逐行字符守恒，不能把别的字段吞掉。 */
export function restoreWordFormRows(
  block: DocTable,
  image: RgbaImage,
  lines: readonly OcrBox[],
  join: (lines: readonly OcrBox[]) => string,
): void {
  if (block.borderless || block.direction) return;
  let rules: PageLines | undefined;
  for (let r = 0; r < block.table.rows;) {
    const touching = block.table.cells.filter((c) => c.row <= r && c.row + c.rowSpan > r);
    const wide =
      touching.length === 1 &&
      touching[0]!.row === r &&
      touching[0]!.col === 0 &&
      touching[0]!.colSpan === block.table.cols;
    if (
      !touching.length ||
      touching.some((c) => !c.box || c.row !== r || (!wide && c.rowSpan !== 1))
    ) {
      r++;
      continue;
    }
    const span = wide ? touching[0]!.rowSpan : 1;
    const box = bounds(touching.map((c) => c.box!));
    const members = lines.filter(
      (l) =>
        l.y + l.height / 2 >= box.y &&
        l.y + l.height / 2 < box.y + box.height &&
        l.x + l.width / 2 >= box.x &&
        l.x + l.width / 2 < box.x + box.width,
    );
    const rows = textRows(members);
    if (!rows.length) {
      r += span;
      continue;
    }
    const colored =
      block.box.width > image.width * 0.65 &&
      block.box.height > image.height * 0.45 &&
      rows.some((row) => sectionHeader(image, row, box));
    const cut =
      !wide &&
      rows.some((row) =>
        row.some((l) =>
          touching.slice(1).some((c) => {
            if (!cutsWord(l, c.box!.x)) return false;
            rules ??= findLines(image);
            return !crossesRule(l, c.box!.x, rules);
          }),
        ),
      );
    if (span > 1 && !colored) {
      r += span;
      continue;
    }
    const split = rows.length > 1 && (colored || cut);
    if (
      !split &&
      !(rows.length === 1 && touching.length > 1 && sectionHeader(image, rows[0]!, box))
    ) {
      r += span;
      continue;
    }
    if (block.table.cells.length - touching.length + rows.length * touching.length > 5000) {
      r += span;
      continue;
    }
    const bands = rows.map(bounds);
    const edges = [
      box.y,
      ...bands
        .slice(1)
        .map((b, i) =>
          Math.max(box.y, Math.min(box.y + box.height, (bands[i]!.y + bands[i]!.height + b.y) / 2)),
        ),
      box.y + box.height,
    ];
    const next: TableCell[] = [];
    for (const [i, row] of rows.entries()) {
      const y = edges[i]!,
        height = edges[i + 1]! - y;
      if (sectionHeader(image, row, box)) {
        next.push({
          ...touching[0]!,
          row: r + i,
          rowSpan: 1,
          col: 0,
          colSpan: block.table.cols,
          text: join(row).trim(),
          align: 'left',
          box: { ...box, y, height },
        });
        continue;
      }
      for (const cell of touching) {
        const cb = cell.box!,
          pieces: OcrBox[] = [];
        for (const l of row) {
          if (l.chars?.length) {
            const chars = l.chars.filter(
              (c) => l.x + c.at * l.width >= cb.x && l.x + c.at * l.width < cb.x + cb.width,
            );
            if (chars.length)
              pieces.push({
                ...l,
                x: l.x + chars[0]!.at * l.width,
                text: chars.map((c) => c.text).join(''),
                chars,
              });
          } else if (l.x + l.width / 2 >= cb.x && l.x + l.width / 2 < cb.x + cb.width)
            pieces.push(l);
        }
        next.push({
          ...cell,
          row: r + i,
          rowSpan: 1,
          text: pieces
            .sort((a, b) => a.x - b.x)
            .map((p) => join([p]).trim())
            .filter(Boolean)
            .join('\t'),
          box: { ...cb, y, height },
        });
      }
    }
    if (
      next.some((c) => !c.box || c.box.height <= 0) ||
      compact(next.map((c) => c.text).join('')) !== compact(touching.map((c) => c.text).join(''))
    ) {
      r += span;
      continue;
    }
    const delta = rows.length - span;
    block.table = {
      ...block.table,
      rows: block.table.rows + delta,
      cells: block.table.cells
        .filter((c) => !touching.includes(c))
        .map((c) => (c.row >= r + span ? { ...c, row: c.row + delta } : c))
        .concat(next)
        .sort((a, b) => a.row - b.row || a.col - b.col),
    };
    r += rows.length;
  }
}
