import { describe, expect, it } from 'vitest';

import {
  boxesToEnhanced,
  despeckle,
  estimateBackground,
  findSkew,
  leveledInk,
  leveledLuma,
  levelsOf,
  localStats,
  normalizeByBackground,
  planScanEnhance,
  rotatedSize,
  sauvolaThreshold,
  scanTone,
  type RgbaImage,
} from './scan-enhance';

type Rgb = [number, number, number];

/** 一页纸：底色由位置决定（模拟阴影、偏色的纸或屏幕）。 */
function page(width: number, height: number, paper: (x: number, y: number) => Rgb): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paper(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** 把一个像素按比例压暗成「墨水」（墨水颜色乘上当地的纸色，和真实拍照一样受阴影影响）。 */
function ink(img: RgbaImage, x: number, y: number, color: Rgb = [20, 20, 20]) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  for (let c = 0; c < 3; c++) img.data[i + c] = Math.round((img.data[i + c]! * color[c]!) / 255);
}

/** 画「文字行」：一行行断续的短横（像字），整体按 deg 度倾斜（y 向下，正数向右下斜）。 */
function textLines(
  img: RgbaImage,
  {
    deg = 0,
    color,
    top = 40,
    gap = 24,
    margin = 30,
  }: Partial<{
    deg: number;
    color: Rgb;
    top: number;
    gap: number;
    margin: number;
  }> = {},
) {
  const t = Math.tan((deg * Math.PI) / 180);
  for (let line = top; line < img.height - 40; line += gap) {
    for (let x = margin; x < img.width - margin; x++) {
      // 「字」宽 9 像素、间隔 4 像素，字高 8 像素。
      if (x % 13 >= 9) continue;
      for (let h = 0; h < 8; h++) {
        if ((x + h) % 3 === 0) continue;
        ink(img, x, line + h + (x - img.width / 2) * t, color);
      }
    }
  }
}

function lumaAt(norm: Float32Array, width: number, x: number, y: number) {
  const o = (y * width + x) * 3;
  return 0.299 * norm[o]! + 0.587 * norm[o + 1]! + 0.114 * norm[o + 2]!;
}

describe('scan enhance: background', () => {
  it('flattens a shadow across the page so the paper is equally white everywhere', () => {
    // 左边亮（235）、右边在阴影里（110），中间有字。
    const img = page(600, 800, (x) => {
      const v = Math.round(235 - (125 * x) / 599);
      return [v, v, v];
    });
    textLines(img);
    const bg = estimateBackground(img);
    const norm = normalizeByBackground(img, bg);
    // 行与行之间的空白（纸）：左右两侧都应接近 1。
    const left = lumaAt(norm, 600, 40, 36);
    const right = lumaAt(norm, 600, 560, 36);
    expect(left).toBeGreaterThan(0.9);
    expect(right).toBeGreaterThan(0.9);
    expect(Math.abs(left - right)).toBeLessThan(0.06);
    // 阴影里的字仍然是暗的。
    const darkInShadow = lumaAt(norm, 600, 552, 41);
    expect(darkInShadow).toBeLessThan(0.3);
  });

  it('removes a sharp shadow edge (book gutter, hand) right up to the edge, not in a wide gray band', () => {
    // 左边 1/3 在很深的阴影里（120），右边是纸（230），交界是一条直线（实验里 2–4 号书页的左上角）。
    // 分析图长边 800 时，交界两边 16 像素以外的纸都应该和别处一样白（误差 5% 以内）。
    const img = page(600, 800, (x) => (x < 200 ? [120, 120, 120] : [230, 230, 230]));
    const norm = normalizeByBackground(img, estimateBackground(img));
    for (const d of [16, 24, 48]) {
      expect(lumaAt(norm, 600, 200 - d, 400)).toBeGreaterThan(0.95);
      expect(lumaAt(norm, 600, 200 + d, 400)).toBeLessThan(1.05);
    }
  });

  it('turns tinted paper (a bluish screen) neutral white', () => {
    const img = page(400, 500, () => [150, 165, 175]);
    textLines(img);
    const norm = normalizeByBackground(img, estimateBackground(img));
    const o = (36 * 400 + 200) * 3;
    expect(norm[o]).toBeCloseTo(norm[o + 2]!, 1);
    expect(norm[o]).toBeGreaterThan(0.9);
  });

  it('keeps the paper around a glare spot white (no dark halo)', () => {
    // 纸色 170，下方有一块很亮的反光（圆心 (300, 600)，半径 120，亮到 252）。
    const img = page(600, 800, (x, y) => {
      const d = Math.hypot(x - 300, y - 600);
      const v = d < 120 ? 252 : 170;
      return [v, v, v];
    });
    textLines(img);
    const norm = normalizeByBackground(img, estimateBackground(img));
    // 反光圈外面一点（离圈 30–60 像素）的纸，在两行字之间。
    for (const [x, y] of [
      [300, 444],
      [140, 612],
      [460, 588],
    ] as const) {
      expect(lumaAt(norm, 600, x, y)).toBeGreaterThan(0.85);
    }
  });

  it('does not wash a large dark picture out to white', () => {
    // 页中间有一大块深色图片（占页面约 1/4）。
    const img = page(600, 800, (x, y) =>
      x > 150 && x < 450 && y > 250 && y < 550 ? [50, 60, 70] : [220, 220, 215],
    );
    textLines(img, { top: 40 });
    const norm = normalizeByBackground(img, estimateBackground(img));
    expect(lumaAt(norm, 600, 300, 400)).toBeLessThan(0.45);
  });
});

