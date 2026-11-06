import {
  mergeEdited,
  type DocDoc,
  type DocList,
  type DocParagraph,
  type EditedPage,
} from '@morph/tool-office';
import { JSDOM } from 'jsdom';

import { blockBase, paperWidth, wordPageHtml } from '../desk/word-page';

// 桌上的 Word 整页直接改（D-465）：页面按原件排；页面里的脚本读回每一块的样子，合回文档。
// 这里用 jsdom 跑真的页面脚本（没有排版，也没有 execCommand：改 DOM 的地方照浏览器会做的那样手动改）。

const WIDTH = 412;
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
        {
          kind: 'list',
          ordered: true,
          format: '(%1)',
          items: ['un', 'deux'],
          box: box(150, 800, 300, 40),
        },
        {
          kind: 'table',
          colWidths: [200, 200],
          box: box(150, 900, 400, 40),
          table: {
            kind: 'table',
            rows: 1,
            col: 0,
            cols: 2,
            box: box(150, 900, 400, 40),
            cells: [
              { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'OD' },
              { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: '-2.75' },
            ],
          },
        },
        { kind: 'paragraph', text: 'Nom\tDupont', tab: 200, box: box(150, 1000, 400, 20) },
      ],
    },
  ],
};

function open(d: DocDoc = doc) {
  const dom = new JSDOM(wordPageHtml(d, WIDTH), { runScripts: 'dangerously' });
  const window = dom.window as unknown as Window & { __wordPages: () => EditedPage[] };
  const q = (sel: string) => window.document.querySelector(sel) as HTMLElement;
  const merge = () =>
    mergeEdited(d, window.__wordPages(), (block, p) =>
      blockBase(block, d.pages[p]!, paperWidth(WIDTH)),
    );
  return { window, q, merge };
}

describe('Word page layout like the original (D-464, D-465)', () => {
  it('indents left-aligned blocks by their position, centred ones not', () => {
    const { q } = open();
    expect(q('[data-ref="0-0"]').style.marginLeft).toBe('0px');
    expect(q('[data-ref="0-1"]').style.marginLeft).toBe('0px');
    // Pantin 在原图里比 Docteur 靠右 400 像素（页宽 1000）。
    expect(parseFloat(q('[data-ref="0-2"]').style.marginLeft)).toBeGreaterThan(130);
    // 纸的两边留出原件的左边空白。
    expect(parseFloat(q('.paper').style.paddingLeft)).toBeGreaterThan(40);
  });

  it('keeps the blank space between blocks', () => {
    const { q } = open();
    const small = parseFloat(q('[data-ref="0-2"]').style.marginTop);
    const big = parseFloat(q('[data-ref="0-3"]').style.marginTop);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(3 * small);
  });

  it('sizes text by the page width, keeps the title size and draws bold and underline', () => {
    const { q } = open();
    const title = parseFloat(q('[data-ref="0-3"]').style.fontSize);
    const body = parseFloat(q('[data-ref="0-1"]').style.fontSize);
    expect(title / body).toBeGreaterThan(1.5);
    expect(title).toBeLessThan(18);
    expect(body).toBeLessThan(12);
    expect(q('[data-ref="0-3"] b u').textContent).toBe('ORDONNANCE');
  });

  it('the whole page is one editable sheet; images cannot be typed into', () => {
    const withImage: DocDoc = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          blocks: [...doc.pages[0]!.blocks, { kind: 'image', box: box(150, 1100, 200, 100) }],
        },
      ],
    };
    const { q, window } = open(withImage);
    expect(window.document.querySelectorAll('[contenteditable="true"]')).toHaveLength(1);
    expect(q('[data-kind="image"]').getAttribute('contenteditable')).toBe('false');
  });
});

