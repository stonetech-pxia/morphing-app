import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { listDesks } from '../desk/store';
import { holdFormCopies } from '../share/save-as-record';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';
import { deskTool } from '../test-utils/desk-toolbar';
import { renderToolsApp } from '../test-utils/render-app';

// 记录附件的「…」（D-395）：分享这个文件，或放到桌上改；桌上「完成」时每次都问「加成新附件」还是「替换原件」，
// 交回表单，点保存才写进记录。桌上用的是副本，记录里存的文件不动；没保存就离开时新建的文件删掉。
// 三种状态：已有记录（一个、两个附件）、没保存的新记录表单（收件页面复制来的副本）、边界（附件满了）。

const receipts: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'item', name: '项目', type: 'text' },
    { id: 'receipt', name: '收据', type: 'file' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(createDefaultWorkspace(locale), [{ op: 'addData', table: receipts }], {
    registry,
    locale,
  });
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

/** 用户文件：数据库里一条、磁盘上 assets/<id>/<名字> 一份（和真机一样）。 */
async function addAsset(
  repo: MemoryWorkspaceRepo,
  files: FakeFiles,
  id: string,
  name: string,
  mimeType = 'image/jpeg',
  bytes = TINY_JPEG,
) {
  const path = `assets/${id}/${name}`;
  files.disk.set(path, bytes);
  await repo.addAsset({
    id,
    name,
    mimeType,
    size: bytes.length,
    path,
    source: 'picked',
    createdAt: 1,
  });
}

async function setup(receipt: unknown) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  await addAsset(repo, files, 'a1', 'IMG_0001.jpg');
  await addAsset(repo, files, 'a2', '小票.pdf', 'application/pdf', PDF);
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'expenses',
    values: { item: '午饭', receipt },
    createdAt: 1,
    updatedAt: 1,
  });
  await renderToolsApp(repo, files, { seed });
  return { repo, files };
}

async function openRecord() {
  await act(() => router.push('/record/expenses?recordId=r1'));
  await screen.findByTestId('editor-receipt-more-0', {}, { timeout: 4000 });
}

/** 弹窗都记下来、不自动点；press 点最后一个弹窗里名字为 label 的按钮。 */
function captureAlerts() {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const last = () => spy.mock.calls.at(-1)!;
  const buttons = () => ((last()[2] ?? []) as AlertButton[]).map((b) => b.text);
  const press = async (label: string) => {
    const button = ((last()[2] ?? []) as AlertButton[]).find((b) => b.text === label);
    if (!button) throw new Error(`no button ${label} in ${buttons().join(', ')}`);
    await act(async () => button.onPress?.());
  };
  return { spy, last, buttons, press };
}

/** 点「…」→「放到桌上」，在桌上旋转一次（生成新版本），点「完成」等它问怎么放回去。 */
async function editOnDesk(alerts: ReturnType<typeof captureAlerts>, index = 0) {
  await fireEvent.press(screen.getByTestId(`editor-receipt-more-${index}`));
  await alerts.press('放到桌上');
  await fireEvent.press(await deskTool('desk-tool-image.rotate'));
  await fireEvent.press(await screen.findByTestId('prompt-ok'));
  await waitFor(() => expect(screen.getByTestId('desk-undo')).not.toBeDisabled());
  const before = alerts.spy.mock.calls.length;
  await fireEvent.press(screen.getByTestId('desk-done'));
  await waitFor(() => expect(alerts.spy.mock.calls.length).toBe(before + 1));
}

/** 等记录页关掉时的异步清理做完（不在 waitFor 里读文件）。 */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

const assetIds = async (repo: MemoryWorkspaceRepo) =>
  (await repo.listAssets()).map((a) => a.id).sort();

afterEach(() => jest.restoreAllMocks());

