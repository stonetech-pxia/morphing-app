import { describe, expect, it } from 'vitest';

import type { DocDoc } from './doc';
import {
  blockAt,
  blockText,
  deleteBlock,
  editDocTable,
  originalArea,
  originalBox,
  swapToOriginal,
  parseDocDoc,
  setBlockText,
  setTableFrom,
  tableDocOf,
} from './doc-edit';
import {
  insertColumn,
  insertRow,
  pushHistory,
  redo,
  setCellText,
  startHistory,
  undo,
} from './edit';

const box = { x: 0, y: 0, width: 100, height: 20 };

const doc: DocDoc = {
  version: 1,
  pages: [
    {
      source: 'file:///p.jpg',
      width: 1000,
      height: 1400,
      bodySize: 11,
      blocks: [
        { kind: 'paragraph', text: 'Title', heading: 1, box },
        { kind: 'list', ordered: true, format: '%1.', start: 1, items: ['a', 'b'], box },
        {
          kind: 'table',
          colWidths: [100, 200],
          box,
          table: {
            kind: 'table',
            rows: 1,
            col: 0,
            cols: 2,
            box,
            cells: [
              { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'x' },
              { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: 'y' },
            ],
          },
        },
        { kind: 'image', box, src: 'crop.jpg' },
      ],
    },
  ],
};

