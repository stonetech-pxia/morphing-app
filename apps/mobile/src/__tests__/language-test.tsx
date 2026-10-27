import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  createStarterWorkspace,
  type AIProvider,
  type Locale,
  type Op,
  type PlanContext,
  type PlannedNotification,
  type ReminderTarget,
} from '@morph/core';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { LOOK_PROMPTS, useGuide } from '../guide/store';
import { useLocaleChoice } from '../locale/store';
import type { NotificationPlatform } from '../reminders/platform';
import { useReminderSync } from '../reminders/useReminders';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 「设置 → 语言」（D-254）：跟随系统或手动选一种，马上生效；选择只存在本机，不进配置版本。
// AI 修改页不再显示测试期保存请求的说明，只在「设置 → AI」显示（D-240）。

const registry = createRegistry(BUILTIN_TOOLS);
const TYPED = { timeout: 4000 };

afterEach(() => {
  jest.restoreAllMocks();
  useGuide.setState({ stage: null, repo: null });
});

async function openLanguage() {
  await fireEvent.press(await screen.findByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-language'));
  expect(await screen.findByTestId('language-system')).toBeTruthy();
}

describe('the beta storage note (D-240)', () => {
  it('is not shown under the AI change input, even with the Morph server', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      aiServer: true,
      seed: starterAfterGuide,
    });
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    expect(await screen.findByTestId('change-input')).toBeTruthy();
    expect(screen.queryByTestId('change-server-stored')).toBeNull();
    expect(screen.queryByText(/测试期间/)).toBeNull();
  });

  it('is still shown in Settings → AI when the Morph server is chosen', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      aiServer: true,
      seed: starterAfterGuide,
    });
    await act(() => router.push('/ai-settings'));
    expect(await screen.findByTestId('ai-server-stored')).toHaveTextContent(/测试期间/);
  });
});

describe('choosing the interface language', () => {
  it('follows the system by default and names the system language in its own language', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: starterAfterGuide });
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    expect(await screen.findByTestId('settings-language')).toHaveTextContent(/中文（跟随系统）/);
    await fireEvent.press(screen.getByTestId('settings-language'));
    expect(await screen.findByTestId('language-system')).toHaveTextContent(/跟随系统/);
    expect(screen.getByTestId('language-en')).toHaveTextContent('English');
    expect(screen.getByTestId('language-zh')).toHaveTextContent('中文');
    expect(screen.getByTestId('language-fr')).toHaveTextContent('Français');
    expect(screen.getByTestId('language-note')).toHaveTextContent(/权限弹窗/);
  });

  it('switches the whole interface right away, and back to the system language', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { store } = await renderToolsApp(repo, new FakeFiles(), { seed: starterAfterGuide });
    const head = store.getState().head!.id;
    const config = store.getState().config;
    await openLanguage();

    await fireEvent.press(screen.getByTestId('language-fr'));
    expect(await screen.findByTestId('language-note')).toHaveTextContent(/S’applique/);
    expect(screen.getByTestId('language-system')).toHaveTextContent(/Suivre le système/);
    await act(() => router.back());
    expect(await screen.findByTestId('settings-language')).toHaveTextContent(/^Langue\s*Français/);
    expect(screen.getAllByText('Paramètres').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId('settings-language'));
    await fireEvent.press(await screen.findByTestId('language-system'));
    expect(await screen.findByTestId('language-note')).toHaveTextContent(/权限弹窗/);

    // 不进工作空间配置、不生成版本（D-254）。
    expect(store.getState().head!.id).toBe(head);
    expect(store.getState().config).toBe(config);
    expect((await repo.listRevisions(50)).map((r) => r.id)).toEqual([head]);
    expect(JSON.stringify(store.getState().config)).not.toMatch(/"locale"/);
  });

  it('keeps the choice after a restart', async () => {
    const repo = new MemoryWorkspaceRepo();
    await renderToolsApp(repo, new FakeFiles(), { seed: starterAfterGuide });
    await openLanguage();
    await fireEvent.press(screen.getByTestId('language-en'));
    expect(await repo.getMeta('locale')).toBe('en');
    screen.unmount();

    // 重启：同一个本机数据库，系统语言仍是中文。
    await renderToolsApp(repo, new FakeFiles(), { seed: starterAfterGuide });
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    expect(await screen.findByTestId('settings-language')).toHaveTextContent(
      /^Language\s*English›?$/,
    );
  });

  it('the locale store resolves the choice against the system language', async () => {
    const repo = new MemoryWorkspaceRepo();
    await useLocaleChoice.getState().load(repo, 'zh');
    expect(useLocaleChoice.getState().locale).toBe('zh');
    await useLocaleChoice.getState().setChoice('fr');
    expect(useLocaleChoice.getState().locale).toBe('fr');
    await useLocaleChoice.getState().setChoice('system');
    expect(useLocaleChoice.getState().locale).toBe('zh');
    // 本机记录坏了就跟随系统。
    await repo.setMeta('locale', 'de');
    await useLocaleChoice.getState().load(repo, 'en');
    expect(useLocaleChoice.getState()).toMatchObject({ choice: 'system', locale: 'en' });
  });

  it('the AI gets the chosen language with the next request', async () => {
    const seen: Locale[] = [];
    const provider: AIProvider = {
      async plan(_input: string, ctx: PlanContext) {
        seen.push(ctx.locale);
        return { kind: 'reject', reason: 'unknown', message: '—', examples: [] } as const;
      },
    };
    const repo = new MemoryWorkspaceRepo();
    await useLocaleChoice.getState().load(repo, 'zh');
    const store = createWorkspaceStore({
      repo,
      provider,
      registry,
      locale: () => useLocaleChoice.getState().locale,
      now: () => new Date(2026, 9, 27, 9),
    });
    await store.getState().boot();
    await store.getState().propose('改一下');
    await useLocaleChoice.getState().setChoice('fr');
    await store.getState().propose('change');
    expect(seen).toEqual(['zh', 'fr']);
  });

  it('a French guide with the built-in rules still sends the English sentence after switching (D-228)', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta('guide', 'look');
    await act(() => useGuide.getState().load(repo));
    await renderToolsApp(repo, new FakeFiles(), { seed: createStarterWorkspace });
    await openLanguage();
    await fireEvent.press(screen.getByTestId('language-fr'));
    await act(() => router.back());
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    await waitFor(
      () => expect(screen.getByTestId('change-input').props.editable).toBe(true),
      TYPED,
    );
    expect(screen.getByTestId('change-input')).toHaveProp('value', LOOK_PROMPTS[0]!.en);
  });
});

