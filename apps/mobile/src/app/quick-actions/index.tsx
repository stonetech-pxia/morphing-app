import { Stack, useLocalSearchParams } from 'expo-router';
import { usePalette } from '@/renderer/theme';
import { quickActionsEntry } from '@/shell/ai-entry';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspaceContext, useAppTheme } from '@/workspace/context';

export default function QuickActionsRoute() {
  const { locale, registry } = useWorkspaceContext();
  const palette = usePalette(useAppTheme());
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerRight: quickActionsEntry(palette) }} />
      <WorkflowsScreen palette={palette} locale={locale} registry={registry} shared={shared} />
    </>
  );
}
