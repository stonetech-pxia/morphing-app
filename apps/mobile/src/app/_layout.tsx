import {
  localize,
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
  trustedToolKeys,
} from '@morph/core';
import { Karla_400Regular } from '@expo-google-fonts/karla/400Regular';
import { Karla_400Regular_Italic } from '@expo-google-fonts/karla/400Regular_Italic';
import { Karla_500Medium } from '@expo-google-fonts/karla/500Medium';
import { Karla_700Bold } from '@expo-google-fonts/karla/700Bold';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { openDatabaseAsync } from 'expo-sqlite';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { AISettingsProvider } from '@/ai/context';
import { createAIRouter } from '@/ai/router';
import { getDeviceId, secureSecretStore } from '@/ai/secure-store';
import { createAISettingsStore } from '@/ai/settings';
import { DraftChatSheet } from '@/draft/DraftBar';
import { useGuide } from '@/guide/store';
import { getDeviceLocale, t } from '@/i18n';
import { PackBridge } from '@/packs/bridge';
import { expoBridgeFiles, expoPackFs, expoSha256 } from '@/packs/expo-pack-fs';
import { PackHostProvider } from '@/packs/PackHost';
import { PackStore } from '@/packs/store';
import { expoFilePlatform } from '@/runtime/expo-platform';
import { closeButtonOption, stackScreenOptions } from '@/shell/header';
import { CLAY_FONTS, usePalette } from '@/renderer/theme';
import { useIncomingShare } from '@/share/useIncomingShare';
import { ToolDownloadsProvider } from '@/tool-download/context';
import { expoToolFs } from '@/tool-download/expo-tool-fs';
import { createToolDownloads } from '@/tool-download/state';
import { ToolDownloadStore } from '@/tool-download/store';
import { SQLiteWorkspaceRepo, migrateDatabase } from '@/storage/sqlite';
import { WorkspaceProvider, useWorkspace } from '@/workspace/context';
import { createNeedSender, createRemoteAIProvider } from '@/workspace/remote-ai';
import { createWorkspaceStore, type WorkspaceStore } from '@/workspace/store';

const locale = getDeviceLocale();
// 扩展包：只在用户确认后下载，存在 documentDirectory/packs（D-064）。
const packStore = new PackStore(expoPackFs, expoSha256);
const packs = { store: packStore, bridge: new PackBridge(expoBridgeFiles(packStore)) };
const registry = createRegistry(BUILTIN_TOOLS);
// 从服务器下载的工具（D-177、D-178）：目录地址不是秘密；开发版另外信任仓库里的开发公钥。
const toolsUrl = process.env.EXPO_PUBLIC_MORPH_TOOLS_URL;
const toolDownloads = createToolDownloads({
  store: new ToolDownloadStore(expoToolFs, expoSha256, {
    baseUrl: toolsUrl ?? '',
    trustedKeys: trustedToolKeys(__DEV__),
  }),
  registry,
  configured: Boolean(toolsUrl),
});
/** 启动时目录超过一天没拉就拉一次（停用名单靠它生效，D-178）。 */
const CATALOG_DAY_MS = 24 * 60 * 60 * 1000;
// AI 来源由「设置 → AI」决定：内置规则、Morph 服务器（需配置地址，见 README）或用户自带 key。
const apiUrl = process.env.EXPO_PUBLIC_MORPH_API_URL;
// 平台和版本随需求（D-189）和测试期保存的请求（D-240）发给服务器。
const appInfo = {
  ...(Platform.OS === 'ios' || Platform.OS === 'android' ? { platform: Platform.OS } : {}),
  ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
};
const aiSettings = createAISettingsStore({
  secrets: secureSecretStore,
  serverAvailable: Boolean(apiUrl),
  // 需求回收（D-189）：配置了服务器地址时，AI 做不到的那句话可以由用户点一下发过去。
  needs: apiUrl
    ? createNeedSender({
        baseUrl: apiUrl,
        clientToken: process.env.EXPO_PUBLIC_MORPH_CLIENT_TOKEN,
        deviceId: getDeviceId,
        ...appInfo,
      })
    : null,
});
const provider = createAIRouter({
  settings: aiSettings,
  mock: createMockAIProvider(),
  remote: apiUrl
    ? createRemoteAIProvider({
        baseUrl: apiUrl,
        clientToken: process.env.EXPO_PUBLIC_MORPH_CLIENT_TOKEN,
        deviceId: getDeviceId,
        ...appInfo,
        registry,
        now: () => new Date(),
      })
    : null,
  registry,
  now: () => new Date(),
});

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

function RootStack() {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const config = useWorkspace((s) => s.config);
  if (status === 'error' || !config) {
    return (
      <Centered>
        {status === 'error' ? (
          <Text>{`${t(locale, 'bootFailed')}\n${error}`}</Text>
        ) : (
          <ActivityIndicator />
        )}
      </Centered>
    );
  }
  return <ThemedStack />;
}

