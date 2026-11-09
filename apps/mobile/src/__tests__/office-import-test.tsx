import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { currentFiles, type Locale } from '@morph/core';
import { writeRowsXlsx } from '@morph/tool-office';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { Alert, type AlertButton } from 'react-native';

import { listDesks } from '../desk/store';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { deskTool } from '../test-utils/desk-toolbar';
import { renderToolsApp } from '../test-utils/render-app';

// 打开、改外来的 docx / xlsx（D-509）：预览页按读出来的中间格式显示（不再是「这里看不了」）；「编辑」复制一份放上桌，
// 就是 Word / 表格编辑器（不走转 PDF）；改过以后第一次保存、分享前说一句哪些格式不留；原件不动。
// 三种状态：没改过就存（存的是原件的副本，不提示）、改过再存、打不开的文件（设了密码）。

afterEach(() => {
  useIncoming.getState().clear();
  jest.restoreAllMocks();
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OFFICE_FIXTURES = join(__dirname, '../../../../packages/tool-office/src/fixtures/office');
/** macOS 的 textutil 从 UTF-8 网页转出来的 docx（£、€、é、中文、粗体、列表）。 */
const LEASE = new Uint8Array(readFileSync(join(OFFICE_FIXTURES, 'lease-textutil.docx')));
/** Pages 存的、设了密码的 docx。 */
const LOCKED = new Uint8Array(readFileSync(join(OFFICE_FIXTURES, 'password-pages.docx')));
/** Word 存的带表格的 docx（mammoth 的测试文件）。 */
const TABLES = new Uint8Array(
  readFileSync(
    join(dirname(require.resolve('mammoth/package.json')), 'test/test-data/tables.docx'),
  ),
);
/** 记录导出的 xlsx（D-427）：以前也只能用系统预览看。 */
const EXPENSES = writeRowsXlsx('Expenses', [
  [
    { kind: 'text', text: 'Item' },
    { kind: 'text', text: 'Amount' },
  ],
  [
    { kind: 'text', text: 'Coffee' },
    { kind: 'number', value: 4.5, format: '0.00', text: '4.50' },
  ],
]);

async function openPreview(name: string, bytes: Uint8Array, mime: string, locale: Locale = 'en') {
  const files = new FakeFiles();
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, files, { locale });
  const picked = files.offer(name, bytes, mime);
  await act(async () => useIncoming.getState().receive([picked], [], 'picker'));
  await act(() => router.push('/share'));
  return { files, repo, picked };
}

async function onlyDesk(files: FakeFiles) {
  const list = await listDesks(files);
  expect(list).toHaveLength(1);
  return list[0]!;
}

/** 编辑页（网页）里改字：页面的脚本把整页交回来（同 desk-edit-test）。 */
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
    input: () => send({ type: 'doc', pages: window.__wordPages() }),
    state: (state: object) => send({ type: 'state', ...state }),
  };
}

