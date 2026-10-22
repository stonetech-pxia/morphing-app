import { BUILTIN_TOOLS, createMockAIProvider, createRegistry } from '@morph/core';
import { Stack } from 'expo-router';
import { openDatabaseAsync } from 'expo-sqlite';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { getDeviceLocale, t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { SQLiteWorkspaceRepo, migrateDatabase } from '@/storage/sqlite';
import { WorkspaceProvider, useWorkspace } from '@/workspace/context';
import { createWorkspaceStore, type WorkspaceStore } from '@/workspace/store';

const locale = getDeviceLocale();
const registry = createRegistry(BUILTIN_TOOLS);

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
        headerTitleStyle: { color: palette.text },
        contentStyle: { backgroundColor: palette.background },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="change"
        options={{ presentation: 'modal', title: t(locale, 'changeTitle') }}
      />
      <Stack.Screen name="page/[pageId]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [store, setStore] = useState<WorkspaceStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await openDatabaseAsync('morph.db');
      await migrateDatabase(db);
      const created = createWorkspaceStore({
        repo: new SQLiteWorkspaceRepo(db),
        provider: createMockAIProvider(),
        registry,
        locale,
        now: () => new Date(),
      });
      await created.getState().boot();
      setStore(created);
    })().catch((e) => setError(String(e)));
  }, []);

  if (!store) {
    return (
      <Centered>
        {error ? <Text>{`${t(locale, 'bootFailed')}\n${error}`}</Text> : <ActivityIndicator />}
      </Centered>
    );
  }
  return (
    <WorkspaceProvider value={{ store, registry, locale }}>
      <RootStack />
    </WorkspaceProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
