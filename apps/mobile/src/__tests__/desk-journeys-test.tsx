import {
  createStarterWorkspace,
  currentFiles,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import type { TableDoc } from '@morph/tool-office';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { commitRun, listDesks, loadDesk, placeOnDesk } from '../desk/store';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';
import { allDeskTools, deskTool } from '../test-utils/desk-toolbar';
import { renderToolsApp } from '../test-utils/render-app';

// 文件房间 R1（file-room DESIGN §9，D-357–D-361）：收件页面「放到桌上」做第一项；房间里预览、工具栏、
// 用一个工具生成新版本、撤销重做、快捷操作作用到桌上、「完成」里清空桌面；布局来自配置。
// 三种状态：新用户（空白工作空间、没有桌面）、有数据（转 Excel 的结果在桌上）、边界（很多份、没有工具的文件、桌面已清空）。

afterEach(() => {
  useIncoming.getState().clear();
  jest.restoreAllMocks();
});

async function openShare(files: FakeFiles, names: string[], mime = 'image/jpeg') {
  const picked = names.map((n) => files.offer(n, TINY_JPEG, mime));
  await act(async () => useIncoming.getState().receive(picked, [], 'picker'));
  await act(() => router.push('/share'));
  return picked;
}

/** 几份文件一起放到桌上（收件页面不再有「放到桌上」，D-457；这里直接放，再打开桌面）。 */
async function openDeskFor(files: FakeFiles, names: string[], mime = 'image/jpeg') {
  const picked = names.map((n) => files.offer(n, TINY_JPEG, mime));
  const desk = await placeOnDesk(files, picked, Date.now());
  await act(() => router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } }));
  return picked;
}

/** 桌面目录里唯一的那个桌面（先等界面更新完再读，不在 waitFor 里读文件：会和别的 act 重叠）。 */
async function onlyDesk(files: FakeFiles) {
  const list = await listDesks(files);
  expect(list).toHaveLength(1);
  return list[0]!;
}

describe('预览页 → 编辑（放到桌上）', () => {
  it('新用户：预览页底下有「编辑」；点了复制一份进房间，原件不动；返回回到预览页', async () => {
    const { files } = await renderToolsApp();
    const [photo] = await openShare(files, ['IMG_1.jpg']);
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preview-edit'));
    expect(await screen.findByTestId('desk-screen')).toBeTruthy();
    expect(screen.getByTestId('desk-preview-image')).toBeTruthy();
    const placed = await onlyDesk(files);
    expect(currentFiles(placed)[0]!.path).toBe('v1-0.jpg');
    // 原件是选择器的副本：桌上用的是自己的副本，没有移动它。
    expect(files.desk.moved).toEqual([]);
    expect(files.disk.get(`desk/${placed.id}/v1-0.jpg`)).toEqual(TINY_JPEG);
    // 预览页还在底下（桌面是 push 上去的）：收到的这一批不释放；返回回到预览页，文件还在。
    expect(files.disk.has(photo!.uri)).toBe(true);
    await act(() => router.back());
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(files.disk.has(photo!.uri)).toBe(true);
    // 桌面不留着（D-462）：没改过，离开就清掉。
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await listDesks(files)).toEqual([]);
  });
});

