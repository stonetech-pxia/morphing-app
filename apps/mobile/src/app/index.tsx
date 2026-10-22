import { View } from 'react-native';

import { ErrorBoundary } from '@/renderer/ErrorBoundary';
import { Shell } from '@/shell/Shell';
import { useWorkspace } from '@/workspace/context';

export default function HomeRoute() {
  const headId = useWorkspace((s) => s.head!.id);
  const reportRenderError = useWorkspace((s) => s.reportRenderError);
  // key 随版本变化：回退到新版本后重新挂载整个外壳。
  return (
    <ErrorBoundary key={headId} onError={reportRenderError} fallback={<View />}>
      <Shell />
    </ErrorBoundary>
  );
}
