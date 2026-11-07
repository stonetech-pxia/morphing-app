import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fieldDefinition, type DataRecord, type WorkspaceConfig } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 门户网站的展示预设（App 文件，D-485）：每一份从「设置 → 数据 → 导入」选进来，加成一个新 App，原来的不动；
// 进到这个 App 里，导航栏每一项、每个页面、每张表的新记录页和记录页都要能渲染，不能出错、不能被回退。

// 每个预设要走完所有页面，几十个测试一起跑时比较慢。
jest.setTimeout(30000);

const DIR = join(__dirname, '../../../../packages/core/src/fixtures/portal-apps');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  apps: { id: string; name: string; file: string }[];
};

/** 每张表放三条记录（字段按类型填一个合法的例子值，选项轮着用，关联指向对方表的第一条）。 */
async function fillTables(
  repo: MemoryWorkspaceRepo,
  config: WorkspaceConfig,
  mine: (table: WorkspaceConfig['data']['tables'][number]) => boolean,
) {
  const ids = new Map<string, string[]>();
  let n = 0;
  const tables = config.data.tables.filter(mine);
  for (const table of tables)
    ids.set(
      table.id,
      [0, 1, 2].map(() => `fill${String(++n).padStart(5, '0')}`),
    );
  for (const table of tables) {
    for (const [i, id] of ids.get(table.id)!.entries()) {
      const values: Record<string, unknown> = {};
      for (const f of table.fields) {
        const def = fieldDefinition(f.type);
        if (!def.write || f.type === 'file') continue;
        let v: unknown = def.exampleValue;
        if (f.type === 'text') v = `${f.name} ${i + 1}`;
        else if (f.type === 'choice') v = f.options[i % f.options.length]!.id;
        else if (f.type === 'link') v = ids.get(f.table)?.[0];
        if (v !== undefined) values[f.id] = v;
      }
      await repo.insertRecord({
        id,
        collectionId: table.id,
        values,
        createdAt: 1 + i,
        updatedAt: 1 + i,
      } as DataRecord);
    }
  }
  return ids;
}

