import { describe, expect, it } from 'vitest';

import type { DocDoc, DocList, DocParagraph } from './doc';
import { mergeEdited, splitRuns, type EditedPage, type EditedRun } from './doc-runs';
import { setBlockText } from './doc-edit';

const box = { x: 100, y: 100, width: 400, height: 40 };
const plain = (text: string, over: Partial<EditedRun> = {}): EditedRun => ({
  text,
  size: 11,
  bold: false,
  italic: false,
  underline: false,
  ...over,
});
const base = (b: DocParagraph | DocList) => ({
  size: b.size ?? 11,
  docSize: b.size ?? 11,
  bold: !!b.bold,
  italic: !!b.italic,
  underline: !!b.underline,
});

const doc: DocDoc = {
  version: 1,
  pages: [
    {
      source: 'file:///p.jpg',
      width: 1000,
      height: 1400,
      bodySize: 11,
      blocks: [
        { kind: 'paragraph', text: 'Title', heading: 1, size: 16, bold: true, box },
        { kind: 'paragraph', text: 'Body text', box: { ...box, y: 200 } },
        { kind: 'list', ordered: true, items: ['a', 'b'], box: { ...box, y: 300 } },
        {
          kind: 'row',
          box: { ...box, y: 400 },
          cells: [
            { width: 500, blocks: [{ kind: 'paragraph', text: 'Left', box }] },
            { width: 500, blocks: [{ kind: 'paragraph', text: 'Right', box }] },
          ],
        },
      ],
    },
  ],
};

const unchanged: EditedPage[] = [
  {
    blocks: [
      { kind: 'paragraph' as const, ref: '0-0', runs: [plain('Title', { size: 16, bold: true })] },
      { kind: 'paragraph' as const, ref: '0-1', runs: [plain('Body text')] },
      { kind: 'list' as const, ref: '0-2', items: [[plain('a')], [plain('b')]] },
      {
        kind: 'row' as const,
        ref: '0-3',
        cells: [
          [{ kind: 'paragraph' as const, ref: '0-3-0-0', runs: [plain('Left')] }],
          [{ kind: 'paragraph' as const, ref: '0-3-1-0', runs: [plain('Right')] }],
        ],
      },
    ],
  },
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('mergeEdited (D-465)', () => {
  it('returns the same doc when nothing changed', () => {
    expect(mergeEdited(doc, unchanged, base)).toBe(doc);
  });

  it('keeps only the run styles that differ from the paragraph', () => {
    const edited = clone(unchanged);
    edited[0]!.blocks[1] = {
      kind: 'paragraph',
      ref: '0-1',
      runs: [plain('Body '), plain('text', { bold: true, size: 14 })],
      align: 'center',
    };
    const next = mergeEdited(doc, edited, base);
    const p = next.pages[0]!.blocks[1] as DocParagraph;
    expect(p.text).toBe('Body text');
    expect(p.runs).toEqual([{ text: 'Body ' }, { text: 'text', bold: true, size: 14 }]);
    expect(p.align).toBe('center');
    // 原来的位置留着。
    expect(p.box).toEqual(doc.pages[0]!.blocks[1]!.box);
  });

  it('un-bolding part of a bold heading writes bold: false on that run', () => {
    const edited = clone(unchanged);
    edited[0]!.blocks[0] = {
      kind: 'paragraph',
      ref: '0-0',
      runs: [plain('Ti', { size: 16, bold: true }), plain('tle', { size: 16 })],
    };
    const p = mergeEdited(doc, edited, base).pages[0]!.blocks[0] as DocParagraph;
    expect(p.runs).toEqual([{ text: 'Ti' }, { text: 'tle', bold: false }]);
    expect(p.heading).toBe(1);
  });

  it('a paragraph split by Enter becomes two paragraphs like the original', () => {
    const edited = clone(unchanged);
    edited[0]!.blocks.splice(
      1,
      1,
      { kind: 'paragraph', ref: '0-1', runs: [plain('Body')] },
      { kind: 'paragraph', ref: '0-1', runs: [plain('text')] },
    );
    const blocks = mergeEdited(doc, edited, base).pages[0]!.blocks;
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.kind))).toEqual([
      'Title',
      'Body',
      'text',
      'list',
      'row',
    ]);
  });

  it('removes deleted and emptied blocks, and a row whose cells are all empty', () => {
    const edited = clone(unchanged);
    edited[0]!.blocks = [
      { kind: 'paragraph', ref: '0-0', runs: [plain('  ')] },
      { kind: 'list', ref: '0-2', items: [[plain('a')], [plain('')]] },
      { kind: 'row', ref: '0-3', cells: [[], []] },
    ];
    const blocks = mergeEdited(doc, edited, base).pages[0]!.blocks;
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as DocList).items).toEqual(['a']);
  });

  it('list items keep their own runs', () => {
    const edited = clone(unchanged);
    edited[0]!.blocks[2] = {
      kind: 'list',
      ref: '0-2',
      items: [[plain('a')], [plain('b', { italic: true })]],
    };
    const list = mergeEdited(doc, edited, base).pages[0]!.blocks[2] as DocList;
    expect(list.itemRuns).toEqual([null, [{ text: 'b', italic: true }]]);
  });
});

describe('size changes are kept relative to the size in the document', () => {
  it('a page that draws 12.46 pt for a 13 pt paragraph: +2 on the page is 15 pt', () => {
    const p13: DocDoc = {
      ...doc,
      pages: [{ ...doc.pages[0]!, blocks: [{ kind: 'paragraph', text: 'ab', size: 13, box }] }],
    };
    const drawn = { size: 12.46, docSize: 13, bold: false, italic: false, underline: false };
    const next = mergeEdited(
      p13,
      [
        {
          blocks: [
            {
              kind: 'paragraph',
              ref: '0-0',
              runs: [plain('a', { size: 12.46 }), plain('b', { size: 14.46 })],
            },
          ],
        },
      ],
      () => drawn,
    );
    expect((next.pages[0]!.blocks[0] as DocParagraph).runs).toEqual([
      { text: 'a' },
      { text: 'b', size: 15 },
    ]);
  });
});

describe('splitRuns', () => {
  it('splits at the separator and keeps each piece’s style', () => {
    expect(splitRuns([{ text: 'a\tb', bold: true }, { text: 'c' }], '\t')).toEqual([
      [{ text: 'a', bold: true }],
      [{ text: 'b', bold: true }, { text: 'c' }],
    ]);
  });
});

describe('setBlockText drops runs that no longer match', () => {
  it('replacing the text removes the old runs', () => {
    const styled: DocDoc = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          blocks: [
            {
              kind: 'paragraph',
              text: 'ab',
              runs: [{ text: 'a', bold: true }, { text: 'b' }],
              box,
            },
          ],
        },
      ],
    };
    const p = setBlockText(styled, { page: 0, block: 0 }, 'xyz').pages[0]!
      .blocks[0] as DocParagraph;
    expect(p.runs).toBeUndefined();
  });
});