describe('scan enhance: levels and color', () => {
  it('keeps a blank page white instead of stretching paper noise into black', () => {
    const img = page(300, 400, (x, y) => {
      const v = 200 + ((x * 7 + y * 13) % 9) - 4;
      return [v, v, v];
    });
    const { lo, hi } = levelsOf(normalizeByBackground(img, estimateBackground(img)));
    expect(lo).toBeLessThanOrEqual(hi / 2);
    const plan = planScanEnhance(img, 'auto');
    expect(plan.skew).toBe(0);
  });

  it('maps ink to near black and paper to white', () => {
    const img = page(500, 600, () => [180, 180, 180]);
    textLines(img, { color: [90, 90, 90] });
    const norm = normalizeByBackground(img, estimateBackground(img));
    const { lo, hi } = levelsOf(norm);
    const leveled = leveledLuma(norm, lo, hi);
    expect(leveled[36 * 500 + 250]).toBe(1);
    // 灰色墨水（纸色的 35%）拉伸后应该足够黑。
    expect(leveled[41 * 500 + 31]).toBeLessThan(0.2);
  });

  it('chooses grayscale for black text on tinted paper, color when there is colored ink', () => {
    const tinted = () => [150, 165, 175] as Rgb;
    const plain = page(400, 500, tinted);
    textLines(plain);
    expect(planScanEnhance(plain, 'auto').output).toBe('gray');

    const red = page(400, 500, tinted);
    textLines(red, { top: 40, gap: 48 });
    textLines(red, { top: 64, gap: 48, color: [200, 40, 40] });
    expect(planScanEnhance(red, 'auto').output).toBe('color');
  });

  it('honours the chosen look', () => {
    const img = page(200, 260, () => [200, 200, 200]);
    textLines(img, { color: [200, 40, 40] });
    expect(planScanEnhance(img, 'gray').output).toBe('gray');
    const bw = planScanEnhance(img, 'bw');
    expect(bw.output).toBe('bw');
    expect(bw.stats).not.toBeNull();
    expect(planScanEnhance(img, 'auto').stats).toBeNull();
  });
});

