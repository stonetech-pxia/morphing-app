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
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import type { AssetRecord } from '../storage/types';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 「设置 → 存储空间」（D-264）：列出 Morph 保存的全部文件、用在哪里，能删单个文件、一键清理没在用的。

const receipts: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'item', name: '项目', type: 'text' },
    { id: 'receipt', name: '收据', type: 'file' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addCollection', collection: receipts },
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'lease',
          type: 'fileSlot',
          props: { title: '租房合同', assetId: 'slot01' },
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const MB = 1024 * 1024;

const asset = (
  id: string,
  name: string,
  size: number,
  mimeType = 'image/jpeg',
  source: AssetRecord['source'] = 'picked',
): AssetRecord => ({
  id,
  name,
  mimeType,
  size,
  path: `assets/${id}/${name}`,
  source,
  createdAt: 1,
});

async function withFiles() {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const all = [
    asset('lunch1', '午饭发票.jpg', 2 * MB),
    asset('lunch2', '午饭小票.pdf', 300 * 1024, 'application/pdf'),
    asset('taxi01', '打车.jpg', MB),
    asset('slot01', '合同.pdf', 5 * MB, 'application/pdf'),
    asset('orphan', '换掉的照片.jpg', 3 * MB),
    asset('result', '压缩后.mp4', 30 * MB, 'video/mp4', 'generated'),
  ];
  for (const a of all) {
    await repo.addAsset(a);
    files.disk.set(a.path, new Uint8Array([1]));
  }
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'expenses',
    values: { item: '午饭', receipt: ['lunch1', 'lunch2'] },
    createdAt: 1,
    updatedAt: 1,
  });
  await repo.insertRecord({
    id: 'r2',
    collectionId: 'expenses',
    values: { item: '打车', receipt: 'taxi01' },
    createdAt: 2,
    updatedAt: 2,
  });
  // 删掉的记录在「最近删除」里，它的文件还算在用。
  await repo.deleteRecord('r2', Date.now());
  return { repo, files };
}

async function openStorage(repo: MemoryWorkspaceRepo, files: FakeFiles, locale: Locale = 'zh') {
  const app = await renderToolsApp(repo, files, { seed, locale });
  await act(() => router.push('/storage'));
  await screen.findByTestId('storage-screen', {}, { timeout: 4000 });
  return app;
}

/** 系统弹窗：依次点名字为 labels 的按钮（每个弹窗一个）。 */
function pressInAlerts(...labels: string[]) {
  const spy = jest.spyOn(Alert, 'alert');
  for (const label of labels)
    spy.mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((b) => b.text === label)?.onPress?.();
    });
  return spy;
}

afterEach(() => jest.restoreAllMocks());

