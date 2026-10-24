import { BUILTIN_TOOLS, createMockAIProvider, createRegistry, type Registry } from '@morph/core';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { DraftChatSheet } from '../draft/DraftBar';
import { useDraftUi } from '../draft/ui';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import ReadyRoute from '../app/ready/[workflowId]';
import RunRoute from '../app/run/[workflowId]';
import ShareRoute from '../app/share';
import WelcomeRoute from '../app/welcome';
import WorkflowRoute from '../app/workflow/[id]';
import WorkflowsRoute from '../app/workflows';
import { useIncomingShare } from '../share/useIncomingShare';
import { ToolDownloadsProvider } from '../tool-download/context';
import type { ToolDownloads } from '../tool-download/state';
import { MemoryWorkspaceRepo } from '../storage/memory';
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

export async function renderToolsApp(
  repo = new MemoryWorkspaceRepo(),
  files = new FakeFiles(),
  /** 下载的工具（D-177）：要用自己的注册表，下载时会往里面加工具。 */
  options: { registry?: Registry; toolDownloads?: ToolDownloads } = {},
) {
  const registry = options.registry ?? testRegistry;
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22, 9, 0),
    toolName: (id) =>
      options.toolDownloads?.getState().catalog?.tools.find((e) => e.id === id)?.name.zh,
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
          <ShareListener files={files} />
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
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'run/[workflowId]': RunRoute,
    workflows: WorkflowsRoute,
    'workflow/[id]': WorkflowRoute,
    share: ShareRoute,
    'ready/[workflowId]': ReadyRoute,
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