describe('scan enhance: tone near white (D-275)', () => {
  it('keeps paper pure white and ink unchanged', () => {
    // 纸在白点稍上面（白点取纸色的 94%，纸约 1.06）：至少 253 / 255，比纸亮的地方 255。
    expect(scanTone(1.064)).toBeGreaterThanOrEqual(0.99);
    expect(scanTone(1.12)).toBe(1);
    expect(scanTone(1.2)).toBe(1);
    expect(scanTone(0)).toBe(0);
    expect(scanTone(0.5)).toBe(0.5);
  });

  it('does not cut faint text just under the paper to white', () => {
    // 只比纸暗 4%（反光里的淡字）：一刀切时是 1（看不见），软膝后仍比纸暗。
    const faint = 1.064 * 0.96;
    expect(scanTone(faint)).toBeLessThan(0.98);
    expect(scanTone(faint)).toBeLessThan(scanTone(1.064) - 0.01);
  });

  it('is continuous and never gets lighter for darker input', () => {
    let previous = -1;
    for (let t = -0.2; t <= 1.4; t += 0.001) {
      const v = scanTone(t);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      if (previous >= 0) expect(v - previous).toBeLessThan(0.002);
      previous = v;
    }
  });
});

describe('scan enhance: deskew', () => {
  const leveledOf = (img: RgbaImage) => {
    const norm = normalizeByBackground(img, estimateBackground(img));
    const { lo, hi } = levelsOf(norm);
    return leveledLuma(norm, lo, hi);
  };

  for (const deg of [2, -3.5, 0.6, 6]) {
    it(`finds text lines tilted by ${deg}°`, () => {
      const img = page(800, 1000, () => [225, 225, 220]);
      textLines(img, { deg, top: 120, margin: 80 });
      const found = findSkew(leveledOf(img), 800, 1000);
      expect(Math.abs(found - deg)).toBeLessThanOrEqual(0.1);
    });
  }

  it('leaves straight text alone', () => {
    const img = page(800, 1000, () => [225, 225, 220]);
    textLines(img);
    expect(findSkew(leveledOf(img), 800, 1000)).toBe(0);
  });

  it('does not rotate when there are no text lines (a scattered pattern)', () => {
    const img = page(600, 600, () => [225, 225, 220]);
    // 随机散点，没有成行的字。
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 4000; i++) {
      const x = rand() * 600;
      const y = rand() * 600;
      for (let d = 0; d < 4; d++) ink(img, x + d, y);
    }
    expect(findSkew(leveledOf(img), 600, 600)).toBe(0);
  });

  it('makes the canvas big enough to keep the rotated corners', () => {
    expect(rotatedSize({ width: 1000, height: 2000 }, 0)).toEqual({ width: 1000, height: 2000 });
    const r = rotatedSize({ width: 1000, height: 2000 }, -3);
    expect(r.width).toBe(Math.ceil(1000 * Math.cos(Math.PI / 60) + 2000 * Math.sin(Math.PI / 60)));
    expect(r.height).toBe(Math.ceil(1000 * Math.sin(Math.PI / 60) + 2000 * Math.cos(Math.PI / 60)));
  });
});

