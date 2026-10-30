import { describe, expect, it } from 'vitest';

import { pickPaper, type GrayImage } from './paper';
import { defaultQuad, type Quad } from './quad';

// 合成的灰度图（照片的 1/10），从创始人 2026-10-29 真机测试的 20 张照片里抽出来的几种情形。
const K = 10;
const W = 300;
const H = 400;
const size = { width: W * K, height: H * K };

const DESK = 70;
const PAPER = 205;
const INK = 50;

function canvas(fill: number): GrayImage {
  return { width: W, height: H, data: new Uint8Array(W * H).fill(fill) };
}

function rect(img: GrayImage, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data[y * W + x] = v;
}

/** 一行行的字：短横线。 */
function text(img: GrayImage, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y += 9)
    for (let x = x0; x < x1; x += 7) rect(img, x, y, x + 4, y + 2, INK);
}

/** 带格子的表格框（线宽 2）。 */
function table(img: GrayImage, x0: number, y0: number, x1: number, y1: number) {
  for (const x of [x0, (x0 + x1) >> 1, x1 - 2]) rect(img, x, y0, x + 2, y1, INK);
  for (let y = y0; y < y1; y += 25) rect(img, x0, y, x1, y + 2, INK);
  rect(img, x0, y1 - 2, x1, y1, INK);
  text(img, x0 + 6, y0 + 8, x1 - 6, y1 - 6);
}

/** 照片上的一个框（坐标是灰度图的，换算回原图）。 */
function quadOf(x0: number, y0: number, x1: number, y1: number): Quad {
  return {
    tl: { x: x0 * K, y: y0 * K },
    tr: { x: x1 * K, y: y0 * K },
    br: { x: x1 * K, y: y1 * K },
    bl: { x: x0 * K, y: y1 * K },
  };
}

const whole = defaultQuad(size, 0);

describe('pickPaper', () => {
  it('does not take a big table on a page that fills the photo for the paper', () => {
    // 物业账单：纸占满画面，上面是字，中间一张大表格；找到的只有表格外框。
    const img = canvas(PAPER);
    text(img, 20, 15, 280, 120);
    table(img, 25, 135, 275, 345);
    text(img, 20, 355, 280, 390);
    const frame = quadOf(25, 135, 275, 345);
    expect(pickPaper([frame], size, img)).toEqual(whole);
    // 亮区域找到了贴着照片边缘的纸：用它。
    const page = quadOf(1, 1, 299, 399);
    expect(pickPaper([frame, page], size, img)).toEqual(page);
  });

  it('still takes a sheet lying on a desk', () => {
    const img = canvas(DESK);
    rect(img, 40, 50, 260, 350, PAPER);
    text(img, 55, 70, 245, 330);
    const sheet = quadOf(40, 50, 260, 350);
    expect(pickPaper([sheet], size, img)).toEqual(sheet);
  });

  it('takes the sheet, not a small box printed on it', () => {
    const img = canvas(DESK);
    rect(img, 30, 40, 270, 370, PAPER);
    text(img, 45, 60, 255, 150);
    table(img, 60, 170, 240, 260);
    const sheet = quadOf(30, 40, 270, 370);
    const box = quadOf(60, 170, 240, 260);
    expect(pickPaper([box, sheet], size, img)).toEqual(sheet);
  });

  it('keeps a sheet that runs off two edges of the photo', () => {
    // 书页：上边和左边出了画面，右边和下边是深色桌面。
    const img = canvas(DESK);
    rect(img, 0, 0, 270, 370, PAPER);
    text(img, 15, 15, 255, 355);
    const sheet = quadOf(0, 0, 270, 370);
    expect(pickPaper([sheet], size, img)).toEqual(sheet);
  });

  it('gives null when there is no candidate at all', () => {
    expect(pickPaper([], size, canvas(PAPER))).toBeNull();
  });
});