describe('房间里的工具', () => {
  it('默认工具栏按文件种类分组；有参数的工具先弹出面板，点「应用」生成新版本，能撤销、重做', async () => {
    const { files } = await renderToolsApp();
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await screen.findByTestId('desk-toolbar');
    // 分组名是工具栏上面的小标签，点哪个标签就滑到哪一组。
    const tabs = within(screen.getByTestId('desk-tabs'));
    for (const name of ['编辑', '处理', '转换', '快捷操作'])
      expect(tabs.getByText(name)).toBeTruthy();
    expect(screen.getByTestId('desk-tab-0')).toBeSelected();
    // 下面只排选中的那一组（2026-11-06：排成一长条时后面几组看起来是同一排，点回第一组也不跳）。
    const firstOf = () =>
      String(
        within(screen.getByTestId('desk-toolbar')).getAllByTestId(/^desk-tool-/)[0]!.props.testID,
      );
    const editFirst = firstOf();
    await fireEvent.press(screen.getByTestId('desk-tab-2'));
    expect(screen.getByTestId('desk-tab-2')).toBeSelected();
    expect(screen.getByTestId('desk-tab-0')).not.toBeSelected();
    expect(screen.queryByTestId(editFirst)).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-tab-0'));
    expect(screen.getByTestId('desk-tab-0')).toBeSelected();
    expect(firstOf()).toBe(editFirst);
    // 图片没有 PDF 的工具。
    expect(screen.queryByTestId('desk-tool-pdf.compress')).toBeNull();
    expect(screen.getByTestId('desk-undo')).toBeDisabled();

    await fireEvent.press(await deskTool('desk-tool-image.rotate'));
    expect(await screen.findByText('应用')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    await waitFor(() => expect(screen.getByTestId('desk-undo')).not.toBeDisabled());
    let desk = await onlyDesk(files);
    expect(desk.versions.map((v) => v.by)).toEqual([
      { kind: 'place' },
      { kind: 'action', action: 'image.rotate' },
    ]);
    // 运行目录里的结果移进了桌面；运行目录清掉了。
    expect([...files.disk.keys()].filter((k) => k.startsWith('runs/'))).toEqual([]);

    await fireEvent.press(screen.getByTestId('desk-undo'));
    await waitFor(() => expect(screen.getByTestId('desk-redo')).not.toBeDisabled());
    expect((await loadDesk(files, desk.id))?.current).toBe(0);
    await fireEvent.press(screen.getByTestId('desk-redo'));
    await waitFor(() => expect(screen.getByTestId('desk-redo')).toBeDisabled());
    desk = (await loadDesk(files, desk.id))!;
    expect(desk.current).toBe(1);
    expect(desk.versions).toHaveLength(2);
  });

  it('几张照片：工具作用到全部；转 PDF 把几张合成一份（多合一），撤销回到几张照片', async () => {
    const { files } = await renderToolsApp();
    await openDeskFor(files, ['a.jpg', 'b.jpg', 'c.jpg']);
    expect(await screen.findByTestId('desk-targets')).toHaveTextContent('工具作用到这 3 份文件');
    expect(screen.getByTestId('desk-strip')).toBeTruthy();
    await fireEvent.press(await deskTool('desk-tool-pdf.fromImages'));
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    await waitFor(() => expect(screen.getByTestId('desk-preview-pdf')).toBeTruthy());
    const desk = await onlyDesk(files);
    expect(currentFiles(desk).map((f) => f.ext)).toEqual(['pdf']);
    // 测试里没有扩展包：PDF 的翻页预览说明要下载，另外能用系统预览看。
    expect(screen.getByTestId('desk-pdf-pack')).toBeTruthy();
    expect(screen.queryByTestId('desk-strip')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-undo'));
    await waitFor(() => expect(screen.getByTestId('desk-strip')).toBeTruthy());
    expect(screen.getByTestId('desk-preview-image')).toBeTruthy();
  });

  it('快捷操作按钮把整个快捷操作作用到桌上的文件（不再选文件），生成一个版本', async () => {
    const rotateTwice: Workflow = {
      kind: 'quickAction',
      id: 'rotate-twice',
      name: '转两次',
      steps: [
        { id: 's1', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } },
        { id: 's2', action: 'image.rotate', params: { angle: 90, flip: 'none' } },
        { id: 's3', action: 'image.rotate', params: { angle: 90, flip: 'none' } },
      ],
    };
    const seed = (locale: Locale, registry: Registry) => {
      const base = createStarterWorkspace(locale, registry);
      return { ...base, tools: [...base.tools, rotateTwice] };
    };
    const { files } = await renderToolsApp(undefined, undefined, { seed });
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    // 自己的快捷操作排在「快捷操作」组的第一个。
    await screen.findByTestId('desk-toolbar');
    const quick = (await allDeskTools()).filter((id) => !id.includes('.'));
    expect(quick[0]).toBe('desk-tool-rotate-twice');
    await fireEvent.press(await deskTool(quick[0]!));
    await waitFor(() => expect(screen.getByTestId('desk-undo')).not.toBeDisabled());
    const desk = await onlyDesk(files);
    // 两步合成一个版本，撤销整串一起撤。
    expect(desk.versions.map((v) => v.by)).toEqual([
      { kind: 'place' },
      { kind: 'workflow', workflowId: 'rotate-twice' },
    ]);
  });

  it('识别类（转 Excel）不问语言、不弹面板，直接跑；跑失败时显示原因，桌上不变（D-278、D-363）', async () => {
    const { files } = await renderToolsApp();
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    // 测试里没有系统文字识别：转 Excel 报「这台手机不能本机识别」。
    await fireEvent.press(await deskTool('desk-tool-ocr.toExcel'));
    expect(await screen.findByTestId('desk-error')).toBeTruthy();
    expect(screen.queryByTestId('prompt-ok')).toBeNull();
    const desk = await onlyDesk(files);
    expect(desk.versions).toHaveLength(1);
  });
});

describe('有数据：转 Excel 的结果在桌上', () => {
  it('xlsx 用表格视图显示（R2 起能改，见 desk-edit-test），工具栏有转 PDF 和「文件」一组', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    files.disk.set('picker://photo.jpg', TINY_JPEG);
    let desk = await placeOnDesk(
      files,
      [
        {
          uri: 'picker://photo.jpg',
          name: 'photo.jpg',
          size: TINY_JPEG.length,
          mimeType: 'image/jpeg',
        },
      ],
      Date.now(),
      'sheetdesk',
    );
    const doc: TableDoc = {
      version: 3,
      scope: 'all',
      pages: [
        {
          name: 'Sheet1',
          source: 'runs/r1/page.jpg',
          width: 100,
          height: 100,
          lineHeight: 10,
          colWidths: [50, 50],
          blocks: [
            {
              kind: 'table',
              rows: 1,
              col: 0,
              cols: 2,
              box: { x: 0, y: 0, width: 100, height: 20 },
              cells: [
                { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '品名' },
                { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: '12' },
              ],
            },
          ],
        },
      ],
    };
    files.disk.set('runs/r1/page.jpg', TINY_JPEG);
    files.disk.set('runs/r1/表格.xlsx', new Uint8Array([1, 2, 3]));
    files.disk.set('runs/r1/表格.json', new TextEncoder().encode(JSON.stringify(doc)));
    ({ desk } = await commitRun(
      files,
      desk,
      ['f1-0'],
      {
        type: 'files',
        items: [
          {
            uri: 'runs/r1/表格.xlsx',
            name: '表格',
            ext: 'xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 3,
            tableDoc: { uri: 'runs/r1/表格.json', for: 'runs/r1/表格.xlsx' },
          },
        ],
      },
      { kind: 'action', action: 'ocr.toExcel' },
      Date.now(),
    ));
    await renderToolsApp(repo, files);
    await act(() => router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } }));
    expect(await screen.findByTestId('table-sheet')).toBeTruthy();
    expect(screen.getByText('品名')).toBeTruthy();
    expect(screen.getByTestId('desk-editor')).toBeTruthy();
    // 工具栏：转 PDF，加上文件这一组（分享、保存、系统预览），不是空的。
    screen.getByTestId('desk-toolbar');
    expect(await allDeskTools()).toEqual([
      'desk-tool-pdf.fromDocument',
      'desk-tool-room-share',
      'desk-tool-room-save',
      'desk-tool-room-folder',
      'desk-tool-room-preview',
    ]);
    // 撤销回到照片。
    await fireEvent.press(screen.getByTestId('desk-undo'));
    expect(await screen.findByTestId('desk-preview-image')).toBeTruthy();
  });
});

