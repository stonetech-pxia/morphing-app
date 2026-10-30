import { describe, expect, it } from 'vitest';

import type { DocDoc } from './doc';
import {
  blockAt,
  blockText,
  deleteBlock,
  parseDocDoc,
  setBlockText,
  setTableFrom,
  tableDocOf,
} from './doc-edit';
import { pushHistory, redo, setCellText, startHistory, undo } from './edit';

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
    expect(parseDocDoc(JSON.stringify(doc))).toEqual(doc);
    expect(parseDocDoc('{"version":2,"pages":[]}')).toBeNull();
    expect(parseDocDoc('{"version":1,"pages":[{}]}')).toBeNull();
    expect(parseDocDoc('not json')).toBeNull();
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
