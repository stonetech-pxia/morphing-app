import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RenderEnv } from '@/renderer/components';
import { usePalette } from '@/renderer/theme';
import { HistoryView } from '@/shell/HistoryView';
import { useShellEnv } from '@/shell/Shell';
import { Toast } from '@/shell/Toast';
import { useWorkspace, useWorkspaceContext, useAppTheme } from '@/workspace/context';
import { shownConfig } from '@/workspace/store';

/**
 * 「设置 → 改动记录」：和设置里其他页面一样是单独的页面，返回回到设置。
 * 回到以前的版本后也回到设置：撤销的提示条在外壳上。
 */
export default function HistoryRoute() {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace(shownConfig)!;
  const palette = usePalette(useAppTheme(config));
  const { navigate, locked } = useShellEnv();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    navigate,
    ...(locked ? { locked } : {}),
  };
  return (
    <>
      <HistoryView env={env} onRestored={() => router.back()} />
      <Toast palette={palette} bottom={insets.bottom + 16} />
    </>
  );
}
