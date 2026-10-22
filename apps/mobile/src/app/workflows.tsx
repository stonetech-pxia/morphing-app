import { usePalette } from '@/renderer/theme';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 「设置 → 工作流」：我的工作流、预设库、工具自带的工作流（D-082）。由内核提供，AI 不能修改这个页面。 */
export default function WorkflowsRoute() {
  const { locale, registry } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  return <WorkflowsScreen palette={palette} locale={locale} registry={registry} />;
}