describe('DocDoc edits', () => {
  it('keeps source cell spacing for text edits and clears it after a grid change', () => {
    const d = structuredClone(doc);
    const b = d.pages[0]!.blocks[2]!;
    if (b.kind !== 'table') throw new Error('fixture');
    b.cellLayout = [{ row: 0, col: 0, lines: [{ x: 0, y: 4, width: 40, height: 10 }] }];
    const at = { page: 0, block: 2 };
    const edited = editDocTable(d, at, (t) => setCellText(t, { page: 0, block: 0 }, 0, 'changed'));
    expect(edited.pages[0]!.blocks[2]).toMatchObject({ cellLayout: b.cellLayout });
    const inserted = editDocTable(d, at, (t) => insertRow(t, { page: 0, block: 0 }, 0));
    expect(inserted.pages[0]!.blocks[2]).not.toHaveProperty('cellLayout');
    const invalid = structuredClone(d);
    const table = invalid.pages[0]!.blocks[2]!;
    if (table.kind !== 'table') throw new Error('fixture');
    table.cellLayout![0]!.lines[0]!.width = -1;
    expect(parseDocDoc(JSON.stringify(invalid))).toBeNull();
  });
  it('edits paragraph text and list items one per line, without touching the original', () => {
    const a = setBlockText(doc, { page: 0, block: 0 }, 'New title');
    expect(a.pages[0]!.blocks[0]).toMatchObject({ text: 'New title', heading: 1 });
    expect(doc.pages[0]!.blocks[0]).toMatchObject({ text: 'Title' });
    const b = setBlockText(doc, { page: 0, block: 1 }, 'a\n\n b \nc');
    expect(b.pages[0]!.blocks[1]).toMatchObject({ items: ['a', 'b', 'c'] });
    expect(blockText(b.pages[0]!.blocks[1]!)).toBe('a\nb\nc');
    // 没变时返回同一个对象（撤销记录不多一步）。
    expect(setBlockText(doc, { page: 0, block: 0 }, 'Title')).toBe(doc);
    // 表格、图片没有编辑框里的文字。
    expect(setBlockText(doc, { page: 0, block: 2 }, 'z')).toBe(doc);
  });

  it('removes a block when its text is cleared or it is deleted', () => {
    expect(setBlockText(doc, { page: 0, block: 0 }, '  ').pages[0]!.blocks).toHaveLength(3);
    expect(setBlockText(doc, { page: 0, block: 1 }, '\n').pages[0]!.blocks).toHaveLength(3);
    const d = deleteBlock(doc, { page: 0, block: 3 });
    expect(d.pages[0]!.blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'table']);
    expect(deleteBlock(doc, { page: 0, block: 9 })).toBe(doc);
  });

  it('round-trips a table block through the Excel editor’s TableDoc', () => {
    const at = { page: 0, block: 2 };
    const tdoc = tableDocOf(doc, at, 'Table')!;
    expect(tdoc.pages).toHaveLength(1);
    expect(tdoc.pages[0]!.colWidths).toEqual([100, 200]);
    expect(tdoc.pages[0]!.source).toBe('file:///p.jpg');
    const edited = setCellText(tdoc, { page: 0, block: 0 }, 1, 'changed');
    const next = setTableFrom(doc, at, edited);
    const block = next.pages[0]!.blocks[2]!;
    expect(block.kind === 'table' && block.table.cells.map((c) => c.text)).toEqual([
      'x',
      'changed',
    ]);
    expect(tableDocOf(doc, { page: 0, block: 0 }, 'x')).toBeNull();
  });

  it('undoes and redoes with the shared history', () => {
    let h = startHistory(doc);
    h = pushHistory(h, deleteBlock(h.present, { page: 0, block: 0 }));
    expect(h.present.pages[0]!.blocks).toHaveLength(3);
    h = undo(h);
    expect(h.present).toBe(doc);
    h = redo(h);
    expect(h.present.pages[0]!.blocks).toHaveLength(3);
  });

  it('reads back its own JSON and rejects anything else', () => {
    expect(parseDocDoc(JSON.stringify(doc))).toEqual({
      ...doc,
      version: 5,
      pages: doc.pages.map((p) => ({ ...p, paper: { width: 595.3, height: 841.9 } })),
    });
    expect(parseDocDoc('{"version":6,"pages":[]}')).toBeNull();
    expect(parseDocDoc('{"version":1,"pages":[{}]}')).toBeNull();
    expect(parseDocDoc('not json')).toBeNull();
  });

  it('upgrades version 4 without inventing physical paper for a photo, and preserves full-cell fills', () => {
    const previous = { ...structuredClone(doc), version: 4 as const };
    const next = parseDocDoc(JSON.stringify(previous));
    expect(next).toEqual({ ...previous, version: 5 });
    const table = next!.pages[0]!.blocks.find((b) => b.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('fixture');
    table.cellLayout = [{ row: 0, col: 0, fill: 'CCD7FF', lines: [] }];
    expect(parseDocDoc(JSON.stringify(next))).toEqual(next);
    table.cellLayout[0]!.fill = 'not-a-color';
    expect(parseDocDoc(JSON.stringify(next))).toBeNull();
  });
  it('keeps a version 2 page size and all editable content when opening it again', () => {
    const next = {
      ...doc,
      version: 2,
      pages: doc.pages.map((p) => ({ ...p, paper: { width: 595.28, height: 255.12 } })),
    };
    expect(parseDocDoc(JSON.stringify(next))).toEqual({ ...next, version: 5 });
    expect(
      parseDocDoc(
        JSON.stringify({
          ...next,
          pages: [{ ...next.pages[0], paper: { width: -1, height: 255 } }],
        }),
      ),
    ).toBeNull();
  });

  it('edits, deletes and opens tables inside a side-by-side row (D-331)', () => {
    const table = doc.pages[0]!.blocks[2]!;
    const rowDoc: DocDoc = {
      version: 1,
      pages: [
        {
          ...doc.pages[0]!,
          blocks: [
            {
              kind: 'row',
              box,
              cells: [
                { width: 500, blocks: [{ kind: 'paragraph', text: 'left', box }] },
                { width: 500, blocks: [table as never, { kind: 'paragraph', text: 'r', box }] },
              ],
            },
          ],
        },
      ],
    };
    const left = { page: 0, block: 0, cell: 0, item: 0 };
    expect(blockAt(rowDoc, left)).toMatchObject({ text: 'left' });
    const edited = setBlockText(rowDoc, left, 'gauche');
    expect(blockAt(edited, left)).toMatchObject({ text: 'gauche' });
    expect(blockAt(rowDoc, left)).toMatchObject({ text: 'left' });
    // 里面的表交给转 Excel 的编辑页，改完换回这一格。
    const at = { page: 0, block: 0, cell: 1, item: 0 };
    const tdoc = tableDocOf(rowDoc, at, 'Sheet')!;
    const back = setTableFrom(rowDoc, at, setCellText(tdoc, { page: 0, block: 0 }, 0, 'z'));
    const inner = blockAt(back, at);
    expect(inner?.kind === 'table' && inner.table.cells[0]!.text).toBe('z');
    // 删掉一格里的块；所有格子都空了就删掉整行。
    let d = deleteBlock(rowDoc, at);
    expect(blockAt(d, at)).toMatchObject({ text: 'r' });
    d = deleteBlock(deleteBlock(d, at), left);
    expect(d.pages[0]!.blocks).toEqual([]);
  });
});

