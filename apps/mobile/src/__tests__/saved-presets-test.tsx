import {
  CURRENT_SCHEMA_VERSION,
  MAX_PRESET_NAME,
  MAX_SAVED_PRESETS,
  applyOps,
  createDefaultWorkspace,
  type Op,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { SQLiteWorkspaceRepo, migrateDatabase } from '../storage/sqlite';
import type { SavedPreset, WorkspaceRepo } from '../storage/types';
import { acceptNextAlert, renderToolsApp, testRegistry } from '../test-utils/render-app';
import { V4_FIXED_NAME } from '../../../../packages/core/src/fixtures/v4';

// 「设置 → 我的预设」（D-410）：存整个 App，不带记录和文件；换回来走恢复版本的流程，能撤销。

const FILE = 'presetfile01';

function seed(): WorkspaceConfig {
  const ops: Op[] = [
    {
      op: 'addData',
      table: { id: 'notes', name: '笔记', fields: [{ id: 'title', name: '标题', type: 'text' }] },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'slot',
        look: 'entry',
        show: { title: '合同', icon: 'folder' },
        opens: { file: FILE },
      },
    },
  ];
  const r = applyOps(createDefaultWorkspace('zh'), ops, { registry: testRegistry, locale: 'zh' });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

const noteRecord = {
  id: 'r1aaaaaa',
  collectionId: 'notes',
  values: { title: '一条记录' },
  createdAt: 1,
  updatedAt: 1,
};

async function app(repo = new MemoryWorkspaceRepo()) {
  await repo.insertRecord(noteRecord);
  return renderToolsApp(repo, undefined, { seed });
}

async function openPresets() {
  await fireEvent.press(await screen.findByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-more'));
  await fireEvent.press(await screen.findByTestId('settings-presets'));
  return screen.findByTestId('presets-screen');
}

async function saveThroughScreen(name: string) {
  await fireEvent.changeText(await screen.findByTestId('preset-name-input'), name);
  await fireEvent.press(screen.getByTestId('preset-save'));
}

async function changeApp(store: Awaited<ReturnType<typeof app>>['store'], ops: Op[]) {
  expect((await store.getState().proposeOps(ops, '改一下')).kind).toBe('preview');
  await store.getState().confirm();
  await store.getState().markRendered(store.getState().head!.id);
}

const stored = (id: string, overrides: Partial<SavedPreset> = {}): SavedPreset => ({
  id,
  name: `预设 ${id}`,
  createdAt: 1,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  config: createDefaultWorkspace('zh'),
  ...overrides,
});

// node:sqlite 跑真实的 SQL，和 delete-asset-test 一样包一层。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...p: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
    };
  };
};

function nodeSqlite(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const api = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    withExclusiveTransactionAsync: async (fn: (txn: unknown) => Promise<void>) => fn(api),
  };
  return api as unknown as SQLiteDatabase;
}

async function sqliteRepo() {
  const db = nodeSqlite();
  await migrateDatabase(db);
  return new SQLiteWorkspaceRepo(db);
}

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('preset storage (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('adds, lists newest first, renames, deletes and puts one back unchanged', async () => {
    const repo = await make();
    expect(await repo.listPresets()).toEqual([]);
    const a = stored('aaaaaaaa', { createdAt: 1 });
    const b = stored('bbbbbbbb', { createdAt: 2 });
    await repo.insertPreset(a);
    await repo.insertPreset(b);
    expect((await repo.listPresets()).map((p) => p.id)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
    expect(await repo.getPreset('aaaaaaaa')).toEqual(a);
    await repo.renamePreset('aaaaaaaa', '新名字');
    expect((await repo.getPreset('aaaaaaaa'))!.name).toBe('新名字');
    await repo.deletePreset('bbbbbbbb');
    expect(await repo.getPreset('bbbbbbbb')).toBeNull();
    await repo.insertPreset(b);
    expect(await repo.getPreset('bbbbbbbb')).toEqual(b);
  });
});

it('new user: the screen explains what a preset is, and nothing is saved by looking', async () => {
  const { repo, store } = await app();
  const head = store.getState().head!.id;
  await openPresets();
  expect(await screen.findByTestId('presets-none')).toBeTruthy();
  expect(await repo.listPresets()).toEqual([]);
  expect(store.getState().head!.id).toBe(head);
});