describe('storage page (D-264)', () => {
  it('opens from Settings', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed });
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-storage'));
    expect(await screen.findByTestId('storage-screen', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('a new user has no files and nothing to clean up', async () => {
    await openStorage(new MemoryWorkspaceRepo(), new FakeFiles());
    expect(await screen.findByTestId('storage-empty')).toBeTruthy();
    expect(screen.queryByTestId('storage-cleanup')).toBeNull();
  });

  it('lists every file with its size, type and where it is used', async () => {
    const { repo, files } = await withFiles();
    await openStorage(repo, files);
    expect(await screen.findByTestId('storage-total')).toHaveTextContent('6 个文件 · 41.3 MB');
    expect(screen.getByTestId('storage-use-lunch1-0')).toHaveTextContent('账目 · 午饭');
    expect(screen.getByTestId('storage-use-lunch2-0')).toHaveTextContent('账目 · 午饭');
    expect(screen.getByTestId('storage-use-taxi01-0')).toHaveTextContent('账目 · 打车（最近删除）');
    expect(screen.getByTestId('storage-use-slot01-0')).toHaveTextContent(/^首页 · /);
    expect(screen.getByTestId('storage-use-orphan-0')).toHaveTextContent('现在没有地方在用');
    expect(screen.getByTestId('storage-use-result-0')).toHaveTextContent('快捷操作存的结果');
    expect(screen.getByTestId('storage-thumb-lunch1')).toBeTruthy();
    expect(screen.queryByTestId('storage-thumb-lunch2')).toBeNull();
    expect(screen.getByText('PDF · 300 KB')).toBeTruthy();
  });

  it('cleans up only what nothing uses, keeping quick action results', async () => {
    const { repo, files } = await withFiles();
    await openStorage(repo, files);
    const alerts = pressInAlerts('删除');
    await fireEvent.press(await screen.findByTestId('storage-cleanup'));
    expect(alerts.mock.calls[0]![0]).toBe('删除 1 个没有在用的文件？');
    expect(alerts.mock.calls[0]![1]).toMatch(/共 3\.0 MB/);
    await waitFor(() => expect(screen.queryByTestId('storage-file-orphan')).toBeNull());
    expect((await repo.listAssets()).map((a) => a.id).sort()).toEqual(
      ['lunch1', 'lunch2', 'result', 'slot01', 'taxi01'].sort(),
    );
    expect(files.disk.has('assets/orphan/换掉的照片.jpg')).toBe(false);
    expect(files.disk.has('assets/result/压缩后.mp4')).toBe(true);
    // 没有可清理的了。
    expect(screen.queryByTestId('storage-cleanup')).toBeNull();
  });

  it('a file only older versions use counts as unused, and says so', async () => {
    const { repo, files } = await withFiles();
    const { store } = await openStorage(repo, files);
    // 文件入口换成另一个文件：旧文件只在旧版本里用到。
    await act(async () => {
      const result = await store.getState().proposeOps(
        [
          {
            op: 'setComponentProps',
            pageId: 'home',
            componentId: 'lease',
            props: { assetId: 'orphan' },
          },
        ],
        '换文件',
      );
      if (result.kind === 'preview') await store.getState().confirm();
    });
    expect(await screen.findByText('只在旧版本里用到')).toBeTruthy();
    expect(screen.getByTestId('storage-use-orphan-0')).toHaveTextContent(/^首页 · /);
    expect(screen.getByTestId('storage-cleanup')).toHaveTextContent(
      /清理 1 个没有在用的文件（5\.0 MB）/,
    );
  });

  it('deleting a used file warns and the entry then says the file is gone', async () => {
    const { repo, files } = await withFiles();
    await openStorage(repo, files);
    const alerts = pressInAlerts('删除', '删除');
    await fireEvent.press(await screen.findByTestId('storage-file-lunch1'));
    expect(alerts.mock.calls[1]![0]).toBe('删除「午饭发票.jpg」？');
    expect(alerts.mock.calls[1]![1]).toMatch(/有 1 个地方用到它.*恢复旧版本也找不回/);
    await waitFor(() => expect(screen.queryByTestId('storage-file-lunch1')).toBeNull());
    expect(await repo.getAsset('lunch1')).toBeNull();
    expect(files.disk.has('assets/lunch1/午饭发票.jpg')).toBe(false);

    await act(() => router.push('/record/expenses?recordId=r1'));
    expect(await screen.findByText('文件已经删掉了')).toBeTruthy();
    expect(screen.getByText('午饭小票.pdf')).toBeTruthy();
  });

  it('previews a picture full screen and a PDF in the system preview', async () => {
    const { repo, files } = await withFiles();
    await openStorage(repo, files);
    pressInAlerts('预览');
    await fireEvent.press(await screen.findByTestId('storage-file-lunch1'));
    expect(await screen.findByTestId('share-viewer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-viewer-close'));
    pressInAlerts('预览');
    await fireEvent.press(screen.getByTestId('storage-file-slot01'));
    await waitFor(() => expect(files.previewed).toHaveLength(1));
  });

  it('French: units and singular counts', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.addAsset(asset('one111', 'photo.jpg', 2 * MB));
    await openStorage(repo, new FakeFiles(), 'fr');
    expect(await screen.findByTestId('storage-total')).toHaveTextContent('1 fichier · 2,0 Mo');
    expect(screen.getByTestId('storage-cleanup')).toHaveTextContent(
      'Nettoyer 1 fichier inutilisé (2,0 Mo)',
    );
  });
});
