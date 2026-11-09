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
import { JSDOM } from 'jsdom';
import { Alert, Dimensions, StyleSheet } from 'react-native';

import { placeAssetOnDesk, savedSourceBytes } from '../desk/saved-source';
import { openAsset } from '../renderer/FileList';
import { loadDesk, placeResultsOnDesk, writeEditDraft } from '../desk/store';
import { makePalette } from '../renderer/theme';
import { ResultView } from '../run/ResultView';
import { saveItems } from '../runtime/actions/io';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { deskTool } from '../test-utils/desk-toolbar';
import { renderToolsApp } from '../test-utils/render-app';

// 文件房间 R2（file-room DESIGN §9、§11，D-366、D-367）：桌上的 Excel、Word 就是编辑器（点一下选中、
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

describe('放到桌上：结果页和存储（D-366）', () => {
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
    // 用别的工具前先合上编辑；文档转 PDF 不问纸张，直接跑（D-363）。
    await fireEvent.press(await deskTool('desk-tool-pdf.fromDocument'));
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

  it('插删列、删表外的文字；点「完成」合上；没保存就离开先问「放弃修改？」', async () => {
    const { files } = await openOnDesk('table', tableDoc());
    await fireEvent.press(screen.getByTestId('table-cell-1-0'));
    await fireEvent.press(screen.getByTestId('desk-col-delete'));
    await fireEvent.press(screen.getByTestId('table-cell-0-0'));
    // 表外的文字：没有插删行列，只有编辑和删除。
    expect(screen.queryByTestId('desk-row-below')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-block-delete'));
    const ask = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await fireEvent.press(screen.getByTestId('desk-close'));
    expect(ask.mock.lastCall?.[0]).toBe('放弃修改？');
    expect(screen.getByTestId('desk-screen')).toBeTruthy();
    ask.mockRestore();
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-sheet-cancel');
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

/** 桌上 Word 的编辑页（D-465）：用 jsdom 跑真的页面脚本，改 DOM，把页面交回来的样子发给 App。 */
function wordPage() {
  const view = screen.getByTestId('word-editor-page');
  const dom = new JSDOM(view.props.source.html, { runScripts: 'dangerously' });
  const window = dom.window as unknown as Window & { __wordPages: () => unknown };
  const send = (msg: object) =>
    fireEvent(screen.getByTestId('word-editor-page'), 'message', {
      nativeEvent: { data: JSON.stringify(msg) },
    });
  return {
    q: (sel: string) => window.document.querySelector(sel) as HTMLElement,
    /** 浏览器的 input 事件：交回整页。 */
    input: () => send({ type: 'doc', pages: window.__wordPages() }),
    state: (state: object) => send({ type: 'state', ...state }),
    /** 原图小窗上的「换成原件」（D-469）。 */
    swap: () => send({ type: 'swap' }),
    window,
  };
}

describe('Word 在桌上就是整页编辑器（D-465）', () => {
  it('整页直接改：改字、加粗几个字、回车分段；光标在表格里能插行；撤销；合上时生成新的 docx', async () => {
    const { files } = await openOnDesk('doc', wordDoc());
    const page = wordPage();
    // 没有点选、没有文字框：页面里每一块都能直接改。
    expect(screen.queryByTestId('desk-edit-input')).toBeNull();
    expect(screen.queryByTestId('word-format-bar')).toBeNull();
    // 光标放进页面：房间的工具栏收起，换成格式按钮。
    await page.state({ focus: true, bold: false, align: 'left', cell: null });
    expect(screen.getByTestId('word-format-bar')).toBeTruthy();
    expect(screen.getByTestId('word-bold')).toBeTruthy();
    expect(screen.getByTestId('word-underline')).toBeTruthy();
    expect(screen.queryByTestId('desk-row-below')).toBeNull();

    page.q('[data-ref="0-1"]').innerHTML = '改过的 &lt;正文&gt; <b>&amp; 段落</b>';
    const second = page.q('[data-ref="0-1"]').cloneNode(false) as HTMLElement;
    second.textContent = '回车分出来的';
    page.q('[data-ref="0-1"]').after(second);
    page.q('[data-ref="0-3"] td[data-i="1"]').textContent = '合计';
    await page.input();
    // 字改到一半，光标到了表格里：多一排插删行列；点「下面插入一行」，改的字也在。
    await page.state({ focus: true, cell: { ref: '0-3', i: 1 } });
    await fireEvent.press(screen.getByTestId('desk-row-below'));
    const html = screen.getByTestId('word-editor-page').props.source.html as string;
    expect(html).toContain('合计');
    expect(html).toContain('回车分出来的');
    expect(html.match(/<tr>/g)).toHaveLength(2);
    // 撤销退掉插入的行，再重做。
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(
      (screen.getByTestId('word-editor-page').props.source.html as string).match(/<tr>/g),
    ).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('desk-redo'));

    await page.state({ focus: false });
    await fireEvent.press(screen.getByTestId('desk-done'));
    expect(await screen.findByTestId('desk-save')).toBeTruthy();
    expect((await deskNow(files)).versions.map((v) => v.by.kind)).toEqual(['place', 'edit']);
    const xml = await docxXml(files);
    expect(xml).toContain('改过的 &lt;正文&gt; ');
    expect(xml).toMatch(/<w:r><w:rPr>[^]*?<w:b\/>[^]*?&amp; 段落<\/w:t>/);
    expect(xml).toContain('回车分出来的');
    expect(xml).toContain('合计');
    const file = currentFiles(await deskNow(files))[0]!;
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/editdesk/${file.source!.path}`)!))!;
    const table = doc.pages[0]!.blocks.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.table.rows).toBe(2);
  });

  it('打了字马上点「完成」：还没合成一步的字也写进 docx', async () => {
    const { files } = await openOnDesk('doc', wordDoc());
    const page = wordPage();
    await page.state({ focus: true });
    page.q('[data-ref="0-0"]').textContent = '刚打的标题';
    await page.input();
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    expect(await docxXml(files)).toContain('刚打的标题');
  });

  it('格式按钮把命令交给页面', async () => {
    await openOnDesk('doc', wordDoc());
    const page = wordPage();
    const inject = jest.fn();
    screen.getByTestId('word-editor-page').props.injectJavaScript = inject;
    await page.state({ focus: true, align: 'left' });
    // 替身 WebView 没有 injectJavaScript 也不出错。
    await fireEvent.press(screen.getByTestId('word-bold'));
    await fireEvent.press(screen.getByTestId('word-bigger'));
    expect(screen.getByTestId('word-format-bar')).toBeTruthy();
  });

  it('桌上的 Word 转 PDF 按编辑页的版面打印，改过的字和样式都在（2026-11-06 三星真机：转出来的 PDF 全部靠左、字号全丢，D-466）', async () => {
    const { files } = await openOnDesk('doc', wordDoc());
    const page = wordPage();
    page.q('[data-ref="0-1"]').innerHTML = '改过的 <b>正文</b>';
    await page.input();
    await fireEvent.press(await deskTool('desk-tool-pdf.fromDocument'));
    await waitFor(() => expect(screen.getByTestId('desk-preview-pdf')).toBeTruthy());
    // 没交给通用的 Word 排版（Android 的 mammoth）。
    expect(files.documents.converted).toHaveLength(0);
    const html = files.printedHtml.at(-1)!;
    expect(html).toContain('class="paper"');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('<script');
    expect(html).toContain('改过的 <b>正文</b>');
    // 字号按磅（A4 宽 595 磅），标题居中的位置照原图。
    expect(html).toMatch(/font-size:\d+(\.\d+)?pt/);
    expect(html).not.toMatch(/font-size:\d+(\.\d+)?px/);
  });

  it('「这里用原图」：被认成字的签名、印章换成原图里剪下来的那一块，合上时搬进桌面、嵌进 docx（D-467）', async () => {
    const files = new FakeFiles();
    files.imageSizes.set('runs/r1/page.jpg', { width: 2000, height: 2800 });
    await openOnDesk('doc', wordDoc(), files);
    const page = wordPage();
    // 按钮在页面里的原图小窗上（D-469），不在格式栏里。
    expect(screen.getByTestId('word-editor-page').props.source.html).toContain(
      '"swap":{"one":"换成原件","lines":"换成原件（{n} 行）","primary":',
    );
    await page.state({ focus: true, cell: null, ref: '0-1', refs: ['0-1'] });
    expect(screen.queryByTestId('word-use-original')).toBeNull();
    await page.swap();
    await waitFor(() =>
      expect(
        (screen.getByTestId('word-editor-page').props.source.html as string).includes(
          'data-ref="0-1" data-kind="image"',
        ),
      ).toBe(true),
    );
    // 新剪的图也读进页面（模拟器上第一次只画了灰块）。
    await waitFor(() =>
      expect(screen.getByTestId('word-editor-page').props.source.html as string).toMatch(
        /data-ref="0-1" data-kind="image"[^>]*><img src="data:image\/jpeg;base64,/,
      ),
    );
    const html = screen.getByTestId('word-editor-page').props.source.html as string;
    expect(html).not.toContain('正文第一段。');
    await page.state({ focus: false });
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    const file = currentFiles(await deskNow(files))[0]!;
    // 剪下来的图搬进了桌面，嵌进了 docx。
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/editdesk/${file.source!.path}`)!))!;
    const image = doc.pages[0]!.blocks[1]!;
    expect(image.kind).toBe('image');
    const src = image.kind === 'image' ? image.src! : '';
    expect(src).toMatch(/^assets\//);
    expect(file.source!.assets.map((a) => a.path)).toContain(src);
    expect(files.disk.has(`desk/editdesk/${src}`)).toBe(true);
    expect(Object.keys(unzipSync(files.disk.get(`desk/editdesk/${file.path}`)!))).toContain(
      'word/media/image1.jpg',
    );
    // 剪的是原图里这一段的位置（按原图的大小换算，四周多留一点）。
    expect(image.box.x).toBeLessThan(100);
    expect(image.box.width).toBeGreaterThan(800);
  });

  it('换成原件以后点「完成」、接着改、再存：图还在页面上，存的文件放回桌上还能改（2026-11-06 三星：存了再打开就显示不了）', async () => {
    const files = new FakeFiles();
    files.imageSizes.set('runs/r1/page.jpg', { width: 1000, height: 1400 });
    const { repo } = await openOnDesk('doc', wordDoc(), files);
    let page = wordPage();
    await page.state({ focus: true, cell: null, ref: '0-1', refs: ['0-1'] });
    await page.swap();
    await waitFor(() =>
      expect(screen.getByTestId('word-editor-page').props.source.html as string).toMatch(
        /data-ref="0-1" data-kind="image"[^>]*><img src="data:image/,
      ),
    );
    await page.state({ focus: false });
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    await fireEvent.press(screen.getByTestId('desk-sheet-cancel'));
    // 合上以后剪的图搬进了桌面：页面上还是这张图，不是灰块。
    await waitFor(() =>
      expect(screen.getByTestId('word-editor-page').props.source.html as string).toMatch(
        /data-ref="0-1" data-kind="image"[^>]*><img src="data:image/,
      ),
    );
    // 接着改字，再存成用户文件。
    page = wordPage();
    page.q('[data-ref="0-0"]').textContent = '第二次改的标题';
    await page.input();
    await fireEvent.press(await deskTool('desk-tool-room-save'));
    expect(await screen.findByTestId('desk-saved')).toBeTruthy();
    const [asset] = await repo.listAssets();
    // 存的 docx 里有两张图（换的这张、原来剪好的那张）；放回桌上还带着中间格式，能改。
    const desk = await placeAssetOnDesk(files, asset!, 3, 'again');
    expect(desk).not.toBeNull();
    const file = currentFiles(desk!)[0]!;
    expect(file.source?.kind).toBe('doc');
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/again/${file.source!.path}`)!))!;
    expect(doc.pages[0]!.blocks.filter((b) => b.kind === 'image')).toHaveLength(2);
    expect(JSON.stringify(doc)).toContain('第二次改的标题');

    // 从最近文件打开（文件预览页）：按编辑页的版面显示；点「编辑」放上桌，还是 Word 编辑器（D-470）。
    await act(() => router.dismissAll());
    await act(() => openAsset(files, router, asset!));
    const preview = await screen.findByTestId('word-preview-page');
    expect(preview.props.source.html).toContain('第二次改的标题');
    expect(preview.props.source.html).not.toContain('contenteditable="true"');
    await fireEvent.press(screen.getByTestId('preview-edit'));
    const editor = await screen.findByTestId('word-editor-page');
    expect(editor.props.source.html).toContain('第二次改的标题');
  });

  it('选中几行再点「用原图」：一起换成一张图（2026-11-06 三星真机：一个签名被切成了好几份，D-468）', async () => {
    const files = new FakeFiles();
    files.imageSizes.set('runs/r1/page.jpg', { width: 1000, height: 1400 });
    await openOnDesk('doc', wordDoc(), files);
    const page = wordPage();
    await page.state({ focus: true, cell: null, ref: '0-1', refs: ['0-1', '0-2'] });
    await page.swap();
    await waitFor(() =>
      expect(screen.getByTestId('word-editor-page').props.source.html as string).toContain(
        'data-ref="0-1" data-kind="image"',
      ),
    );
    const html = screen.getByTestId('word-editor-page').props.source.html as string;
    expect(html).not.toContain('正文第一段。');
    expect(html).not.toContain('甲');
    // 一张图包住两块（段落 y 120–180、列表 y 200–220，四周多留一点）。
    await page.state({ focus: false });
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    const file = currentFiles(await deskNow(files))[0]!;
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/editdesk/${file.source!.path}`)!))!;
    const images = doc.pages[0]!.blocks.filter((b) => b.kind === 'image');
    expect(images).toHaveLength(2);
    const swapped = images.find((b) => b.box.y < 200)!;
    expect(swapped.box.y).toBeLessThan(120);
    expect(swapped.box.y + swapped.box.height).toBeGreaterThan(220);
  });

  it('剪好嵌进 docx 的图片：图片写进页面；合上时再嵌一次', async () => {
    const files = new FakeFiles();
    files.disk.set('runs/r1/crop.jpg', new Uint8Array([7, 7, 7, 7]));
    files.imageSizes.set('runs/r1/crop.jpg', { width: 600, height: 400 });
    await openOnDesk('doc', wordDoc('runs/r1/crop.jpg'), files);
    const page = wordPage();
    expect(page.q('[data-kind="image"] img').getAttribute('src')).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    page.q('[data-ref="0-0"]').remove();
    await page.input();
    await fireEvent.press(screen.getByTestId('desk-done'));
    await screen.findByTestId('desk-save');
    const file = currentFiles(await deskNow(files))[0]!;
    expect(Object.keys(unzipSync(files.disk.get(`desk/editdesk/${file.path}`)!))).toContain(
      'word/media/image1.jpg',
    );
    expect(await docxXml(files)).not.toContain('年度报告');
    // 原图和剪好的图片都还在桌面的 assets 里。
    expect(file.source!.assets).toHaveLength(2);
  });
});

