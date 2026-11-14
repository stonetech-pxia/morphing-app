import type { OcrBox, RgbaImage } from './types';

// 列表的圆点「•」、短横「-」（EU 样本 026、027）：识别常常读不出这个小记号，行从后面的字开始。
// 没有记号时列表项变成普通段落，两项接成一段、一项的折行又被拆开。在行左边找这个记号：
// 一小块实心的墨（圆点）或者一小截横线（短横），在字的半腰，周围空着；整页至少两行在同一个位置有同样的记号才算。
// 找到的接在行的前面（「• 」「- 」），后面照常按列表排。

/** 记号离字最远这么多个行高，最近这么多个行高。 */
const MARK_FAR = 2.5;
const MARK_NEAR = 0.15;
/** 圆点的直径：这么多到这么多个行高。 */
const DOT_MIN = 0.12;
const DOT_MAX = 0.5;
/** 短横：长这么多到这么多个行高，粗不超过这么多个行高。 */
const DASH_MIN = 0.18;
const DASH_MAX = 1.1;
const DASH_THICK = 0.15;
/** 同一种记号至少这么多行、左边差不到这么多个行高，才是列表。 */
const MARKS_MIN = 2;
const MARK_ALIGN = 0.5;
/** 第一个字的中心离字的左边约这么多个行高；第一个字离框的左边至少这么多个行高才算框里有记号。 */
const CHAR_HALF = 0.25;
const INSIDE_MIN = 0.6;

type Kind = 'dot' | 'dash';
interface Mark {
  kind: Kind;
  x: number;
}

const inkAt = (image: RgbaImage, x: number, y: number) => {
  const o = (y * image.width + x) * 4;
  return Math.min(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!) < 128;
};

/**
 * 字真正从哪里开始：识别框常常从记号开始（框里有「■」，字里却没有它，EU 样本 041），
 * 第一个字的位置离框的左边超过半个行高时按第一个字算。
 */
function textStart(line: OcrBox): number {
  const first = line.chars?.length === [...line.text].length ? line.chars[0] : undefined;
  if (!first) return line.x;
  const x = line.x + first.at * line.width - CHAR_HALF * line.height;
  return x - line.x >= INSIDE_MIN * line.height ? x : line.x;
}

/** 行左边的一小块墨：只有一块、大小和位置像圆点或短横时返回它。 */
function markOf(image: RgbaImage, line: OcrBox): Mark | null {
  const h = line.height;
  const start = textStart(line);
  const x0 = Math.max(0, Math.floor(line.x - MARK_FAR * h));
  const x1 = Math.min(image.width, Math.floor(start - MARK_NEAR * h));
  const y0 = Math.max(0, Math.floor(line.y));
  const y1 = Math.min(image.height, Math.ceil(line.y + h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const w = x1 - x0;
  const seen = new Uint8Array(w * (y1 - y0));
  let blob: { x0: number; y0: number; x1: number; y1: number; n: number } | null = null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = (y - y0) * w + (x - x0);
      if (seen[k] || !inkAt(image, x, y)) continue;
      // 第二块墨：不是单独的一个记号。
      if (blob) return null;
      const b = { x0: x, y0: y, x1: x, y1: y, n: 0 };
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = (p % w) + x0;
        const py = Math.floor(p / w) + y0;
        b.n++;
        b.x0 = Math.min(b.x0, px);
        b.x1 = Math.max(b.x1, px);
        b.y0 = Math.min(b.y0, py);
        b.y1 = Math.max(b.y1, py);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const q = (ny - y0) * w + (nx - x0);
          if (!seen[q] && inkAt(image, nx, ny)) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
      blob = b;
    }
  }
  if (!blob) return null;
  const bw = blob.x1 - blob.x0 + 1;
  const bh = blob.y1 - blob.y0 + 1;
  // 贴着找的范围的边（左边的别的字、上下行的字伸进来）：不是单独的记号。
  if (blob.x0 === x0 || blob.y0 === y0 || blob.y1 === y1 - 1) return null;
  const cy = (blob.y0 + blob.y1) / 2 - line.y;
  if (cy < 0.25 * h || cy > 0.8 * h) return null;
  if (
    bw >= DOT_MIN * h &&
    bw <= DOT_MAX * h &&
    bh >= DOT_MIN * h &&
    bh <= DOT_MAX * h &&
    bw <= 1.6 * bh &&
    bh <= 1.6 * bw &&
    blob.n >= 0.6 * bw * bh
  )
    return { kind: 'dot', x: blob.x0 };
  if (bw >= DASH_MIN * h && bw <= DASH_MAX * h && bh <= DASH_THICK * h && bw >= 2 * bh)
    return { kind: 'dash', x: blob.x0 };
  return null;
}

const TEXT = { dot: '•', dash: '-' } as const;

/**
 * 给识别漏了列表记号的行补上记号。已经以记号、编号开头的行不动。
 * 返回新的行，和新行 → 原来的识别行。
 */
export function withBullets(
  image: RgbaImage,
  lines: readonly OcrBox[],
): { lines: OcrBox[]; source: Map<OcrBox, OcrBox> } {
  const found = new Map<OcrBox, Mark>();
  for (const l of lines) {
    if (/^\s*[•·*▪●○◦■□\-–—]/u.test(l.text) || !/^\s*\p{L}/u.test(l.text)) continue;
    const mark = markOf(image, l);
    if (mark) found.set(l, mark);
  }
  const source = new Map<OcrBox, OcrBox>();
  const out = lines.map((l) => {
    const mark = found.get(l);
    if (!mark) return l;
    // 同一种记号、左边对齐的至少还有一行。
    const peers = [...found].filter(
      ([o, m]) => m.kind === mark.kind && Math.abs(m.x - mark.x) <= MARK_ALIGN * o.height,
    );
    if (peers.length < MARKS_MIN) return l;
    const x = Math.min(mark.x, l.x);
    const width = l.x + l.width - x;
    const head = `${TEXT[mark.kind]} `;
    const chars = l.chars?.length
      ? [
          { text: TEXT[mark.kind], at: (mark.x - x) / width },
          { text: ' ', at: (mark.x - x + textStart(l) - x) / 2 / width },
          ...l.chars.map((c) => ({ text: c.text, at: (l.x - x + c.at * l.width) / width })),
        ]
      : undefined;
    const next: OcrBox = {
      ...l,
      text: head + l.text.trimStart(),
      x,
      width,
      ...(chars && l.chars!.length === [...l.text].length && !/^\s/.test(l.text) ? { chars } : {}),
    };
    if (!next.chars || next.chars.length !== [...next.text].length) delete next.chars;
    source.set(next, l);
    return next;
  });
  return { lines: out, source };
}
