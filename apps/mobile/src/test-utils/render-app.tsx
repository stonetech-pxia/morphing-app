import {
  BUILTIN_TOOLS,
  applyOps,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
  homeFileEntryOps,
  type Locale,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AISettingsProvider } from '../ai/context';
import { DraftChatSheet } from '../draft/DraftBar';
import { useDraftUi } from '../draft/ui';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import ReadyRoute from '../app/ready/[workflowId]';
import RecordRoute from '../app/record/[collectionId]';
import ReminderRoute from '../app/reminder/[workflowId]';
import RunRoute from '../app/run/[workflowId]';
import ShareRoute from '../app/share';
import StorageRoute from '../app/storage';
import WelcomeRoute from '../app/welcome';
import WorkflowRoute from '../app/workflow/[id]';
import WorkflowsRoute from '../app/workflows';
import QuickActionsRoute from '../app/quick-actions';
import QuickActionCategoryRoute from '../app/quick-actions/[kind]';
import { HomeScreenProvider } from '../home-screen/context';
import type { HomeScreenPlatform } from '../home-screen/platform';
import { HomeScreenBridge } from '../home-screen/useHomeScreen';
import { useIncomingShare } from '../share/useIncomingShare';
import { ToolDownloadsProvider } from '../tool-download/context';
import type { ToolDownloads } from '../tool-download/state';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { WidgetProvider } from '../widgets/context';
import type { WidgetPlatform } from '../widgets/types';
import { WidgetBridge } from '../widgets/useWidgets';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';
import { FakeFiles } from './fake-files';

// 工具和工作流旅程测试共用：真实路由 + 内存存储 + 假文件平台。

// 草稿模式的界面状态是模块级的（D-190）：每个测试从关着的聊天框开始。
afterEach(() => useDraftUi.setState({ chatOpen: false, seenStep: null }));

export const testRegistry = createRegistry(BUILTIN_TOOLS);

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

/** 和根布局一样接收分享（原生模块在测试里是假的或没有）。 */
function ShareListener({ files }: { files: FakeFiles }) {
  useIncomingShare(files);
  return null;
}

/** 新用户做完引导第 1 步的样子（D-231）：空白首页加上「打开相册」「打开文件」。 */
export function starterAfterGuide(locale: Locale, registry: Registry): WorkspaceConfig {
  const config = createStarterWorkspace(locale, registry);
  const result = applyOps(config, homeFileEntryOps(config), { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

export async function renderToolsApp(
  repo = new MemoryWorkspaceRepo(),
  files = new FakeFiles(),
  /** 下载的工具（D-177）：要用自己的注册表，下载时会往里面加工具。 */
  options: {
    registry?: Registry;
    locale?: Locale;
    toolDownloads?: ToolDownloads;
    /** 第一个版本；不传时是空白工作空间（App 里用 createStarterWorkspace）。 */
    seed?: (locale: Locale, registry: Registry) => WorkspaceConfig;
    /** 手机桌面（D-271）：假的长按菜单 / 桌面图标；不传时和 Expo Go 一样没有。 */
    homeScreen?: HomeScreenPlatform;
    /** 桌面小组件（D-321）：假的平台；不传时和 Expo Go 一样没有。 */
    widgets?: WidgetPlatform;
  } = {},
) {
  const registry = options.registry ?? testRegistry;
  const locale = options.locale ?? 'zh';
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale,
    now: () => new Date(2026, 9, 22, 9, 0),
    toolName: (id) =>
      options.toolDownloads?.getState().catalog?.tools.find((e) => e.id === id)?.name[locale],
    ...(options.seed ? { seed: options.seed } : {}),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AISettingsProvider store={aiSettings}>
          <WorkspaceProvider value={{ store, repo, files, registry, locale }}>
            <ShareListener files={files} />
            <HomeScreenProvider value={options.homeScreen ?? null}>
              <WidgetProvider value={options.widgets ?? null}>
                {options.toolDownloads ? (
                  <ToolDownloadsProvider value={options.toolDownloads}>
                    <Stack />
                    <DraftChatSheet />
                  </ToolDownloadsProvider>
                ) : (
                  <>
                    <Stack />
                    <DraftChatSheet />
                  </>
                )}
                <HomeScreenBridge platform={options.homeScreen ?? null} />
                <WidgetBridge platform={options.widgets ?? null} />
              </WidgetProvider>
            </HomeScreenProvider>
          </WorkspaceProvider>
        </AISettingsProvider>
      </GestureHandlerRootView>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'run/[workflowId]': RunRoute,
    'reminder/[workflowId]': ReminderRoute,
    workflows: WorkflowsRoute,
    'quick-actions/index': QuickActionsRoute,
    'quick-actions/[kind]': QuickActionCategoryRoute,
    'workflow/[id]': WorkflowRoute,
    share: ShareRoute,
    storage: StorageRoute,
    'ready/[workflowId]': ReadyRoute,
    'record/[collectionId]': RecordRoute,
    welcome: WelcomeRoute,
  });
  return { repo, store, files };
}

/** 系统确认框：直接点非取消的按钮（例如「应用更改」）。 */
export function acceptNextAlert() {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
}
