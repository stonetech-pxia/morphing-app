import { navTargetLabel } from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { ErrorBoundary } from '@/renderer/ErrorBoundary';
import { PageView, type RenderEnv } from '@/renderer/components';
import { usePalette } from '@/renderer/theme';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 工具页面：同一个渲染器，渲染工作空间配置中的某一页。 */
export default function PageRoute() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const { registry, locale } = useWorkspaceContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const config = useWorkspace((s) => s.config)!;
  const headId = useWorkspace((s) => s.head!.id);
  const reportRenderError = useWorkspace((s) => s.reportRenderError);
  const palette = usePalette(config.theme);
  const page = config.pages.find((p) => p.id === pageId);

  if (!page) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: palette.subtext }}>{t(locale, 'pageMissing')}</Text>
      </View>
    );
  }

  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    onOpenTools: () => router.back(),
  };
  return (
    <>
      <Stack.Screen options={{ title: page.title }} />
      <ErrorBoundary key={headId} onError={reportRenderError} fallback={<View />}>
        <PageView page={page} env={env} bottomInset={insets.bottom + 72} />
      </ErrorBoundary>
      {/* AI 修改入口在工具页同样可达（受保护元素，§5.1）。 */}
      <Pressable
        testID="page-ai"
        onPress={() => router.push('/change')}
        style={[styles.fab, { backgroundColor: palette.primary, bottom: insets.bottom + 16 }]}>
        <Text style={[styles.fabText, { color: palette.onPrimary }]}>
          {navTargetLabel('ai', config, locale)}
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: { fontWeight: '600' },
});