function ThemedStack() {
  const theme = useWorkspace((s) => s.config!.theme);
  // 别的 App 分享进来的文件 → 收件页面（D-114）。
  useIncomingShare(expoFilePlatform);
  const palette = usePalette(theme);
  const closable = { presentation: 'modal', ...closeButtonOption(palette) } as const;
  return (
    <>
      <StatusBar style={palette.dark ? 'light' : 'dark'} />
      <Stack screenOptions={stackScreenOptions(palette)}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="change" options={{ ...closable, title: t(locale, 'changeTitle') }} />
        <Stack.Screen name="page/[pageId]" />
        <Stack.Screen name="ai-settings" options={{ title: t(locale, 'aiSettingsTitle') }} />
        <Stack.Screen name="data" options={{ title: t(locale, 'dataTitle') }} />
        <Stack.Screen name="packs" options={{ title: t(locale, 'packsTitle') }} />
        <Stack.Screen
          name="quick-actions/index"
          options={{ title: t(locale, '_layout_What_Morph_can_do_8f4f4') }}
        />
        <Stack.Screen name="quick-actions/[kind]" />
        <Stack.Screen name="workflows" options={{ title: t(locale, 'workflowsTitle') }} />
        <Stack.Screen name="workflow/[id]" />
        <Stack.Screen name="record/[collectionId]" options={closable} />
        <Stack.Screen name="run/[workflowId]" options={closable} />
        <Stack.Screen name="share" options={closable} />
        <Stack.Screen name="ready/[workflowId]" options={{ ...closable, title: '' }} />
        <Stack.Screen name="table-ready/[collectionId]" options={{ ...closable, title: '' }} />
        <Stack.Screen
          name="welcome"
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
      </Stack>
      {/* 草稿模式的聊天框只放一个（D-190）：外壳每改一步会重新挂载，推入的页面也要用它。 */}
      <DraftChatSheet />
    </>
  );
}

export default function RootLayout() {
  const [runtime, setRuntime] = useState<{
    store: WorkspaceStore;
    repo: SQLiteWorkspaceRepo;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 默认风格 Clay 的字体（Sora 标题、Karla 正文）。加载失败时退回系统字体，不阻塞启动。
  const [fontsLoaded, fontError] = useFonts({
    [CLAY_FONTS.heading]: Sora_700Bold,
    [CLAY_FONTS.title]: Sora_600SemiBold,
    [CLAY_FONTS.body]: Karla_400Regular,
    Karla_400Regular_Italic,
    [CLAY_FONTS.bodyMedium]: Karla_500Medium,
    [CLAY_FONTS.bodyBold]: Karla_700Bold,
  });

  useEffect(() => {
    (async () => {
      await aiSettings.getState().load();
      const db = await openDatabaseAsync('morph.db');
      await migrateDatabase(db);
      const repo = new SQLiteWorkspaceRepo(db);
      // 先把本机下载过的工具注册进来，用到它们的配置才校验得过。
      await toolDownloads.getState().load();
      const created = createWorkspaceStore({
        repo,
        provider,
        registry,
        locale,
        now: () => new Date(),
        seed: createStarterWorkspace,
        toolName: (id) =>
          localize(toolDownloads.getState().catalog?.tools.find((e) => e.id === id)?.name, locale),
      });
      await created.getState().boot();
      await useGuide.getState().load(repo);
      void toolDownloads.getState().refresh(CATALOG_DAY_MS);
      // 上次运行没来得及删除的临时文件（D-063）。
      await expoFilePlatform.removeAllRuns().catch(() => undefined);
      // 上次在 App 里选了文件、没有处理完就退出时，选择器留在缓存里的副本。
      await expoFilePlatform.removeStalePickerCopies().catch(() => undefined);
      // 已经删掉的快捷操作不再记着文件夹（D-196）。
      const booted = created.getState().config;
      if (booted) expoFilePlatform.forgetFolders(booted.workflows.map((w) => w.id));
      setRuntime({ store: created, repo });
    })().catch((e) => setError(String(e)));
  }, []);

  if (!runtime || (!fontsLoaded && !fontError)) {
    return (
      <Centered>
        {error ? <Text>{`${t(locale, 'bootFailed')}\n${error}`}</Text> : <ActivityIndicator />}
      </Centered>
    );
  }
  return (
    <AISettingsProvider store={aiSettings}>
      <WorkspaceProvider
        value={{
          store: runtime.store,
          repo: runtime.repo,
          files: expoFilePlatform,
          registry,
          locale,
        }}>
        <PackHostProvider value={packs}>
          <ToolDownloadsProvider value={toolDownloads}>
            <RootStack />
          </ToolDownloadsProvider>
        </PackHostProvider>
      </WorkspaceProvider>
    </AISettingsProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
