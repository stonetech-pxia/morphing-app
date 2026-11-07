import { Stack } from 'expo-router';

import { usePalette } from '@/renderer/theme';
import { quickActionsEntry } from '@/shell/ai-entry';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspaceContext, useAppTheme } from '@/workspace/context';

/** 旧 /workflows 路径兼容入口：显示文件类型分类。由内核提供，AI 不能修改这个页面。 */
export default function WorkflowsRoute() {
  const { locale, registry } = useWorkspaceContext();
  const theme = useAppTheme();
  const palette = usePalette(theme);
  return (
    <>
      <Stack.Screen options={{ headerRight: quickActionsEntry(palette) }} />
      <WorkflowsScreen palette={palette} locale={locale} registry={registry} />
    </>
  );
}
