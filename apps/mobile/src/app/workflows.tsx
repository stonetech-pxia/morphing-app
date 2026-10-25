import { usePalette } from '@/renderer/theme';
import { WorkflowsScreen } from '@/shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 旧 /workflows 路径兼容入口：显示文件类型分类。由内核提供，AI 不能修改这个页面。 */
export default function WorkflowsRoute() {
  const { locale, registry } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  return <WorkflowsScreen palette={palette} locale={locale} registry={registry} />;
}
