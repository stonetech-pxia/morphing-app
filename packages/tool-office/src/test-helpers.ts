import type { DocPage } from './doc';
import { leafBlocks } from './doc';
import { lineShareIn } from './layout';
import type { OcrBox, RgbaImage } from './types';

// 测试用的合成页面：白底上画黑色的矩形（线、字的笔画），整页可以转一个角度（模拟拍歪了）。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 灰度（0 黑 – 255 白），不给是 20（黑）。 */
  shade?: number;
}

/** 画一页：rects 是转之前的坐标，deg 是绕页面中心顺时针转的角度（y 朝下）。 */
export function renderPage(
  width: number,
  height: number,
  rects: readonly Rect[],
  deg = 0,
): RgbaImage {
  const data = new Uint8Array(width * height * 4).fill(255);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 转回去，看落在哪个矩形里。
      const u = cx + (x + 0.5 - cx) * cos + (y + 0.5 - cy) * sin;
      const v = cy - (x + 0.5 - cx) * sin + (y + 0.5 - cy) * cos;
      for (const r of rects) {
        if (u >= r.x && u < r.x + r.width && v >= r.y && v < r.y + r.height) {
          const o = (y * width + x) * 4;
          data[o] = data[o + 1] = data[o + 2] = r.shade ?? 20;
          break;
        }
      }
    }
  }
  return { width, height, data };
}

/** 一点转 deg 度以后的位置。 */
export function rotatePoint(x: number, y: number, width: number, height: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  };
}

/** 网格线：横线在 ys、竖线在 xs，线宽 2；skip 里的边不画（合并单元格）。 */
export function gridRects(
  xs: readonly number[],
  ys: readonly number[],
  options: {
    thickness?: number;
    /** 不画的竖线段：[第几条竖线, 第几行]。 */
    skipV?: readonly [number, number][];
    /** 不画的横线段：[第几条横线, 第几列]。 */
    skipH?: readonly [number, number][];
    /** 每条线上的断口（像素宽）。 */
    breakEvery?: number;
  } = {},
): Rect[] {
  const t = options.thickness ?? 2;
  const out: Rect[] = [];
  const pushBroken = (r: Rect, horizontal: boolean) => {
    if (!options.breakEvery) return void out.push(r);
    // 每隔 breakEvery 像素断开 6 像素（复印件的断线）。
    const length = horizontal ? r.width : r.height;
    for (let s = 0; s < length; s += options.breakEvery) {
      const piece = Math.min(options.breakEvery - 6, length - s);
      if (piece <= 0) continue;
      out.push(
        horizontal
          ? { x: r.x + s, y: r.y, width: piece, height: r.height }
          : { x: r.x, y: r.y + s, width: r.width, height: piece },
      );
    }
  };
  for (const [i, y] of ys.entries()) {
    for (let c = 0; c < xs.length - 1; c++) {
      if (options.skipH?.some(([a, b]) => a === i && b === c)) continue;
      pushBroken({ x: xs[c]!, y, width: xs[c + 1]! - xs[c]! + t, height: t }, true);
    }
  }
  for (const [i, x] of xs.entries()) {
    for (let r = 0; r < ys.length - 1; r++) {
      if (options.skipV?.some(([a, b]) => a === i && b === r)) continue;
      pushBroken({ x, y: ys[r]!, width: t, height: ys[r + 1]! - ys[r]! + t }, false);
    }
  }
  return out;
}

/** 像字的笔画：一排竖条（每 7 像素一条，宽 2，高 h），不会被当成线。 */
export function glyphs(x: number, y: number, width: number, h = 16): Rect[] {
  const out: Rect[] = [];
  for (let s = 0; s + 2 <= width; s += 7) out.push({ x: x + s, y, width: 2, height: h });
  return out;
}

/** 假的识别结果：转之前的框，换成转过以后的位置（大小不变）；chars 给每个字均匀的位置。 */
export function fakeLine(
  text: string,
  box: Rect,
  page: { width: number; height: number; deg?: number },
  withChars = false,
): OcrBox {
  const c = rotatePoint(
    box.x + box.width / 2,
    box.y + box.height / 2,
    page.width,
    page.height,
    page.deg ?? 0,
  );
  const chars = Array.from(text);
  return {
    text,
    x: c.x - box.width / 2,
    y: c.y - box.height / 2,
    width: box.width,
    height: box.height,
    ...(withChars
      ? { chars: chars.map((ch, i) => ({ text: ch, at: (i + 0.5) / chars.length })) }
      : {}),
  };
}

/**
 * 字的守恒：识别出来的每个词在 Word 的可编辑文字里正好出现一次（丢字、重复都算错）。
 * 一半以上落在图片块里的行可以只留在图里（出现 0 次或 1 次都行）。按词计数，不受分段、分格影响。
 */
export function textConservation(
  page: Pick<DocPage, 'blocks'>,
  lines: readonly OcrBox[],
): { missing: string[]; extra: string[] } {
  const leaves = leafBlocks(page);
  const images = leaves.filter((b) => b.kind === 'image').map((b) => b.box);
  // 列表的编号写进 Word 的自动编号，不在项目文字里：编号样的词两边都不数。
  const marker = /^(?:[(（]?[\p{N}\p{L}]{1,3}[.)）、:]|[•·\-–*])$/u;
  const words = (s: string) => s.split(/\s+/).filter((w) => w && !marker.test(w));
  const count = (list: readonly string[]) => {
    const m = new Map<string, number>();
    for (const w of list) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const inImage = (l: OcrBox) => images.some((box) => lineShareIn(l, box) >= 0.5);
  const expected = count(lines.filter((l) => !inImage(l)).flatMap((l) => words(l.text)));
  const optional = count(lines.filter(inImage).flatMap((l) => words(l.text)));
  const actual = count(
    leaves.flatMap((b) =>
      words(
        b.kind === 'paragraph'
          ? b.text
          : b.kind === 'list'
            ? b.items.join(' ')
            : b.kind === 'table'
              ? b.table.cells.map((c) => c.text).join(' ')
              : '',
      ),
    ),
  );
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [w, n] of expected) {
    const got = actual.get(w) ?? 0;
    for (let i = got; i < n; i++) missing.push(w);
  }
  for (const [w, got] of actual) {
    const allowed = (expected.get(w) ?? 0) + (optional.get(w) ?? 0);
    for (let i = allowed; i < got; i++) extra.push(w);
  }
  return { missing, extra };
}