/** 弹出的提示：记下标题和内容，点 label 那个按钮。 */
function answerAlert(label: string) {
  const seen: { title: string; message?: string }[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons?: AlertButton[]) => {
    seen.push({ title: String(title), ...(message ? { message: String(message) } : {}) });
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
  return seen;
}

const docxText = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

describe('outside Word files (docx)', () => {
  it('the preview page shows the document itself; Edit puts a copy on the desk in the Word editor', async () => {
    const { files, picked } = await openPreview('Lease.docx', LEASE, DOCX);
    const preview = await screen.findByTestId('word-preview-page');
    const html = preview.props.source.html as string;
    expect(html).toContain('The rent is £1,250 per month');
    expect(html).toContain('Pay the rent');
    expect(html).toContain('中文测试');
    // 只能看。
    expect(html).not.toContain('contenteditable="true"');
    expect(screen.queryByTestId('desk-preview-generic')).toBeNull();

    await fireEvent.press(screen.getByTestId('preview-edit'));
    const editor = await screen.findByTestId('word-editor-page');
    expect(editor.props.source.html).toContain('contenteditable="true"');
    expect(editor.props.source.html).toContain('Café deposit: €300');
    const desk = await onlyDesk(files);
    const [file] = currentFiles(desk);
    expect(file!.source).toMatchObject({ kind: 'doc', imported: 'original' });
    // 原件只复制：桌上是一样的字节，原件还在、没变。
    expect(files.disk.get(`desk/${desk.id}/${file!.path}`)).toEqual(LEASE);
    expect(files.disk.get(picked.uri)).toEqual(LEASE);
    expect(files.desk.moved).toEqual([]);
    // 没有转成 PDF。
    expect(files.documents.converted).toEqual([]);
  });

  it('saving without editing saves the original copy: no notice, nothing stored next to it', async () => {
    const { files, repo } = await openPreview('Lease.docx', LEASE, DOCX);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await screen.findByTestId('word-editor-page');
    const alerts = answerAlert('Continue');
    await fireEvent.press(await deskTool('desk-tool-room-save'));
    expect(await screen.findByTestId('desk-saved')).toBeTruthy();
    expect(alerts).toEqual([]);
    const [asset] = await repo.listAssets();
    expect(files.disk.get(asset!.path)).toEqual(LEASE);
    expect([...files.disk.keys()].filter((k) => k.startsWith(`assets/${asset!.id}/`))).toEqual([
      asset!.path,
    ]);
  });

  it('after editing, the first save says once which formatting is not kept; Cancel saves nothing', async () => {
    const { files, repo, picked } = await openPreview('Report.docx', TABLES, DOCX);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await screen.findByTestId('word-editor-page');
    const page = wordPage();
    await page.state({ focus: true });
    page.q('[data-ref="0-0"]').textContent = 'Above, edited on the phone';
    page.q('[data-ref="0-1"] td[data-i="3"]').textContent = 'Bottom right, edited';
    await page.input();
    await page.state({ focus: false });

    // 第一次点「取消」：什么都不存，下次还问。
    let alerts = answerAlert('Cancel');
    await fireEvent.press(await deskTool('desk-tool-room-save'));
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(alerts[0]!.title).toBe('Some formatting won’t be kept');
    expect(alerts[0]!.message).toMatch(/new Word file.*Headers and footers.*not changed/s);
    expect(await repo.listAssets()).toEqual([]);

    jest.restoreAllMocks();
    alerts = answerAlert('Continue');
    await fireEvent.press(await deskTool('desk-tool-room-save'));
    expect(await screen.findByTestId('desk-saved')).toBeTruthy();
    expect(alerts).toHaveLength(1);
    const [asset] = await repo.listAssets();
    const xml = docxText(files.disk.get(asset!.path)!);
    expect(xml).toContain('Above, edited on the phone');
    expect(xml).toContain('Bottom right, edited');
    expect(xml).toContain('Below');
    // 外来文件读出来的中间格式不跟着存（下次打开再读一遍）。
    expect([...files.disk.keys()].filter((k) => k.startsWith(`assets/${asset!.id}/`))).toEqual([
      asset!.path,
    ]);
    // 原件没动。
    expect(files.disk.get(picked.uri)).toEqual(TABLES);

    // 只说一次：接着分享不再问。
    await fireEvent.press(await deskTool('desk-tool-room-share'));
    await waitFor(() => expect(files.shared).toHaveLength(1));
    expect(alerts).toHaveLength(1);
  });

  it('a password-protected file says it cannot be opened, also when tapping Edit (French)', async () => {
    const { files } = await openPreview('Contrat.docx', LOCKED, DOCX, 'fr');
    expect(await screen.findByTestId('desk-preview-generic')).toHaveTextContent(
      /protégé par un mot de passe/,
    );
    await fireEvent.press(screen.getByTestId('preview-edit'));
    expect(await screen.findByTestId('share-preview-error')).toHaveTextContent(
      'Ce fichier est protégé par un mot de passe : Tinkrum ne peut pas l’ouvrir. Vous pouvez l’ouvrir dans l’aperçu du système.',
    );
    expect(await listDesks(files)).toEqual([]);
  });
});

describe('outside Excel files (xlsx)', () => {
  it('the preview shows the sheet; Edit opens the table editor; the edited number is saved after the notice', async () => {
    const { files, repo, picked } = await openPreview('Expenses.xlsx', EXPENSES, XLSX, 'zh');
    expect(await screen.findByTestId('table-preview-sheet')).toBeTruthy();
    expect(screen.getByTestId('table-cell-1-0')).toHaveTextContent('Coffee');
    expect(screen.getByTestId('table-cell-1-1')).toHaveTextContent('4.50');

    await fireEvent.press(screen.getByTestId('preview-edit'));
    expect(await screen.findByTestId('desk-editor')).toBeTruthy();
    // 没有表外的文字：识别范围的两个按钮没有用，不显示。
    expect(screen.queryByTestId('table-scope-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('table-cell-1-1'));
    // 外来的表没有原图：选中的格子下面不说「原图」「这一格是在这里加的」。
    expect(screen.getByTestId('desk-edit-bar')).not.toHaveTextContent(/原图/);
    await fireEvent.press(screen.getByTestId('table-cell-1-1'));
    await fireEvent.changeText(screen.getByTestId('desk-edit-input'), '5.25');
    await fireEvent.press(screen.getByTestId('desk-edit-ok'));
    await fireEvent.press(screen.getByTestId('desk-deselect'));

    const alerts = answerAlert('继续');
    await fireEvent.press(screen.getByTestId('desk-done'));
    await fireEvent.press(await screen.findByTestId('desk-save'));
    await waitFor(async () => expect(await repo.listAssets()).toHaveLength(1));
    expect(alerts).toEqual([
      {
        title: '有些格式不会保留',
        message:
          'Tinkrum 会把改好的存成一份新的 Excel 文件：数值、合并的格子和列宽都在；公式只留下最后算出的结果，颜色、边框和图表不会保留。原来的文件不会改动。',
      },
    ]);
    const [asset] = await repo.listAssets();
    const sheet = strFromU8(unzipSync(files.disk.get(asset!.path)!)['xl/worksheets/sheet1.xml']!);
    expect(sheet).toMatch(/<c r="B2" s="\d+"><v>5.25<\/v><\/c>/);
    expect(files.disk.get(picked.uri)).toEqual(EXPENSES);
  });
});
