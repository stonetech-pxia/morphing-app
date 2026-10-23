import { RunError } from '@morph/core';

import type { MorphShareModule, SavedToFolder } from '../../modules/morph-share';
import {
  rememberedFolder,
  saveAllToFolder,
  shareAll,
  type PickedFolder,
  type ShareDeps,
} from '../runtime/expo-share';

// 输出去向（D-119、D-120、D-123）：原生模块 MorphShare 用假的，Expo Go 的退路也用假的。

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
    expect(await saveAllToFolder(deps, items, false)).toEqual({ saved: 2, folder: 'MorphOut' });
    expect(calls[0]!.args).toEqual([
      items.map((i) => i.uri),
      ['收据 1.jpg', 'a-b.pdf'],
      ['image/jpeg', 'application/pdf'],
      true,
    ]);
    await saveAllToFolder(deps, items, true);
    expect(calls[1]!.args[3]).toBe(false);
    expect(rememberedFolder(deps)).toBe('MorphOut');
  });

  it('returns null when the user closes the picker', async () => {
    const { native } = fakeNative(async () => null);
    expect(await saveAllToFolder({ ...fallbackDeps(null).deps, native }, items, false)).toBeNull();
    expect(await saveAllToFolder(fallbackDeps(null).deps, items, false)).toBeNull();
  });

  it('turns a folder it may not write into folderNotWritable, other failures into saveFailed', async () => {
    const denied = fakeNative(() =>
      Promise.reject(Object.assign(new Error('denied'), { code: 'ERR_FOLDER_NOT_WRITABLE' })),
    );
    await expect(
      saveAllToFolder({ ...fallbackDeps(null).deps, native: denied.native }, items, false),
    ).rejects.toMatchObject({ code: 'folderNotWritable' });

    const full = fakeNative(() => Promise.reject(new Error('disk full')));
    const error = await saveAllToFolder(
      { ...fallbackDeps(null).deps, native: full.native },
      items,
      false,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunError);
    expect(error).toMatchObject({ code: 'saveFailed', detail: { detail: 'disk full' } });
  });

  it('without the native module writes into the picked folder without overwriting, and remembers it for this session', async () => {
    const { folder, written } = memoryFolder('Receipts', ['收据 1.jpg']);
    const fallback = fallbackDeps(folder);
    expect(rememberedFolder(fallback.deps)).toBeNull();
    expect(await saveAllToFolder(fallback.deps, items, false)).toEqual({
      saved: 2,
      folder: 'Receipts',
    });
    expect(written).toEqual([
      { name: '收据 1-2.jpg', mimeType: 'image/jpeg', source: items[0]!.uri },
      { name: 'a-b.pdf', mimeType: 'application/pdf', source: items[1]!.uri },
    ]);
    expect(rememberedFolder(fallback.deps)).toBe('Receipts');
    // 第二次直接存进记住的文件夹，不再弹选择器；choose 时才再选。
    await saveAllToFolder(fallback.deps, items, false);
    expect(fallback.picks()).toBe(1);
    await saveAllToFolder(fallback.deps, items, true);
    expect(fallback.picks()).toBe(2);

    const readOnly = memoryFolder('Locked', [], '收据 1.jpg');
    await expect(
      saveAllToFolder(fallbackDeps(readOnly.folder).deps, items, false),
    ).rejects.toMatchObject({ code: 'folderNotWritable' });
  });
});
