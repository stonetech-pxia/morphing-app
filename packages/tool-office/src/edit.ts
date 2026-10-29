import type { TableBlock, TableCell, TableDoc, TablePage, TableScope } from './types';

// 编辑页对 TableDoc 的修改（D-272）：改格子、插入和删除行列（合并区域跟着动）、切换识别范围。
// 一页的列是各张表共用的，所以插入和删除列是对整页的：这一列经过的每张表都跟着变。
// 每个操作都返回新的 TableDoc（不改原来的），撤销和重做只是在几份之间切换，最多记 100 步。

/** 一张表在 TableDoc 里的位置。 */
export interface TableRef {
  page: number;
  block: number;
}

/** 每个位置属于哪个格子（r * cols + c → cells 的下标）。 */
export function cellOwners(table: TableBlock): Int32Array {
  const owner = new Int32Array(table.rows * table.cols).fill(-1);
  table.cells.forEach((cell, i) => {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) owner[r * table.cols + c] = i;
    }
  });
  return owner;
}

const sortCells = (cells: TableCell[]) => cells.sort((a, b) => a.row - b.row || a.col - b.col);

function updateTable(doc: TableDoc, at: TableRef, fn: (t: TableBlock) => TableBlock): TableDoc {
  const block = doc.pages[at.page]?.blocks[at.block];
  if (!block || block.kind !== 'table') return doc;
  const next = fn(block);
  if (next === block) return doc;
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === at.page ? { ...p, blocks: p.blocks.map((b, j) => (j === at.block ? next : b)) } : p,
    ),
  };
}

/** 改一格的文字。 */
export function setCellText(doc: TableDoc, at: TableRef, cell: number, text: string): TableDoc {
  return updateTable(doc, at, (t) =>
    t.cells[cell] && t.cells[cell]!.text !== text
      ? { ...t, cells: t.cells.map((c, i) => (i === cell ? { ...c, text } : c)) }
      : t,
  );
}

/**
 * 在第 at 行（0 到 rows）的位置插入一行。横跨插入位置的合并格子跟着变高；
 * 其余位置是新的空格子。
 */
export function insertRow(doc: TableDoc, at: TableRef, row: number): TableDoc {
  return updateTable(doc, at, (t) => {
    if (row < 0 || row > t.rows) return t;
    const covered = new Set<number>();
    const cells = t.cells.map((c) => {
      if (c.row >= row) return { ...c, row: c.row + 1 };
      if (c.row + c.rowSpan > row) {
        for (let k = c.col; k < c.col + c.colSpan; k++) covered.add(k);
        return { ...c, rowSpan: c.rowSpan + 1 };
      }
      return c;
    });
    for (let col = 0; col < t.cols; col++) {
      if (!covered.has(col)) cells.push({ row, col, rowSpan: 1, colSpan: 1, text: '' });
    }
    return { ...t, rows: t.rows + 1, cells: sortCells(cells) };
  });
}

/** 删除一行（至少留一行）。只占这一行的格子删掉，跨过它的合并格子变矮。 */
export function deleteRow(doc: TableDoc, at: TableRef, row: number): TableDoc {
  return updateTable(doc, at, (t) => {
    if (t.rows <= 1 || row < 0 || row >= t.rows) return t;
    const cells: TableCell[] = [];
    for (const c of t.cells) {
      if (c.row > row) cells.push({ ...c, row: c.row - 1 });
      else if (c.row + c.rowSpan > row) {
        if (c.rowSpan > 1) cells.push({ ...c, rowSpan: c.rowSpan - 1 });
      } else cells.push(c);
    }
    return { ...t, rows: t.rows - 1, cells: sortCells(cells) };
  });
}

/** 表内第 col 列（0 到 cols）的位置插入一列：横跨它的合并格子变宽，其余行是新的空格子。 */
function insertTableColumn(t: TableBlock, col: number): TableBlock {
  const covered = new Set<number>();
  const cells = t.cells.map((c) => {
    if (c.col >= col) return { ...c, col: c.col + 1 };
    if (c.col + c.colSpan > col) {
      for (let k = c.row; k < c.row + c.rowSpan; k++) covered.add(k);
      return { ...c, colSpan: c.colSpan + 1 };
    }
    return c;
  });
  for (let row = 0; row < t.rows; row++) {
    if (!covered.has(row)) cells.push({ row, col, rowSpan: 1, colSpan: 1, text: '' });
  }
  return { ...t, cols: t.cols + 1, cells: sortCells(cells) };
}

/** 删除表内的第 col 列：只占这一列的格子删掉，跨过它的合并格子变窄。 */
function deleteTableColumn(t: TableBlock, col: number): TableBlock {
  const cells: TableCell[] = [];
  for (const c of t.cells) {
    if (c.col > col) cells.push({ ...c, col: c.col - 1 });
    else if (c.col + c.colSpan > col) {
      if (c.colSpan > 1) cells.push({ ...c, colSpan: c.colSpan - 1 });
    } else cells.push(c);
  }
  return { ...t, cols: t.cols - 1, cells: sortCells(cells) };
}