it('the whole path: save, change the app, apply and come back, undo, rename, delete and undo', async () => {
  const { repo, store } = await app();
  const original = store.getState().config!;
  await openPresets();
  // 空名字存不了。
  await saveThroughScreen('   ');
  expect(await repo.listPresets()).toEqual([]);

  await saveThroughScreen('  我的笔记  ');
  const preset = (
    await waitFor(async () => {
      const list = await repo.listPresets();
      expect(list).toHaveLength(1);
      return list;
    })
  )[0]!;
  expect(preset.name).toBe('我的笔记');
  expect(preset.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  // 保存不产生新版本，也不带文件引用。
  expect(JSON.stringify(preset.config)).not.toContain(FILE);
  expect(store.getState().config).toEqual(original);
  expect(await screen.findByTestId(`preset-${preset.id}`)).toBeTruthy();

  // 改主题、移走表。
  await act(() =>
    changeApp(store, [
      { op: 'setTheme', primaryColor: '#336699' },
      { op: 'removeData', table: 'notes' },
    ]),
  );
  expect(store.getState().config!.data.tables.map((t) => t.id)).not.toContain('notes');
  const changedHead = store.getState().head!.id;

  // 先确认：取消就什么都不变。
  const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
    buttons?.find((b) => b.style === 'cancel')?.onPress?.();
  });
  await fireEvent.press(await screen.findByTestId(`preset-${preset.id}-apply`));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(String(alert.mock.calls[0]![0])).toContain('我的笔记');
  expect(store.getState().head!.id).toBe(changedHead);
  await waitFor(() => expect(store.getState().proposal).toBeNull());

  acceptNextAlert();
  await fireEvent.press(screen.getByTestId(`preset-${preset.id}-apply`));
  await waitFor(() => expect(store.getState().head!.id).toBeGreaterThan(changedHead));
  const applied = store.getState().config!;
  expect(applied.data.tables.map((t) => t.id)).toContain('notes');
  expect(applied.theme.primaryColor).toBe(original.theme.primaryColor);
  expect(store.getState().head!.source).toBe('restore');
  expect(store.getState().head!.summary).toContain('我的笔记');
  // 文件位还在，是空的。
  expect(JSON.stringify(applied)).not.toContain(FILE);
  expect(JSON.stringify(applied)).toContain('"slot"');
  // 记录还在；回到首页，提示条能撤销。
  expect(await repo.listRecords('notes')).toHaveLength(1);
  expect(await screen.findByText(/我的笔记/)).toBeTruthy();
  await act(() => store.getState().undo());
  expect(store.getState().config!.theme.primaryColor).toBe('#336699');
  expect(await repo.listRecords('notes')).toHaveLength(1);

  // 回到预设页改名、删除并撤销。
  await act(() => store.getState().dismissBanner());
  await openPresets();
  await fireEvent.press(await screen.findByTestId(`preset-${preset.id}-rename`));
  await fireEvent.changeText(await screen.findByTestId('preset-rename-input'), '  ');
  await fireEvent.press(screen.getByTestId('preset-rename-save'));
  expect((await repo.getPreset(preset.id))!.name).toBe('我的笔记');
  await fireEvent.changeText(screen.getByTestId('preset-rename-input'), '换个名字');
  await fireEvent.press(screen.getByTestId('preset-rename-save'));
  await waitFor(async () => expect((await repo.getPreset(preset.id))!.name).toBe('换个名字'));
  expect(await screen.findByText('换个名字')).toBeTruthy();

  await fireEvent.press(screen.getByTestId(`preset-${preset.id}-delete`));
  await waitFor(async () => expect(await repo.getPreset(preset.id)).toBeNull());
  expect(await screen.findByTestId('presets-none')).toBeTruthy();
  await fireEvent.press(await screen.findByTestId('toast-undo'));
  await waitFor(async () => expect((await repo.getPreset(preset.id))!.name).toBe('换个名字'));
  expect(await screen.findByTestId(`preset-${preset.id}`)).toBeTruthy();
});