// 2026-11-09 用户测试：桌上「完成」和「文件」里只有存进 App 自己的文件库，用户到「文件」App 里找不到。
describe('桌上的文件能存到手机（复制进「文件」App 里选的文件夹）', () => {
  it('「完成」里和「文件」页签里都有，每次让用户选文件夹', async () => {
    const { files } = await openOnDesk('table', tableDoc());
    await fireEvent.press(screen.getByTestId('desk-done'));
    await fireEvent.press(await screen.findByTestId('desk-folder'));
    await waitFor(() =>
      expect([...(files.folders.get('MorphOut')?.keys() ?? [])]).toEqual(['明细.xlsx']),
    );
    await fireEvent.press(screen.getByTestId('desk-sheet-backdrop'));
    files.nextFolder = 'Work';
    await fireEvent.press(await deskTool('desk-tool-room-folder'));
    await waitFor(() =>
      expect([...(files.folders.get('Work')?.keys() ?? [])]).toEqual(['明细.xlsx']),
    );
    expect(files.folderPicks).toBe(2);
  });
});

describe('存成用户文件以后还能放回桌上改（D-367）', () => {
  it('保存时中间格式和原图跟着存；存储空间里算在这个文件上，能放回桌上改；删文件一起删', async () => {
    const { files, repo } = await openOnDesk('table', tableDoc());
    await editTo('table-cell-1-0', '存之前改的');
    await fireEvent.press(screen.getByTestId('desk-deselect'));
    await fireEvent.press(await deskTool('desk-tool-room-save'));
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
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('desk-close'));
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    expect(files.disk.has(asset!.path)).toBe(true);

    await files.removeAssetFile(asset!.path);
    expect([...files.disk.keys()].filter((k) => k.startsWith(`assets/${asset!.id}/`))).toEqual([]);
  });

  it('结果页的「保存」、快捷操作的保存步骤也带中间格式和原图（D-400）：存储空间能放回桌上改', async () => {
    const files = new FakeFiles();
    const repo = new MemoryWorkspaceRepo();
    // 转 Word 的结果：页面原图和剪下来的图片各一张。
    files.disk.set('runs/r1/cut.png', new Uint8Array([7, 7]));
    const word = runResult(files, 'doc', wordDoc('runs/r1/cut.png'));
    const [saved] = await saveItems({ files, repo, grantee: 'w1' }, [word], {
      now: () => new Date(1),
      newId: () => 'a1',
    });
    expect(saved!.assetId).toBe('a1');
    const [asset] = await repo.listAssets();
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/a1/')).sort()).toEqual(
      [
        'assets/a1/明细.docx',
        'assets/a1/morph-source-0.jpg',
        'assets/a1/morph-source-1.png',
        'assets/a1/morph-source.json',
      ].sort(),
    );
    // 运行目录里的结果不动（运行页关掉时才删）。
    expect(files.disk.has('runs/r1/明细.json')).toBe(true);
    // 存储空间里算在这个文件上：两张图 + 中间格式。
    expect(await savedSourceBytes(files, asset!)).toBeGreaterThan(4);
    const desk = await placeAssetOnDesk(files, asset!, 2, 'backdesk');
    expect(desk).not.toBeNull();
    const file = currentFiles(desk!)[0]!;
    expect(file.source?.kind).toBe('doc');
    expect(file.source!.assets).toHaveLength(2);
    const doc = parseDocDoc(decodeUtf8(files.disk.get(`desk/backdesk/${file.source!.path}`)!))!;
    expect(doc.pages[0]!.blocks.map((b) => b.kind)).toContain('table');

    // 后面的步骤改过文件（中间格式不再对应它）、普通文件：只存文件。
    const renamed = { ...runResult(files, 'table', tableDoc()), uri: 'runs/r1/明细.xlsx' };
    renamed.tableDoc = { ...renamed.tableDoc!, for: 'runs/r1/别的.xlsx' };
    await saveItems({ files, repo, grantee: 'w1' }, [renamed], {
      now: () => new Date(1),
      newId: () => 'a2',
    });
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/a2/'))).toEqual([
      'assets/a2/明细.xlsx',
    ]);
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
