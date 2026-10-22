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
import { Banner } from '@/shell/Shell';
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
  const editing = useWorkspace((s) => s.editing?.pageId === pageId);
  const startEditing = useWorkspace((s) => s.startEditing);
  const cancelEditing = useWorkspace((s) => s.cancelEditing);
  const palette = usePalette(config.theme);
  const navigate = useNavigate();
  const page = config.pages.find((p) => p.id === pageId);

  // 页面被关闭（例如它被删除）时放弃未保存的编辑。
  useEffect(() => () => cancelEditing(), [cancelEditing]);

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
          // 编辑模式下不能返回：先在页面顶部点「完成」或「取消」，草稿不会丢失（D-054）。
          headerBackVisible: !editing,
          gestureEnabled: !editing,
          // 「编辑」进入编辑模式（D-053）；也可以长按页面上的组件。
          headerRight: () =>
            editing ? null : (
              <View style={styles.headerActions}>
                <Pressable testID="page-edit" onPress={() => startEditing(page.id)} hitSlop={10}>
                  <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                    {t(locale, 'edit')}
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
      <Banner palette={palette} />
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
