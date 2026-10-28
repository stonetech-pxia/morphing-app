import { describe, expect, it } from 'vitest';

import {
  cjkPunctuation,
  layoutOcrLines,
  polishOcrText,
  toSimplifiedChinese,
  type OcrLine,
} from './ocr-text';

/** 一行字：第几行（行高 40、行距 50），左右边界。 */
const line = (text: string, row: number, left = 100, right = 1100): OcrLine => ({
  text,
  x: left,
  y: 100 + row * 50,
  width: right - left,
  height: 40,
});

describe('layoutOcrLines (D-268)', () => {
  it('joins lines that only wrap because the paragraph is wider than the page', () => {
    const text = layoutOcrLines([
      line(
        '你这张图上，原尺寸时一行字大约高55像素，缩到50%后大约27像素，后者更接近这类模型习惯',
        0,
      ),
      line('的大小。', 1, 100, 260),
    ]);
    expect(text).toBe(
      '你这张图上，原尺寸时一行字大约高55像素，缩到50%后大约27像素，后者更接近这类模型习惯的大小。',
    );
  });

  it('keeps a new paragraph, a list item and a gap on their own lines', () => {
    const text = layoutOcrLines([
      line('漏掉一整行，往往不是因为字认不出来，而是找文字行时，那一行的边界刚好落在模型的判断', 0),
      line('线附近。', 1, 100, 260),
      // 缩进两个字：新的一段。
      line('所以并不是越大越好，而是有一个最合适的字高。图片大小只是间接决定了字有多高。', 2, 180),
      // 空了一行多：新的一段。
      line('对 Morph 的意义', 4, 100, 500),
      line('• 现在拉正后的页面长边是 2400，识别前最大送 3500，A4 上的正文大约在 25 到 35 像素', 5),
      line('高，大体在合适的范围内。', 6, 140, 600),
      line('• 但不同的识别器喜欢的字高不一样，要实测才知道。', 7, 100, 900),
    ]);
    expect(text.split('\n')).toEqual([
      '漏掉一整行，往往不是因为字认不出来，而是找文字行时，那一行的边界刚好落在模型的判断线附近。',
      '所以并不是越大越好，而是有一个最合适的字高。图片大小只是间接决定了字有多高。',
      '',
      '对 Morph 的意义',
      '• 现在拉正后的页面长边是 2400，识别前最大送 3500，A4 上的正文大约在 25 到 35 像素高，大体在合适的范围内。',
      '• 但不同的识别器喜欢的字高不一样，要实测才知道。',
    ]);
  });

  it('does not join a list item to the full line above it', () => {
    const text = layoutOcrLines([
      line('需要你先决定的事：下面三件事都会影响第一步的设计，所以请先定下来再动代码，谢谢', 0),
      line('1. 能不能在本机保存从文字里提取出的特征？', 1, 100, 700),
      line('• 识别要不要在每次打开文件时都在后台跑？', 2, 100, 700),
    ]);
    expect(text.split('\n')).toHaveLength(3);
  });

  it('joins English with a space and mends a word split by a hyphen', () => {
    const text = layoutOcrLines([
      line('The scanner straightens the page and removes the shadows before the recog-', 0),
      line('nition step, so that faint text is not lost in', 1),
      line('the process.', 2, 100, 400),
    ]);
    expect(text).toBe(
      'The scanner straightens the page and removes the shadows before the recognition step, so that faint text is not lost in the process.',
    );
  });

  it('puts boxes on the same row side by side and orders rows top to bottom', () => {
    const text = layoutOcrLines([
      line('Total', 1, 100, 300),
      { ...line('12,50 €', 1, 900, 1100), y: 153 },
      line('Ticket', 0, 100, 300),
    ]);
    expect(text).toBe('Ticket\nTotal 12,50 €');
  });

  it('returns nothing when nothing was read', () => {
    expect(layoutOcrLines([])).toBe('');
    expect(layoutOcrLines([line('  ', 0)])).toBe('');
  });
});

describe('toSimplifiedChinese (D-268)', () => {
  it('turns the traditional characters ML Kit mixed in back into simplified ones', () => {
    expect(toSimplifiedChinese('模型內部要缩得很厉害，缩小后这些細碎的纹路，差別会小很多')).toBe(
      '模型内部要缩得很厉害，缩小后这些细碎的纹路，差别会小很多',
    );
  });

  it('leaves characters that simplified Chinese also uses', () => {
    // 乾隆、於（姓）、著作：简体里也写这些字。
    expect(toSimplifiedChinese('乾隆年间，於先生的著作')).toBe('乾隆年间，於先生的著作');
    expect(toSimplifiedChinese('Total 12,50 € café')).toBe('Total 12,50 € café');
  });
});

describe('cjkPunctuation (D-268)', () => {
  it('uses full-width punctuation next to Chinese, as in the ML Kit sample', () => {
    expect(
      cjkPunctuation('认字:把每一行再缩放到固定高度,通常是48像素左右,再一个字一个字地认.'),
    ).toBe('认字：把每一行再缩放到固定高度，通常是48像素左右，再一个字一个字地认。');
    expect(cjkPunctuation('拍屏幕时的摩尔纹(屏幕像素格子产生的波纹) ,会干扰识别')).toBe(
      '拍屏幕时的摩尔纹（屏幕像素格子产生的波纹），会干扰识别',
    );
    expect(cjkPunctuation('要我加上并推送吗?')).toBe('要我加上并推送吗？');
    // 左右括号一起换。
    expect(cjkPunctuation('行高约55像素(px),缩到一半')).toBe('行高约55像素（px），缩到一半');
  });

  it('keeps numbers, times, list numbers and Latin text as they are', () => {
    expect(cjkPunctuation('合计 1,000 元，12:30 到 3.5 小时')).toBe(
      '合计 1,000 元，12:30 到 3.5 小时',
    );
    expect(cjkPunctuation('2. 缩小会顺带去掉噪点')).toBe('2. 缩小会顺带去掉噪点');
    expect(cjkPunctuation('Hello, world: (test).')).toBe('Hello, world: (test).');
    expect(cjkPunctuation('文件名 report.pdf 已保存')).toBe('文件名 report.pdf 已保存');
  });
});

describe('polishOcrText (D-268)', () => {
  it('only touches Chinese', () => {
    expect(polishOcrText('差別:内部', 'zh-Hans')).toBe('差别：内部');
    expect(polishOcrText('差別:內部', 'zh-Hant')).toBe('差別：內部');
    expect(polishOcrText('Total: 12', 'other')).toBe('Total: 12');
  });
});
