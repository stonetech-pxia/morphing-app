import { describe, expect, it } from 'vitest';

import {
  cellOwners,
  deleteColumn,
  deleteRow,
  HISTORY_LIMIT,
  insertColumn,
  insertRow,
  parseTableDoc,
  pushHistory,
  redo,
  setCellText,
  setScope,
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
  cols: 3,
  colWidths: [100, 200, 300],
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
  version: 1,
  scope: 'all',
  pages: [
    {
      name: 'P',
      source: 's',
      width: 1000,
      height: 1000,
      lineHeight: 20,
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

  it('inserts and deletes columns, with column widths following', () => {
    const wider = tableOf(insertColumn(DOC, AT, 1));
    expectTiled(wider);
    expect(picture(wider)[0]).toEqual(['head', 'head', 'head', 'c']);
    expect(picture(wider)[1]).toEqual(['tall', '', 'e', 'f']);
    expect(wider.colWidths).toEqual([100, 100, 200, 300]);
    const narrower = tableOf(deleteColumn(DOC, AT, 0));
    expectTiled(narrower);
    expect(picture(narrower)).toEqual([
      ['head', 'c'],
      ['e', 'f'],
      ['h', 'i'],
    ]);
    expect(narrower.colWidths).toEqual([200, 300]);
  });

  it('keeps at least one row and one column', () => {
    let doc = DOC;
    doc = deleteRow(doc, AT, 0);
    doc = deleteRow(doc, AT, 0);
    expect(tableOf(doc).rows).toBe(1);
    expect(deleteRow(doc, AT, 0)).toBe(doc);
    doc = deleteColumn(doc, AT, 0);
    doc = deleteColumn(doc, AT, 0);
    expect(deleteColumn(doc, AT, 0)).toBe(doc);
    expectTiled(tableOf(doc));
  });

  it('ignores edits aimed at a text block', () => {
    expect(insertRow(DOC, { page: 0, block: 0 }, 0)).toBe(DOC);
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
    expect(parseTableDoc('{"version":2,"scope":"all","pages":[]}')).toBeNull();
  });
});
