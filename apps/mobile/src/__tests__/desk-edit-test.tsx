import { createDefaultWorkspace, currentFiles, decodeUtf8, type RunItem } from '@morph/core';
import {
  parseDocDoc,
  parseTableDoc,
  type DocDoc,
  type TableBlock,
  type TableDoc,
} from '@morph/tool-office';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { strFromU8, unzipSync } from 'fflate';
import { Alert, Dimensions, StyleSheet } from 'react-native';

import { loadDesk, placeResultsOnDesk, writeEditDraft } from '../desk/store';
import { makePalette } from '../renderer/theme';
import { ResultView } from '../run/ResultView';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 文件房间 R2（file-room DESIGN §9、§11，D-345、D-346）：桌上的 Excel、Word 就是编辑器（点一下选中、
// 再点一下编辑，选中时工具栏换成编辑层）；连续的编辑合成一个版本，撤销先一步步退编辑、合上后整段退；
// 存成用户文件时带着中间格式和原图，从存储空间放回桌上还能改；结果页的「放到桌上」代替「查看和编辑」。

afterEach(() => jest.restoreAllMocks());

const box = (x: number, y: number, width = 100, height = 20) => ({ x, y, width, height });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 第 1 页：一行表外的文字（标题），下面一张 cells×cells 的表；第 2 页只有文字。 */
function tableDoc(cells = 2): TableDoc {
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
        source: 'runs/r1/page.jpg',
        width: 1000,
        height: 1400,
        lineHeight: 20,
        colWidths: Array(cells).fill(200),
        blocks: [{ kind: 'text', text: '标题', box: box(0, 0) }, table],
      },
      {
        name: '第 2 页',
        source: 'runs/r1/page.jpg',
        width: 1000,
        height: 1400,
        lineHeight: 20,
        colWidths: [250, 250, 250, 250],
        blocks: [{ kind: 'text', text: '只有文字', box: box(0, 0) }],
      },
    ],
  };
}

function wordDoc(src?: string): DocDoc {
  const cell = (col: number, text: string) => ({
    row: 0,
    col,
    rowSpan: 1,
    colSpan: 1,
    text,
    box: box(100 + col * 200, 300, 200, 40),
  });
  return {
    version: 1,
    pages: [
      {
        source: 'runs/r1/page.jpg',
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
              cells: [cell(0, '名称'), cell(1, '金额')],
            },
          },
          { kind: 'image', box: box(100, 400, 300, 200), ...(src ? { src } : {}) },
        ],
      },
    ],
  };
}

/** 运行目录里的一份转 Excel / 转 Word 的结果（和结果页上的一样）。 */
function runResult(files: FakeFiles, kind: 'table' | 'doc', doc: TableDoc | DocDoc): RunItem {
  files.disk.set('runs/r1/page.jpg', new Uint8Array([9, 9, 9]));
  const ext = kind === 'table' ? 'xlsx' : 'docx';
  files.disk.set(`runs/r1/明细.${ext}`, new Uint8Array([1, 2, 3]));
  files.disk.set('runs/r1/明细.json', new TextEncoder().encode(JSON.stringify(doc)));
  const ref = { uri: 'runs/r1/明细.json', for: `runs/r1/明细.${ext}` };
  return {
    uri: `runs/r1/明细.${ext}`,
    name: '明细',
    ext,
    mimeType: kind === 'table' ? XLSX : DOCX,
    size: 3,
    ...(kind === 'table' ? { tableDoc: ref } : { docDoc: ref }),
  };
}

/** 放到桌上（结果页的「放到桌上」），打开房间。 */
async function openOnDesk(kind: 'table' | 'doc', doc: TableDoc | DocDoc, files = new FakeFiles()) {
  const item = runResult(files, kind, doc);
  const desk = await placeResultsOnDesk(files, [item], Date.now(), 'editdesk');
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, files);
  await act(() => router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } }));
  await screen.findByTestId('desk-editor');
  return { files, repo, item };
}