describe('scan enhance: black and white', () => {
  it('local threshold keeps faint text black and paper white', () => {
    const width = 400;
    const height = 400;
    const luma = new Float32Array(width * height).fill(1);
    // 左半边是很淡的字（0.6），右半边是正常的黑字（0.05）。
    for (let y = 100; y < 300; y += 20) {
      for (let x = 20; x < 380; x++) {
        if (x % 10 >= 6) continue;
        for (let h = 0; h < 6; h++) luma[(y + h) * width + x] = x < 200 ? 0.6 : 0.05;
      }
    }
    const stats = localStats(luma, width, height);
    const at = (x: number, y: number) => {
      const o = (Math.floor(y / 2) * stats.width + Math.floor(x / 2)) * 4;
      return sauvolaThreshold(stats.data[o]! / 255, stats.data[o + 1]! / 255 / 2);
    };
    expect(0.6).toBeLessThan(at(100, 102)); // 淡字 → 黑
    expect(0.05).toBeLessThan(at(300, 102)); // 黑字 → 黑
    expect(1).toBeGreaterThan(at(100, 50)); // 空白 → 白
    expect(1).toBeGreaterThan(at(100, 112)); // 行间 → 白
  });

  it('treats red and blue ink as dark for black and white, so colored text is kept', () => {
    // 除过背景、拉伸后的颜色：红字、蓝字、白纸、浅灰的纸纹。
    const normalized = Float32Array.from([1, 0.25, 0.25, 0.2, 0.3, 0.9, 1, 1, 1, 0.92, 0.9, 0.94]);
    const ink = leveledInk(normalized, 0, 1);
    expect(ink[0]).toBeLessThan(0.3);
    expect(ink[1]).toBeLessThan(0.3);
    expect(ink[2]).toBe(1);
    expect(ink[3]).toBeGreaterThan(0.85);
    // 黑白模式的统计就是按这个算的：黑字和红字隔行，红字那一行的均值和黑字那一行差不多暗。
    const mixed = page(240, 240, () => [230, 230, 230]);
    textLines(mixed, { top: 40, gap: 48 });
    textLines(mixed, { top: 64, gap: 48, color: [220, 30, 30] });
    const stats = planScanEnhance(mixed, 'bw').stats!;
    const meanAt = (x: number, y: number) =>
      stats.data[(Math.floor(y / 2) * stats.width + Math.floor(x / 2)) * 4]! / 255;
    expect(Math.abs(meanAt(120, 68) - meanAt(120, 44))).toBeLessThan(0.03);
    expect(planScanEnhance(mixed, 'gray').stats).toBeNull();
  });

  it('removes isolated specks but keeps dots next to letters', () => {
    const img = page(200, 100, () => [255, 255, 255]);
    const black = (x: number, y: number) => {
      const i = (y * 200 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    };
    // 一个「字」：20×30。
    for (let y = 30; y < 60; y++) for (let x = 20; x < 40; x++) black(x, y);
    // 字旁边的句号（2×2，隔 3 像素）。
    for (let y = 56; y < 58; y++) for (let x = 43; x < 45; x++) black(x, y);
    // 远处孤立的噪点（2×2 和 1 个像素）。
    for (let y = 10; y < 12; y++) for (let x = 150; x < 152; x++) black(x, y);
    black(120, 80);
    const removed = despeckle(img, { maxSide: 3, reach: 6 });
    expect(removed).toBe(2);
    const isBlack = (x: number, y: number) => img.data[(y * 200 + x) * 4] === 0;
    expect(isBlack(43, 56)).toBe(true);
    expect(isBlack(30, 40)).toBe(true);
    expect(isBlack(150, 10)).toBe(false);
    expect(isBlack(120, 80)).toBe(false);
  });

  it('keeps everything on a page with no specks', () => {
    const img = page(50, 50, () => [255, 255, 255]);
    expect(despeckle(img, { maxSide: 3, reach: 6 })).toBe(0);
  });
});

describe('scan enhance: text boxes on the enhanced page (D-267)', () => {
  const box = (x: number, y: number) => ({ text: 't', x, y, width: 40, height: 10 });

  it('only scales when the page was not rotated', () => {
    const [b] = boxesToEnhanced(
      [box(100, 200)],
      { width: 1000, height: 2000 },
      { width: 500, height: 1000 },
      0,
      { width: 500, height: 1000 },
    );
    expect(b).toEqual({ text: 't', x: 50, y: 100, width: 20, height: 5 });
  });

  it('follows the deskew: words on a line tilted by +3° end up on one horizontal line', () => {
    const size = { width: 1000, height: 1400 };
    const canvas = rotatedSize(size, 3);
    const t = Math.tan((3 * Math.PI) / 180);
    // 同一行上的三个词：越往右越低（向右下斜 3°）。
    const words = [100, 450, 800].map((x) => box(x, 600 + (x + 20 - 500) * t));
    const mapped = boxesToEnhanced(words, size, size, 3, canvas);
    const centers = mapped.map((b) => b.y + b.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(0.5);
    // 页面中心还在画布中心。
    const [mid] = boxesToEnhanced([box(480, 695)], size, size, 3, canvas);
    expect(mid!.x + 20).toBeCloseTo(canvas.width / 2, 6);
    expect(mid!.y + 5).toBeCloseTo(canvas.height / 2, 6);
  });
});
