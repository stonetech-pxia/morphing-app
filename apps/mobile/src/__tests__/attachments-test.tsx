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
  const result = applyOps(createDefaultWorkspace(locale), [{ op: 'addData', table: receipts }], {
    registry,
    locale,
  });
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
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'add',
            look: 'form',
            show: { mode: 'inline' },
            tools: [
              {
                as: 'submit',
                label: '记下',
                do: 'create',
                table: 'expenses',
                ask: ['item', 'receipt'],
              },
            ],
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
    // 记下以后表单清空。
    await waitFor(() => expect(screen.queryByText('IMG_9.jpg')).toBeNull());
    const [asset] = await repo.listAssets();
    expect((await repo.listRecords('expenses'))[0]!.values).toEqual({
      item: '咖啡',
      receipt: [asset!.id],
    });
    expect(screen.getByTestId('form-add-receipt-add')).toBeTruthy();
  });
});

describe('thumbnails and previews (D-263)', () => {
  const withList = (display: 'list' | 'cards') => (locale: Locale, registry: Registry) => {
    const result = applyOps(
      seed(locale, registry),
      [
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'recent',
            look: display,
            source: { table: 'expenses', limit: 50 },
            show: { title: 'item' },
          },
        },
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

  async function listWith(records: Record<string, unknown>, display: 'list' | 'cards' = 'list') {
    const repo = new MemoryWorkspaceRepo();
    await repo.addAsset(asset('a1', '发票.jpg'));
    await repo.addAsset(asset('a2', '小票.pdf', 'application/pdf'));
    for (const [id, receipt] of Object.entries(records))
      await repo.insertRecord({
        id,
        collectionId: 'expenses',
        values: { item: id, receipt },
        createdAt: 1,
        updatedAt: 1,
      });
    const files = new FakeFiles();
    await renderToolsApp(repo, files, { seed: withList(display) });
    await screen.findByTestId('record-none', {}, { timeout: 4000 });
    return files;
  }

  it('show the first picture of each entry, decoded at the shown size', async () => {
    const files = await listWith({ pdfFirst: ['a2', 'a1'], old: 'a1', none: [], gone: ['zz'] });
    const thumb = screen.getByTestId('record-thumb-pdfFirst');
    expect(thumb.props.source).toEqual([{ uri: files.fileUri('assets/a1/发票.jpg') }]);
    expect(thumb.props.allowDownscaling).toBe(true);
    expect(thumb.props.style).toMatchObject({ width: 44, height: 44 });
    // 旧格式的单个 ID 也显示；没有附件、只有 PDF、文件已经删掉的不显示。
    expect(screen.getByTestId('record-thumb-old')).toBeTruthy();
    expect(screen.queryByTestId('record-thumb-none')).toBeNull();
    expect(screen.queryByTestId('record-thumb-gone')).toBeNull();
  });

  it('cards show a bigger thumbnail', async () => {
    await listWith({ one: ['a1'], none: [] }, 'cards');
    expect(screen.getByTestId('record-thumb-one').props.style).toMatchObject({ width: 56 });
  });

  it('many photos: only the first one is shown in the list', async () => {
    const repo = new MemoryWorkspaceRepo();
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    for (const id of ids) await repo.addAsset(asset(id, `${id}.jpg`));
    await repo.insertRecord({
      id: 'many',
      collectionId: 'expenses',
      values: { item: '很多照片', receipt: ids },
      createdAt: 1,
      updatedAt: 1,
    });
    await renderToolsApp(repo, new FakeFiles(), { seed: withList('list') });
    expect(
      (await screen.findByTestId('record-thumb-many', {}, { timeout: 4000 })).props.source[0].uri,
    ).toContain('p0.jpg');
    expect(screen.queryAllByTestId(/^record-thumb-/)).toHaveLength(1);
  });

  it('in the editor, pictures open full screen and swipe; other files open in the system preview', async () => {
    const repo = await withRecord(['a1', 'a2']);
    await repo.addAsset(asset('a3', '第二张.jpg'));
    await repo.updateRecord('r1', { item: '午饭', receipt: ['a1', 'a2', 'a3'] }, 2);
    const files = new FakeFiles();
    await openEditor(repo, files);
    expect(await screen.findByTestId('editor-receipt-thumb-0', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByTestId('editor-receipt-thumb-1')).toBeNull();

    await fireEvent.press(screen.getByTestId('editor-receipt-file-2'));
    // 只翻看照片和视频：两张照片，从第二张开始。
    expect(await screen.findByTestId('share-viewer')).toBeTruthy();
    expect(screen.getByTestId('share-viewer-count')).toHaveTextContent('2 / 2');
    await fireEvent.press(screen.getByTestId('share-viewer-close'));

    await fireEvent.press(screen.getByTestId('editor-receipt-file-1'));
    expect(files.previewed).toEqual([
      { uri: files.fileUri('assets/a2/小票.pdf'), mimeType: 'application/pdf' },
    ]);
  });

  it('says when the system cannot preview a file', async () => {
    const repo = await withRecord(['a2']);
    const files = new FakeFiles();
    files.previewFails = true;
    await openEditor(repo, files);
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await fireEvent.press(await screen.findByTestId('editor-receipt-file-0'));
    await waitFor(() => expect(alerts).toHaveBeenCalledWith('收据', expect.any(String)));
  });
});
