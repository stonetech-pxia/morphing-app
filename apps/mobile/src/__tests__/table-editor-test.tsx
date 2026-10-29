import { createDefaultWorkspace, decodeUtf8, type RunItem } from '@morph/core';
import { parseTableDoc, type TableBlock, type TableDoc } from '@morph/tool-office';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { strFromU8, unzipSync } from 'fflate';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { ResultView } from '../run/ResultView';
import { TableEditor } from '../run/TableEditor';
import { canEditTable, saveTableEdits } from '../run/table-edit';
import { freshName } from '../runtime/actions/helpers';
import { FakeFiles } from '../test-utils/fake-files';

// 转 Excel 的查看和编辑（D-272）：点选中再点编辑、选中时显示原图截图、长按行号列字母插入删除、
// 识别范围、撤销重做；完成时改过才写新文件（换掉结果里的地址），旧的删掉。

const box = (x: number, y: number, width = 100, height = 20) => ({ x, y, width, height });

function makeDoc(cells = 2): TableDoc {
  const table: TableBlock = {
    kind: 'table',
    rows: cells,
    col: 0,
    cols: cells,
    box: box(0, 30, 400, 40),
    cells: Array.from({ length: cells * cells }, (_, i) => ({
      row: Math.floor(i / cells),
      col: i % cells,
      rowSpan: 1,
      colSpan: 1,
      text: cells === 2 ? 'abcd'[i]! : String(i),
      box: box((i % cells) * 200, 30 + Math.floor(i / cells) * 20, 200, 20),
    })),
  };
  return {
    version: 2,
    scope: 'all',
    pages: [
      {
        name: '第 1 页',
        source: 'runs/r1/0/page.jpg',
        width: 1000,
        height: 1400,
        lineHeight: 20,
        colWidths: Array(cells).fill(200),
        blocks: [{ kind: 'text', text: '标题', box: box(0, 0) }, table],
      },
      {
        name: '第 2 页',
        source: 'runs/r1/0/page2.jpg',
        width: 1000,
        height: 1400,
        lineHeight: 20,
        colWidths: [250, 250, 250, 250],
        blocks: [{ kind: 'text', text: '只有文字', box: box(0, 0) }],
      },
    ],
  };
}

async function setup(doc = makeDoc()) {
  const files = new FakeFiles();
  const xlsx = await files.writeRunFile('r1', 'old-a/明细.xlsx', new Uint8Array([1, 2, 3]));
  const json = await files.writeRunFile(
    'r1',
    'old-b/明细.json',
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  const item: RunItem = {
    uri: xlsx.uri,
    name: '明细',
    ext: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 3,
    assetId: 'saved-before',
    tableDoc: { uri: json.uri, for: xlsx.uri },
  };
  const onClose = jest.fn();
  const onSaved = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      <TableEditor
        item={item}
        files={files}
        runId="r1"
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onClose={onClose}
        onSaved={onSaved}
      />
    </SafeAreaProvider>,
  );
  await screen.findByTestId('table-cell-1-0');
  return { files, item, onClose, onSaved };
}

describe('saving table edits', () => {
  it('never deletes the new file when it lands on the old path', async () => {
    const files = new FakeFiles();
    const doc = makeDoc();
    // 下一个新文件名正好是旧文件的路径（例如计数器重新开始时）：新的写在原处，不能再删。
    const n = Number(freshName('x', 'y').split('/')[0]);
    const xlsx = await files.writeRunFile('r2', `${n + 1}/x.xlsx`, new Uint8Array([1]));
    const json = await files.writeRunFile('r2', `${n + 2}/x.json`, new Uint8Array([2]));
    const item: RunItem = {
      uri: xlsx.uri,
      name: 'x',
      ext: 'xlsx',
      mimeType: 'application/octet-stream',
      size: 1,
      tableDoc: { uri: json.uri, for: xlsx.uri },
    };
    const next = await saveTableEdits(files, 'r2', item, doc);
    expect(next.uri).toBe(xlsx.uri);
    await expect(files.readUri(next.uri)).resolves.toBeInstanceOf(Uint8Array);
    await expect(files.readUri(next.tableDoc!.uri)).resolves.toBeInstanceOf(Uint8Array);
  });
});

async function savedDoc(files: FakeFiles, next: RunItem) {
  return parseTableDoc(decodeUtf8(await files.readUri(next.tableDoc!.uri)))!;
}

