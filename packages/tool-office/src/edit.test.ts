import { describe, expect, it } from 'vitest';

import {
  canDeleteColumn,
  cellOwners,
  deleteColumn,
  deleteRow,
  HISTORY_LIMIT,
  insertColumn,
  insertRow,
  parseTableDoc,
  pushHistory,
  redo,
  deleteTextBlock,
  setCellText,
  setScope,
  setTextBlock,
  startHistory,
  undo,
} from './edit';
import type { TableBlock, TableDoc } from './types';

// 3 × 3：A1:B1 合并，A2:A3 合并。
//   | head (A1:B1) | c |
//   | tall (A2:A3) | e | f |
//   |              | h | i |
const TABLE: TableBlock = {
  kind: 'table',
  rows: 3,
  col: 0,
  cols: 3,
  box: { x: 0, y: 0, width: 600, height: 120 },
  cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 2, text: 'head' },
    { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: 'c' },
    { row: 1, col: 0, rowSpan: 2, colSpan: 1, text: 'tall' },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: 'e' },
    { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: 'f' },
    { row: 2, col: 1, rowSpan: 1, colSpan: 1, text: 'h' },
    { row: 2, col: 2, rowSpan: 1, colSpan: 1, text: 'i' },
  ],
};

const DOC: TableDoc = {
  version: 2,
  scope: 'all',
  pages: [
    {
      name: 'P',
      source: 's',
      width: 1000,
      height: 1000,
      lineHeight: 20,
      colWidths: [100, 200, 300],
      blocks: [{ kind: 'text', text: 'title', box: { x: 0, y: 0, width: 10, height: 10 } }, TABLE],
    },
  ],
};
const AT = { page: 0, block: 1 };
const tableOf = (doc: TableDoc) => doc.pages[0]!.blocks[1] as TableBlock;
/** 每个位置正好属于一个格子。 */
function expectTiled(t: TableBlock) {
  const owner = cellOwners(t);
  expect([...owner].every((i) => i >= 0)).toBe(true);
  const area = t.cells.reduce((n, c) => n + c.rowSpan * c.colSpan, 0);
  expect(area).toBe(t.rows * t.cols);
}
/** 表格画成文字，方便断言：每一行列出每个位置的文字（合并格子的每个位置都写它的文字）。 */
function picture(t: TableBlock): string[][] {
  const owner = cellOwners(t);
  return Array.from({ length: t.rows }, (_, r) =>
    Array.from({ length: t.cols }, (_, c) => t.cells[owner[r * t.cols + c]!]!.text),
  );
}

