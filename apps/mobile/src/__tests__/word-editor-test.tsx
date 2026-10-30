import { createDefaultWorkspace, decodeUtf8, type RunItem } from '@morph/core';
import { parseDocDoc, type DocDoc, type DocLeaf } from '@morph/tool-office';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { strFromU8, unzipSync } from 'fflate';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { ResultView } from '../run/ResultView';
import { WordEditor } from '../run/WordEditor';
import { canEditWord } from '../run/word-edit';
import { FakeFiles } from '../test-utils/fake-files';

// 转 Word 的查看和编辑（D-328）：按块显示，点一下选中（显示原图截图）、再点一下编辑；列表一行一项；
// 删除块；表格交给转 Excel 的编辑页；撤销重做；完成时改过才写新的 docx（换掉结果里的地址），旧的删掉。

const box = (x: number, y: number, width = 400, height = 30) => ({ x, y, width, height });

function makeDoc(src?: string): DocDoc {
  return {
    version: 1,
    pages: [
      {
        source: 'runs/r1/0/page.jpg',
        width: 1000,
        height: 1400,
        bodySize: 11,
        blocks: [
          { kind: 'paragraph', text: '年度报告', heading: 1, box: box(300, 40) },
          { kind: 'paragraph', text: '正文第一段。', box: box(100, 120, 800, 60) },
          {
            kind: 'list',
            ordered: true,
            format: '%1.',
            start: 1,
            items: ['甲', '乙'],
            box: box(100, 200),
          },
          {
            kind: 'table',
            colWidths: [200, 200],
            box: box(100, 300, 400, 40),
            table: {
              kind: 'table',
              rows: 1,
              col: 0,
              cols: 2,
              box: box(100, 300, 400, 40),
              cells: [
                {
                  row: 0,
                  col: 0,
                  rowSpan: 1,
                  colSpan: 1,
                  text: '名称',
                  box: box(100, 300, 200, 40),
                },
                {
                  row: 0,
                  col: 1,
                  rowSpan: 1,
                  colSpan: 1,
                  text: '金额',
                  box: box(300, 300, 200, 40),
                },
              ],
            },
          },
          { kind: 'image', box: box(100, 400, 300, 200), ...(src ? { src } : {}) },
        ],
      },
    ],
  };
}

