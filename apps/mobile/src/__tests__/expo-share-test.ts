import { RunError } from '@morph/core';

import type { MorphShareModule, SavedToFolder } from '../../modules/morph-share';
import {
  forgetFolders,
  previewFile,
  rememberedFolder,
  saveAllToFolder,
  shareAll,
  type PickedFolder,
  type ShareDeps,
} from '../runtime/expo-share';

// 输出去向（D-119、D-120、D-123、D-196）：原生模块 MorphShare 用假的，Expo Go 的退路也用假的。

const items = [
  { uri: 'file:///cache/runs/r/1/收据 1.jpg', name: '收据 1', ext: 'jpg', mimeType: 'image/jpeg' },
  { uri: 'file:///cache/runs/r/2/a:b.pdf', name: 'a:b', ext: 'pdf', mimeType: 'application/pdf' },
];

function fakeNative(exportResult: () => Promise<SavedToFolder | null>, remembered = 'MorphOut') {
  const calls: { fn: string; args: unknown[] }[] = [];
  const native: MorphShareModule = {
    async shareFiles(...args) {
      calls.push({ fn: 'shareFiles', args });
    },
    rememberedFolder: () => remembered,
    async exportFiles(...args) {
      calls.push({ fn: 'exportFiles', args });
      return exportResult();
    },
    forgetFolders(...args) {
      calls.push({ fn: 'forgetFolders', args });
    },
    async previewFile(...args) {
      calls.push({ fn: 'previewFile', args });
      if (args[0].endsWith('.zzz')) {
        throw Object.assign(new Error('no viewer'), { code: 'ERR_NO_VIEWER' });
      }
      if (args[0].endsWith('.bad')) {
        // 原生里没接住的异常（例如 SecurityException），Expo 统一报 ERR_UNEXPECTED。
        throw Object.assign(new Error('boom'), { code: 'ERR_UNEXPECTED' });
      }
    },
  };
  return { native, calls };
}

function fallbackDeps(folder: PickedFolder | null) {
  const sheets: string[] = [];
  let picks = 0;
  const deps: ShareDeps = {
    native: null,
    shareOne: async (item) => {
      sheets.push(item.uri);
    },
    pickFolder: async () => {
      picks++;
      return folder;
    },
    remembered: null,
    rememberedBy: new Map(),
  };
  return { deps, sheets, picks: () => picks };
}

function memoryFolder(name: string, existing: string[], failOn?: string) {
  const written: { name: string; mimeType: string; source: string }[] = [];
  const folder: PickedFolder = {
    name,
    names: () => existing,
    async write(file, mimeType, source) {
      if (file === failOn) {
        throw Object.assign(new Error('nope'), { code: 'ERR_FOLDER_NOT_WRITABLE' });
      }
      written.push({ name: file, mimeType, source });
    },
  };
  return { folder, written };
}

describe('sharing several files', () => {
  it('opens one share sheet with every file when the native module is there', async () => {
    const { native, calls } = fakeNative(async () => null);
    await shareAll({ ...fallbackDeps(null).deps, native }, items);
    expect(calls).toEqual([
      {
        fn: 'shareFiles',
        args: [items.map((i) => i.uri), ['image/jpeg', 'application/pdf']],
      },
    ]);
  });

  it('falls back to one sheet per file without it (Expo Go)', async () => {
    const { deps, sheets } = fallbackDeps(null);
    await shareAll(deps, items);
    expect(sheets).toEqual(items.map((i) => i.uri));
    await shareAll(deps, []);
    expect(sheets).toHaveLength(2);
  });
});

