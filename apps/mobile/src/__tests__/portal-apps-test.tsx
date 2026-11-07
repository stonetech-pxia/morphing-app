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

const DIR = join(__dirname, '../../../../packages/core/src/fixtures/portal-apps');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  apps: { id: string; name: string; file: string }[];
};

/** 每张表放三条记录（字段按类型填一个合法的例子值，选项轮着用，关联指向对方表的第一条）。 */
async function fillTables(repo: MemoryWorkspaceRepo, config: WorkspaceConfig, appId: string) {
  const ids = new Map<string, string[]>();
  let n = 0;
  const tables = config.data.tables.filter((t) => t.app === appId);
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
    jest
      .spyOn(Alert, 'alert')
      .mockImplementationOnce((_title, _message, buttons) => void buttons?.[1]?.onPress?.());
    await act(() => router.push('/data'));
    await fireEvent.press(await screen.findByTestId('import-app-config'));
    await waitFor(() => expect(store.getState().config!.nav.apps?.[0]?.id).toBe(entry.id));
    const config = store.getState().config!;
    const filled = withData ? await fillTables(repo, config, entry.id) : null;
    return { repo, store, config, filled };
  }

  async function visitEverything(withData: boolean) {
    const { repo, store, config, filled } = await importThroughUi(withData);
    const healthy = () => {
      const s = store.getState();
      expect(s.status).toBe('ready');
      expect(s.renderAttempt).toBe(0);
      expect(errors).toEqual([]);
    };
    // 导入是一个版本（改动记录里能撤销），主页上多了进这个 App 的入口。
    const home = config.containers.pages.find((p) => p.id === 'home')!;
    expect(JSON.stringify(home.blocks)).toContain(`app:${entry.id}`);
    healthy();

    // 进到这个 App 里：底栏每一项。
    await act(async () => store.getState().enterApp(entry.id));
    const app = config.nav.apps!.find((a) => a.id === entry.id)!;
    await screen.findByTestId(`nav-${app.bar[0]}`);
    for (const target of app.bar) {
      await fireEvent.press(await screen.findByTestId(`nav-${target}`));
      healthy();
      if (target === 'ai') await act(async () => router.back());
    }

    // 这个 App 的每个页面（给一条记录用的页面带一条记录）。
    let n = 0;
    for (const page of config.containers.pages.filter((p) => p.app === entry.id)) {
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
    for (const table of config.data.tables.filter((t) => t.app === entry.id)) {
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
});
