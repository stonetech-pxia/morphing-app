import { applyOps, type AIProvider, type Op } from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

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

  it('opens an app from a home button, swaps the bar, and goes back to Tinkrum', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    expect(screen.queryByTestId('nav-back-home')).toBeNull();

    await fireEvent.press((await screen.findAllByText('健身'))[0]!);
    // app 的底栏：自己的两页和 Tink，加固定的返回；主页的设置不在。
    expect(await screen.findByTestId('nav-page:fit-home')).toBeTruthy();
    expect(screen.getByTestId('nav-page:fit-plan')).toBeTruthy();
    expect(screen.getByTestId('nav-ai')).toBeTruthy();
    expect(screen.getByTestId('nav-back-home')).toBeTruthy();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
    expect(store.getState().appId).toBe('fit');

    await fireEvent.press(screen.getByTestId('nav-page:fit-plan'));
    expect(store.getState().tab).toBe('page:fit-plan');

    await fireEvent.press(screen.getByTestId('nav-back-home'));
    expect(await screen.findByTestId('nav-settings')).toBeTruthy();
    expect(screen.queryByTestId('nav-back-home')).toBeNull();
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
    expect(await screen.findByTestId('nav-back-home')).toBeTruthy();
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
    expect(screen.getByTestId('nav-back-home')).toBeTruthy();
  });

  it('falls back to the home page when the app the user is in goes away', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await act(async () => store.getState().enterApp('fit'));
    expect(await screen.findByTestId('nav-back-home')).toBeTruthy();
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
    const homeChange = planning([
      { op: 'addData', table } as never,
      { op: 'setTheme', primaryColor: '#ff0000' },
    ]);
    await act(async () => store.getState().enterApp('fit'));
    let result;
    await act(async () => {
      result = await store.getState().change('红色', homeChange);
    });
    expect(result).toMatchObject({ kind: 'invalid' });
    expect(store.getState().config!.data.tables.some((t) => t.id === 'logs')).toBe(false);
    expect(store.getState().config!.theme.primaryColor).not.toBe('#ff0000');
    await act(async () => store.getState().leaveApp());
    await act(async () => {
      result = await store.getState().change('红色', homeChange);
    });
    expect(result).not.toMatchObject({ kind: 'invalid' });
    expect(store.getState().config!.data.tables.some((t) => t.id === 'logs')).toBe(true);
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
    expect(await screen.findByTestId('nav-back-home')).toBeTruthy();
  });

  it('opens the app when the app was started from its home screen item', async () => {
    const fake = new FakeHomeScreen();
    fake.launched = 'app:fit';
    const { store } = await withHomeScreen(fake);
    await screen.findByTestId('nav-back-home');
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
    expect(await screen.findByTestId('nav-back-home')).toBeTruthy();
    expect(store.getState().appId).toBe('fit');
    await act(async () => store.getState().leaveApp());
    await act(async () => router.push('/app/gone'));
    await screen.findByTestId('nav-settings');
    expect(store.getState().appId).toBeNull();
  });
});
