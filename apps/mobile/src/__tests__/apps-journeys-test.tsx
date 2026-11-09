import { THEME_PRESETS, applyOps, type AIProvider, type Op } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert, AppState } from 'react-native';

import type { HomeScreenEntry, HomeScreenPlatform } from '../home-screen/platform';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide, testRegistry } from '../test-utils/render-app';

// 多个 app（D-485）：从主页的入口进入，底栏换成 app 自己的，固定的「返回 Tinkrum」回主页。

/** 一个健身 app：两页，底栏是两页加 Tink；主页上有入口按钮。 */
function withFitness(locale: 'zh' | 'en' | 'fr', registry: typeof testRegistry) {
  const base = starterAfterGuide(locale, registry);
  const ops: Op[] = [
    { op: 'addContainer', app: { id: 'fit', name: '健身', icon: 'heart' } },
    { op: 'addContainer', page: { id: 'fit-home', title: '今天', app: 'fit', blocks: [] } },
    { op: 'addContainer', page: { id: 'fit-plan', title: '计划', app: 'fit', blocks: [] } },
    { op: 'updateContainer', app: { id: 'fit', bar: ['page:fit-home', 'page:fit-plan', 'ai'] } },
    { op: 'setTheme', app: 'fit', primaryColor: '#2255aa' },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'open-fit',
        look: 'button',
        show: { label: '健身', variant: 'row' },
        opens: 'app:fit',
      } as never,
    },
    // 入口卡片：不写名字和图标，按 app 现取。
    {
      op: 'addContainer',
      page: 'home',
      block: { id: 'fit-card', look: 'entry', opens: 'app:fit' } as never,
    },
  ];
  const result = applyOps(base, ops, { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

describe('apps (UI)', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: withFitness });

  // 子 App 里没有「返回 Tinkrum」（D-485）：离开 App 再回来就是回到主页。
  const handlers: ((state: string) => void)[] = [];
  const toState = (state: string) => handlers.forEach((h) => h(state));
  const appState = () =>
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      handler: (state: string) => void,
    ) => {
      handlers.push(handler);
      return { remove: () => {} };
    }) as never);
  /** 等一会儿（让 700 毫秒的延迟检查跑完）。 */
  const wait = async (ms: number) => {
    const t0 = Date.now();
    await waitFor(
      () => {
        if (Date.now() - t0 < ms) throw new Error('waiting');
      },
      { timeout: ms + 3000, interval: 50 },
    );
  };
  /** 离开 App 再回来（点手机上的 Tinkrum 图标）。 */
  const leaveAndReturn = async () => {
    await act(async () => toState('background'));
    await act(async () => toState('active'));
    await wait(900);
  };

  it('opens an app from a home button, swaps the bar, and has no way back inside', async () => {
    appState();
    const { store } = await start();
    await screen.findByTestId('nav-settings');

    await fireEvent.press((await screen.findAllByText('健身'))[0]!);
    // app 的底栏：自己的两页和 Tink；主页的设置不在，也没有返回主页的入口。
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
    expect(screen.getByTestId('nav-page:fit-plan')).toBeTruthy();
    expect(screen.getByTestId('nav-ai')).toBeTruthy();
    expect(screen.queryByTestId('nav-back-home')).toBeNull();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
    expect(store.getState().appId).toBe('fit');

    await fireEvent.press(screen.getByTestId('nav-page:fit-plan'));
    expect(store.getState().tab).toBe('page:fit-plan');

    // 离开再回来：回到真正的主页。
    await leaveAndReturn();
    expect(await screen.findByTestId('nav-settings')).toBeTruthy();
    expect(store.getState().appId).toBeNull();
    // 进出 app 不写任何数据（底线 15）：版本没变。
    expect(store.getState().head!.id).toBe(1);
  });

  it('an entry card that opens an app takes its name from the app, and Settings lists the app', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    // 按钮和入口卡片各有一个“健身”。
    expect(screen.getAllByText('健身').length).toBe(2);
    await fireEvent.press(screen.getByTestId('nav-settings'));
    expect(await screen.findByText('我的 App'.toUpperCase())).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-app-fit'));
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
    expect(store.getState().appId).toBe('fit');
  });

  it('shows an empty state for a new app that has only Tink in its bar', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    const result = applyOps(
      store.getState().config!,
      [{ op: 'addContainer', app: { id: 'blank', name: '空白' } }],
      { registry: testRegistry, locale: 'zh' },
    );
    if (!result.ok) throw new Error(result.error);
    await act(async () => {
      store.setState({ config: result.config });
      store.getState().enterApp('blank');
    });
    expect(await screen.findByText('这个 App 还没有页面，点 Tink 来搭一个。')).toBeTruthy();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
  });

  it('falls back to the home page when the app the user is in goes away', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await act(async () => store.getState().enterApp('fit'));
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
    const result = applyOps(store.getState().config!, [{ op: 'removeContainer', app: 'fit' }], {
      registry: testRegistry,
      locale: 'zh',
    });
    if (!result.ok) throw new Error(result.error);
    await act(async () => store.setState({ config: result.config }));
    expect(await screen.findByTestId('nav-settings')).toBeTruthy();
    expect(store.getState().appId).toBeNull();
  });

  it('opening a page of another app switches to that app', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    // 例如提醒、小组件打开 app 里的页面：先切到它的 app。
    let shown = false;
    await act(async () => {
      const nav = store.getState();
      shown = nav.showInShell(nav.config!, 'page:fit-plan');
    });
    expect(shown).toBe(true);
    expect(store.getState().appId).toBe('fit');
    expect(store.getState().tab).toBe('page:fit-plan');
  });

  // 在 app 里的 Tink 只能改这个 app（D-485，暂定规则）。
  const planning = (ops: Op[]): AIProvider => ({ plan: async () => ({ kind: 'ops', ops }) });
  const table = { id: 'logs', name: '记录', fields: [{ id: 'title', name: '标题', type: 'text' }] };

  it('inside an app Tink may add to the app, and what it adds belongs to the app', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await act(async () => store.getState().enterApp('fit'));
    let result;
    await act(async () => {
      result = await store
        .getState()
        .change('加一张表', planning([{ op: 'addData', table } as never]));
    });
    expect(result).toMatchObject({ kind: 'applied' });
    expect(store.getState().config!.data.tables.find((t) => t.id === 'logs')!.app).toBe('fit');
  });

  it('inside an app Tink cannot change the home; the same change from the home works', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    // 没写 app 的风格在 app 里是这个 app 的风格（opsForApp）；主页的页面在 app 里改不了。
    const homeChange = planning([
      { op: 'addData', table } as never,
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'hi', look: 'text', show: { text: 'hi' } } as never,
      },
    ]);
    const hasHi = () =>
      store
        .getState()
        .config!.containers.pages.find((p) => p.id === 'home')!
        .blocks.some((b) => b.id === 'hi');
    await act(async () => store.getState().enterApp('fit'));
    let result;
    await act(async () => {
      result = await store.getState().change('首页加一句话', homeChange);
    });
    expect(result).toMatchObject({ kind: 'invalid' });
    expect(store.getState().config!.data.tables.some((t) => t.id === 'logs')).toBe(false);
    expect(hasHi()).toBe(false);
    await act(async () => store.getState().leaveApp());
    await act(async () => {
      result = await store.getState().change('首页加一句话', homeChange);
    });
    expect(result).not.toMatchObject({ kind: 'invalid' });
    expect(store.getState().config!.data.tables.some((t) => t.id === 'logs')).toBe(true);
  });

  // 创始人 2026-11-08 在手机上：子 App 的 Tink 页「选风格」和两个预设句子都被「超出范围」拦下。
  it('inside an app, Pick a style changes the app style, not the home style', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    const homeTheme = store.getState().config!.theme;
    await act(async () => store.getState().enterApp('fit'));
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    await fireEvent.press(await screen.findByTestId('change-pick-style'));
    await fireEvent.press(await screen.findByTestId('style-material'));
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    await waitFor(() =>
      expect(store.getState().config!.nav.apps!.find((a) => a.id === 'fit')!.theme).toEqual(
        THEME_PRESETS.material.theme,
      ),
    );
    expect(store.getState().config!.theme).toEqual(homeTheme);
    // 草稿和应用以后都还在这个 app 里（风格的修改不带页面，不能回落到主页）。
    expect(store.getState().appId).toBe('fit');
    // 再打开选风格：标出的是这个 app 现在的风格。
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    await fireEvent.press(await screen.findByTestId('change-pick-style'));
    expect((await screen.findByTestId('style-material')).props.accessibilityState.selected).toBe(
      true,
    );
  });

  it.each([
    ['change-want-receipts', 'receipts'],
    ['change-want-cards', 'contacts'],
  ])('inside an app, %s builds the sample inside the app', async (id, tableId) => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    const before = store.getState().config!;
    await act(async () => store.getState().enterApp('fit'));
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    await fireEvent.press(await screen.findByTestId(id));
    await fireEvent.press(screen.getByTestId('change-submit'));
    await waitFor(() =>
      expect(store.getState().config!.data.tables.find((t) => t.id === tableId)?.app).toBe('fit'),
    );
    expect(screen.queryByTestId('change-feedback')).toBeNull();
    // 页面在草稿里：应用草稿后都属于这个 app，主页面进了 app 的底栏，主页没动。
    await fireEvent.press(await screen.findByTestId('draft-apply'));
    await waitFor(() => expect(store.getState().draft).toBeNull());
    const after = store.getState().config!;
    const added = after.containers.pages.filter(
      (p) => !before.containers.pages.some((o) => o.id === p.id),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const page of added) expect(page.app).toBe('fit');
    for (const tool of after.tools.filter((x) => !before.tools.some((o) => o.id === x.id)))
      expect(tool.app).toBe('fit');
    expect(after.nav.apps!.find((a) => a.id === 'fit')!.bar).toHaveLength(4);
    expect(after.nav.bar).toEqual(before.nav.bar);
    expect(after.containers.pages.find((p) => p.id === 'home')).toEqual(
      before.containers.pages.find((p) => p.id === 'home'),
    );
  });

  // 桌面菜单里的 App 和深链接（D-485）。
  class FakeHomeScreen implements HomeScreenPlatform {
    menus: HomeScreenEntry[][] = [];
    pinned: HomeScreenEntry[] = [];
    launched: string | null = null;
    private listener: ((id: string) => void) | null = null;
    async setItems(items: readonly HomeScreenEntry[]) {
      this.menus.push([...items]);
    }
    canPin() {
      return true;
    }
    async pin(item: HomeScreenEntry) {
      this.pinned.push(item);
      return true;
    }
    takeLaunched() {
      const id = this.launched;
      this.launched = null;
      return id;
    }
    onOpen(listener: (id: string) => void) {
      this.listener = listener;
      return () => {
        this.listener = null;
      };
    }
    tap(id: string) {
      this.listener?.(id);
    }
  }
  const withHomeScreen = (fake: HomeScreenPlatform) =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      seed: withFitness,
      homeScreen: fake,
    });

  it('long-press an app in Settings puts it on the phone home screen menu, and tapping it opens the app', async () => {
    const fake = new FakeHomeScreen();
    const { store } = await withHomeScreen(fake);
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    // 长按弹出菜单，点第一项「放到桌面」。
    jest
      .spyOn(Alert, 'alert')
      .mockImplementationOnce((_title, _message, buttons) => void buttons?.[0]?.onPress?.());
    await fireEvent(await screen.findByTestId('settings-app-fit'), 'longPress');
    await screen.findByText('在桌面菜单里');
    expect(store.getState().config!.nav.phoneHomeScreen).toEqual(['app:fit']);
    expect(fake.menus.at(-1)).toEqual([{ id: 'app:fit', title: '健身', symbol: 'heart.fill' }]);
    // 点桌面菜单：进那个 App。
    await act(async () => fake.tap('app:fit'));
    expect(store.getState().appId).toBe('fit');
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
  });

  it('opens the app when the app was started from its home screen item', async () => {
    const fake = new FakeHomeScreen();
    fake.launched = 'app:fit';
    const { store } = await withHomeScreen(fake);
    await screen.findByTestId('nav-page:fit-home');
    expect(store.getState().appId).toBe('fit');
  });

  it('stays on the home page when the menu item is for an app that is gone', async () => {
    const fake = new FakeHomeScreen();
    const { store } = await withHomeScreen(fake);
    await screen.findByTestId('nav-settings');
    await act(async () => fake.tap('app:gone'));
    expect(store.getState().appId).toBeNull();
  });

  it('morph://app/<id> opens the app, and an unknown id stays on the home page', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await act(async () => router.push('/app/fit'));
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
    expect(store.getState().appId).toBe('fit');
    await act(async () => store.getState().leaveApp());
    await act(async () => router.push('/app/gone'));
    await screen.findByTestId('nav-settings');
    expect(store.getState().appId).toBeNull();
  });

  it('stays in the app when the app is opened from the home screen after being away', async () => {
    appState();
    const fake = new FakeHomeScreen();
    const { store } = await withHomeScreen(fake);
    await screen.findByTestId('nav-settings');
    await act(async () => toState('background'));
    await act(async () => toState('active'));
    // 回到前台以后桌面菜单的点按才到：进入 App 比离开晚，所以留在 App 里。
    await act(async () => fake.tap('app:fit'));
    await wait(900);
    expect(store.getState().appId).toBe('fit');
  });

  it('being away from the home page changes nothing', async () => {
    appState();
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await leaveAndReturn();
    expect(store.getState().appId).toBeNull();
    expect(store.getState().head!.id).toBe(1);
  });
});