const deskNow = async (files: FakeFiles) => (await loadDesk(files, 'editdesk'))!;
const xlsxText = async (files: FakeFiles) => {
  const file = currentFiles(await deskNow(files))[0]!;
  return strFromU8(
    unzipSync(files.disk.get(`desk/editdesk/${file.path}`)!)['xl/sharedStrings.xml']!,
  );
};
const docxXml = async (files: FakeFiles) => {
  const file = currentFiles(await deskNow(files))[0]!;
  return strFromU8(unzipSync(files.disk.get(`desk/editdesk/${file.path}`)!)['word/document.xml']!);
};

async function editTo(id: string, text: string) {
  await fireEvent.press(screen.getByTestId(id));
  await fireEvent.press(screen.getByTestId(id));
  await fireEvent.changeText(screen.getByTestId('desk-edit-input'), text);
  await fireEvent.press(screen.getByTestId('desk-edit-ok'));
}

describe('放到桌上：结果页和存储（D-345）', () => {
  it('结果页的转 Excel、转 Word 结果有「放到桌上」（代替「查看和编辑」）；后面的步骤生成了别的文件时没有', async () => {
    const putOnDesk = jest.fn(async () => undefined);
    const item: RunItem = {
      uri: 'runs/r/1/a.xlsx',
      name: 'a',
      ext: 'xlsx',
      mimeType: XLSX,
      size: 2048,
      tableDoc: { uri: 'runs/r/2/a.json', for: 'runs/r/1/a.xlsx', pagesWithoutTables: [2, 3] },
    };
    const actions = {
      save: jest.fn(),
      share: jest.fn(),
      saveToFolder: jest.fn(),
      rememberedFolder: () => null,
      saveToPhotos: jest.fn(),
      print: jest.fn(),
      copy: jest.fn(),
      putOnDesk,
    };
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    const view = await render(
      <ResultView
        value={{ type: 'files', items: [item] }}
        palette={palette}
        locale="zh"
        actions={actions}
      />,
    );
    expect(view.getByText('第 2、3 页没有找到带线的表格，已按全部内容输出。')).toBeTruthy();
    expect(view.queryByText('查看和编辑')).toBeNull();
    await fireEvent.press(view.getByTestId('result-desk'));
    expect(putOnDesk).toHaveBeenCalledWith(item);
    await view.rerender(
      <ResultView
        value={{ type: 'files', items: [{ ...item, uri: 'runs/r/3/a-renamed.xlsx' }] }}
        palette={palette}
        locale="zh"
        actions={actions}
      />,
    );
    expect(view.queryByTestId('result-desk')).toBeNull();
  });

  it('放到桌上只复制：结果页的文件还在；中间格式的图片换成桌面里的相对路径', async () => {
    const files = new FakeFiles();
    const item = runResult(files, 'table', tableDoc());
    const desk = await placeResultsOnDesk(files, [item], 1, 'copydesk');
    expect(files.disk.has(item.uri)).toBe(true);
    expect(files.disk.has('runs/r1/page.jpg')).toBe(true);
    const file = currentFiles(desk)[0]!;
    expect(file.source?.kind).toBe('table');
    const json = parseTableDoc(decodeUtf8(files.disk.get(`desk/copydesk/${file.source!.path}`)!))!;
    expect(json.pages[0]!.source).toBe(file.source!.assets[0]!.path);
  });
});