describe('附件的「…」', () => {
  it('只有分享和放到桌上；分享的是存着的这个文件', async () => {
    const { files } = await setup(['a2', 'a1']);
    await openRecord();
    const alerts = captureAlerts();
    expect(screen.getByTestId('editor-receipt-more-1').props.accessibilityLabel).toBe(
      '「IMG_0001.jpg」的更多操作',
    );
    await fireEvent.press(screen.getByTestId('editor-receipt-more-1'));
    expect(alerts.last()[0]).toBe('IMG_0001.jpg');
    expect(alerts.buttons()).toEqual(['分享', '放到桌上', '取消']);
    await alerts.press('分享');
    await waitFor(() =>
      expect(files.shareSheets).toEqual([[files.fileUri('assets/a1/IMG_0001.jpg')]]),
    );
    // 点文件本身照旧是预览。
    await fireEvent.press(screen.getByTestId('editor-receipt-file-0'));
    expect(files.previewed).toEqual([
      { uri: files.fileUri('assets/a2/小票.pdf'), mimeType: 'application/pdf' },
    ]);
  });

  it('页面上的快速添加表单没有记录页清理新文件，只能分享', async () => {
    const withForm = (locale: Locale, registry: Registry) => {
      const result = applyOps(
        seed(locale, registry),
        [
          {
            op: 'addContainer',
            page: 'home',
            block: {
              id: 'add',
              look: 'form',
              show: { mode: 'inline' },
              tools: [
                { as: 'submit', label: '记下', do: 'create', table: 'expenses', ask: ['receipt'] },
              ],
            },
          },
        ],
        { registry, locale },
      );
      if (!result.ok) throw new Error(result.error);
      return result.config;
    };
    const files = new FakeFiles();
    await renderToolsApp(new MemoryWorkspaceRepo(), files, { seed: withForm });
    files.nextPick = [files.offer('合同.pdf', PDF)];
    const alerts = captureAlerts();
    await fireEvent.press(await screen.findByTestId('form-add-receipt-add'));
    await alerts.press('从「文件」选');
    await fireEvent.press(await screen.findByTestId('form-add-receipt-more-0'));
    expect(alerts.buttons()).toEqual(['分享', '取消']);
  });
});

describe('附件满了（MAX_ATTACHMENTS）', () => {
  it('说明放不下，只能替换原件', async () => {
    const missing = Array.from({ length: 19 }, (_, i) => `gone${i}`);
    const { repo } = await setup(['a1', ...missing]);
    await openRecord();
    const alerts = captureAlerts();
    await editOnDesk(alerts);
    expect(alerts.last()[1]).toBe('这条记录的附件已经满了，只能替换原件。');
    expect(alerts.buttons()).toEqual(['替换原件', '取消']);
    await alerts.press('替换原件');
    await waitFor(() =>
      expect(screen.getByTestId('editor-receipt-file-0')).not.toHaveTextContent('IMG_0001.jpg'),
    );
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    const saved = (await repo.getRecord('r1'))!.values.receipt as string[];
    expect(saved).toHaveLength(20);
    expect(saved[0]).not.toBe('a1');
    expect(saved.slice(1)).toEqual(missing);
  });
});

