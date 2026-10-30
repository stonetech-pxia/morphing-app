import {
  applyOps,
  createDefaultWorkspace,
  createStarterWorkspace,
  homeFileEntryOps,
  type Locale,
  type Op,
  quickActionsOf,
  type Registry,
  remindersOf,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { useSampleHint } from '../guide/SampleHint';
import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 新手引导第 3 步：样板 App（D-260）。第 2 步结束后首页列出五个样板；点一个整套进草稿（D-190），
// 「应用」后合成一个版本（顶部「已改好 · 撤销」），回到样板的主页面，提示可以用 AI 接着改。不经过 AI。

const TYPED = { timeout: 4000 };

type Seed = (locale: Locale, registry: Registry) => WorkspaceConfig;

async function start(
  stage: 'goal' | 'samples' | 'done' | undefined,
  options: { seed?: Seed; locale?: Locale; repo?: MemoryWorkspaceRepo } = {},
) {
  const repo = options.repo ?? new MemoryWorkspaceRepo();
  if (stage) await repo.setMeta('guide', stage);
  await act(() => useGuide.getState().load(repo));
  return renderToolsApp(repo, new FakeFiles(), {
    seed: options.seed ?? starterAfterGuide,
    locale: options.locale ?? 'zh',
  });
}

/** 在 starterAfterGuide 上再做几处修改的初始版本。 */
const seedWith =
  (ops: (config: WorkspaceConfig) => Op[], base: Seed = starterAfterGuide): Seed =>
  (locale, registry) => {
    const config = base(locale, registry);
    const result = applyOps(config, ops(config), { registry, locale });
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

describe('guide step 3: sample apps', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useGuide.setState({ stage: null, repo: null });
    useSampleHint.setState({ hint: null });
  });

  it('a new user who finishes steps 1 and 2 sees step 3 with the five samples', async () => {
    const { repo } = await start(undefined, { seed: createStarterWorkspace });
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    await waitFor(
      () => expect(screen.getByTestId('change-input').props.editable).toBe(true),
      TYPED,
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    await fireEvent.press(await screen.findByTestId('guide-later'));
    const card = await screen.findByTestId('guide-samples');
    expect(card).toHaveTextContent(/第 3 步/);
    expect(card).toHaveTextContent(/还能把 Morph 变成你自己的 App/);
    for (const name of ['报销助手', '出国办证', '学习助手', '小店接单', '宝宝成长'])
      expect(card).toHaveTextContent(new RegExp(name));
    expect(screen.getByTestId('guide-samples-later')).toBeTruthy();
    expect(await repo.getMeta('guide')).toBe('samples');
  });

  it('opening a picture in step 2 leads to step 3 back on the home page', async () => {
    const files = new FakeFiles();
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta('guide', 'goal');
    await act(() => useGuide.getState().load(repo));
    await renderToolsApp(repo, files, { seed: starterAfterGuide });
    files.nextMedia = [files.offerImage('a.jpg', 400, 300)];
    await fireEvent.press(await screen.findByTestId('file-pick-media'));
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(await repo.getMeta('guide')).toBe('samples');
    await act(() => router.back());
    expect(await screen.findByTestId('guide-samples')).toBeTruthy();
  });

  it('skipping the guide skips step 3 too', async () => {
    const { repo } = await start(undefined, { seed: createStarterWorkspace });
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-skip'));
    await waitFor(() => expect(useGuide.getState().stage).toBe('done'));
    expect(await repo.getMeta('guide')).toBe('done');
    expect(screen.queryByTestId('guide-samples')).toBeNull();
  });

  it('users who already saw the guide do not get step 3', async () => {
    await start('done');
    await screen.findByTestId('nav-settings');
    expect(screen.queryByTestId('guide-samples')).toBeNull();
    expect(screen.queryByTestId('guide-goal')).toBeNull();
  });

  it('“later” on step 3 ends the guide without changing the app', async () => {
    const { repo, store } = await start('samples');
    const before = store.getState().config;
    await fireEvent.press(await screen.findByTestId('guide-samples-later'));
    await waitFor(() => expect(screen.queryByTestId('guide-samples')).toBeNull());
    expect(await repo.getMeta('guide')).toBe('done');
    expect(store.getState().config).toBe(before);
    expect(store.getState().draft).toBeNull();
  });

  it('picking a sample drafts it, applying returns to its page with undo and an AI hint', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { repo, store } = await start('samples');
    const before = store.getState().config!;
    const revisions = (await store.getState().listRevisions(50)).length;
    await fireEvent.press(await screen.findByTestId('guide-sample-expense-helper'));

    // 先进草稿：能看不能用，正式的版本没变（D-190）。
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    const draft = store.getState().draft!;
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]!.input).toBe('套用样板「报销助手」');
    expect(draft.origin.sample).toEqual({ id: 'expense-helper', pageId: 'expenses' });
    expect(store.getState().config).toBe(before);
    expect(store.getState().tab).toBe('page:expenses');
    expect(await screen.findByText('报销助手')).toBeTruthy();
    // 选了样板，引导就结束了。
    expect(await repo.getMeta('guide')).toBe('done');

    // 应用：一个版本，表、快捷操作、页面、提醒一起加上；顶部照常「已改好 · 撤销」（不是引导的小改动，D-239 不适用）。
    await fireEvent.press(screen.getByTestId('draft-apply'));
    await waitFor(() => expect(store.getState().draft).toBeNull());
    const after = store.getState().config!;
    expect(after.data.tables.map((c) => c.id)).toContain('claims');
    expect(quickActionsOf(after).map((w) => w.id)).toEqual(
      expect.arrayContaining([
        'scan-receipt-log',
        'print-expenses',
        'receipt-archive',
        'expense-report',
      ]),
    );
    expect(remindersOf(after)?.map((r) => r.id)).toEqual(['submit-expenses']);
    expect(after.nav.bar).toContain('page:expenses');
    expect(after.theme).toEqual(before.theme);
    expect((await store.getState().listRevisions(50)).length).toBe(revisions + 1);
    expect(await screen.findByTestId('banner')).toHaveTextContent(/撤销/);
    expect(store.getState().tab).toBe('page:expenses');
    const hint = await screen.findByTestId('sample-hint');
    expect(hint).toHaveTextContent(/「报销助手」装好了/);

    // 「用 AI 接着改」：开头填进输入框，不自动发送。
    await fireEvent.press(screen.getByTestId('sample-hint-change'));
    const input = await screen.findByTestId('change-input');
    expect(input).toHaveProp('value', '在报销助手的基础上改：');
    expect(store.getState().draft).toBeNull();
    expect(store.getState().config).toBe(after);
    // 整个过程没有发任何请求。
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('undo after applying a sample brings the app back to how it was', async () => {
    const { store } = await start('samples');
    const before = store.getState().config!;
    await fireEvent.press(await screen.findByTestId('guide-sample-shop-orders'));
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    await waitFor(() => expect(store.getState().config!.data.tables).toHaveLength(2));
    await fireEvent.press(await screen.findByText('撤销'));
    await waitFor(() => expect(store.getState().config).toEqual(before));
  });

  it('works in French without AI', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { store } = await start('samples', { locale: 'fr' });
    expect(await screen.findByTestId('guide-samples')).toHaveTextContent(/Étape 3/);
    await fireEvent.press(screen.getByTestId('guide-sample-visa-docs'));
    expect(store.getState().draft!.steps[0]!.input).toBe(
      'Utiliser l’app modèle « Visa et passeport »',
    );
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    expect(await screen.findByTestId('sample-hint')).toHaveTextContent(
      /« Visa et passeport » est prête/,
    );
    expect(store.getState().config!.data.tables.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Pièces à préparer', 'Mes papiers']),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with data: an existing table of the same name keeps its records, the sample gets new ids', async () => {
    const repo = new MemoryWorkspaceRepo();
    const seed = seedWith(() => [
      {
        op: 'addData',
        table: {
          id: 'growth',
          name: '成长',
          fields: [{ id: 'name', name: '名字', type: 'text' }],
        },
      },
    ]);
    const { store } = await start('samples', { seed, repo });
    await repo.insertRecord({
      id: 'r1',
      collectionId: 'growth',
      values: { name: '老记录' },
      createdAt: 1,
      updatedAt: 1,
    });
    await fireEvent.press(await screen.findByTestId('guide-sample-baby-growth'));
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    await waitFor(() => expect(store.getState().draft).toBeNull());
    const after = store.getState().config!;
    expect(after.data.tables.map((c) => c.id)).toEqual(['growth', 'growth-2']);
    expect(remindersOf(after)?.[0]).toMatchObject({ opens: 'page:baby' });
    expect((await repo.listRecords('growth')).map((r) => r.id)).toEqual(['r1']);
    expect(await screen.findByTestId('sample-hint')).toBeTruthy();
  });

  it('a full navigation bar puts the sample on the home page and opens its page after applying', async () => {
    // 默认工作空间的导航栏是满的：首页、工具、AI、历史、设置。
    const seed = seedWith(homeFileEntryOps, (locale) => createDefaultWorkspace(locale));
    const { store } = await start('samples', { seed });
    await fireEvent.press(await screen.findByTestId('guide-sample-study-helper'));
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    await waitFor(() => expect(store.getState().draft).toBeNull());
    const after = store.getState().config!;
    expect(after.nav.bar).toHaveLength(5);
    expect(after.nav.bar).not.toContain('page:study');
    expect(
      after.containers.pages
        .find((p) => p.id === 'home')!
        .blocks.some((c) => c.look === 'entry' && c.opens === 'page:study'),
    ).toBe(true);
    // 不在导航栏里的主页面推入一个新页面，提示卡片在那一页上。
    expect(await screen.findByTestId('sample-hint')).toHaveTextContent(/「学习助手」装好了/);
  });

  it('at the table limit it explains why and stays on step 3', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const seed = seedWith((config) =>
      Array.from({ length: 20 - config.data.tables.length }, (_, i) => ({
        op: 'addData' as const,
        table: {
          id: `t${i}`,
          name: `表${i}`,
          fields: [{ id: 'n', name: 'N', type: 'text' as const }],
        },
      })),
    );
    const { repo, store } = await start('samples', { seed });
    await fireEvent.press(await screen.findByTestId('guide-sample-expense-helper'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![1]).toMatch(/「报销助手」要新建数据表.*20 张/);
    expect(store.getState().draft).toBeNull();
    expect(await repo.getMeta('guide')).toBe('samples');
    expect(screen.getByTestId('guide-samples')).toBeTruthy();
  });
});
