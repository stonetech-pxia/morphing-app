import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

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
      <Stack.Screen
        options={{
          title: page.title,
          headerRight: () => (
            <Pressable testID="page-ai" onPress={() => router.push('/change')} hitSlop={8}>
              <Text style={{ color: palette.primary, fontWeight: '700' }}>AI</Text>
            </Pressable>
          ),
        }}
      />
      <ErrorBoundary key={headId} onError={reportRenderError} fallback={<View />}>
        <PageView page={page} env={env} />
      </ErrorBoundary>
    </>
  );
}
