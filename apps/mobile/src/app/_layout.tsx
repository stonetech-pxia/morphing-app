import { Karla_400Regular } from '@expo-google-fonts/karla/400Regular';
import { Karla_400Regular_Italic } from '@expo-google-fonts/karla/400Regular_Italic';
import { Karla_500Medium } from '@expo-google-fonts/karla/500Medium';
import { Karla_700Bold } from '@expo-google-fonts/karla/700Bold';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
} from '@morph/core';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { openDatabaseAsync } from 'expo-sqlite';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AISettingsProvider } from '@/ai/context';
import { createAIRouter } from '@/ai/router';
import { getDeviceId, secureSecretStore } from '@/ai/secure-store';
import { createAISettingsStore } from '@/ai/settings';
import { useGuide } from '@/guide/store';
import { getDeviceLocale, t } from '@/i18n';
import { PackBridge } from '@/packs/bridge';
import { expoBridgeFiles, expoPackFs, expoSha256 } from '@/packs/expo-pack-fs';
import { PackHostProvider } from '@/packs/PackHost';
import { PackStore } from '@/packs/store';
import { expoFilePlatform } from '@/runtime/expo-platform';
import { CloseButton } from '@/shell/CloseButton';
import { CLAY_FONTS, usePalette } from '@/renderer/theme';
import { useIncomingShare } from '@/share/useIncomingShare';
import { SQLiteWorkspaceRepo, migrateDatabase } from '@/storage/sqlite';
import { WorkspaceProvider, useWorkspace } from '@/workspace/context';
import { createRemoteAIProvider } from '@/workspace/remote-ai';
import { createWorkspaceStore, type WorkspaceStore } from '@/workspace/store';

const locale = getDeviceLocale();
// 扩展包：只在用户确认后下载，存在 documentDirectory/packs（D-064）。
const packStore = new PackStore(expoPackFs, expoSha256);
const packs = { store: packStore, bridge: new PackBridge(expoBridgeFiles(packStore)) };
const registry = createRegistry(BUILTIN_TOOLS);
// AI 来源由「设置 → AI」决定：内置规则、Morph 服务器（需配置地址，见 README）或用户自带 key。
const apiUrl = process.env.EXPO_PUBLIC_MORPH_API_URL;
const aiSettings = createAISettingsStore({
  secrets: secureSecretStore,
  serverAvailable: Boolean(apiUrl),
});
const provider = createAIRouter({
  settings: aiSettings,
  mock: createMockAIProvider(),
  remote: apiUrl
    ? createRemoteAIProvider({
        baseUrl: apiUrl,
        clientToken: process.env.EXPO_PUBLIC_MORPH_CLIENT_TOKEN,
        deviceId: getDeviceId,
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
  const closable = {
    presentation: 'modal',
    headerLeft: () => <CloseButton palette={palette} />,
  } as const;
  return (
    <>
      <StatusBar style={palette.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.background },
          headerShadowVisible: false,
          headerTintColor: palette.text,
          headerBackButtonDisplayMode: 'minimal',
          headerTitleStyle: { ...palette.font('title', 17), color: palette.text } as never,
          contentStyle: palette.backdrop,
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="change" options={{ ...closable, title: t(locale, 'changeTitle') }} />
        <Stack.Screen name="page/[pageId]" />
        <Stack.Screen name="ai-settings" options={{ title: t(locale, 'aiSettingsTitle') }} />
        <Stack.Screen name="data" options={{ title: t(locale, 'dataTitle') }} />
        <Stack.Screen name="packs" options={{ title: t(locale, 'packsTitle') }} />
        <Stack.Screen name="workflows" options={{ title: t(locale, 'workflowsTitle') }} />
        <Stack.Screen name="workflow/[id]" />
        <Stack.Screen name="record/[collectionId]" options={closable} />
        <Stack.Screen name="run/[workflowId]" options={closable} />
        <Stack.Screen name="share" options={closable} />
        <Stack.Screen name="ready/[workflowId]" options={{ ...closable, title: '' }} />
        <Stack.Screen
          name="welcome"
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
      </Stack>
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
      const created = createWorkspaceStore({
        repo,
        provider,
        registry,
        locale,
        now: () => new Date(),
        seed: createStarterWorkspace,
      });
      await created.getState().boot();
      await useGuide.getState().load(repo);
      // 上次运行没来得及删除的临时文件（D-063）。
      await expoFilePlatform.removeAllRuns().catch(() => undefined);
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
          <RootStack />
        </PackHostProvider>
      </WorkspaceProvider>
    </AISettingsProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
