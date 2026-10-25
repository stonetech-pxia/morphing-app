import { localize, t, QUICK_ACTION_CATEGORIES, isQuickActionKind } from '@morph/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { usePalette } from '@/renderer/theme';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

export default function QuickActionCategoryRoute() {
  const { locale, registry } = useWorkspaceContext();
  const palette = usePalette(useWorkspace((s) => s.config!.theme));
  const { kind, shared } = useLocalSearchParams<{ kind: string; shared?: string }>();
  if (!isQuickActionKind(kind)) return <Text>{t(locale, '_kind__Category_not_found_5faf2')}</Text>;
  return (
    <>
      <Stack.Screen options={{ title: localize(QUICK_ACTION_CATEGORIES[kind].name, locale) }} />
      <WorkflowsScreen
        palette={palette}
        locale={locale}
        registry={registry}
        kind={kind}
        shared={shared}
      />
    </>
  );
}