describe('reading the page back (D-465)', () => {
  it('an untouched page gives back the same document', () => {
    expect(open().merge()).toBe(doc);
  });

  it('a page built from a document with runs gives back the same document', () => {
    const styled: DocDoc = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          blocks: [
            {
              kind: 'paragraph',
              text: 'Oeil gauche',
              size: 13,
              runs: [{ text: 'Oeil ' }, { text: 'gauche', size: 15, italic: true }],
              box: box(150, 300, 300, 20),
            },
            {
              kind: 'list',
              ordered: false,
              items: ['un', 'deux'],
              itemRuns: [null, [{ text: 'deux', bold: true }]],
              box: box(150, 400, 300, 40),
            },
          ],
        },
      ],
    };
    expect(open(styled).merge()).toBe(styled);
  });

  it('bold, italic, underline and size on a few characters become runs', () => {
    const { q, merge } = open();
    // 浏览器加粗选中的「teur」、把「Doc」改成斜体加大一号。
    q('[data-ref="0-1"]').innerHTML =
      '<i><span style="font-size:9px">Doc</span></i><b><u>teur</u></b>';
    const p = merge().pages[0]!.blocks[1] as DocParagraph;
    expect(p.text).toBe('Docteur');
    expect(p.runs).toHaveLength(2);
    expect(p.runs![0]).toMatchObject({ text: 'Doc', italic: true });
    expect(p.runs![0]!.size).toBeGreaterThan(10);
    expect(p.runs![1]).toEqual({ text: 'teur', bold: true, underline: true });
  });

  it('un-bolding part of the bold title keeps the rest bold', () => {
    const { q, merge } = open();
    q('[data-ref="0-3"]').innerHTML = '<b><u>ORDON</u></b><u>NANCE</u>';
    const p = merge().pages[0]!.blocks[3] as DocParagraph;
    expect(p.runs).toEqual([{ text: 'ORDON' }, { text: 'NANCE', bold: false }]);
    expect(p.heading).toBe(1);
  });

  it('typing, Enter, alignment, a new list item, a table cell and deleting a block', () => {
    const { q, window, merge } = open();
    const d = window.document;
    // 回车：浏览器把段落分成两个（属性跟着复制）。
    const first = q('[data-ref="0-1"]');
    const second = first.cloneNode(false) as HTMLElement;
    first.textContent = 'Doc';
    second.textContent = 'teur Martin';
    first.after(second);
    // 居中「Pantin」。
    q('[data-ref="0-2"]').style.textAlign = 'center';
    // 列表加一项。
    const li = d.createElement('li');
    li.textContent = 'trois';
    q('[data-ref="0-4"]').appendChild(li);
    // 改格子。
    q('[data-ref="0-5"] td[data-i="1"]').textContent = '-3.00';
    // 删掉中心名。
    q('[data-ref="0-0"]').remove();
    const blocks = merge().pages[0]!.blocks;
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.kind))).toEqual([
      'Doc',
      'teur Martin',
      'Pantin le 11/05',
      'ORDONNANCE',
      'list',
      'table',
      'Nom\tDupont',
    ]);
    expect((blocks[2] as DocParagraph).align).toBe('center');
    expect((blocks[4] as DocList).items).toEqual(['un', 'deux', 'trois']);
    const table = blocks[5]!;
    expect(table.kind === 'table' && table.table.cells[1]!.text).toBe('-3.00');
  });

  it('A+ on a few selected characters makes only those one point bigger per press (2026-11-06 simulator: WebKit’s fontSize command dropped the paragraph size)', () => {
    const { q, window, merge } = open();
    const w = window as unknown as Window & { __wordCommand: (name: string) => void };
    const p = q('[data-ref="0-1"]');
    const text = p.firstChild!;
    const range = window.document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    w.__wordCommand('bigger');
    w.__wordCommand('bigger');
    const merged = merge().pages[0]!.blocks[1] as DocParagraph;
    expect(merged.text).toBe('Docteur');
    const base = blockBase(
      doc.pages[0]!.blocks[1] as DocParagraph,
      doc.pages[0]!,
      paperWidth(WIDTH),
    );
    expect(merged.runs).toHaveLength(2);
    expect(merged.runs![0]).toEqual({ text: 'Doc' });
    expect(merged.runs![1]!.text).toBe('teur');
    expect(merged.runs![1]!.size).toBe(base.docSize + 2);
    // 段落自己的字号还在。
    expect(p.style.fontSize).not.toBe('');
  });

  it('A+ with no selection makes the whole paragraph bigger', () => {
    const { q, window, merge } = open();
    const w = window as unknown as Window & { __wordCommand: (name: string) => void };
    const range = window.document.createRange();
    range.setStart(q('[data-ref="0-1"]').firstChild!, 2);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    w.__wordCommand('bigger');
    const merged = merge().pages[0]!.blocks[1] as DocParagraph;
    const base = blockBase(
      doc.pages[0]!.blocks[1] as DocParagraph,
      doc.pages[0]!,
      paperWidth(WIDTH),
    );
    expect(merged.runs).toEqual([{ text: 'Docteur', size: base.docSize + 1 }]);
  });

  it('the line break the browser puts at the end of a paragraph is not text', () => {
    const { q, merge } = open();
    q('[data-ref="0-1"]').innerHTML = 'Doc<br>teur<br>';
    expect((merge().pages[0]!.blocks[1] as DocParagraph).text).toBe('Doc\nteur');
  });
});
