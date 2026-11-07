import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  fieldDefinition,
  prepareSnapshot,
  readAppConfigFile,
  type DataRecord,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, testRegistry } from '../test-utils/render-app';

// 门户网站的展示预设（Tinkrum 展示预设）：每一份装进 App 后，导航栏每一项、每一个页面、每一张表的新记录页、
// 每一个记录页都要能渲染，不能出错、不能被回退到旧版本。

const DIR = join(__dirname, '../../../../packages/core/src/fixtures/portal-presets');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  presets: { id: string; name: string; file: string }[];
};

function load(file: string): WorkspaceConfig {
  const raw = readAppConfigFile(readFileSync(join(DIR, file), 'utf8'));
  const prepared = prepareSnapshot(raw, testRegistry);
  if (!prepared.ok) throw new Error(prepared.issues.join('\n'));
  return prepared.after;
}

/** 每张表放三条记录（字段按类型填一个合法的例子值，选项轮着用，关联指向对方表的第一条），让列表、图表、汇总、公式、日历都有东西可算。 */
async function fillTables(repo: MemoryWorkspaceRepo, config: WorkspaceConfig) {
  const ids = new Map<string, string[]>();
  let n = 0;
  const tables = config.data.tables;
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
      const record: DataRecord = {
        id,
        collectionId: table.id,
        values,
        createdAt: 1 + i,
        updatedAt: 1 + i,
      } as DataRecord;
      await repo.insertRecord(record);
    }
  }
  return ids;
}

describe.each(manifest.presets.map((p) => [p.name, p] as const))('preset %s', (_name, preset) => {
  let errors: unknown[][];
  beforeEach(() => {
    errors = [];
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // act 的提示不算渲染错误。
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
      errors.push(args);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  /** 导航栏每一项、每一个页面、每一张表的新记录页、每一个记录页。 */
  async function visitEverything(
    repo: MemoryWorkspaceRepo,
    config: WorkspaceConfig,
    filled: Map<string, string[]> | null,
  ) {
    const { store } = await renderToolsApp(repo, new FakeFiles(), {
      seed: () => config,
      locale: 'en',
    });
    const healthy = () => {
      const s = store.getState();
      expect(s.status).toBe('ready');
      expect(s.renderAttempt).toBe(0);
      // 没有被回退成别的版本。
      expect(s.head!.id).toBe(1);
      expect(errors).toEqual([]);
    };
    await screen.findByTestId(`nav-${config.nav.bar[0]}`);
    healthy();

    for (const target of config.nav.bar) {
      await fireEvent.press(await screen.findByTestId(`nav-${target}`));
      healthy();
      // Tink 是单独推入的页面，看完回到外壳。
      if (target === 'ai') await act(async () => router.back());
    }

    // 每一个页面（不在导航栏里的推入）；给一条记录用的页面（of）带一条记录（有数据时用真的，没有就放一条空的）。
    let n = 0;
    for (const page of config.containers.pages) {
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
      // 页面真的画出来了（不是空白或出错页）。
      expect(screen.queryAllByTestId('editable-scroll').length).toBeGreaterThan(0);
      await act(async () => router.back());
    }

    for (const table of config.data.tables) {
      await act(async () =>
        router.push({ pathname: '/record/[collectionId]', params: { collectionId: table.id } }),
      );
      healthy();
      await act(async () => router.back());
      // 有数据时，再打开每张表的第一条记录。
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

  it('renders every page, new-record form and record page when it is empty', async () => {
    await visitEverything(new MemoryWorkspaceRepo(), load(preset.file), null);
  });

  it('renders every page and record when every table has entries (lists, charts, formulas, calendars)', async () => {
    const repo = new MemoryWorkspaceRepo();
    const config = load(preset.file);
    const filled = await fillTables(repo, config);
    await visitEverything(repo, config, filled);
  });
});
