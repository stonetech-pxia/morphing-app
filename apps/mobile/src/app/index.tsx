import { View } from 'react-native';

import { ErrorBoundary } from '@/renderer/ErrorBoundary';
import { Shell } from '@/shell/Shell';
import { useWorkspace } from '@/workspace/context';

export default function HomeRoute() {
  const headId = useWorkspace((s) => s.head!.id);
  const reportRenderError = useWorkspace((s) => s.reportRenderError);
  const draftFailed = useWorkspace((s) => s.draftRenderFailed);
  // 草稿模式里显示的是草稿（D-190）：显示不出来时撤掉草稿的最近一步，不动已保存的版本。
  const draftKey = useWorkspace((s) =>
    s.draft?.open ? `d${s.draft.steps.at(-1)!.changeRequestId}` : '',
  );
  // key 随版本变化：回退到新版本后重新挂载整个外壳；当前导航项保存在 store 里，不会丢失。
  return (
    <ErrorBoundary
      key={`${headId}${draftKey}`}
      onError={draftKey ? draftFailed : reportRenderError}
      fallback={<View />}>
      <Shell />
    </ErrorBoundary>
  );
}
