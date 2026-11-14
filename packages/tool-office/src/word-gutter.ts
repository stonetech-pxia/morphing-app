import type { Box } from './types';

// 整页分成左右两栏、两栏的行一排一排对齐的页（EU 样本 044：公报一页印着 2 × 4 张小发票样张；
// 两栏的标签行在同一个高度上）：按位置分块时左右两栏同一高度的行连成一带，一会儿左一会儿右，
// 同一排的左右两行还会接成一段「左\t右」，一页变成好几页。
// 找出整页的中缝（中间一条竖着的空白，两栏并排的那一段里没有任何行、表格、图片跨过它）以后，
// 两栏各排各的，写成一个两格的并排行；中缝上面、下面横跨的标题、页脚照常排。

/** 中缝在文字左右范围的这一段里（不是靠边的标签列）。 */
const GUTTER_FROM = 0.3;
const GUTTER_TO = 0.7;
/** 中缝至少这么宽：这么多个行高，也至少是页宽的这么多。 */
const GUTTER_MIN_LINES = 2;
const GUTTER_MIN_SHARE = 0.02;
/** 每一栏至少这么多行、至少占全部行的这么多，左右范围至少占文字宽的这么多（不是左边一列短标签、右边一列值）。 */
const SIDE_MIN_LINES = 8;
const SIDE_MIN_SHARE = 0.25;
const SIDE_MIN_WIDTH = 0.3;
/** 两栏并排的那一段至少有页高的这么多。 */
const BAND_MIN_HEIGHT = 0.3;
/**
 * 两栏差不多宽（窄的至少是宽的这么多）、两边的字至少这么多是字母：小票、价目表的品名和数量、金额是一张表的几列，
 * 不是两栏（回归用例 tbl-receipt-local-tilt）。
 */
const SIDE_BALANCE = 0.6;
const SIDE_LETTERS = 0.6;

export interface PageGutter {
  /** 中缝的中线。 */
  x: number;
  /** 两栏并排的上下范围：这一段里没有东西跨过中缝。 */
  top: number;
  bottom: number;
}

/**
 * 找整页的中缝。lines 是正文的行，blocks 是表格、图片（也不能跨过中缝，但不算行数）。
 * 没有时 null：两栏之间有横跨的图、标题、表格的页，照原来按带排。
 */
export function findPageGutter(
  lines: readonly (Box & { text: string })[],
  blocks: readonly Box[],
  lineHeight: number,
  page: { width: number; height: number },
): PageGutter | null {
  if (lines.length < 2 * SIDE_MIN_LINES) return null;
  const items = [
    ...lines.map((box) => ({ box, text: box.text as string | null })),
    ...blocks.map((box) => ({ box, text: null })),
  ];
  const left = Math.min(...items.map((i) => i.box.x));
  const right = Math.max(...items.map((i) => i.box.x + i.box.width));
  const span = right - left;
  const at = (x: number): PageGutter | null => {
    const a = items.filter((i) => i.box.x + i.box.width <= x);
    const b = items.filter((i) => i.box.x >= x);
    const count = (side: typeof items) => side.filter((i) => i.text !== null).length;
    if (Math.min(count(a), count(b)) < Math.max(SIDE_MIN_LINES, SIDE_MIN_SHARE * lines.length))
      return null;
    const extent = (side: typeof items) =>
      Math.max(...side.map((i) => i.box.x + i.box.width)) - Math.min(...side.map((i) => i.box.x));
    const [ea, eb] = [extent(a), extent(b)];
    if (Math.min(ea, eb) < Math.max(SIDE_MIN_WIDTH * span, SIDE_BALANCE * Math.max(ea, eb)))
      return null;
    const letters = (side: typeof items) => {
      const text = side
        .map((i) => i.text ?? '')
        .join('')
        .replace(/\s/g, '');
      return (text.match(/\p{L}/gu)?.length ?? 0) / Math.max(1, text.length);
    };
    if (Math.min(letters(a), letters(b)) < SIDE_LETTERS) return null;
    const top = Math.max(Math.min(...a.map((i) => i.box.y)), Math.min(...b.map((i) => i.box.y)));
    const bottom = Math.min(
      Math.max(...a.map((i) => i.box.y + i.box.height)),
      Math.max(...b.map((i) => i.box.y + i.box.height)),
    );
    if (bottom - top < BAND_MIN_HEIGHT * page.height) return null;
    const crossing = items.some(
      (i) =>
        i.box.x < x &&
        i.box.x + i.box.width > x &&
        i.box.y < bottom &&
        i.box.y + i.box.height > top,
    );
    return crossing ? null : { x, top, bottom };
  };
  const step = Math.max(1, lineHeight / 4);
  let best: { from: number; to: number } | null = null;
  let start: number | null = null;
  const end = left + GUTTER_TO * span;
  for (let x = left + GUTTER_FROM * span; x <= end + step; x += step) {
    const open = x <= end && at(x) !== null;
    if (open && start === null) start = x;
    if (!open && start !== null) {
      if (!best || x - step - start > best.to - best.from) best = { from: start, to: x - step };
      start = null;
    }
  }
  if (!best) return null;
  if (best.to - best.from < Math.max(GUTTER_MIN_LINES * lineHeight, GUTTER_MIN_SHARE * page.width))
    return null;
  return at((best.from + best.to) / 2);
}

/** 一块在中缝的哪一边：0 左栏，1 右栏，-1 横跨（中缝上面、下面的标题、页脚）。 */
export function sideOfGutter(box: Box, gutter: PageGutter): -1 | 0 | 1 {
  if (box.x + box.width <= gutter.x) return 0;
  if (box.x >= gutter.x) return 1;
  return -1;
}
