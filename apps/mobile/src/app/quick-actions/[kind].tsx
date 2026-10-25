import { QUICK_ACTION_CATEGORIES, isQuickActionKind } from '@morph/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { usePalette } from '@/renderer/theme';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

export default function QuickActionCategoryRoute() {
  const { locale, registry } = useWorkspaceContext();
  const palette = usePalette(useWorkspace((s) => s.config!.theme));
  const { kind, shared } = useLocalSearchParams<{ kind: string; shared?: string }>();
  if (!isQuickActionKind(kind))
    return <Text>{locale === 'zh' ? '找不到这个分类' : 'Category not found'}</Text>;
  return (
    <>
      <Stack.Screen options={{ title: QUICK_ACTION_CATEGORIES[kind].name[locale] }} />
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