describe('Excel 在桌上就是表格编辑器', () => {
  it('点一下选中（工具栏换成编辑层、显示原图），再点一下编辑；编辑中撤销一步步退；「完成」时合成一个版本', async () => {
    const { files } = await openOnDesk('table', tableDoc());
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    expect(screen.getByTestId('desk-edit-bar')).toBeTruthy();
    expect(screen.getByTestId('table-crop')).toBeTruthy();
    expect(screen.queryByTestId('desk-toolbar')).toBeNull();
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    expect(screen.getByTestId('desk-edit-input').props.value).toBe('a');
    await fireEvent.changeText(screen.getByTestId('desk-edit-input'), 'A & 1');
    await fireEvent.press(screen.getByTestId('desk-edit-ok'));
    expect(screen.getByText('A & 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-row-below'));
    expect(screen.getByTestId('table-cell-3-0')).toBeTruthy();
    // 没合上：桌上还是一个版本，「编辑中」写进了桌面（防丢）。
    expect((await deskNow(files)).versions).toHaveLength(1);
    await waitFor(() => expect(files.disk.has('desk/editdesk/editing.json')).toBe(true));
    // 撤销一步步退编辑。
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(screen.queryByTestId('table-cell-3-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(screen.getByText('a')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-redo'));
    expect(screen.getByText('A & 1')).toBeTruthy();
    // 插入行以后不再选中：工具栏回来了。
    expect(screen.getByTestId('desk-toolbar')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('desk-done'));
    expect(await screen.findByTestId('desk-save')).toBeTruthy();
    const desk = await deskNow(files);
    expect(desk.versions.map((v) => v.by)).toEqual([{ kind: 'place' }, { kind: 'edit' }]);
    expect(desk.versions.some((v) => v.open)).toBe(false);
    expect(await xlsxText(files)).toContain('<t>A &amp; 1</t>');
    expect(files.disk.has('desk/editdesk/editing.json')).toBe(false);
    // 合上以后撤销整段一起退。
    await fireEvent.press(screen.getByTestId('desk-sheet-backdrop'));
    await fireEvent.press(screen.getByTestId('desk-undo'));
    await waitFor(() => expect(screen.getByText('a')).toBeTruthy());
    expect((await deskNow(files)).current).toBe(0);
  });

  it('撤销跨编辑和工具：编辑后转 PDF，先退回改过的表格，再整段退回原来的', async () => {
    const files = new FakeFiles();
    files.documents.extensions = ['docx', 'xlsx'];
    await openOnDesk('table', tableDoc(), files);
    await editTo('table-cell-1-1', '改过');
    await fireEvent.press(screen.getByTestId('desk-deselect'));
    // 用别的工具前先合上编辑；文档转 PDF 不问纸张，直接跑（D-342）。
    await fireEvent.press(screen.getByTestId('desk-tool-pdf.fromDocument'));
    await waitFor(() => expect(screen.getByTestId('desk-preview-pdf')).toBeTruthy());
    expect((await deskNow(files)).versions.map((v) => v.by.kind)).toEqual([
      'place',
      'edit',
      'action',
    ]);
    expect(files.documents.converted).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(await screen.findByText('改过')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(await screen.findByText('b')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-redo'));
    expect(await screen.findByText('改过')).toBeTruthy();
  });

  it('插删列、删表外的文字；离开房间时合上', async () => {
    const { files } = await openOnDesk('table', tableDoc());
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    await fireEvent.press(screen.getByTestId('desk-col-delete'));
    await fireEvent.press(screen.getByTestId('table-cell-0-0'));
    // 表外的文字：没有插删行列，只有编辑和删除。
    expect(screen.queryByTestId('desk-row-below')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-block-delete'));
    await fireEvent.press(screen.getByTestId('desk-close'));
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    const desk = await deskNow(files);
    expect(desk.versions.map((v) => v.by.kind)).toEqual(['place', 'edit']);
    const file = currentFiles(desk)[0]!;
    const doc = parseTableDoc(decodeUtf8(files.disk.get(`desk/editdesk/${file.source!.path}`)!))!;
    const blocks = doc.pages[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['table']);
    expect((blocks[0] as TableBlock).cells.map((c) => c.text)).toEqual(['b', 'd']);
    // 原图只存一份，新版本还用着它。
    expect(file.source!.assets).toHaveLength(1);
  });

  it('识别范围和页签；一页超过 2000 格只能看', async () => {
    await openOnDesk('table', tableDoc());
    await fireEvent.press(screen.getByTestId('table-scope-tables'));
    expect(screen.queryByText('标题')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-sheet-page-1'));
    expect(screen.getByText('只有文字')).toBeTruthy();
  });

  it('超过 2000 格的页只能看：格子点不了', async () => {
    await openOnDesk('table', tableDoc(46));
    expect(screen.getByText(/超过 2000 个格子/)).toBeTruthy();
    expect(screen.getByTestId('table-cell-1-0')).toBeDisabled();
  });

  it('格子照原图对齐；表外很长的一行按屏幕折行', async () => {
    const doc = tableDoc(20);
    const table = doc.pages[0]!.blocks[1] as TableBlock;
    table.cells[0]!.align = 'center';
    table.cells[1]!.text = 'note';
    const long = Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1} du relevé`).join(' ');
    doc.pages[0]!.blocks[0] = { kind: 'text', text: long, align: 'center', box: box(0, 0, 1000) };
    await openOnDesk('table', doc);
    const alignOf = (text: string) =>
      StyleSheet.flatten(screen.getByText(text).props.style).textAlign;
    expect(alignOf('0')).toBe('center');
    expect(alignOf('note')).toBe('left');
    expect(alignOf('388')).toBe('right');
    const cell = StyleSheet.flatten(screen.getByTestId('table-cell-0-0').props.style);
    expect(cell.width).toBeLessThanOrEqual(Dimensions.get('window').width - 40);
  });

  it('App 被关掉时没合上的编辑：下次打开房间合成一个版本，能撤销', async () => {
    const files = new FakeFiles();
    const item = runResult(files, 'table', tableDoc());
    const desk = await placeResultsOnDesk(files, [item], Date.now(), 'editdesk');
    const file = currentFiles(desk)[0]!;
    const edited = tableDoc();
    (edited.pages[0]!.blocks[1] as TableBlock).cells[0]!.text = '没合上的';
    await writeEditDraft(files, desk, file.id, { kind: 'table', doc: edited });
    await renderToolsApp(new MemoryWorkspaceRepo(), files);
    await act(() => router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } }));
    expect(await screen.findByText('没合上的')).toBeTruthy();
    expect((await deskNow(files)).versions.map((v) => v.by.kind)).toEqual(['place', 'edit']);
    expect(files.disk.has('desk/editdesk/editing.json')).toBe(false);
  });
});

describe('Word 在桌上就是文档编辑器', () => {
  it('段落、列表改文字，删块；表格在文档里直接改（不弹出编辑页）；合上时生成新的 docx', async () => {
    const { files } = await openOnDesk('doc', wordDoc());
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    expect(screen.getAllByTestId('table-crop').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('word-block-0-1'));
    await fireEvent.changeText(screen.getByTestId('desk-edit-input'), '改过的 <正文> & 段落');
    await fireEvent.press(screen.getByTestId('desk-edit-ok'));
    expect(screen.getByText('改过的 <正文> & 段落')).toBeTruthy();
    // 列表一行一项。
    await fireEvent.press(screen.getByTestId('word-block-0-2'));
    await fireEvent.press(screen.getByTestId('desk-edit-text'));
    expect(screen.getByTestId('desk-edit-input').props.value).toBe('甲\n乙');
    await fireEvent.changeText(screen.getByTestId('desk-edit-input'), '甲\n乙\n丙');
    await fireEvent.press(screen.getByTestId('desk-edit-ok'));
    expect(screen.getByText('丙')).toBeTruthy();
    // 表格的格子：选中、再点编辑，就在文档里改；再在下面插入一行。
    await editTo('word-cell-0-3-1', '合计');
    expect(screen.queryByTestId('table-editor')).toBeNull();
    expect(screen.getByText('合计')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-row-below'));
    // 删掉标题。
    await fireEvent.press(screen.getByTestId('word-block-0-0'));
    await fireEvent.press(screen.getByTestId('desk-block-delete'));
    expect(screen.queryByText('年度报告')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(screen.getByText('年度报告')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-redo'));

    await fireEvent.press(screen.getByTestId('desk-done'));
    expect(await screen.findByTestId('desk-save')).toBeTruthy();
    expect((await deskNow(files)).versions.map((v) => v.by.kind)).toEqual(['place', 'edit']);
    const xml = await docxXml(files);
    expect(xml).toContain('改过的 &lt;正文&gt; &amp; 段落');
    expect(xml).toContain('合计');
    expect(xml).not.toContain('年度报告');
    const file = currentFiles(await deskNow(files))[0]!;
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/editdesk/${file.source!.path}`)!))!;
    const table = doc.pages[0]!.blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.table.rows).toBe(2);
  });

  it('剪好嵌进 docx 的图片：合上时再嵌一次', async () => {
    const files = new FakeFiles();
    files.disk.set('runs/r1/crop.jpg', new Uint8Array([7, 7, 7, 7]));
    files.imageSizes.set('runs/r1/crop.jpg', { width: 600, height: 400 });
    await openOnDesk('doc', wordDoc('runs/r1/crop.jpg'), files);
    await fireEvent.press(screen.getByTestId('word-block-0-0'));
    await fireEvent.press(screen.getByTestId('desk-block-delete'));
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    const file = currentFiles(await deskNow(files))[0]!;
    expect(Object.keys(unzipSync(files.disk.get(`desk/editdesk/${file.path}`)!))).toContain(
      'word/media/image1.jpg',
    );
    // 原图和剪好的图片都还在桌面的 assets 里。
    expect(file.source!.assets).toHaveLength(2);
  });
});

