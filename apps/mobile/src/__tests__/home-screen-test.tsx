import {
  WORKFLOW_PRESETS,
  createStarterWorkspace,
  presetWorkflow,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import type { HomeScreenEntry, HomeScreenPlatform } from '../home-screen/platform';
import { renderToolsApp } from '../test-utils/render-app';
import type { WorkspaceStore } from '../workspace/store';

// 手机桌面（D-269）：长按 Morph 图标的菜单跟着正式版本的配置变（AI、撤销、删除、改名）；从桌面打开直接开始；
// Android 的「添加到桌面」只有用户点了才请求（系统会弹确认框）；iOS 只说明长按 Morph 图标。

class FakeHomeScreen implements HomeScreenPlatform {
  /** 每次整份换掉的菜单。 */
  menus: HomeScreenEntry[][] = [];
  disabledMessage = '';
  pinned: HomeScreenEntry[] = [];
  launched: string | null = null;
  private listener: ((id: string) => void) | null = null;
  constructor(private readonly pinnable: boolean) {}
  async setItems(items: readonly HomeScreenEntry[], disabledMessage: string) {
    this.menus.push([...items]);
    this.disabledMessage = disabledMessage;
  }
  canPin() {
    return this.pinnable;
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
  /** 用户点了桌面菜单（App 开着）。 */
  tap(id: string) {
    this.listener?.(id);
  }
  get menu() {
    return this.menus.at(-1);
  }
}

async function askAi(text: string) {
  await fireEvent.press(screen.getByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
}

async function addVisa(store: WorkspaceStore) {
  const wf = presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', 'visa-photo');
  await act(async () => {
    await store.getState().proposeOps([{ op: 'addWorkflow', workflow: wf }], 'add');
    await store.getState().confirm();
  });
}

/** 新用户的工作空间加上几个现成的快捷操作：on 里的放到桌面，off 里的不放。 */
const withPresets =
  (on: number[], off: number[] = []) =>
  (locale: Locale, registry: Registry) => {
    const config = createStarterWorkspace(locale, registry);
    const added: Workflow[] = [...on, ...off].map((i) => {
      const wf = presetWorkflow(WORKFLOW_PRESETS[i]!, locale, WORKFLOW_PRESETS[i]!.id);
      return on.includes(i) ? { ...wf, homeScreen: true as const } : wf;
    });
    return { ...config, workflows: [...config.workflows, ...added] };
  };

describe('quick actions on the phone home screen (D-269)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('AI puts one there; Android offers “add to home screen” and only asks when tapped', async () => {
    const home = new FakeHomeScreen(true);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    // 新用户：菜单是空的（也会停用以前留在桌面上的图标）。
    await waitFor(() => expect(home.menu).toEqual([]));
    await addVisa(store);
    expect(home.menu).toEqual([]);

    await askAi('把签证照片放到桌面');
    // 功能类修改（D-191）：直接应用，打开它的「做好了」，说明怎么用。
    const ready = await screen.findByTestId('ready-screen');
    expect(within(ready).getByTestId('home-screen-how')).toHaveTextContent(/长按 Morph 图标/);
    await waitFor(() =>
      expect(home.menu).toEqual([
        { id: 'visa-photo', title: '签证 / 证件照', symbol: expect.any(String) },
      ]),
    );
    expect(home.disabledMessage).toBe('这个快捷操作已经不在桌面上了。');
    // 不能在应用修改时自己弹系统框。
    expect(home.pinned).toEqual([]);
    await fireEvent.press(screen.getByTestId('home-screen-pin'));
    expect(home.pinned).toEqual([
      expect.objectContaining({ id: 'visa-photo', title: '签证 / 证件照' }),
    ]);
    // 首页没有因此多一个卡片（「放到桌面」不是「放到首页」，D-109）。
    const page = store.getState().config!.pages.find((p) => p.id === 'home')!;
    expect(page.components.some((c) => c.type === 'workflowRunner')).toBe(false);
  });

  it('undo takes it off the menu again', async () => {
    const home = new FakeHomeScreen(true);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    await addVisa(store);
    await askAi('把签证照片放到桌面');
    await waitFor(() => expect(home.menu?.map((e) => e.id)).toEqual(['visa-photo']));
    const banner = await within(await screen.findByTestId('ready-screen')).findByTestId('banner');
    await fireEvent.press(within(banner).getByText('撤销'));
    await waitFor(() => expect(home.menu).toEqual([]));
    expect(store.getState().config!.workflows.find((w) => w.id === 'visa-photo')!.homeScreen).toBe(
      undefined,
    );
  });

  it('renaming and deleting the quick action update the menu', async () => {
    const home = new FakeHomeScreen(true);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    await addVisa(store);
    await act(async () => {
      await store
        .getState()
        .proposeOps(
          [{ op: 'setWorkflowHomeScreen', workflowId: 'visa-photo', homeScreen: true }],
          'on',
        );
      await store.getState().confirm();
    });
    await waitFor(() => expect(home.menu?.map((e) => e.title)).toEqual(['签证 / 证件照']));
    await act(async () => {
      await store
        .getState()
        .proposeOps(
          [{ op: 'renameWorkflow', workflowId: 'visa-photo', name: '美签照片' }],
          'rename',
        );
      await store.getState().confirm();
    });
    await waitFor(() => expect(home.menu?.map((e) => e.title)).toEqual(['美签照片']));
    await act(async () => {
      await store.getState().proposeOps([{ op: 'removeWorkflow', workflowId: 'visa-photo' }], 'rm');
      await store.getState().confirm();
    });
    // 菜单里没有了；Android 上固定在桌面上的图标由模块停用（不在菜单里的都停用）。
    await waitFor(() => expect(home.menu).toEqual([]));
  });

  it('iOS has no pin button, only how to find it', async () => {
    const home = new FakeHomeScreen(false);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    await addVisa(store);
    await askAi('把签证照片放到桌面');
    const ready = await screen.findByTestId('ready-screen');
    expect(within(ready).getByTestId('home-screen-how')).toHaveTextContent(
      '在手机桌面上长按 Morph 图标就能看到「签证 / 证件照」，在那里点一下直接开始。',
    );
    expect(screen.queryByTestId('home-screen-pin')).toBeNull();
  });

  it('“放到首页” still means the home page and puts nothing on the phone', async () => {
    const home = new FakeHomeScreen(true);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    await addVisa(store);
    await askAi('把签证照片放到首页');
    // 首页是 App 里的外观，先进草稿（D-190）；草稿里首页多了运行卡片，手机桌面没有变化。
    const draft = await waitFor(() => store.getState().draft!.steps.at(-1)!.config);
    expect(
      draft.pages.find((p) => p.id === 'home')!.components.some((c) => c.type === 'workflowRunner'),
    ).toBe(true);
    expect(draft.workflows.some((w) => w.homeScreen)).toBe(false);
    expect(home.menu).toEqual([]);
    expect(screen.queryByTestId('home-screen-how')).toBeNull();
  });

  it('opening from the home screen starts the quick action, cold or warm', async () => {
    const home = new FakeHomeScreen(true);
    home.launched = 'visa-photo';
    await renderToolsApp(undefined, undefined, { homeScreen: home, seed: withPresets([0]) });
    // 冷启动：启动完直接是运行页面（和点运行卡片一样开始，D-108），只开一次。
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
    expect(home.launched).toBeNull();
    await act(() => router.back());
    await waitFor(() => expect(screen.queryByTestId('run-screen')).toBeNull());
    // App 开着时点菜单。
    await act(async () => home.tap('visa-photo'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
  });

  it('the quick action editor puts it on and takes it off; a full menu says to take one off', async () => {
    const home = new FakeHomeScreen(true);
    const { store } = await renderToolsApp(undefined, undefined, { homeScreen: home });
    await addVisa(store);
    await act(() => router.push('/workflow/visa-photo'));
    await fireEvent.press(await screen.findByTestId('workflow-home-screen'));
    await waitFor(() => expect(home.menu?.map((e) => e.id)).toEqual(['visa-photo']));
    expect(await screen.findByTestId('home-screen-pin')).toBeTruthy();
    expect(screen.getByTestId('workflow-home-screen')).toHaveTextContent('从桌面拿掉');
    await fireEvent.press(screen.getByTestId('workflow-home-screen'));
    await waitFor(() => expect(home.menu).toEqual([]));
    expect(screen.queryByTestId('home-screen-pin')).toBeNull();
  });

  it('a full menu says to take one off first and changes nothing', async () => {
    const home = new FakeHomeScreen(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { store } = await renderToolsApp(undefined, undefined, {
      homeScreen: home,
      seed: withPresets([1, 2, 3, 4], [0]),
    });
    await waitFor(() => expect(home.menu).toHaveLength(4));
    const head = store.getState().head!.id;
    await act(() => router.push(`/workflow/${WORKFLOW_PRESETS[0]!.id}`));
    await fireEvent.press(await screen.findByTestId('workflow-home-screen'));
    expect(alert).toHaveBeenCalledWith('桌面菜单最多放 4 个快捷操作，先拿掉一个。');
    expect(store.getState().head!.id).toBe(head);
  });
});
