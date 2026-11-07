import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { PDFDocument } from 'pdf-lib';
import { Alert } from 'react-native';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// D-472：全部文件页面每行右边一个选择框；选了以后下面一排按钮：重命名（一个）、合并（两个以上 PDF）、分享、删除。

async function start() {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const add = async (id: string, name: string, mimeType: string, bytes: Uint8Array, at: number) => {
    const { path, size } = await files.writeBytes(id, name, bytes);
    await repo.addAsset({ id, name, mimeType, size, path, source: 'picked', createdAt: at });
  };
  await add('a', '发票.pdf', 'application/pdf', await makePdf(1), 1000);
  await add('b', '合同.pdf', 'application/pdf', await makePdf(2), 2000);
  await add('c', '照片.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]), 3000);
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  await renderToolsApp(repo, files, { seed: starterAfterGuide });
  await act(() => router.push('/files'));
  const page = await screen.findByTestId('files-screen', {}, { timeout: 4000 });
  const check = (id: string) => fireEvent.press(within(page).getByTestId(`files-check-${id}`));
  const enabled = (id: string) => !within(page).getByTestId(id).props.accessibilityState?.disabled;
  return { repo, files, page, check, enabled };
}

afterEach(() => {
  useGuide.setState({ stage: null, repo: null });
  jest.restoreAllMocks();
});

describe('selecting files on the all-files page (D-472)', () => {
  it('no bar until a file is checked; one file can be renamed, keeping its extension', async () => {
    const { repo, files, page, check, enabled } = await start();
    expect(within(page).queryByTestId('files-bar')).toBeNull();
    await check('a');
    expect(within(page).getByTestId('files-selected')).toHaveTextContent('已选 1 个');
    expect(enabled('files-rename-start')).toBe(true);
    expect(enabled('files-merge')).toBe(false);

    await fireEvent.press(within(page).getByTestId('files-rename-start'));
    const input = within(page).getByTestId('files-rename-input');
    expect(input.props.value).toBe('发票');
    // 空名字不改。
    await fireEvent.changeText(input, '  ');
    await fireEvent.press(within(page).getByTestId('files-rename-save'));
    await waitFor(() => expect(within(page).queryByTestId('files-rename')).toBeNull());
    expect((await repo.getAsset('a'))!.name).toBe('发票.pdf');
    await fireEvent.press(within(page).getByTestId('files-rename-start'));
    await fireEvent.changeText(within(page).getByTestId('files-rename-input'), '三月发票');
    await fireEvent.press(within(page).getByTestId('files-rename-save'));
    await waitFor(async () => expect((await repo.getAsset('a'))!.name).toBe('三月发票.pdf'));
    // 磁盘上的文件不动（缩略图、中间格式、文字都按路径找）。
    expect((await repo.getAsset('a'))!.path).toBe('assets/a/发票.pdf');
    expect(files.disk.has('assets/a/发票.pdf')).toBe(true);
    expect(await within(page).findByTestId('file-三月发票.pdf')).toBeTruthy();

    // 两个时不能重命名。
    await check('b');
    await waitFor(() =>
      expect(within(page).getByTestId('files-selected')).toHaveTextContent('已选 2 个'),
    );
    expect(enabled('files-rename-start')).toBe(false);
    // 「取消选择」：下面那排按钮收起来。
    await fireEvent.press(within(page).getByTestId('files-clear'));
    await waitFor(() => expect(within(page).queryByTestId('files-bar')).toBeNull());
  });

  it('two PDFs merge in the order they were checked into a new file; the originals stay', async () => {
    const { repo, files, page, check, enabled } = await start();
    await check('b');
    await check('a');
    expect(enabled('files-merge')).toBe(true);
    await fireEvent.press(within(page).getByTestId('files-merge'));
    // 合成以后进新文件的预览页。
    await screen.findByTestId('preview-bar');
    const assets = await repo.listAssets();
    expect(assets.map((a) => a.name).sort()).toEqual(
      ['发票.pdf', '合同.pdf', '合同（合并）.pdf', '照片.jpg'].sort(),
    );
    const merged = assets.find((a) => a.name === '合同（合并）.pdf')!;
    const doc = await PDFDocument.load(files.disk.get(merged.path)!);
    // 先点的「合同」（2 页，宽 200、201）在前面，「发票」（1 页）在后面。
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([200, 201, 200]);
    expect([...files.disk.keys()].some((k) => k.startsWith('runs/'))).toBe(false);
  });

  it('merge needs PDFs only; share takes every checked file under its own name', async () => {
    const { files, page, check, enabled } = await start();
    await check('a');
    await check('c');
    expect(enabled('files-merge')).toBe(false);
    await fireEvent.press(within(page).getByTestId('files-share'));
    await waitFor(() => expect(files.shareSheets).toHaveLength(1));
    expect(files.shareNames[0]).toEqual(['发票.pdf', '照片.jpg']);
  });

  it('delete asks first, then removes the checked files from the list and the disk', async () => {
    const { repo, files, page, check } = await start();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await check('a');
    await check('c');
    await fireEvent.press(within(page).getByTestId('files-delete'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const [title, message, buttons] = alert.mock.calls[0]!;
    expect(title).toBe('删除 2 个文件？');
    expect(message).toBe('删除后不能恢复。');
    // 还没确认：一个都没删。
    expect(await repo.listAssets()).toHaveLength(3);
    await act(async () => buttons!.find((b) => b.style === 'destructive')!.onPress!());
    await waitFor(async () => expect((await repo.listAssets()).map((a) => a.id)).toEqual(['b']));
    expect(files.disk.has('assets/a/发票.pdf')).toBe(false);
    await waitFor(() => expect(within(page).queryByTestId('files-bar')).toBeNull());
  });
});
