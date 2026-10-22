import { BUILTIN_TOOLS, createMockAIProvider, createRegistry } from '@morph/core';
import { Stack } from 'expo-router';
import { openDatabaseAsync } from 'expo-sqlite';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AISettingsProvider } from '@/ai/context';
import { createAIRouter } from '@/ai/router';
import { secureSecretStore } from '@/ai/secure-store';
import { createAISettingsStore } from '@/ai/settings';
import { getDeviceLocale, t } from '@/i18n';
import { expoFilePlatform } from '@/runtime/expo-platform';
import { usePalette } from '@/renderer/theme';
import { SQLiteWorkspaceRepo, migrateDatabase } from '@/storage/sqlite';
import { WorkspaceProvider, useWorkspace } from '@/workspace/context';
import { createRemoteAIProvider } from '@/workspace/remote-ai';
import { createWorkspaceStore, type WorkspaceStore } from '@/workspace/store';

const locale = getDeviceLocale();
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
  remote: apiUrl ? createRemoteAIProvider({ baseUrl: apiUrl }) : null,
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
  const palette = usePalette(theme);
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.card },
        headerTintColor: palette.primary,
        headerBackButtonDisplayMode: 'minimal',
        headerTitleStyle: { color: palette.text },
        contentStyle: { backgroundColor: palette.background },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="change"
        options={{ presentation: 'modal', title: t(locale, 'changeTitle') }}
      />
      <Stack.Screen name="page/[pageId]" />
      <Stack.Screen name="ai-settings" options={{ title: t(locale, 'aiSettingsTitle') }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [runtime, setRuntime] = useState<{
    store: WorkspaceStore;
    repo: SQLiteWorkspaceRepo;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      });
      await created.getState().boot();
      setRuntime({ store: created, repo });
    })().catch((e) => setError(String(e)));
  }, []);

  if (!runtime) {
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
        <RootStack />
      </WorkspaceProvider>
    </AISettingsProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