function updatePage(doc: TableDoc, page: number, next: TablePage): TableDoc {
  return { ...doc, pages: doc.pages.map((p, i) => (i === page ? next : p)) };
}

/**
 * 在这一页的第 col 列（0 到列数）的位置插入一列，宽度和左边一列一样。
 * 这个位置在一张表里面或者边上时，这张表多一列；在表的左边时，整张表右移一列。
 */
export function insertColumn(doc: TableDoc, page: number, col: number): TableDoc {
  const p = doc.pages[page];
  if (!p || col < 0 || col > p.colWidths.length) return doc;
  const blocks = p.blocks.map((b) => {
    if (b.kind !== 'table') return b;
    if (col < b.col) return { ...b, col: b.col + 1 };
    if (col <= b.col + b.cols) return insertTableColumn(b, col - b.col);
    return b;
  });
  const width = p.colWidths[Math.max(0, col - 1)] ?? 100;
  const colWidths = [...p.colWidths.slice(0, col), width, ...p.colWidths.slice(col)];
  return updatePage(doc, page, { ...p, colWidths, blocks });
}

/** 能不能删这一页的第 col 列：至少留一列，经过它的表也都至少留一列（表格不能整张删）。 */
export function canDeleteColumn(page: TablePage, col: number): boolean {
  if (page.colWidths.length <= 1 || col < 0 || col >= page.colWidths.length) return false;
  return page.blocks.every(
    (b) => b.kind !== 'table' || b.cols > 1 || col < b.col || col >= b.col + b.cols,
  );
}

/** 删除这一页的第 col 列。 */
export function deleteColumn(doc: TableDoc, page: number, col: number): TableDoc {
  const p = doc.pages[page];
  if (!p || !canDeleteColumn(p, col)) return doc;
  const blocks = p.blocks.map((b) => {
    if (b.kind !== 'table') return b;
    if (col < b.col) return { ...b, col: b.col - 1 };
    if (col < b.col + b.cols) return deleteTableColumn(b, col - b.col);
    return b;
  });
  const colWidths = p.colWidths.filter((_, i) => i !== col);
  return updatePage(doc, page, { ...p, colWidths, blocks });
}

/** 改一段表外的文字。 */
export function setTextBlock(doc: TableDoc, page: number, block: number, text: string): TableDoc {
  const b = doc.pages[page]?.blocks[block];
  if (!b || b.kind !== 'text' || b.text === text) return doc;
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === page ? { ...p, blocks: p.blocks.map((x, j) => (j === block ? { ...b, text } : x)) } : p,
    ),
  };
}

/** 删掉一段表外的文字（认进来的页眉、页码这类）。表格不能整张删。 */
export function deleteTextBlock(doc: TableDoc, page: number, block: number): TableDoc {
  if (doc.pages[page]?.blocks[block]?.kind !== 'text') return doc;
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === page ? { ...p, blocks: p.blocks.filter((_, j) => j !== block) } : p,
    ),
  };
}

/** 切换识别范围（只影响写 xlsx 时写不写表外的文字）。 */
export function setScope(doc: TableDoc, scope: TableScope): TableDoc {
  return doc.scope === scope ? doc : { ...doc, scope };
}

/** 撤销和重做：只在内存里。 */
export interface TableHistory {
  past: readonly TableDoc[];
  present: TableDoc;
  future: readonly TableDoc[];
}

export const HISTORY_LIMIT = 100;

export const startHistory = (doc: TableDoc): TableHistory => ({
  past: [],
  present: doc,
  future: [],
});

/** 记下一次修改（没变时不记）。 */
export function pushHistory(h: TableHistory, next: TableDoc): TableHistory {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: TableHistory): TableHistory {
  const prev = h.past.at(-1);
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
}

export function redo(h: TableHistory): TableHistory {
  const next = h.future[0];
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
}

/** 一页的格子总数（编辑页超过 2000 格只读）。 */
export const pageCellCount = (doc: TableDoc, page: number) =>
  (doc.pages[page]?.blocks ?? []).reduce(
    (n, b) => n + (b.kind === 'table' ? b.rows * b.cols : 0),
    0,
  );

export const EDITABLE_CELLS = 2000;

/** TableDoc 的 JSON 读回来时检查一下大概的形状（文件是自己写的，只防坏文件）。 */
export function parseTableDoc(json: string): TableDoc | null {
  try {
    const doc = JSON.parse(json) as TableDoc;
    if (doc?.version !== 2 || !Array.isArray(doc.pages)) return null;
    if (doc.scope !== 'all' && doc.scope !== 'tables') return null;
    return doc;
  } catch {
    return null;
  }
}