describe('Word 文档在桌上', () => {
  it('名字里没有扩展名的 docx（Android 别的 App 分享过来）：认得出是 Word，能转 PDF、能分享', async () => {
    const { files } = await renderToolsApp();
    await openShare(
      files,
      ['合同'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    const toolbar = await screen.findByTestId('desk-toolbar');
    expect(screen.queryByTestId('desk-no-tools')).toBeNull();
    expect(within(toolbar).getByTestId('desk-tool-pdf.fromDocument')).not.toBeDisabled();
    expect(await deskTool('desk-tool-room-share')).toBeTruthy();
    const placed = await onlyDesk(files);
    expect(currentFiles(placed)[0]!.ext).toBe('docx');
    // 转 PDF 不问纸张，直接跑。
    await fireEvent.press(await deskTool('desk-tool-pdf.fromDocument'));
    await waitFor(() => expect(screen.getByTestId('desk-preview-pdf')).toBeTruthy());
    expect(files.documents.converted.map((c) => c.ext)).toEqual(['docx']);
  });

  it('工具栏里的「分享」把桌上的文件交给系统分享', async () => {
    const { files } = await renderToolsApp();
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await fireEvent.press(await deskTool('desk-tool-room-share'));
    await waitFor(() => expect(files.shared).toHaveLength(1));
  });
});

describe('边界', () => {
  it('桌面已经清空：说明一句，能关掉', async () => {
    await renderToolsApp();
    await act(() => router.push({ pathname: '/desk/[deskId]', params: { deskId: 'nope' } }));
    expect(await screen.findByTestId('desk-gone')).toHaveTextContent(/已经清空/);
  });

  it('认不出的文件：没有工具，能用系统预览看；「完成」里没有清空桌面，离开就清掉，原件不动（D-462）', async () => {
    const { files } = await renderToolsApp();
    const [zip] = await openShare(files, ['notes.zip'], 'application/zip');
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    expect(await screen.findByTestId('desk-no-tools')).toBeTruthy();
    expect(screen.getByTestId('desk-preview-generic')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('desk-done'));
    expect(screen.queryByTestId('desk-clear')).toBeNull();
    await fireEvent.press(await screen.findByTestId('desk-sheet-cancel'));
    await fireEvent.press(screen.getByTestId('desk-close'));
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await listDesks(files)).toEqual([]);
    expect(zip).toBeTruthy();
  });
});

describe('布局配置（D-358）', () => {
  const seed = (locale: Locale, registry: Registry) => {
    const base = createStarterWorkspace(locale, registry);
    return {
      ...base,
      containers: {
        ...base.containers,
        desk: {
          toolbar: 'top' as const,
          above: [{ id: 'tip', look: 'notice' as const, show: { text: '先旋转再转 PDF' } }],
          tools: {
            image: [
              { title: '常用', items: [{ action: 'image.rotate' }, { action: 'pdf.fromImages' }] },
            ],
          },
        },
      },
    };
  };

  it('配置里写的工具栏、位置和预览上方的说明都用上；没写的种类照旧用默认', async () => {
    const { files } = await renderToolsApp(undefined, undefined, { seed });
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await screen.findByTestId('desk-toolbar');
    expect(within(screen.getByTestId('desk-tabs')).getByText('常用')).toBeTruthy();
    expect(await allDeskTools()).toEqual([
      'desk-tool-image.rotate',
      'desk-tool-pdf.fromImages',
      // 「文件」这一组是房间自己的，不在配置里，总在最后。
      'desk-tool-room-share',
      'desk-tool-room-save',
      'desk-tool-room-folder',
      'desk-tool-room-preview',
    ]);
    expect(screen.getByTestId('desk-above')).toHaveTextContent(/先旋转再转 PDF/);
    // 工具栏在预览上面。
    const order = screen.queryAllByTestId(/^(desk-toolbar|desk-preview-image)$/);
    expect(order.map((n) => n.props.testID)).toEqual(['desk-toolbar', 'desk-preview-image']);
  });
});

describe('存储空间里的桌面', () => {
  it('有桌面时列出来，7 天没动的提示可以清掉，点「打开」回到房间', async () => {
    const files = new FakeFiles();
    files.disk.set('picker://a.jpg', TINY_JPEG);
    const picked = [
      { uri: 'picker://a.jpg', name: 'a.jpg', size: TINY_JPEG.length, mimeType: 'image/jpeg' },
    ];
    const old = await placeOnDesk(files, picked, Date.now() - 8 * 24 * 60 * 60 * 1000, 'olddesk');
    const fresh = await placeOnDesk(files, picked, Date.now(), 'freshdesk');
    await renderToolsApp(new MemoryWorkspaceRepo(), files);
    await act(() => router.push('/storage'));
    expect(await screen.findByTestId('desk-list')).toBeTruthy();
    expect(screen.getByTestId(`desk-stale-${old.id}`)).toHaveTextContent('7 天没动了，可以清掉');
    expect(screen.queryByTestId(`desk-stale-${fresh.id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`desk-open-${old.id}`));
    expect(await screen.findByTestId('desk-screen')).toBeTruthy();
  });

  it('新用户：存储空间里没有桌面这一块', async () => {
    await renderToolsApp();
    await act(() => router.push('/storage'));
    expect(await screen.findByTestId('storage-screen')).toBeTruthy();
    expect(screen.queryByTestId('desk-list')).toBeNull();
  });
});

describe('三种语言', () => {
  it.each([
    ['fr', ['Modifier', 'Ajuster', 'Convertir', 'Actions rapides']],
    ['en', ['Edit', 'Adjust', 'Convert', 'Quick actions']],
  ] as const)('%s：工具栏的组名', async (locale, groups) => {
    const { files } = await renderToolsApp(undefined, undefined, { locale });
    await openDeskFor(files, ['IMG_1.jpg', 'IMG_2.jpg']);
    await screen.findByTestId('desk-toolbar');
    for (const g of groups)
      expect(within(screen.getByTestId('desk-tabs')).getByText(g)).toBeTruthy();
    expect(screen.getByTestId('desk-targets')).toHaveTextContent(
      locale === 'fr' ? 'Les outils s’appliquent à ces 2 fichiers' : 'Tools apply to these 2 files',
    );
  });
});