async function setup(doc = makeDoc()) {
  const files = new FakeFiles();
  const docx = await files.writeRunFile('r1', 'old-a/报告.docx', new Uint8Array([1, 2, 3]));
  const json = await files.writeRunFile(
    'r1',
    'old-b/报告.json',
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  const item: RunItem = {
    uri: docx.uri,
    name: '报告',
    ext: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 3,
    assetId: 'saved-before',
    docDoc: { uri: json.uri, for: docx.uri },
  };
  const onClose = jest.fn();
  const onSaved = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      <WordEditor
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
  await screen.findByTestId('word-block-0-0');
  return { files, item, onClose, onSaved };
}

const saved = async (files: FakeFiles, next: RunItem) => ({
  doc: parseDocDoc(decodeUtf8(await files.readUri(next.docDoc!.uri)))!,
  xml: strFromU8(unzipSync(await files.readUri(next.uri))['word/document.xml']!),
});

describe('word editor (D-328)', () => {
  it('selects on the first tap, edits on the second, and writes a new docx when done', async () => {
    const { files, item, onSaved, onClose } = await setup();
    expect(screen.getByText('点一下选中，再点一下编辑')).toBeTruthy();
    // 还没剪好的图片块显示原图里的那一块。
    expect(screen.getAllByTestId('table-crop')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    // 选中：底部再显示原图里这一块。
    expect(screen.getAllByTestId('table-crop')).toHaveLength(2);
    expect(screen.queryByTestId('word-edit-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    await fireEvent.changeText(screen.getByTestId('word-edit-input'), '改过的 <正文> & 段落');
    await fireEvent.press(screen.getByTestId('word-edit-ok'));
    expect(screen.getByText('改过的 <正文> & 段落')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('word-done'));
    expect(onClose).not.toHaveBeenCalled();
    const next = onSaved.mock.calls[0]![0] as RunItem;
    expect(next.uri).not.toBe(item.uri);
    expect(next).toMatchObject({ name: '报告', ext: 'docx' });
    expect(canEditWord(next)).toBe(true);
    expect(next.assetId).toBeUndefined();
    // 旧的 docx 和 DocDoc 删掉了。
    await expect(files.readUri(item.uri)).rejects.toThrow();
    await expect(files.readUri(item.docDoc!.uri)).rejects.toThrow();
    const { doc, xml } = await saved(files, next);
    expect(xml).toContain('改过的 &lt;正文&gt; &amp; 段落');
    expect(doc.pages[0]!.blocks[1]).toMatchObject({ text: '改过的 <正文> & 段落' });
  });

  it('edits a list one item per line, deletes a block, and undoes and redoes', async () => {
    const { files, onSaved } = await setup();
    await fireEvent.press(screen.getByTestId('word-block-0-2'));
    await fireEvent.press(screen.getByTestId('word-edit-text'));
    expect(screen.getByTestId('word-edit-input').props.value).toBe('甲\n乙');
    await fireEvent.changeText(screen.getByTestId('word-edit-input'), '甲\n乙\n丙');
    await fireEvent.press(screen.getByTestId('word-edit-ok'));
    expect(screen.getByText('丙')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('word-block-0-0'));
    await fireEvent.press(screen.getByTestId('word-delete'));
    expect(screen.queryByText('年度报告')).toBeNull();
    await fireEvent.press(screen.getByTestId('word-undo'));
    expect(screen.getByText('年度报告')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('word-redo'));
    expect(screen.queryByText('年度报告')).toBeNull();
    await fireEvent.press(screen.getByTestId('word-done'));
    const { doc } = await saved(files, onSaved.mock.calls[0]![0] as RunItem);
    expect(doc.pages[0]!.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'list',
      'table',
      'image',
    ]);
    expect(doc.pages[0]!.blocks[1]).toMatchObject({ items: ['甲', '乙', '丙'] });
  });

  it('edits a table in the Excel editor and puts it back', async () => {
    const { files, onSaved } = await setup();
    await fireEvent.press(screen.getByTestId('word-block-0-3'));
    await fireEvent.press(screen.getByTestId('word-block-0-3'));
    expect(await screen.findByTestId('table-editor')).toBeTruthy();
    // 只有这一张表：不显示识别范围。
    expect(screen.queryByTestId('table-scope-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('table-cell-0-1'));
    await fireEvent.press(screen.getByTestId('table-cell-0-1'));
    await fireEvent.changeText(screen.getByTestId('table-edit-input'), '合计');
    await fireEvent.press(screen.getByTestId('table-edit-ok'));
    await fireEvent.press(screen.getByTestId('table-done'));
    expect(screen.queryByTestId('table-editor')).toBeNull();
    await fireEvent.press(screen.getByTestId('word-done'));
    const { doc, xml } = await saved(files, onSaved.mock.calls[0]![0] as RunItem);
    const table = doc.pages[0]!.blocks[3]!;
    expect(table.kind === 'table' && table.table.cells.map((c) => c.text)).toEqual([
      '名称',
      '合计',
    ]);
    expect(xml).toContain('合计');
  });

  it('closes without writing anything when nothing changed, also after undoing', async () => {
    const { files, onSaved, onClose } = await setup();
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    await fireEvent.press(screen.getByTestId('word-delete'));
    await fireEvent.press(screen.getByTestId('word-undo'));
    await fireEvent.press(screen.getByTestId('word-done'));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(files.disk.size).toBe(2);
  });

  it('embeds the cropped picture again in the new docx', async () => {
    const files0 = new FakeFiles();
    const crop = await files0.transformImage(
      files0.offerImage('p.jpg', 600, 400).uri,
      {},
      { format: 'jpeg', quality: 0.85 },
      'r1',
      'word/1-1.jpg',
    );
    const { files, onSaved } = await setup(makeDoc(crop.uri));
    // setup 里换了一个 FakeFiles：把剪好的图片也放进去。
    files.disk.set(crop.uri, await files0.readUri(crop.uri));
    files.imageSizes.set(crop.uri, { width: 600, height: 400 });
    await fireEvent.press(screen.getByTestId('word-block-0-0'));
    await fireEvent.press(screen.getByTestId('word-delete'));
    await fireEvent.press(screen.getByTestId('word-done'));
    const first = onSaved.mock.calls[0]![0] as RunItem;
    expect(Object.keys(unzipSync(await files.readUri(first.uri)))).toContain(
      'word/media/image1.jpg',
    );
  });
});

describe('side-by-side rows in the word editor (D-331)', () => {
  /** 一行并排：左边一段，右边一张表和一段；下面一张剪好的图片在另一行的右格里。 */
  function rowDoc(src?: string): DocDoc {
    const doc = makeDoc(src);
    const [, , , table, image] = doc.pages[0]!.blocks as DocLeaf[];
    doc.pages[0]!.blocks = [
      {
        kind: 'row',
        box: box(100, 120, 800, 220),
        cells: [
          {
            width: 450,
            blocks: [{ kind: 'paragraph', text: '左栏的一段。', box: box(100, 120, 400, 60) }],
          },
          {
            width: 350,
            blocks: [table!, { kind: 'paragraph', text: '右栏', box: box(560, 360) }],
          },
        ],
      },
      {
        kind: 'row',
        box: box(100, 400, 800, 200),
        cells: [
          { width: 400, blocks: [{ kind: 'paragraph', text: '图注', box: box(100, 400) }] },
          { width: 400, blocks: [image!] },
        ],
      },
    ];
    return doc;
  }

  it('shows each cell’s blocks and edits them like any other block', async () => {
    const { files, onSaved } = await setup(rowDoc());
    expect(screen.getByText('左栏的一段。')).toBeTruthy();
    expect(screen.getByText('右栏')).toBeTruthy();
    // 格子里的块：点一下选中，再点一下编辑。
    await fireEvent.press(screen.getByTestId('word-block-0-0-1-1'));
    await fireEvent.press(screen.getByTestId('word-block-0-0-1-1'));
    await fireEvent.changeText(screen.getByTestId('word-edit-input'), '右栏改过');
    await fireEvent.press(screen.getByTestId('word-edit-ok'));
    expect(screen.getByText('右栏改过')).toBeTruthy();
    // 格子里的表格照样交给转 Excel 的编辑页。
    await fireEvent.press(screen.getByTestId('word-block-0-0-1-0'));
    await fireEvent.press(screen.getByTestId('word-block-0-0-1-0'));
    expect(await screen.findByTestId('table-editor')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('table-done'));
    // 删除格子里的块。
    await fireEvent.press(screen.getByTestId('word-block-0-0-0-0'));
    await fireEvent.press(screen.getByTestId('word-delete'));
    expect(screen.queryByText('左栏的一段。')).toBeNull();
    await fireEvent.press(screen.getByTestId('word-done'));
    const { doc, xml } = await saved(files, onSaved.mock.calls[0]![0] as RunItem);
    const row = doc.pages[0]!.blocks[0]!;
    expect(row.kind === 'row' && row.cells.map((c) => c.blocks.map((b) => b.kind))).toEqual([
      [],
      ['table', 'paragraph'],
    ]);
    expect(xml).toContain('右栏改过');
  });

  it('embeds a cropped picture that sits in a row again', async () => {
    const files0 = new FakeFiles();
    const crop = await files0.transformImage(
      files0.offerImage('p.jpg', 600, 400).uri,
      {},
      { format: 'jpeg', quality: 0.85 },
      'r1',
      'word/1-1.jpg',
    );
    const { files, onSaved } = await setup(rowDoc(crop.uri));
    files.disk.set(crop.uri, await files0.readUri(crop.uri));
    files.imageSizes.set(crop.uri, { width: 600, height: 400 });
    await fireEvent.press(screen.getByTestId('word-block-0-1-0-0'));
    await fireEvent.press(screen.getByTestId('word-delete'));
    await fireEvent.press(screen.getByTestId('word-done'));
    const next = onSaved.mock.calls[0]![0] as RunItem;
    expect(Object.keys(unzipSync(await files.readUri(next.uri)))).toContain(
      'word/media/image1.jpg',
    );
  });
});

describe('form label and value pairs in the word editor (D-332)', () => {
  it('shows each label next to its value and edits them as text with tabs', async () => {
    const doc = makeDoc();
    doc.pages[0]!.blocks[1] = {
      kind: 'paragraph',
      text: '开始日期\t2019-03-01\n结束日期\t2019-03-31',
      tab: 300,
      box: box(100, 120, 600, 60),
    };
    const { files, onSaved } = await setup(doc);
    // 标签和值各是一段字，排在同一行。
    expect(screen.getByText('开始日期')).toBeTruthy();
    expect(screen.getByText('2019-03-31')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    expect(screen.getByTestId('word-edit-input').props.value).toBe(
      '开始日期\t2019-03-01\n结束日期\t2019-03-31',
    );
    await fireEvent.changeText(
      screen.getByTestId('word-edit-input'),
      '开始日期\t2019-04-01\n结束日期\t2019-03-31',
    );
    await fireEvent.press(screen.getByTestId('word-edit-ok'));
    expect(screen.getByText('2019-04-01')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('word-done'));
    const { xml } = await saved(files, onSaved.mock.calls[0]![0] as RunItem);
    // docx 里一对是两列表格的一行。
    expect(xml).toMatch(/>开始日期<\/w:t>.*?<\/w:tc><w:tc>.*?>2019-04-01<\/w:t>/);
  });
});

describe('result page for Word conversions (D-328)', () => {
  const actions = {
    save: jest.fn(),
    share: jest.fn(),
    saveToFolder: jest.fn(),
    rememberedFolder: () => null,
    saveToPhotos: jest.fn(),
    print: jest.fn(),
    copy: jest.fn(),
  };
  const docx: RunItem = {
    uri: 'runs/r/1/a.docx',
    name: 'a',
    ext: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 2048,
    docDoc: { uri: 'runs/r/2/a.json', for: 'runs/r/1/a.docx' },
  };
  const show = (item: RunItem, editWord = jest.fn()) =>
    render(
      <ResultView
        value={{ type: 'files', items: [item] }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        actions={{ ...actions, editWord }}
      />,
    );

  it('offers “View and edit” for the docx', async () => {
    const editWord = jest.fn();
    await show(docx, editWord);
    await fireEvent.press(screen.getByTestId('result-word-edit'));
    expect(editWord).toHaveBeenCalledWith(docx);
    expect(screen.queryByTestId('result-table-edit')).toBeNull();
  });

  it('does not offer editing once a later step made another file', async () => {
    await show({ ...docx, uri: 'runs/r/3/a-renamed.docx' });
    expect(screen.queryByTestId('result-word-edit')).toBeNull();
  });
});
