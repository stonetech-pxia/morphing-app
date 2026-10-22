import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditablePage } from '@/editing/EditablePage';
import { t } from '@/i18n';
import { ErrorBoundary } from '@/renderer/ErrorBoundary';
import { Icon } from '@/renderer/Icon';
import type { RenderEnv } from '@/renderer/components';
import { usePalette } from '@/renderer/theme';
import { useNavigate } from '@/shell/navigation';
import { Toast } from '@/shell/Toast';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 不在导航栏里的页面（工具页、用户新建的页面）：同一个渲染器，渲染工作空间配置中的某一页。 */
export default function PageRoute() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const { registry, locale } = useWorkspaceContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const config = useWorkspace((s) => s.config)!;
  const headId = useWorkspace((s) => s.head!.id);
  const reportRenderError = useWorkspace((s) => s.reportRenderError);
  const arranging = useWorkspace((s) => s.arranging === pageId);
  const setArranging = useWorkspace((s) => s.setArranging);
  const palette = usePalette(config.theme);
  const navigate = useNavigate();
  const page = config.pages.find((p) => p.id === pageId);

  // 离开页面时退出「调整顺序」。
  useEffect(() => () => setArranging(null), [setArranging]);

  if (!page) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'pageMissing')}
        </Text>
      </View>
    );
  }

  const env: RenderEnv = { config, palette, locale, registry, interactive: true, navigate };
  return (
    <>
      <Stack.Screen
        options={{
          title: page.title,
          // 在当前页面直接发起修改，预览会聚焦这一页。
          // 「编辑」进入调整顺序模式（D-052）；也可以长按页面上的组件。
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                testID="page-edit"
                onPress={() => setArranging(arranging ? null : page.id)}
                hitSlop={10}>
                <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                  {t(locale, arranging ? 'done' : 'edit')}
                </Text>
              </Pressable>
              <Pressable
                testID="page-ai"
                accessibilityLabel={t(locale, 'changeTitle')}
                onPress={() => router.push('/change')}
                hitSlop={10}>
                <Icon name="sparkles" size={22} color={palette.primaryText} />
              </Pressable>
            </View>
          ),
        }}
      />
      <ErrorBoundary key={headId} onError={reportRenderError} fallback={<View />}>
        <EditablePage page={page} env={env} bottomInset={insets.bottom} />
      </ErrorBoundary>
      <Toast palette={palette} bottom={insets.bottom + 16} />
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
});