describe('saving to a folder', () => {
  it('hands every file to the native module with clean names, using the remembered folder unless asked to choose', async () => {
    const { native, calls } = fakeNative(async () => ({ saved: 2, folder: 'MorphOut' }));
    const deps = { ...fallbackDeps(null).deps, native };
    expect(await saveAllToFolder(deps, items, 'wf1', false)).toEqual({
      saved: 2,
      folder: 'MorphOut',
    });
    expect(calls[0]!.args).toEqual([
      items.map((i) => i.uri),
      ['收据 1.jpg', 'a-b.pdf'],
      ['image/jpeg', 'application/pdf'],
      true,
      'wf1',
    ]);
    await saveAllToFolder(deps, items, 'wf1', true);
    expect(calls[1]!.args[3]).toBe(false);
    expect(rememberedFolder(deps, 'wf1')).toBe('MorphOut');
    forgetFolders(deps, ['wf1']);
    expect(calls[2]).toEqual({ fn: 'forgetFolders', args: [['wf1']] });
  });

  it('returns null when the user closes the picker', async () => {
    const { native } = fakeNative(async () => null);
    expect(
      await saveAllToFolder({ ...fallbackDeps(null).deps, native }, items, 'wf1', false),
    ).toBeNull();
    expect(await saveAllToFolder(fallbackDeps(null).deps, items, 'wf1', false)).toBeNull();
  });

  it('turns a folder it may not write into folderNotWritable, other failures into saveFailed', async () => {
    const denied = fakeNative(() =>
      Promise.reject(Object.assign(new Error('denied'), { code: 'ERR_FOLDER_NOT_WRITABLE' })),
    );
    await expect(
      saveAllToFolder({ ...fallbackDeps(null).deps, native: denied.native }, items, 'wf1', false),
    ).rejects.toMatchObject({ code: 'folderNotWritable' });

    const full = fakeNative(() => Promise.reject(new Error('disk full')));
    const error = await saveAllToFolder(
      { ...fallbackDeps(null).deps, native: full.native },
      items,
      'wf1',
      false,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunError);
    expect(error).toMatchObject({ code: 'saveFailed', detail: { detail: 'disk full' } });
  });

  it('without the native module writes into the picked folder without overwriting, and remembers it for this session', async () => {
    const { folder, written } = memoryFolder('Receipts', ['收据 1.jpg']);
    const fallback = fallbackDeps(folder);
    expect(rememberedFolder(fallback.deps, 'wf1')).toBeNull();
    expect(await saveAllToFolder(fallback.deps, items, 'wf1', false)).toEqual({
      saved: 2,
      folder: 'Receipts',
    });
    expect(written).toEqual([
      { name: '收据 1-2.jpg', mimeType: 'image/jpeg', source: items[0]!.uri },
      { name: 'a-b.pdf', mimeType: 'application/pdf', source: items[1]!.uri },
    ]);
    expect(rememberedFolder(fallback.deps, 'wf1')).toBe('Receipts');
    // 第二次直接存进记住的文件夹，不再弹选择器；choose 时才再选。
    await saveAllToFolder(fallback.deps, items, 'wf1', false);
    expect(fallback.picks()).toBe(1);
    await saveAllToFolder(fallback.deps, items, 'wf1', true);
    expect(fallback.picks()).toBe(2);

    const readOnly = memoryFolder('Locked', [], '收据 1.jpg');
    await expect(
      saveAllToFolder(fallbackDeps(readOnly.folder).deps, items, 'wf1', false),
    ).rejects.toMatchObject({ code: 'folderNotWritable' });
  });

  it('each shortcut keeps its own folder, starting from the last one chosen (D-196)', async () => {
    const receipts = memoryFolder('Receipts', []);
    const contracts = memoryFolder('Contracts', []);
    const fallback = fallbackDeps(receipts.folder);
    await saveAllToFolder(fallback.deps, items, 'receipts', false);
    // 另一个快捷操作第一次存：沿用最后选过的，不弹选择器。
    expect(rememberedFolder(fallback.deps, 'contracts')).toBe('Receipts');
    await saveAllToFolder(fallback.deps, items, 'contracts', false);
    expect(fallback.picks()).toBe(1);
    // 换文件夹只换这个快捷操作的。
    fallback.deps.pickFolder = async () => contracts.folder;
    await saveAllToFolder(fallback.deps, items, 'contracts', true);
    expect(rememberedFolder(fallback.deps, 'contracts')).toBe('Contracts');
    expect(rememberedFolder(fallback.deps, 'receipts')).toBe('Receipts');
    // 还没存过的快捷操作用最后选过的那个。
    expect(rememberedFolder(fallback.deps, 'new')).toBe('Contracts');
    // 删掉的快捷操作忘掉它的文件夹，再用时回到最后选过的。
    forgetFolders(fallback.deps, ['contracts']);
    expect(rememberedFolder(fallback.deps, 'receipts')).toBe('Contracts');
  });
});

describe('previewing a file (D-238)', () => {
  it('opens the system preview; no app to open it becomes noViewer', async () => {
    const { native, calls } = fakeNative(async () => null);
    const deps: ShareDeps = { ...fallbackDeps(null).deps, native };
    await previewFile(deps, {
      uri: 'content://x/报告.pdf',
      mimeType: 'application/pdf',
      name: '报告.pdf',
    });
    expect(calls).toEqual([
      { fn: 'previewFile', args: ['content://x/报告.pdf', 'application/pdf', '报告.pdf'] },
    ]);
    await expect(
      previewFile(deps, {
        uri: 'file:///cache/runs/r/a.zzz',
        mimeType: 'application/octet-stream',
        name: 'a.zzz',
      }),
    ).rejects.toEqual(new RunError('noViewer'));
    // 别的原生错误不把错误代码显示给用户。
    await expect(
      previewFile(deps, { uri: 'content://x/a.bad', mimeType: 'application/pdf', name: 'a.pdf' }),
    ).rejects.toEqual(new RunError('previewFailed'));
  });

  it('falls back to the share sheet without the native module (Expo Go)', async () => {
    const { deps, sheets } = fallbackDeps(null);
    await previewFile(deps, {
      uri: 'file:///group/a.pdf',
      mimeType: 'application/pdf',
      name: 'a.pdf',
    });
    expect(sheets).toEqual(['file:///group/a.pdf']);
  });
});
