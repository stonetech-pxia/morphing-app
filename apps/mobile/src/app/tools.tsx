import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RenderEnv } from '@/renderer/components';
import { usePalette } from '@/renderer/theme';
import { entryOption } from '@/shell/ai-entry';
import { BannerAnchor } from '@/shell/Banner';
import { useShellEnv } from '@/shell/Shell';
import { Toast } from '@/shell/Toast';
import { ToolsView } from '@/shell/ToolsView';
import { useWorkspace, useWorkspaceContext, useAppTheme } from '@/workspace/context';
import { shownConfig } from '@/workspace/store';

/** 从设置或页面上的入口打开的工具页（不在导航栏里时）：单独的页面，返回回到原来的地方。 */
export default function ToolsRoute() {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace(shownConfig)!;
  const palette = usePalette(useAppTheme(config));
  const { navigate, locked } = useShellEnv();
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
      <Stack.Screen
        options={{ headerRight: entryOption({ kind: 'screen', screen: 'tools' }, palette) }}
      />
      <BannerAnchor palette={palette} />
      <ToolsView env={env} />
      <Toast palette={palette} bottom={insets.bottom + 16} />
    </>
  );
}
