import { RunError } from '@morph/core';

import type { MorphShareModule } from '../../modules/morph-share';
import {
  saveAllToFolder,
  shareAll,
  type PickedFolder,
  type ShareDeps,
} from '../runtime/expo-share';

// 输出去向（D-100、D-101）：原生模块 MorphShare 用假的，Expo Go 的退路也用假的。

const items = [
  { uri: 'file:///cache/runs/r/1/收据 1.jpg', name: '收据 1', ext: 'jpg', mimeType: 'image/jpeg' },
  { uri: 'file:///cache/runs/r/2/a:b.pdf', name: 'a:b', ext: 'pdf', mimeType: 'application/pdf' },
];

function fakeNative(exportResult: () => Promise<number | null>) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const native: MorphShareModule = {
    async shareFiles(...args) {
      calls.push({ fn: 'shareFiles', args });
    },
    async exportFiles(...args) {
      calls.push({ fn: 'exportFiles', args });
      return exportResult();
    },
  };
  return { native, calls };
}

function fallbackDeps(folder: PickedFolder | null) {
  const sheets: string[] = [];
  const deps: ShareDeps = {
    native: null,
    shareOne: async (item) => {
      sheets.push(item.uri);
    },
    pickFolder: async () => folder,
  };
  return { deps, sheets };
}

function memoryFolder(existing: string[], failOn?: string) {
  const written: { name: string; mimeType: string; source: string }[] = [];
  const folder: PickedFolder = {
    names: () => existing,
    async write(name, mimeType, source) {
      if (name === failOn)
        throw Object.assign(new Error('nope'), { code: 'ERR_FOLDER_NOT_WRITABLE' });
      written.push({ name, mimeType, source });
    },
  };
  return { folder, written };
}

describe('sharing several files', () => {
  it('opens one share sheet with every file when the native module is there', async () => {
    const { native, calls } = fakeNative(async () => 0);
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
  it('hands every file to the folder picker with clean names and reports how many were saved', async () => {
    const { native, calls } = fakeNative(async () => 2);
    expect(await saveAllToFolder({ ...fallbackDeps(null).deps, native }, items)).toBe(2);
    expect(calls[0]!.args).toEqual([
      items.map((i) => i.uri),
      ['收据 1.jpg', 'a-b.pdf'],
      ['image/jpeg', 'application/pdf'],
    ]);
  });

  it('returns null when the user closes the picker', async () => {
    const { native } = fakeNative(async () => null);
    expect(await saveAllToFolder({ ...fallbackDeps(null).deps, native }, items)).toBeNull();
    expect(await saveAllToFolder(fallbackDeps(null).deps, items)).toBeNull();
  });

  it('turns a folder it may not write into folderNotWritable, other failures into saveFailed', async () => {
    const denied = fakeNative(() =>
      Promise.reject(Object.assign(new Error('denied'), { code: 'ERR_FOLDER_NOT_WRITABLE' })),
    );
    await expect(
      saveAllToFolder({ ...fallbackDeps(null).deps, native: denied.native }, items),
    ).rejects.toMatchObject({ code: 'folderNotWritable' });

    const full = fakeNative(() => Promise.reject(new Error('disk full')));
    const error = await saveAllToFolder(
      { ...fallbackDeps(null).deps, native: full.native },
      items,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunError);
    expect(error).toMatchObject({ code: 'saveFailed', detail: { detail: 'disk full' } });
  });

  it('without the native module writes into the picked folder without overwriting', async () => {
    const { folder, written } = memoryFolder(['收据 1.jpg']);
    expect(await saveAllToFolder(fallbackDeps(folder).deps, items)).toBe(2);
    expect(written).toEqual([
      { name: '收据 1-2.jpg', mimeType: 'image/jpeg', source: items[0]!.uri },
      { name: 'a-b.pdf', mimeType: 'application/pdf', source: items[1]!.uri },
    ]);

    const readOnly = memoryFolder([], '收据 1.jpg');
    await expect(saveAllToFolder(fallbackDeps(readOnly.folder).deps, items)).rejects.toMatchObject({
      code: 'folderNotWritable',
    });
  });
});