describe('reminders follow the chosen language (D-251)', () => {
  it('reschedules with the new language when the user switches', async () => {
    const scheduled: PlannedNotification[][] = [];
    const platform: NotificationPlatform = {
      permission: async () => 'granted',
      request: async () => true,
      replaceAll: async (planned) => void scheduled.push([...planned]),
      onOpen: (_l: (opens: ReminderTarget) => void) => () => {},
    };
    const ops: Op[] = [
      {
        op: 'addCollection',
        collection: {
          id: 'bills',
          name: 'Bills',
          fields: [{ id: 'due', name: 'Due', type: 'date' }],
        },
      },
      {
        op: 'addReminder',
        reminder: {
          id: 'due',
          title: 'Due',
          enabled: true,
          schedule: 'dateField',
          time: '08:00',
          collectionId: 'bills',
          fieldId: 'due',
          daysBefore: 3,
          opens: 'page:home',
        },
      },
    ];
    const seeded = applyOps(createDefaultWorkspace('en'), ops, { registry, locale: 'en' });
    if (!seeded.ok) throw new Error(seeded.error);
    const repo = new MemoryWorkspaceRepo();
    await useLocaleChoice.getState().load(repo, 'en');
    const store = createWorkspaceStore({
      repo,
      provider: {
        plan: async () => ({ kind: 'reject', reason: 'unknown', message: '—', examples: [] }),
      },
      registry,
      locale: () => useLocaleChoice.getState().locale,
      now: () => new Date(),
      seed: () => seeded.config,
    });
    await store.getState().boot();
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await repo.insertRecord({
      id: 'b1',
      collectionId: 'bills',
      values: { due },
      createdAt: 0,
      updatedAt: 0,
    });
    function Sync() {
      useReminderSync(platform);
      return null;
    }
    function App() {
      const locale = useLocaleChoice((s) => s.locale);
      return (
        <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale }}>
          <Sync />
        </WorkspaceProvider>
      );
    }
    render(<App />);
    await waitFor(() => expect(scheduled.at(-1)?.[0]?.body).toMatch(/is due in 3 days/));
    await act(() => useLocaleChoice.getState().setChoice('fr'));
    await waitFor(() => expect(scheduled.at(-1)?.[0]?.body).toMatch(/dans 3 jours/));
  });
});
