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
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 附件字段放多个文件（D-263）：记录里是一组文件 ID；旧数据里的单个 ID 当成一组。

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
    [{ op: 'addCollection', collection: receipts }],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const asset = (id: string, name: string, mimeType = 'image/jpeg') => ({
  id,
  name,
  mimeType,
  size: 1000,
  path: `assets/${id}/${name}`,
  source: 'picked' as const,
  createdAt: 1,
});

async function withRecord(receipt: unknown) {
  const repo = new MemoryWorkspaceRepo();
  await repo.addAsset(asset('a1', '发票.jpg'));
  await repo.addAsset(asset('a2', '小票.pdf', 'application/pdf'));
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'expenses',
    values: { item: '午饭', receipt },
    createdAt: 1,
    updatedAt: 1,
  });
  return repo;
}

async function openEditor(repo: MemoryWorkspaceRepo, files = new FakeFiles()) {
  const app = await renderToolsApp(repo, files, { seed });
  await act(() => router.push('/record/expenses?recordId=r1'));
  return app;
}

/** 系统弹窗：依次点名字为 labels 的按钮（每个弹窗一个），返回 spy 看弹了什么。 */
function pressInAlerts(...labels: string[]) {
  const spy = jest.spyOn(Alert, 'alert');
  for (const label of labels)
    spy.mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((b) => b.text === label)?.onPress?.();
    });
  return spy;
}

afterEach(() => jest.restoreAllMocks());

/** 这次新复制进来的文件名（withRecord 先放了 a1、a2）。 */
const added = async (repo: MemoryWorkspaceRepo) =>
  (await repo.listAssets()).map((a) => a.name).filter((n) => n !== '发票.jpg' && n !== '小票.pdf');

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

describe('attachment fields in the record editor', () => {
  it('list every file, in order, and remove one', async () => {
    const repo = await withRecord(['a2', 'a1']);
    await openEditor(repo);
    expect(await screen.findByText('小票.pdf')).toBeTruthy();
    expect(screen.getByTestId('editor-receipt-file-0')).toHaveTextContent('小票.pdf');
    expect(screen.getByTestId('editor-receipt-file-1')).toHaveTextContent('发票.jpg');
    await fireEvent.press(screen.getByTestId('editor-receipt-remove-0'));
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual(['a1']);
    // 文件本身还在（用户文件不随记录删除）。
    expect(await repo.getAsset('a2')).not.toBeNull();
  });

  it('read an old single id as one file and save it as a list', async () => {
    const repo = await withRecord('a1');
    await openEditor(repo);
    expect(await screen.findByText('发票.jpg')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('editor-item'), '晚饭');
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect((await repo.getRecord('r1'))!.values).toEqual({ item: '晚饭', receipt: ['a1'] });
  });

  it('say when a file is no longer on this device', async () => {
    const repo = await withRecord(['gone', 'a1']);
    await openEditor(repo);
    expect(await screen.findByText('文件已经删掉了')).toBeTruthy();
    expect(screen.getByText('发票.jpg')).toBeTruthy();
  });

  it('a new user sees no attachment', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
    await act(() => router.push('/record/expenses'));
    expect(await screen.findByText('没有附件')).toBeTruthy();
  });
});