describe('放到桌上改，再放回记录', () => {
  it('桌上是副本；加成新附件：表单里多一个，点保存才写进记录，桌面清掉', async () => {
    const { repo, files } = await setup(['a1']);
    await openRecord();
    const alerts = captureAlerts();
    await editOnDesk(alerts);
    // 桌上的是复制进来的，记录里存的文件没动。
    const [desk] = await listDesks(files);
    expect(files.disk.get(`desk/${desk!.id}/v1-0.jpg`)).toEqual(TINY_JPEG);
    expect(files.disk.get('assets/a1/IMG_0001.jpg')).toEqual(TINY_JPEG);
    // 移进桌面的只有运行目录里的结果，没有用户文件。
    expect(files.desk.moved.every((uri) => uri.startsWith('runs/'))).toBe(true);

    expect(alerts.last()[0]).toBe('放回记录');
    expect(alerts.last()[1]).toBe('桌上的文件要怎么放进这条记录？');
    expect(alerts.buttons()).toEqual(['加成新附件', '替换原件', '取消']);
    await alerts.press('加成新附件');
    expect(await screen.findByTestId('editor-receipt-file-1')).toBeTruthy();
    expect(screen.getByTestId('editor-receipt-file-0')).toHaveTextContent('IMG_0001.jpg');
    // 还没保存：记录不变。
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual(['a1']);
    expect(await listDesks(files)).toEqual([]);

    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    const saved = (await repo.getRecord('r1'))!.values.receipt as string[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toBe('a1');
    const fresh = (await repo.getAsset(saved[1]!))!;
    // 桌上的结果是正常的用户文件：assets/<id>/名字，扩展名照旧。
    expect(fresh.path).toBe(`assets/${fresh.id}/${fresh.name}`);
    expect(fresh.name).toMatch(/\.jpg$/);
    expect(files.disk.has(fresh.path)).toBe(true);
    await settle();
    expect(await repo.getAsset(fresh.id)).not.toBeNull();
    expect(files.disk.get('assets/a1/IMG_0001.jpg')).toEqual(TINY_JPEG);
  });

  it('替换原件：放在原来的位置；原件和记录里去掉的附件一样，还在存储空间里', async () => {
    const { repo, files } = await setup(['a2', 'a1']);
    await openRecord();
    const alerts = captureAlerts();
    await editOnDesk(alerts, 1);
    await alerts.press('替换原件');
    await waitFor(() =>
      expect(screen.getByTestId('editor-receipt-file-1')).not.toHaveTextContent('IMG_0001.jpg'),
    );
    expect(screen.getByTestId('editor-receipt-file-0')).toHaveTextContent('小票.pdf');
    expect(screen.queryByTestId('editor-receipt-file-2')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    await settle();
    const saved = (await repo.getRecord('r1'))!.values.receipt as string[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toBe('a2');
    expect(saved[1]).not.toBe('a1');
    expect(await repo.getAsset('a1')).not.toBeNull();
    expect(files.disk.get('assets/a1/IMG_0001.jpg')).toEqual(TINY_JPEG);
  });

  it('取消：记录不变，照常打开「完成」；不保存就离开先问「放弃修改？」，放弃后桌面清掉（D-462）', async () => {
    const { repo, files } = await setup(['a1']);
    await openRecord();
    const alerts = captureAlerts();
    await editOnDesk(alerts);
    await alerts.press('取消');
    expect(await screen.findByTestId('desk-sheet-cancel')).toBeTruthy();
    expect(screen.queryByTestId('desk-leave')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-sheet-cancel'));
    await fireEvent.press(screen.getByTestId('desk-close'));
    expect(alerts.last()[0]).toBe('放弃修改？');
    await alerts.press('放弃');
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await screen.findByTestId('editor-receipt-file-0')).toBeTruthy();
    expect(screen.queryByTestId('editor-receipt-file-1')).toBeNull();
    expect(await assetIds(repo)).toEqual(['a1', 'a2']);
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await listDesks(files)).toEqual([]);
  });

  it('没点完成就离开桌面：表单和记录都不变', async () => {
    const { repo, files } = await setup(['a1']);
    await openRecord();
    const alerts = captureAlerts();
    await fireEvent.press(screen.getByTestId('editor-receipt-more-0'));
    await alerts.press('放到桌上');
    await fireEvent.press(await screen.findByTestId('desk-close'));
    expect(await screen.findByTestId('editor-receipt-file-0')).toBeTruthy();
    expect(screen.queryByTestId('editor-receipt-file-1')).toBeNull();
    expect(await assetIds(repo)).toEqual(['a1', 'a2']);
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual(['a1']);
    expect(files.disk.get('assets/a1/IMG_0001.jpg')).toEqual(TINY_JPEG);
  });

  it('已有的记录：加了以后没保存就离开，新文件删掉，记录和原来的文件不变', async () => {
    const { repo, files } = await setup(['a1']);
    await openRecord();
    const alerts = captureAlerts();
    await editOnDesk(alerts);
    await alerts.press('加成新附件');
    expect(await screen.findByTestId('editor-receipt-file-1')).toBeTruthy();
    expect(await assetIds(repo)).toHaveLength(3);
    await act(() => router.back());
    // 填过、改过没保存：先问「放弃修改？」。
    expect(alerts.last()[0]).toBe('放弃修改？');
    await alerts.press('放弃');
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    await settle();
    expect(await assetIds(repo)).toEqual(['a1', 'a2']);
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/')).sort()).toEqual([
      'assets/a1/IMG_0001.jpg',
      'assets/a2/小票.pdf',
    ]);
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual(['a1']);
  });

  it('没保存的新记录表单：替换收件页面复制来的副本，然后离开，两个文件都删掉', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    await addAsset(repo, files, 'c1', 'IMG_0002.jpg');
    await renderToolsApp(repo, files, { seed });
    await act(() =>
      router.push({
        pathname: '/record/[collectionId]',
        params: {
          collectionId: 'expenses',
          prefill: JSON.stringify({ receipt: ['c1'] }),
          copies: holdFormCopies(['c1']),
        },
      }),
    );
    await screen.findByTestId('editor-receipt-more-0', {}, { timeout: 4000 });
    const alerts = captureAlerts();
    await editOnDesk(alerts);
    await alerts.press('替换原件');
    await waitFor(() =>
      expect(screen.getByTestId('editor-receipt-file-0')).not.toHaveTextContent('IMG_0002.jpg'),
    );
    expect(await assetIds(repo)).toHaveLength(2);
    await act(() => router.back());
    // 填过、改过没保存：先问「放弃修改？」。
    expect(alerts.last()[0]).toBe('放弃修改？');
    await alerts.press('放弃');
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    await settle();
    expect(await repo.listAssets()).toEqual([]);
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/'))).toEqual([]);
    expect(await repo.listRecords('expenses')).toEqual([]);
    expect(await listDesks(files)).toEqual([]);
  });
});