describe('TableDoc editing (D-272)', () => {
  it('changes one cell without touching the original document', () => {
    const next = setCellText(DOC, AT, 3, 'E');
    expect(picture(tableOf(next))[1]).toEqual(['tall', 'E', 'f']);
    expect(picture(tableOf(DOC))[1]).toEqual(['tall', 'e', 'f']);
    expect(setCellText(DOC, AT, 3, 'e')).toBe(DOC);
  });

  it('inserts a row through a merged cell: the merged cell grows', () => {
    const t = tableOf(insertRow(DOC, AT, 2));
    expectTiled(t);
    expect(picture(t)).toEqual([
      ['head', 'head', 'c'],
      ['tall', 'e', 'f'],
      ['tall', '', ''],
      ['tall', 'h', 'i'],
    ]);
    expect(t.cells.find((c) => c.text === 'tall')).toMatchObject({ row: 1, rowSpan: 3 });
  });

  it('inserts a row above everything: merged cells move down', () => {
    const t = tableOf(insertRow(DOC, AT, 0));
    expectTiled(t);
    expect(picture(t)[0]).toEqual(['', '', '']);
    expect(t.cells.find((c) => c.text === 'head')).toMatchObject({ row: 1, colSpan: 2 });
  });

  it('deletes a row: cells only in it go, merged cells across it shrink', () => {
    const t = tableOf(deleteRow(DOC, AT, 1));
    expectTiled(t);
    expect(picture(t)).toEqual([
      ['head', 'head', 'c'],
      ['tall', 'h', 'i'],
    ]);
    expect(t.cells.find((c) => c.text === 'tall')).toMatchObject({ row: 1, rowSpan: 1 });
  });

  it('inserts and deletes columns, with the page’s column widths following', () => {
    const widerDoc = insertColumn(DOC, 0, 1);
    const wider = tableOf(widerDoc);
    expectTiled(wider);
    expect(picture(wider)[0]).toEqual(['head', 'head', 'head', 'c']);
    expect(picture(wider)[1]).toEqual(['tall', '', 'e', 'f']);
    expect(widerDoc.pages[0]!.colWidths).toEqual([100, 100, 200, 300]);
    const narrowerDoc = deleteColumn(DOC, 0, 0);
    const narrower = tableOf(narrowerDoc);
    expectTiled(narrower);
    expect(picture(narrower)).toEqual([
      ['head', 'c'],
      ['e', 'f'],
      ['h', 'i'],
    ]);
    expect(narrowerDoc.pages[0]!.colWidths).toEqual([200, 300]);
  });

  it('inserts and deletes a column across every table on the page', () => {
    // 第二张表只占共用的第 2、3 列（C、D）；页上一共 4 列。
    const narrow: TableBlock = {
      kind: 'table',
      rows: 1,
      col: 2,
      cols: 2,
      box: { x: 0, y: 200, width: 600, height: 40 },
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'x' },
        { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: 'y' },
      ],
    };
    const doc: TableDoc = {
      ...DOC,
      pages: [{ ...DOC.pages[0]!, colWidths: [100, 200, 300, 400], blocks: [TABLE, narrow] }],
    };
    const blocksOf = (d: TableDoc) => d.pages[0]!.blocks as TableBlock[];
    // 在 B 前面插入：第一张表多一列，第二张表整张右移。
    const inserted = insertColumn(doc, 0, 1);
    const [a, b] = blocksOf(inserted);
    expect(picture(a!)[1]).toEqual(['tall', '', 'e', 'f']);
    expect([b!.col, b!.cols]).toEqual([3, 2]);
    expect(picture(b!)).toEqual([['x', 'y']]);
    expect(inserted.pages[0]!.colWidths).toEqual([100, 100, 200, 300, 400]);
    // 删掉 C：两张表都经过它，各少一列。
    const deleted = deleteColumn(doc, 0, 2);
    const [c, d] = blocksOf(deleted);
    expect(picture(c!)).toEqual([
      ['head', 'head'],
      ['tall', 'e'],
      ['tall', 'h'],
    ]);
    expect([d!.col, d!.cols]).toEqual([2, 1]);
    expect(picture(d!)).toEqual([['y']]);
    expect(deleted.pages[0]!.colWidths).toEqual([100, 200, 400]);
    // 第二张表只剩一列时，不能删它所在的列（表格不能整张删）。
    expect(canDeleteColumn(deleted.pages[0]!, 2)).toBe(false);
    expect(deleteColumn(deleted, 0, 2)).toBe(deleted);
    expect(canDeleteColumn(deleted.pages[0]!, 0)).toBe(true);
  });

  it('keeps at least one row and one column', () => {
    let doc = DOC;
    doc = deleteRow(doc, AT, 0);
    doc = deleteRow(doc, AT, 0);
    expect(tableOf(doc).rows).toBe(1);
    expect(deleteRow(doc, AT, 0)).toBe(doc);
    doc = deleteColumn(doc, 0, 0);
    doc = deleteColumn(doc, 0, 0);
    expect(deleteColumn(doc, 0, 0)).toBe(doc);
    expectTiled(tableOf(doc));
  });

  it('ignores edits aimed at a text block', () => {
    expect(insertRow(DOC, { page: 0, block: 0 }, 0)).toBe(DOC);
  });

  it('edits and deletes text outside tables, but never a whole table', () => {
    const renamed = setTextBlock(DOC, 0, 0, 'Title');
    expect(renamed.pages[0]!.blocks[0]).toMatchObject({ kind: 'text', text: 'Title' });
    expect(setTextBlock(DOC, 0, 1, 'x')).toBe(DOC);
    const without = deleteTextBlock(DOC, 0, 0);
    expect(without.pages[0]!.blocks.map((b) => b.kind)).toEqual(['table']);
    expect(deleteTextBlock(DOC, 0, 1)).toBe(DOC);
  });

  it('switches the scope without losing edits', () => {
    const edited = setCellText(DOC, AT, 0, 'HEAD');
    const tablesOnly = setScope(edited, 'tables');
    expect(tablesOnly.scope).toBe('tables');
    expect(tableOf(setScope(tablesOnly, 'all')).cells[0]!.text).toBe('HEAD');
  });
});

describe('undo and redo', () => {
  it('undoes and redoes edits in order', () => {
    let h = startHistory(DOC);
    h = pushHistory(h, setCellText(h.present, AT, 1, 'C'));
    h = pushHistory(h, insertRow(h.present, AT, 3));
    expect(tableOf(h.present).rows).toBe(4);
    h = undo(h);
    expect(tableOf(h.present).rows).toBe(3);
    expect(tableOf(h.present).cells[1]!.text).toBe('C');
    h = undo(h);
    expect(h.present).toBe(DOC);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(tableOf(h.present).cells[1]!.text).toBe('C');
    // 新的修改清掉重做。
    h = pushHistory(h, setCellText(h.present, AT, 1, 'X'));
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('remembers at most 100 steps', () => {
    let h = startHistory(DOC);
    for (let i = 0; i < 150; i++) h = pushHistory(h, setCellText(h.present, AT, 1, `v${i}`));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 200; i++) h = undo(h);
    expect(tableOf(h.present).cells[1]!.text).toBe('v49');
  });

  it('does not record a change that changed nothing', () => {
    const h = startHistory(DOC);
    expect(pushHistory(h, setCellText(DOC, AT, 1, 'c'))).toBe(h);
  });

  it('reads back a saved document and rejects broken files', () => {
    expect(parseTableDoc(JSON.stringify(DOC))).toEqual(DOC);
    expect(parseTableDoc('{')).toBeNull();
    // 旧版本（每张表各自的列）不再读。
    expect(parseTableDoc('{"version":1,"scope":"all","pages":[]}')).toBeNull();
  });
});