describe('table editor (D-272)', () => {
  it('selects on the first tap, edits on the second, and writes a new xlsx when done', async () => {
    const { files, item, onSaved, onClose } = await setup();
    expect(screen.getByText('点一下选中，再点一下编辑')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-cell-1-1'));
    // 选中：底部显示原图里这一格。
    expect(screen.getByTestId('table-crop')).toBeTruthy();
    expect(screen.queryByTestId('table-edit-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('table-cell-1-1'));
    await fireEvent.changeText(screen.getByTestId('table-edit-input'), 'B & 1');
    await fireEvent.press(screen.getByTestId('table-edit-ok'));
    expect(screen.getByText('B & 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-done'));
    expect(onClose).not.toHaveBeenCalled();
    const next = onSaved.mock.calls[0]![0] as RunItem;
    expect(next.uri).not.toBe(item.uri);
    expect(next.name).toBe('明细');
    expect(canEditTable(next)).toBe(true);
    // 新的一份还没存成用户文件。
    expect(next.assetId).toBeUndefined();
    // 旧的 xlsx 和 TableDoc 删掉了。
    await expect(files.readUri(item.uri)).rejects.toThrow();
    await expect(files.readUri(item.tableDoc!.uri)).rejects.toThrow();
    const zip = unzipSync(await files.readUri(next.uri));
    expect(strFromU8(zip['xl/sharedStrings.xml']!)).toContain('<t>B &amp; 1</t>');
    const doc = await savedDoc(files, next);
    expect((doc.pages[0]!.blocks[1] as TableBlock).cells[1]!.text).toBe('B & 1');
  });

  it('closes without writing anything when nothing changed, also after undoing', async () => {
    const { onSaved, onClose } = await setup();
    await fireEvent.press(screen.getByTestId('table-cell-0-0'));
    await fireEvent.press(screen.getByTestId('table-cell-0-0'));
    await fireEvent.changeText(screen.getByTestId('table-edit-input'), '新标题');
    await fireEvent.press(screen.getByTestId('table-edit-ok'));
    expect(screen.getByText('新标题')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-undo'));
    expect(screen.getByText('标题')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-redo'));
    expect(screen.getByText('新标题')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-undo'));
    await fireEvent.press(screen.getByTestId('table-done'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('inserts and deletes rows and columns from a long press on the row number or column letter', async () => {
    const { files, onSaved } = await setup();
    // 第 2 行是表格的第 1 行：在下方插入一行。
    await fireEvent(screen.getByTestId('table-row-1'), 'longPress');
    expect(screen.getByText('在上方插入一行')).toBeTruthy();
    await fireEvent.press(screen.getByText('在下方插入一行'));
    expect(screen.getByTestId('table-cell-3-0')).toBeTruthy();
    // 列是整页共用的：长按列字母不用先选中。删除 A 列。
    await fireEvent(screen.getByTestId('table-col-0'), 'longPress');
    await fireEvent.press(screen.getByText('删除这一列'));
    // 第 1 行是表外的文字：只能删掉它。
    await fireEvent(screen.getByTestId('table-row-0'), 'longPress');
    expect(screen.queryByText('在上方插入一行')).toBeNull();
    await fireEvent.press(screen.getByText('删除这段文字'));
    await fireEvent.press(screen.getByTestId('table-done'));
    const doc = await savedDoc(files, onSaved.mock.calls[0]![0] as RunItem);
    const blocks = doc.pages[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['table']);
    const table = blocks[0] as TableBlock;
    expect([table.rows, table.cols]).toEqual([3, 1]);
    expect(table.cells.map((c) => c.text)).toEqual(['b', '', 'd']);
  });

  it('aligns each cell like the original: centred, or numbers on the right when not known', async () => {
    const doc = makeDoc(3);
    const table = doc.pages[0]!.blocks[1] as TableBlock;
    table.cells[0]!.align = 'center';
    table.cells[1]!.text = 'note';
    await setup(doc);
    const alignOf = (text: string) =>
      StyleSheet.flatten(screen.getByText(text).props.style).textAlign;
    expect(alignOf('0')).toBe('center');
    expect(alignOf('note')).toBe('left');
    expect(alignOf('8')).toBe('right');
  });

  it('switches to “tables only” and between pages; pages without a table keep everything', async () => {
    const { files, onSaved } = await setup();
    await fireEvent.press(screen.getByTestId('table-scope-tables'));
    // 表外的文字不再画出来，表格从第 1 行开始。
    expect(screen.queryByText('标题')).toBeNull();
    expect(screen.getByTestId('table-cell-0-0')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-page-1'));
    expect(screen.getByText('只有文字')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-done'));
    const next = onSaved.mock.calls[0]![0] as RunItem;
    expect(next.tableDoc?.pagesWithoutTables).toEqual([2]);
    expect((await savedDoc(files, next)).scope).toBe('tables');
  });

  it('only shows pages with more than 2000 cells', async () => {
    await setup(makeDoc(46));
    expect(screen.getByText(/超过 2000 个格子/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    expect(screen.queryByTestId('table-edit-input')).toBeNull();
    await fireEvent(screen.getByTestId('table-row-1'), 'longPress');
    expect(screen.queryByText('在上方插入一行')).toBeNull();
  });
});

describe('result page for Excel conversions (D-272)', () => {
  const actions = {
    save: jest.fn(),
    share: jest.fn(),
    saveToFolder: jest.fn(),
    rememberedFolder: () => null,
    saveToPhotos: jest.fn(),
    print: jest.fn(),
    copy: jest.fn(),
  };
  const xlsx: RunItem = {
    uri: 'runs/r/1/a.xlsx',
    name: 'a',
    ext: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 2048,
    tableDoc: { uri: 'runs/r/2/a.json', for: 'runs/r/1/a.xlsx', pagesWithoutTables: [2, 3] },
  };
  const show = (item: RunItem, editTable = jest.fn()) =>
    render(
      <ResultView
        value={{ type: 'files', items: [item] }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        actions={{ ...actions, editTable }}
      />,
    );

  it('offers “View and edit” and says which pages had no ruled table', async () => {
    const editTable = jest.fn();
    await show(xlsx, editTable);
    expect(screen.getByText('第 2、3 页没有找到带线的表格，已按全部内容输出。')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('result-table-edit'));
    expect(editTable).toHaveBeenCalledWith(xlsx);
  });

  it('does not offer editing once a later step made another file', async () => {
    await show({ ...xlsx, uri: 'runs/r/3/a-renamed.xlsx' });
    expect(screen.queryByTestId('result-table-edit')).toBeNull();
    expect(screen.queryByTestId('result-tables-missing')).toBeNull();
  });
});