it('a table the preset does not have: its entries stay and show under Settings → Data (底线 5)', async () => {
  const repo = new MemoryWorkspaceRepo();
  await repo.insertRecord(noteRecord);
  const { store } = await renderToolsApp(repo, undefined, { seed });
  await repo.insertPreset(stored('emptyapp', { config: createDefaultWorkspace('zh') }));
  const result = await act(() => store.getState().proposePreset('emptyapp'));
  expect(result.kind).toBe('preview');
  if (result.kind === 'preview') {
    expect(result.proposal.lines.join('\n')).toContain('笔记');
    expect(result.proposal.lines.join('\n')).toContain('重新选');
  }
  await act(async () => void (await store.getState().confirm()));
  expect(store.getState().config!.data.tables).toEqual([]);
  expect(await repo.listRecords('notes')).toHaveLength(1);
  await fireEvent.press(await screen.findByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-more'));
  await fireEvent.press(await screen.findByTestId('settings-data'));
  expect(await screen.findByTestId('orphan-notes')).toBeTruthy();
});

it('a preset from an old format is upgraded first, and applying it works (底线 12)', async () => {
  const { repo, store } = await app();
  await repo.insertPreset(stored('oldpreset', { config: V4_FIXED_NAME, schemaVersion: 4 }));
  const result = await act(() => store.getState().proposePreset('oldpreset'));
  expect(result.kind).toBe('preview');
  await act(async () => void (await store.getState().confirm()));
  expect(store.getState().config!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  // 存着的那份没被改。
  expect((await repo.getPreset('oldpreset'))!.schemaVersion).toBe(4);
});

it('a broken preset or one that is gone is refused and changes nothing', async () => {
  const { repo, store } = await app();
  const head = store.getState().head!.id;
  await repo.insertPreset(stored('brokenone', { config: null }));
  expect((await store.getState().proposePreset('brokenone')).kind).toBe('invalid');
  expect((await store.getState().proposePreset('nosuchone')).kind).toBe('invalid');
  expect(store.getState().head!.id).toBe(head);
  expect(store.getState().proposal).toBeNull();
});

it('limits: 50 at most, a long name is cut, an empty one is refused', async () => {
  const { repo, store } = await app();
  for (let i = 0; i < MAX_SAVED_PRESETS - 1; i++)
    await repo.insertPreset(stored(`preset${i}`, { createdAt: i }));
  expect((await store.getState().savePreset('')).kind).toBe('noName');
  const long = await store.getState().savePreset('长'.repeat(MAX_PRESET_NAME + 10));
  expect(long.kind).toBe('saved');
  if (long.kind === 'saved') expect(long.preset.name).toHaveLength(MAX_PRESET_NAME);
  expect((await store.getState().savePreset('第 51 个')).kind).toBe('full');
  expect(await repo.listPresets()).toHaveLength(MAX_SAVED_PRESETS);

  await openPresets();
  expect(await screen.findByTestId('presets-full')).toBeTruthy();
  expect(screen.queryByTestId('preset-save')).toBeNull();
});

it('while a draft is open the row asks to finish the draft first (env.locked), like the other system pages', async () => {
  const { store } = await app();
  await act(() =>
    store.getState().change('换个颜色', {
      plan: async () => ({ kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#336699' }] }),
    }),
  );
  expect(store.getState().draft?.open).toBe(true);
  await fireEvent.press(await screen.findByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-more'));
  await fireEvent.press(await screen.findByTestId('settings-presets'));
  expect(screen.queryByTestId('presets-screen')).toBeNull();
});

it('French: the settings row and the screen use the French words', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { locale: 'fr' });
  await fireEvent.press(await screen.findByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-more'));
  expect(await screen.findByText('Mes préréglages')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-presets'));
  expect(await screen.findByTestId('presets-none')).toBeTruthy();
  expect(await screen.findByText('Garder l’app actuelle comme préréglage')).toBeTruthy();
});

// 保存时显示工具检查的结果（D-417）：只提醒，不阻止（底线 19）。
describe('保存预设时的检查', () => {
  // 路由状态是模块级的，上一个测试可能还停在预设页：直接打开。
  const openCheck = async () => {
    await act(async () => router.push('/presets'));
    return screen.findByTestId('presets-screen');
  };

  const orphan: Op[] = [
    {
      op: 'addData',
      table: { id: 'books', name: '书单', fields: [{ id: 'title', name: '书名', type: 'text' }] },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'books-add',
        look: 'button',
        show: { label: '添加', variant: 'filled' },
        tools: [{ do: 'create', table: 'books', ask: 'all' }],
      },
    },
  ];
  const seedWith = (ops: Op[]) => () => {
    const r = applyOps(createDefaultWorkspace('zh'), ops, { registry: testRegistry, locale: 'zh' });
    if (!r.ok) throw new Error(r.error);
    return r.config;
  };

  it('空的 App：0 个工具，没有问题，按钮是「保存」', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo());
    await openCheck();
    expect(screen.getByTestId('preset-check-tools').props.children).toBe('0 个工具');
    expect(screen.queryByTestId('preset-check-problem')).toBeNull();
    expect(screen.queryByText('仍然保存')).toBeNull();
  });

  it('工具包自带的快捷操作不算：个数是用户自己的工具', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
      seed: seedWith([{ op: 'setPackage', package: 'pdf', do: 'add' }, ...orphan]),
    });
    await openCheck();
    expect(screen.getByTestId('preset-check-tools').props.children).toBe('1 个工具');
  });

  it('问题很多也只列前几条', async () => {
    const many = Array.from({ length: 6 }, (_, n): Op[] =>
      JSON.parse(JSON.stringify(orphan).replaceAll('books', `books${n}`)),
    ).flat();
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed: seedWith(many) });
    await openCheck();
    expect(screen.getByTestId('preset-check-summary').props.children).toBe(
      '还有 6 个地方用不了，也可以先存着。',
    );
    expect(screen.getAllByTestId('preset-check-problem')).toHaveLength(4);
  });

  it('法语', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
      locale: 'fr',
      seed: seedWith(orphan),
    });
    await openCheck();
    expect(screen.getByText('Enregistrer quand même')).toBeTruthy();
    expect(screen.getByTestId('preset-check-tools').props.children).toBe('1 outil');
  });

  it('有问题：列出来，按钮变成「仍然保存」，点了照样存下', async () => {
    const repo = new MemoryWorkspaceRepo();
    await renderToolsApp(repo, undefined, { seed: seedWith(orphan) });
    await openCheck();
    expect(screen.getByTestId('preset-check-tools').props.children).toBe('1 个工具');
    expect(screen.getByTestId('preset-check-summary').props.children).toBe(
      '还有 1 个地方用不了，也可以先存着。',
    );
    expect(screen.getAllByTestId('preset-check-problem')).toHaveLength(1);
    expect(screen.getByText('仍然保存')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('preset-name-input'), '半成品');
    await fireEvent.press(screen.getByTestId('preset-save'));
    await waitFor(async () => expect(await repo.listPresets()).toHaveLength(1));
  });
});