describe('存成用户文件以后还能放回桌上改（D-346）', () => {
  it('保存时中间格式和原图跟着存；存储空间里算在这个文件上，能放回桌上改；删文件一起删', async () => {
    const { files, repo } = await openOnDesk('table', tableDoc());
    await editTo('table-cell-1-0', '存之前改的');
    await fireEvent.press(screen.getByTestId('desk-deselect'));
    await fireEvent.press(screen.getByTestId('desk-tool-room-save'));
    expect(await screen.findByTestId('desk-saved')).toBeTruthy();
    const [asset] = await repo.listAssets();
    expect(asset!.name).toBe('明细.xlsx');
    const dir = [...files.disk.keys()].filter((k) => k.startsWith(`assets/${asset!.id}/`));
    expect(dir.sort()).toEqual(
      [
        `assets/${asset!.id}/明细.xlsx`,
        `assets/${asset!.id}/morph-source-0.jpg`,
        `assets/${asset!.id}/morph-source.json`,
      ].sort(),
    );
    // 保存前合上了编辑：存的是改过的。
    expect(strFromU8(unzipSync(files.disk.get(asset!.path)!)['xl/sharedStrings.xml']!)).toContain(
      '存之前改的',
    );

    await act(() => router.push('/storage'));
    // 大小算上中间格式和原图。
    const row = await screen.findByTestId(`storage-file-${asset!.id}`);
    expect(row).toHaveTextContent(/表格|其他|文件/);
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.text === '放到桌上')?.onPress?.();
    });
    await fireEvent.press(row);
    expect(await screen.findByText('存之前改的')).toBeTruthy();
    expect(screen.getByTestId('desk-editor')).toBeTruthy();
    // 放回桌上是复制：用户文件不动。
    expect(files.disk.has(asset!.path)).toBe(true);

    await editTo('table-cell-1-1', '放回来再改');
    await fireEvent.press(screen.getByTestId('desk-close'));
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    expect(files.disk.has(asset!.path)).toBe(true);

    await files.removeAssetFile(asset!.path);
    expect([...files.disk.keys()].filter((k) => k.startsWith(`assets/${asset!.id}/`))).toEqual([]);
  });

  it('普通文件（没有中间格式）在存储空间里没有「放到桌上」', async () => {
    const files = new FakeFiles();
    const repo = new MemoryWorkspaceRepo();
    files.disk.set('assets/x1/a.pdf', new Uint8Array([1]));
    await repo.addAsset({
      id: 'x1',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 1,
      path: 'assets/x1/a.pdf',
      source: 'generated',
      createdAt: 1,
    });
    await renderToolsApp(repo, files);
    await act(() => router.push('/storage'));
    let labels: string[] = [];
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      labels = (buttons ?? []).map((b) => b.text ?? '');
    });
    await fireEvent.press(await screen.findByTestId('storage-file-x1'));
    expect(labels).not.toContain('放到桌上');
  });
});
