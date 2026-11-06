import { createDefaultWorkspace } from '@morph/core';
import type { DocDoc } from '@morph/tool-office';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { makePalette } from '../renderer/theme';
import { DocView } from '../run/DocView';

// 2026-11-06 真机：转 Word 的编辑页和原件位置完全不一样（块都顶格、一个挨一个、标题被放大）。
// 编辑页按原件排（D-464，参考 CamScanner）：块之间按原图空着的高度空开，靠左的段落按原图的左边缩进，
// 字号按原件占页宽的比例，下划线画出来。
const box = (x: number, y: number, width = 100, height = 20) => ({ x, y, width, height });
const doc: DocDoc = {
  version: 1,
  pages: [
    {
      source: 'runs/r1/page.jpg',
      width: 1000,
      height: 1400,
      bodySize: 10,
      blocks: [
        {
          kind: 'paragraph',
          text: 'CENTRE DE SANTE',
          align: 'center',
          box: box(350, 100, 300, 30),
        },
        { kind: 'paragraph', text: 'Docteur', box: box(150, 300, 300, 20) },
        { kind: 'paragraph', text: 'Pantin le 11/05', box: box(550, 400, 300, 20) },
        {
          kind: 'paragraph',
          text: 'ORDONNANCE',
          heading: 1,
          size: 18,
          bold: true,
          underline: true,
          align: 'center',
          box: box(350, 700, 300, 40),
        },
      ],
    },
  ],
};

describe('DocView layout like the original', () => {
  const palette = makePalette(createDefaultWorkspace('fr').theme, false);
  const view = () => render(<DocView doc={doc} palette={palette} locale="fr" contentWidth={412} />);
  let screen: Awaited<ReturnType<typeof view>>;
  const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
  beforeEach(async () => {
    screen = await view();
  });

  it('indents left-aligned blocks by their position, centred ones not', () => {
    expect(flat('word-block-0-0').marginLeft ?? 0).toBe(0);
    const doctor = flat('word-block-0-1').marginLeft;
    const pantin = flat('word-block-0-2').marginLeft;
    expect(doctor).toBe(0);
    // Pantin 在原图里比 Docteur 靠右 400 像素（页宽 1000）。
    expect(pantin).toBeGreaterThan(130);
  });

  it('keeps the blank space between blocks', () => {
    const small = flat('word-block-0-2').marginTop;
    const big = flat('word-block-0-3').marginTop;
    // Docteur → Pantin 空 80 像素，Pantin → ORDONNANCE 空 280 像素。
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(3 * small);
  });

  it('sizes text by the page width, keeps the title size and draws the underline', () => {
    const title = StyleSheet.flatten(screen.getByText('ORDONNANCE').props.style);
    const body = StyleSheet.flatten(screen.getByText('Docteur').props.style);
    expect(title.textDecorationLine).toBe('underline');
    expect(title.fontSize / body.fontSize).toBeGreaterThan(1.5);
    expect(title.fontSize).toBeLessThan(18);
    expect(body.fontSize).toBeLessThan(12);
  });
});
