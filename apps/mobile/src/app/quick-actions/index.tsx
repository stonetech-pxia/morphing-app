import { useLocalSearchParams } from 'expo-router';
import { usePalette } from '@/renderer/theme';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

export default function QuickActionsRoute() {
  const { locale, registry } = useWorkspaceContext();
  const palette = usePalette(useWorkspace((s) => s.config!.theme));
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  return <WorkflowsScreen palette={palette} locale={locale} registry={registry} shared={shared} />;
}