describe('文档里的表格就地改（file-room R2，D-366）', () => {
  const at = { page: 0, block: 2 };
  const table = (d: DocDoc) => {
    const b = blockAt(d, at);
    if (b?.kind !== 'table') throw new Error('not a table');
    return b;
  };

  it('改格子、插入行和列，表格块直接变，别的块不动', () => {
    let next = editDocTable(doc, at, (t) => setCellText(t, { page: 0, block: 0 }, 1, 'z'));
    expect(table(next).table.cells.map((c) => c.text)).toEqual(['x', 'z']);
    next = editDocTable(next, at, (t) => insertRow(t, { page: 0, block: 0 }, 1));
    expect(table(next).table.rows).toBe(2);
    next = editDocTable(next, at, (t) => insertColumn(t, 0, 2));
    expect(table(next).table.cols).toBe(3);
    expect(table(next).colWidths).toHaveLength(3);
    expect(next.pages[0]!.blocks[0]).toBe(doc.pages[0]!.blocks[0]);
  });

  it('没变时还是原来那份（撤销历史不多记一步）；不是表格时不变', () => {
    expect(editDocTable(doc, at, (t) => t)).toBe(doc);
    expect(
      editDocTable(doc, { page: 0, block: 0 }, (t) => insertRow(t, { page: 0, block: 0 }, 0)),
    ).toBe(doc);
  });
});

describe('swapping text for the original (D-467, D-468)', () => {
  // 三星真机：签名被认成了三行字，旁边是剪好的印章。
  const line = (y: number) => ({ x: 600, y, width: 200, height: 40 });
  const doc: DocDoc = {
    version: 1,
    pages: [
      {
        source: 'p.jpg',
        width: 1000,
        height: 1400,
        bodySize: 11,
        blocks: [
          {
            kind: 'paragraph',
            text: 'Oeil gauche',
            box: { x: 100, y: 900, width: 500, height: 30 },
          },
          { kind: 'paragraph', text: 'mod cal & dentaira', box: line(1100) },
          { kind: 'paragraph', text: 'entre CDSCO PANTN', box: line(1150) },
          { kind: 'paragraph', text: 'tue', box: line(1200) },
        ],
      },
    ],
  };

  it('the crop is a little bigger than the text box but stays on the page', () => {
    expect(originalBox(line(1100), { width: 1000, height: 1400 })).toEqual({
      x: 590,
      y: 1090,
      width: 220,
      height: 60,
    });
    expect(
      originalBox({ x: 2, y: 1380, width: 990, height: 20 }, { width: 1000, height: 1400 }),
    ).toEqual({ x: 0, y: 1372, width: 1000, height: 28 });
  });

  it('swapping the lines one by one ends with ONE image covering the whole signature', () => {
    let next = doc;
    for (const y of [1100, 1150, 1200]) {
      const area = originalArea(next, 0, [line(y)])!;
      next = swapToOriginal(next, 0, [line(y)], { src: `crop-${y}.jpg`, box: area });
    }
    const blocks = next.pages[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'image']);
    const image = blocks[1]!;
    expect(image.box.y).toBeLessThanOrEqual(1090);
    expect(image.box.y + image.box.height).toBeGreaterThanOrEqual(1250);
    expect(image.kind === 'image' && image.src).toBe('crop-1200.jpg');
  });

  it('several selected lines are swapped together, in the place of the first', () => {
    const boxes = [line(1100), line(1150), line(1200)];
    const area = originalArea(doc, 0, boxes)!;
    const next = swapToOriginal(doc, 0, boxes, { src: 'all.jpg', box: area });
    expect(next.pages[0]!.blocks.map((b) => b.kind)).toEqual(['paragraph', 'image']);
    expect(area).toEqual({ x: 590, y: 1090, width: 220, height: 160 });
  });

  it('does nothing when no block matches', () => {
    expect(swapToOriginal(doc, 0, [line(10)], { src: 'x.jpg', box: line(10) })).toBe(doc);
  });
});