describe('adding attachments (D-263)', () => {
  it('takes a photo, picks from Photos and Files, reorders, and keeps copies of the files', async () => {
    const repo = await withRecord([]);
    const files = new FakeFiles();
    await openEditor(repo, files);
    await screen.findByTestId('editor-receipt-add');

    files.camera = [files.offerImage('IMG_CAM.jpg', 3000, 4000)];
    pressInAlerts('拍照');
    await fireEvent.press(screen.getByTestId('editor-receipt-add'));
    expect(await screen.findByText('IMG_CAM.jpg')).toBeTruthy();

    files.nextMedia = [files.offerImage('IMG_1.HEIC', 3000, 4000, 'image/heic')];
    pressInAlerts('从相册选');
    await fireEvent.press(screen.getByTestId('editor-receipt-add'));
    expect(await screen.findByText('IMG_1.HEIC')).toBeTruthy();

    files.nextPick = [
      files.offer('合同.pdf', pdf),
      files.offer('报价.docx', pdf, 'application/octet-stream'),
    ];
    pressInAlerts('从「文件」选');
    await fireEvent.press(screen.getByTestId('editor-receipt-add'));
    expect(await screen.findByText('报价.docx')).toBeTruthy();

    // 最后一个挪到最前面。
    await fireEvent.press(screen.getByTestId('editor-receipt-up-3'));
    await fireEvent.press(screen.getByTestId('editor-receipt-up-2'));
    await fireEvent.press(screen.getByTestId('editor-receipt-up-1'));
    expect(screen.getByTestId('editor-receipt-file-0')).toHaveTextContent('报价.docx');
    await fireEvent.press(screen.getByTestId('editor-save'));

    const assets = await repo.listAssets();
    const byName = (name: string) => assets.find((a) => a.name === name)!;
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual([
      byName('报价.docx').id,
      byName('IMG_CAM.jpg').id,
      byName('IMG_1.HEIC').id,
      byName('合同.pdf').id,
    ]);
    // 照片原样保存（不重新编码），扩展名和类型照旧。
    expect(byName('IMG_1.HEIC')).toMatchObject({ mimeType: 'image/heic', source: 'picked' });
    expect(files.disk.get(byName('合同.pdf').path)).toEqual(pdf);
    // 选择器放在缓存里的副本都删了。
    expect([...files.disk.keys()].filter((k) => k.startsWith('picker://'))).toEqual([]);
    expect(files.encodes).toEqual([]);
  });

  it('never moves or deletes the original (content://)', async () => {
    const repo = await withRecord([]);
    const files = new FakeFiles();
    await openEditor(repo, files);
    const original = 'content://media/external/images/media/42';
    files.disk.set(original, pdf);
    files.nextMedia = [
      { uri: original, name: 'IMG_42.jpg', size: pdf.length, mimeType: 'image/jpeg' },
    ];
    pressInAlerts('从相册选');
    await fireEvent.press(await screen.findByTestId('editor-receipt-add'));
    expect(await screen.findByText('IMG_42.jpg')).toBeTruthy();
    expect(files.disk.get(original)).toEqual(pdf);
  });

  it('a file over the limit or a full phone keeps the ones already copied and says why', async () => {
    const repo = await withRecord([]);
    const files = new FakeFiles();
    await openEditor(repo, files);
    const huge = files.offer('big.mov', pdf, 'video/quicktime');
    files.nextPick = [files.offer('ok.pdf', pdf), { ...huge, size: 5 * 1024 ** 3 }];
    const alerts = pressInAlerts('从「文件」选');
    await fireEvent.press(await screen.findByTestId('editor-receipt-add'));
    expect(await screen.findByText('ok.pdf')).toBeTruthy();
    expect(alerts).toHaveBeenLastCalledWith('收据', '这个文件超过 4 GB。');
    expect(await added(repo)).toEqual(['ok.pdf']);
    expect(files.disk.has('picker://big.mov')).toBe(false);

    files.freeBytes = 1024;
    files.nextPick = [files.offer('more.pdf', pdf)];
    const full = pressInAlerts('从「文件」选');
    await fireEvent.press(screen.getByTestId('editor-receipt-add'));
    await waitFor(() =>
      expect(full).toHaveBeenLastCalledWith('收据', '手机剩余空间不够，存不下这个文件的副本。'),
    );
    expect(await added(repo)).toEqual(['ok.pdf']);
  });

  it('says when there is no camera', async () => {
    const repo = await withRecord([]);
    const files = new FakeFiles();
    files.cameraAvailable = false;
    await openEditor(repo, files);
    const alerts = pressInAlerts('拍照');
    await fireEvent.press(await screen.findByTestId('editor-receipt-add'));
    await waitFor(() => expect(alerts).toHaveBeenCalledTimes(2));
    expect(alerts.mock.calls[1]![1]).toMatch(/相机/);
    expect(await added(repo)).toEqual([]);
  });

  it('stops at 20 files', async () => {
    const repo = await withRecord(Array.from({ length: 19 }, (_, i) => `x${i}`));
    const files = new FakeFiles();
    await openEditor(repo, files);
    files.nextPick = [files.offer('a.pdf', pdf), files.offer('b.pdf', pdf)];
    pressInAlerts('从「文件」选');
    await fireEvent.press(await screen.findByTestId('editor-receipt-add'));
    expect(await screen.findByText('最多 20 个文件')).toBeTruthy();
    expect(screen.queryByTestId('editor-receipt-add')).toBeNull();
    // 只复制了还放得下的那一个。
    expect(await added(repo)).toEqual(['a.pdf']);
  });
});

describe('the quick-add form on a page takes attachments (D-263)', () => {
  const withForm = (locale: Locale, registry: Registry) => {
    const result = applyOps(
      seed(locale, registry),
      [
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'add',
            type: 'recordForm',
            props: {
              collectionId: 'expenses',
              fieldIds: ['item', 'receipt'],
              submitLabel: '记下',
              mode: 'inline',
            },
          },
        },
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

  it('adds a photo with the entry and starts empty again', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    await renderToolsApp(repo, files, { seed: withForm });
    await fireEvent.changeText(await screen.findByTestId('form-add-item'), '咖啡');
    files.nextMedia = [files.offerImage('IMG_9.jpg', 100, 100)];
    pressInAlerts('从相册选');
    await fireEvent.press(screen.getByTestId('form-add-receipt-add'));
    expect(await screen.findByText('IMG_9.jpg')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    await waitFor(async () => expect(await repo.listRecords('expenses')).toHaveLength(1));
    const [asset] = await repo.listAssets();
    expect((await repo.listRecords('expenses'))[0]!.values).toEqual({
      item: '咖啡',
      receipt: [asset!.id],
    });
    expect(screen.queryByText('IMG_9.jpg')).toBeNull();
    expect(screen.getByTestId('form-add-receipt-add')).toBeTruthy();
  });
});
