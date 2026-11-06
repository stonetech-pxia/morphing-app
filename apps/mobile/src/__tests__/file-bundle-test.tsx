import { packById, type PackNeed } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import type { PackBridge } from '../packs/bridge';
import { FILE_BUNDLE_ASKED, ensureRunPacks, fileBundleMissing } from '../packs/file-bundle';
import type { Packs } from '../packs/PackHost';
import { PackStore } from '../packs/store';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG } from '../test-utils/fake-files';
import { MemoryPackFs, sha256 } from '../test-utils/memory-packs';
import { renderToolsApp } from '../test-utils/render-app';

// 文件处理包一次问完（D-456）：扫描完、分享或打开文件后问一次，一起下载；运行时不再为可选的弹框。

const NO_PAGES: string[] = [];

async function packStore(installed: string[] = []) {
  const fs = new MemoryPackFs();
  const store = new PackStore(fs, sha256);
  for (const id of installed)
    await fs.writeText(`${id}/${packById(id)!.version}/ready.json`, '{"bytes":1,"installedAt":1}');
  return store;
}

function phone({ documentCamera = true, canFindPaper = true } = {}) {
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  vision.ocrModel = { pack: 'ppocr', languages: ['zh', 'en'] };
  Object.assign(vision, {
    flattenModel: { pack: 'dewarp' },
    layoutModel: { pack: 'layout' },
    documentCamera,
    canFindPaper,
  });
  files.vision = vision;
  return files;
}

describe('which packs the file bundle lists (D-456)', () => {
  it('lists text recognition, PDF preview, flattening and layout on a phone with a document camera', async () => {
    expect(await fileBundleMissing(phone(), await packStore())).toEqual([
      'ppocr',
      'pdfview',
      'dewarp',
      'layout',
    ]);
  });

  it('adds the photo straightener only when the phone has no document camera and cannot find paper', async () => {
    const files = phone({ documentCamera: false, canFindPaper: false });
    expect(await fileBundleMissing(files, await packStore())).toContain('scan');
  });

  it('leaves out what is already installed', async () => {
    expect(await fileBundleMissing(phone(), await packStore(['ppocr', 'pdfview']))).toEqual([
      'dewarp',
      'layout',
    ]);
  });
});

describe('packs while running (D-456)', () => {
  const needs: PackNeed[] = [
    { pack: 'dewarp', optional: true },
    { pack: 'ppocr', optional: false },
  ];

  it('does not ask for optional packs: they are skipped', async () => {
    const ask = jest.fn(async () => []);
    const left = await ensureRunPacks(await packStore(), [needs[0]!], ask);
    expect(ask).not.toHaveBeenCalled();
    expect(left).toEqual(['dewarp']);
  });

  it('asks only for the required ones and still reports the skipped optional ones', async () => {
    const ask = jest.fn(async () => [] as string[]);
    const left = await ensureRunPacks(await packStore(), needs, ask);
    expect(ask).toHaveBeenCalledWith([{ pack: 'ppocr', optional: false }]);
    expect(left).toEqual(['dewarp']);
  });

  it('cancels the run when a required pack is not downloaded', async () => {
    expect(await ensureRunPacks(await packStore(), needs, async () => null)).toBeNull();
  });
});

describe('the one-time prompt after opening a file (D-456)', () => {
  async function open(repo: MemoryWorkspaceRepo, files: FakeFiles) {
    const bridge = {
      subscribe: () => () => undefined,
      activePages: () => NO_PAGES,
      close: () => undefined,
    } as unknown as PackBridge;
    await renderToolsApp(repo, files, { packs: { store: await packStore(), bridge } as Packs });
    const picked = files.offer('bill.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([picked], [], 'picker'));
    await act(() => router.push('/share'));
  }

  it('asks once with everything in one list, and not again after "not now"', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = phone();
    await open(repo, files);
    expect(await screen.findByText(/^下载文件工具/)).toBeTruthy();
    for (const id of ['ppocr', 'pdfview', 'dewarp', 'layout'])
      expect(screen.getByTestId(`pack-item-${id}`)).toBeTruthy();
    // 每一项都能取消勾选，不写「不下载也能继续」。
    expect(screen.getByTestId('pack-include-ppocr')).toBeTruthy();
    expect(screen.queryByText(/不下载也能继续/)).toBeNull();
    expect(screen.queryByText(/许可证/)).toBeNull();
    // 打开页面不写数据（底线 15）：点了才记下问过。
    expect(await repo.getMeta(FILE_BUNDLE_ASKED)).toBeNull();
    expect(screen.getByTestId('pack-cancel')).toHaveTextContent('以后再说');
    await fireEvent.press(screen.getByTestId('pack-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pack-gate')).toBeNull());
    expect(await repo.getMeta(FILE_BUNDLE_ASKED)).toBe('1');

    await act(() => router.back());
    const again = files.offer('bill2.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([again], [], 'picker'));
    await act(() => router.push('/share'));
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(screen.queryByTestId('pack-gate')).toBeNull();
  });
});
