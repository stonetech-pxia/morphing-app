import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CURRENT_SCHEMA_VERSION,
  MAX_APP_CONFIG_SIZE,
  MAX_PRESET_NAME,
  MAX_SAVED_PRESETS,
  appConfigFile,
  applyOps,
  createDefaultWorkspace,
  type Op,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import type { SavedPreset, WorkspaceRepo } from '../storage/types';
import { sqliteRepo } from '../test-utils/node-sqlite';
import {
  acceptNextAlert,
  renderToolsApp,
  starterAfterGuide,
  testRegistry,
} from '../test-utils/render-app';
import { V4_FIXED_NAME } from '../../../../packages/core/src/fixtures/v4';

// 「设置 → 我的预设」（D-410）：存整个 App，不带记录和文件；换回来走恢复版本的流程，能撤销。

const FILE = 'presetfile01';
const PORTAL = join(__dirname, '../../../../packages/core/src/fixtures/portal-apps');

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

// 「从文件导入」：门户下载的预设文件存成一个新预设，点「应用」才换（D-485）。
describe('import a preset from a file', () => {
  // 前面的测试留下的 Alert.alert 监视和调用记录不能带进来。
  beforeEach(() => jest.restoreAllMocks());
  const PICKED = 'file:///cache/DocumentPicker/收据.json';
  const pickFile = (
    files: Awaited<ReturnType<typeof app>>['files'],
    text: string,
    overrides: { name?: string; size?: number | null } = {},
  ) => {
    files.nextPick = [
      {
        uri: PICKED,
        name: overrides.name ?? '收据.json',
        size: overrides.size === undefined ? text.length : overrides.size,
        mimeType: 'application/json',
      },
    ];
    files.pickedTexts.set(PICKED, text);
  };
  const exported = (config: unknown = seed()) =>
    appConfigFile(config as WorkspaceConfig, new Date(2026, 10, 7));
  // 路由状态是模块级的，上一个测试可能还停在预设页，也可能回到了首页：哪种都能打开。
  const openScreen = async () => {
    if (await screen.findByTestId('presets-screen', {}, { timeout: 300 }).catch(() => null))
      return screen.getByTestId('presets-screen');
    if (screen.queryByTestId('nav-settings')) return openPresets();
    await act(async () => router.push('/presets'));
    return screen.findByTestId('presets-screen');
  };
  const importThroughScreen = async () => {
    await openScreen();
    await fireEvent.press(await screen.findByTestId('preset-import'));
  };

  it('stores a new preset named after the file, changes nothing else, and applies only on request', async () => {
    const { repo, files, store } = await app();
    const text = exported();
    // 先把 App 改成和文件里不一样的样子。
    await act(() => changeApp(store, [{ op: 'removeData', table: 'notes' }]));
    const before = store.getState().config!;
    const head = store.getState().head!.id;

    pickFile(files, text);
    await importThroughScreen();
    const preset = (
      await waitFor(async () => {
        const list = await repo.listPresets();
        expect(list).toHaveLength(1);
        return list;
      })
    )[0]!;
    expect(preset.name).toBe('收据');
    expect(preset.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(JSON.stringify(preset.config)).not.toContain(FILE);
    // 只选了文件的类型，没联网；当前的 App 一点没变，也没有新版本。
    expect(files.lastPickTypes).toContain('application/json');
    expect(store.getState().config).toEqual(before);
    expect(store.getState().head!.id).toBe(head);
    expect(await screen.findByTestId(`preset-${preset.id}`)).toBeTruthy();

    // 点「应用」：先问，确认后换，记录还在，能撤销。
    acceptNextAlert();
    await fireEvent.press(screen.getByTestId(`preset-${preset.id}-apply`));
    await waitFor(() => expect(store.getState().head!.id).toBeGreaterThan(head));
    expect(store.getState().config!.data.tables.map((t) => t.id)).toContain('notes');
    expect(await repo.listRecords('notes')).toHaveLength(1);
    await act(() => store.getState().undo());
    expect(store.getState().config!.data.tables.map((t) => t.id)).not.toContain('notes');
    expect(await repo.listRecords('notes')).toHaveLength(1);
  });

  it('a name that is taken gets a number', async () => {
    const { repo, files } = await app();
    await repo.insertPreset(stored('taken000', { name: '收据' }));
    pickFile(files, exported());
    await importThroughScreen();
    await waitFor(async () => expect(await repo.listPresets()).toHaveLength(2));
    expect((await repo.listPresets()).map((p) => p.name).sort()).toEqual(['收据', '收据 2']);
  });

  it('an older file is upgraded before it is stored (底线 12)', async () => {
    const { repo, files } = await app();
    pickFile(files, exported(V4_FIXED_NAME), { name: 'old.json' });
    await importThroughScreen();
    const [preset] = await waitFor(async () => {
      const list = await repo.listPresets();
      expect(list).toHaveLength(1);
      return list;
    });
    expect(preset!.name).toBe('old');
    expect((preset!.config as WorkspaceConfig).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it.each([
    ['not json at all', 'nope', 'importAppConfigNotJson', '不是有效的 JSON'],
    ['another kind of file', '{"hello":1}', 'importAppConfigInvalid', '不是 Tinkrum 的 App 配置'],
    [
      'another export format',
      '{"format":"morph-layout-store","version":1,"config":{"schemaVersion":1}}',
      'importAppConfigInvalid',
      '不是 Tinkrum 的 App 配置',
    ],
    [
      'a file from a newer Tinkrum',
      `{"format":"morph-app-config","version":9,"config":{"schemaVersion":${CURRENT_SCHEMA_VERSION}}}`,
      'importAppConfigNewer',
      '更新版本的 Tinkrum',
    ],
  ])('refuses %s, says why and stores nothing', async (_name, text, _key, reason) => {
    const { repo, files, store } = await app();
    const head = store.getState().head!.id;
    pickFile(files, text);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await importThroughScreen();
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![0]).toBe('从文件导入');
    expect(String(alert.mock.calls[0]![1])).toContain(reason);
    expect(await repo.listPresets()).toEqual([]);
    expect(store.getState().head!.id).toBe(head);
  });

  it('refuses a configuration that does not hold together, listing the reasons (底线 18)', async () => {
    const { repo, files } = await app();
    const broken = JSON.parse(JSON.stringify(seed())) as WorkspaceConfig;
    broken.containers.pages[0]!.blocks.push({
      id: 'dangling',
      look: 'entry',
      show: { title: 'x', icon: 'star' },
      opens: 'no-such-page' as never,
    });
    pickFile(files, exported(broken));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await importThroughScreen();
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const message = String(alert.mock.calls[0]![1]);
    expect(message).toContain('没有导入');
    expect(message.split('\n').length).toBeGreaterThan(1);
    expect(await repo.listPresets()).toEqual([]);
  });

  it('a file over the size limit is refused without being read', async () => {
    const { repo, files } = await app();
    pickFile(files, exported(), { size: MAX_APP_CONFIG_SIZE + 1 });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await importThroughScreen();
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0]![1])).toContain('太大');
    expect(files.readPicked).toEqual([]);
    expect(await repo.listPresets()).toEqual([]);
  });

  it('cancelling the picker does nothing', async () => {
    const { repo, files } = await app();
    files.nextPick = null;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await importThroughScreen();
    expect(alert).not.toHaveBeenCalled();
    expect(await repo.listPresets()).toEqual([]);
  });

  it('with 50 presets a configuration file is refused (nothing stored), but the import is still offered', async () => {
    const { repo, files, store } = await app();
    for (let i = 0; i < MAX_SAVED_PRESETS; i++)
      await repo.insertPreset(stored(`preset${i}`, { createdAt: i }));
    await openScreen();
    expect(await screen.findByTestId('presets-full')).toBeTruthy();
    // App 文件不占预设的名额，所以入口还在；整份配置存不下，只提示。
    expect(screen.getByTestId('preset-import')).toBeTruthy();
    pickFile(files, exported());
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByTestId('preset-import'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect((await store.getState().importPreset(exported(), 'a.json')).kind).toBe('full');
    expect(await repo.listPresets()).toHaveLength(MAX_SAVED_PRESETS);
  });

  describe('an App file (D-485: one app, tinkrum-app)', () => {
    // 门户上的 App 文件是在新用户的起始配置上做的（要有它的工具包和页面），所以用起始配置当底子。
    const starterApp = () =>
      renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
        seed: starterAfterGuide,
        locale: 'zh',
      });
    // 门户里现成的一份 App 文件（Clay）。
    // 先问「导入主页」还是「做成新 App」：选做成新 App（第二个按钮）。
    const chooseNewApp = () =>
      jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
        buttons?.[1]?.onPress?.();
      });
    const clay = () => readFileSync(join(PORTAL, 'tinkrum-app-clay.json'), 'utf8');

    it('is added as a new app after asking; no preset is stored, what is there stays, and it can be undone', async () => {
      const { repo, files, store } = await starterApp();
      const before = store.getState().config!;
      pickFile(files, clay(), { name: 'tinkrum-app-clay.json' });
      chooseNewApp();
      acceptNextAlert();
      await importThroughScreen();
      await waitFor(() => expect(store.getState().config!.nav.apps?.[0]?.id).toBe('clay'));
      expect(await repo.listPresets()).toEqual([]);
      // 原来的页面和表一个不少。
      const after = store.getState().config!;
      for (const p of before.containers.pages)
        expect(after.containers.pages.some((x) => x.id === p.id)).toBe(true);
      for (const tb of before.data.tables)
        expect(after.data.tables.some((x) => x.id === tb.id)).toBe(true);
      // 能在改动记录里撤销，撤销后没有这个 App。
      await act(() => store.getState().undo());
      expect(store.getState().config!.nav.apps ?? []).toEqual([]);
    });

    it('asking is not skipped: cancelling changes nothing', async () => {
      const { repo, files, store } = await starterApp();
      const head = store.getState().head!.id;
      pickFile(files, clay(), { name: 'tinkrum-app-clay.json' });
      const alert = jest
        .spyOn(Alert, 'alert')
        .mockImplementationOnce((_t, _m, buttons) => void buttons?.[0]?.onPress?.());
      await importThroughScreen();
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(store.getState().head!.id).toBe(head);
      expect(store.getState().config!.nav.apps ?? []).toEqual([]);
      expect(await repo.listPresets()).toEqual([]);
    });

    it('the same app twice: the second is refused and says why, nothing changes', async () => {
      const { files, store } = await starterApp();
      pickFile(files, clay(), { name: 'tinkrum-app-clay.json' });
      chooseNewApp();
      acceptNextAlert();
      await importThroughScreen();
      await waitFor(() => expect(store.getState().config!.nav.apps?.[0]?.id).toBe('clay'));
      const head = store.getState().head!.id;
      await openScreen();
      pickFile(files, clay(), { name: 'tinkrum-app-clay.json' });
      // 第一次导入时 acceptNextAlert 装的监视还在，调用记录要清掉再看这一次。
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      alert.mockClear();
      chooseNewApp();
      await fireEvent.press(await screen.findByTestId('preset-import'));
      await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
      expect(String(alert.mock.calls[1]![1])).toContain('已经添加过');
      expect(store.getState().head!.id).toBe(head);
    });

    it('with 50 presets an App file is still added', async () => {
      const { repo, files, store } = await starterApp();
      for (let i = 0; i < MAX_SAVED_PRESETS; i++)
        await repo.insertPreset(stored(`preset${i}`, { createdAt: i }));
      pickFile(files, clay(), { name: 'tinkrum-app-clay.json' });
      chooseNewApp();
      acceptNextAlert();
      await importThroughScreen();
      await waitFor(() => expect(store.getState().config!.nav.apps?.[0]?.id).toBe('clay'));
      expect(await repo.listPresets()).toHaveLength(MAX_SAVED_PRESETS);
    });
  });

  it('French: the button, the hint and the refusal are in French', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { files } = await renderToolsApp(repo, undefined, { locale: 'fr' });
    pickFile(files, '{"hello":1}');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openScreen();
    expect(await screen.findByText('Importer depuis un fichier')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preset-import'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![0]).toBe('Importer depuis un fichier');
    expect(String(alert.mock.calls[0]![1])).toMatch(/rien n’a été importé/i);
    expect(await repo.listPresets()).toEqual([]);
  });
});