describe.each(manifest.apps.map((a) => [a.name, a] as const))('app file %s', (_name, entry) => {
  let errors: unknown[][];
  beforeEach(() => {
    errors = [];
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
      errors.push(args);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const fileIds = (() => {
    const f = JSON.parse(readFileSync(join(DIR, entry.file), 'utf8')) as {
      pages: { id: string }[];
      tables: { id: string }[];
    };
    return { pages: new Set(f.pages.map((p) => p.id)), tables: new Set(f.tables.map((t) => t.id)) };
  })();
  // 做成 App 的按 app 字段认；导入主页的没有 app，按文件里的 ID 认。
  let mode: 'app' | 'home' = 'app';
  const ownedPage = (p: { id: string; app?: string | undefined }) =>
    mode === 'app' ? p.app === entry.id : fileIds.pages.has(p.id);
  const ownedTable = (t: { id: string; app?: string | undefined }) =>
    mode === 'app' ? t.app === entry.id : fileIds.tables.has(t.id);
  const readTheme = () =>
    (
      JSON.parse(readFileSync(join(DIR, entry.file), 'utf8')) as {
        app: { theme: { primaryColor: string } };
      }
    ).app.theme.primaryColor;

  /** 从「设置 → 数据」的导入选进来（和用户做的一样），点「应用」。 */
  async function importThroughUi(withData: boolean) {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const { store } = await renderToolsApp(repo, files, {
      seed: starterAfterGuide,
      locale: 'en',
    });
    await screen.findByTestId('nav-settings');
    const uri = `file:///picked/${entry.file}`;
    files.pickedTexts.set(uri, readFileSync(join(DIR, entry.file), 'utf8'));
    files.nextPick = [{ uri, name: entry.file, size: null, mimeType: 'application/json' }];
    // 先问怎么导入（导入主页 / 做成新 App），再预览，点「应用」。
    jest
      .spyOn(Alert, 'alert')
      .mockImplementationOnce(
        (_title, _message, buttons) => void buttons?.[mode === 'home' ? 0 : 1]?.onPress?.(),
      )
      .mockImplementationOnce((_title, _message, buttons) => void buttons?.[1]?.onPress?.());
    await act(() => router.push('/data'));
    await fireEvent.press(await screen.findByTestId('import-app-config'));
    await waitFor(() =>
      expect(
        mode === 'home'
          ? store.getState().config!.theme.primaryColor
          : store.getState().config!.nav.apps?.[0]?.id,
      ).toBe(mode === 'home' ? readTheme() : entry.id),
    );
    const config = store.getState().config!;
    const filled = withData ? await fillTables(repo, config, ownedTable) : null;
    return { repo, store, config, filled };
  }

  async function visitEverything(withData: boolean, how: 'app' | 'home' = 'app') {
    mode = how;
    const { repo, store, config, filled } = await importThroughUi(withData);
    const healthy = () => {
      const s = store.getState();
      expect(s.status).toBe('ready');
      expect(s.renderAttempt).toBe(0);
      expect(errors).toEqual([]);
    };
    const home = config.containers.pages.find((p) => p.id === 'home')!;
    let bar: readonly string[];
    if (mode === 'app') {
      // 导入是一个版本（改动记录里能撤销），主页上多了进这个 App 的入口。
      expect(JSON.stringify(home.blocks)).toContain(`app:${entry.id}`);
      healthy();
      // 进到这个 App 里：底栏每一项。
      await act(async () => store.getState().enterApp(entry.id));
      bar = config.nav.apps!.find((a) => a.id === entry.id)!.bar;
    } else {
      // 导入主页：风格换成了它的，没有做成 App，它的页面进了主页的导航栏。
      expect(config.nav.apps).toBeUndefined();
      expect(config.theme.primaryColor).toBe(readTheme());
      expect(config.nav.bar.some((t) => t.startsWith('page:') && t !== 'page:home')).toBe(true);
      healthy();
      bar = config.nav.bar;
    }
    await screen.findByTestId(`nav-${bar[0]}`);
    for (const target of bar) {
      await fireEvent.press(await screen.findByTestId(`nav-${target}`));
      healthy();
      if (target === 'ai') await act(async () => router.back());
    }

    // 这个 App 的每个页面（给一条记录用的页面带一条记录）。
    let n = 0;
    for (const page of config.containers.pages.filter(ownedPage)) {
      let params: Record<string, string> = { pageId: page.id };
      if (page.of !== undefined) {
        let id = filled?.get(page.of)?.[0];
        if (!id) {
          id = `rec${String(++n).padStart(5, '0')}`;
          await repo.insertRecord({
            id,
            collectionId: page.of,
            values: {},
            createdAt: 1,
            updatedAt: 1,
          } as DataRecord);
        }
        params = { ...params, record: id };
      }
      await act(async () => router.push({ pathname: '/page/[pageId]', params }));
      healthy();
      expect(screen.queryAllByTestId('editable-scroll').length).toBeGreaterThan(0);
      await act(async () => router.back());
    }

    // 每张表的新记录页；有数据时再打开第一条记录。
    for (const table of config.data.tables.filter(ownedTable)) {
      await act(async () =>
        router.push({ pathname: '/record/[collectionId]', params: { collectionId: table.id } }),
      );
      healthy();
      await act(async () => router.back());
      const first = filled?.get(table.id)?.[0];
      if (first) {
        await act(async () =>
          router.push({
            pathname: '/record/[collectionId]',
            params: { collectionId: table.id, recordId: first },
          }),
        );
        healthy();
        await act(async () => router.back());
      }
    }
  }

  it('imports from the data screen as one new app and renders everything when it is empty', async () => {
    await visitEverything(false);
  });

  it('renders everything when every table has entries (lists, charts, formulas, calendars)', async () => {
    await visitEverything(true);
  });

  it('imports into the home page from the data screen and renders everything (empty)', async () => {
    await visitEverything(false, 'home');
  });

  it('imports into the home page and renders everything with entries', async () => {
    await visitEverything(true, 'home');
  });
});

describe('restore the original look (D-485)', () => {
  const entry = manifest.apps.find((a) => a.id === 'habits')!;
  afterEach(() => jest.restoreAllMocks());

  it('long-press an imported app in Settings and restore it; a hand-made app has no such item', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const { store } = await renderToolsApp(repo, files, { seed: starterAfterGuide, locale: 'en' });
    await screen.findByTestId('nav-settings');
    const uri = `file:///picked/${entry.file}`;
    files.pickedTexts.set(uri, readFileSync(join(DIR, entry.file), 'utf8'));
    files.nextPick = [{ uri, name: entry.file, size: null, mimeType: 'application/json' }];
    jest
      .spyOn(Alert, 'alert')
      .mockImplementationOnce((_t, _m, buttons) => void buttons?.[1]?.onPress?.())
      .mockImplementationOnce((_t, _m, buttons) => void buttons?.[1]?.onPress?.());
    await act(() => router.push('/data'));
    await fireEvent.press(await screen.findByTestId('import-app-config'));
    await waitFor(() => expect(store.getState().config!.nav.apps?.[0]?.id).toBe('habits'));
    const original = store.getState().config!.nav.apps![0]!;

    // 用户把它改了：删一页、改风格、改名。
    await act(async () => {
      await store.getState().proposeOps(
        [
          { op: 'removeContainer', page: 'habits-insights' },
          { op: 'setTheme', app: 'habits', primaryColor: '#000000' },
          { op: 'updateContainer', app: { id: 'habits', name: 'Changed' } },
        ],
        'edit',
      );
      await store.getState().confirm();
    });
    expect(store.getState().config!.nav.apps![0]!.name).toBe('Changed');

    // 长按这个 App：菜单里有「恢复初始样子」；点它，预览里点「应用」。
    let menu: string[] = [];
    jest
      .spyOn(Alert, 'alert')
      .mockImplementationOnce((_t, _m, buttons) => {
        menu = (buttons ?? []).map((b) => b.text ?? '');
        void buttons?.find((b) => b.text === 'Restore its original look')?.onPress?.();
      })
      .mockImplementationOnce((_t, _m, buttons) => void buttons?.[1]?.onPress?.());
    await act(async () => router.back());
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent(await screen.findByTestId('settings-app-habits'), 'longPress');
    await waitFor(() => expect(store.getState().config!.nav.apps![0]!.name).toBe(original.name));
    expect(menu).toContain('Restore its original look');
    const after = store.getState().config!;
    expect(after.nav.apps![0]!.theme).toEqual(original.theme);
    expect(after.containers.pages.some((p) => p.id === 'habits-insights')).toBe(true);
    // 记录的表都还在。
    expect(after.data.tables.filter((t) => t.app === 'habits').length).toBeGreaterThan(0);

    // 不是从文件导入的 App（这里手做一个）没有这一项。
    await act(async () => {
      await store
        .getState()
        .proposeOps([{ op: 'addContainer', app: { id: 'mine', name: 'Mine' } }], 'add');
      await store.getState().confirm();
    });
    let mineMenu: string[] = [];
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      mineMenu = (buttons ?? []).map((b) => b.text ?? '');
    });
    await fireEvent(await screen.findByTestId('settings-app-mine'), 'longPress');
    await waitFor(() => expect(mineMenu.length).toBeGreaterThan(0));
    expect(mineMenu).not.toContain('Restore its original look');
  });
});
