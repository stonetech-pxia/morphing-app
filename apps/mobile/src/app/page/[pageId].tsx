import { linkTitle, type DataRecord } from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditablePage } from '@/editing/EditablePage';
import { t } from '@/i18n';
import { ErrorBoundary } from '@/renderer/ErrorBoundary';
import { Icon, UiIcon } from '@/renderer/Icon';
import { openEditor } from '@/renderer/data';
import type { RenderEnv } from '@/renderer/components';
import { usePalette } from '@/renderer/theme';
import { DraftBar } from '@/draft/DraftBar';
import { SampleHint } from '@/guide/SampleHint';
import { directEditEntry } from '@/editing/entry';
import { Banner, DraftNotice, useShellEnv } from '@/shell/Shell';
import { Toast } from '@/shell/Toast';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';
import { shownConfig } from '@/workspace/store';

/** 不在导航栏里的页面（工具页、用户新建的页面）：同一个渲染器，渲染工作空间配置中的某一页。 */
export default function PageRoute() {
  const { pageId, record: recordId } = useLocalSearchParams<{
    pageId: string;
    /** 给一条记录用的页面（D-342）：从列表点开的那条记录。 */
    record?: string;
  }>();
  const { registry, locale, repo } = useWorkspaceContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 草稿模式里显示草稿（D-190）。
  const config = useWorkspace(shownConfig)!;
  const headId = useWorkspace((s) => s.head!.id);
  const reportRenderError = useWorkspace((s) => s.reportRenderError);
  const draftFailed = useWorkspace((s) => s.draftRenderFailed);
  const editing = useWorkspace((s) => s.editing?.pageId === pageId);
  const cancelEditing = useWorkspace((s) => s.cancelEditing);
  const startEditing = useWorkspace((s) => s.startEditing);
  const palette = usePalette(config.theme);
  const { navigate, locked, inDraft } = useShellEnv();
  const page = config.pages.find((p) => p.id === pageId);
  const recordOf = page?.recordOf;
  const collection = recordOf ? config.collections.find((c) => c.id === recordOf) : undefined;
  // 这条记录：标题写在页面顶部；改了、删了以后重新读（undefined = 还在读）。
  const version = useWorkspace((s) => s.recordsVersion);
  const [record, setRecord] = useState<DataRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!recordOf || !recordId) return;
    void repo
      .getRecord(recordId)
      .then((r) => setRecord(r && r.deletedAt === null && r.collectionId === recordOf ? r : null));
  }, [repo, recordOf, recordId, version]);

  // 页面被关闭（例如它被删除）时放弃未保存的编辑。
  useEffect(() => () => cancelEditing(), [cancelEditing]);

  const opened = recordOf && recordId ? record : null;
  if (recordOf && opened === undefined) return null;
  if (!page || (recordOf && (!opened || !collection))) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, page ? 'recordPageMissing' : 'pageMissing')}
        </Text>
      </View>
    );
  }

  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    navigate,
    ...(locked ? { locked } : {}),
    ...(opened ? { recordId: opened.id } : {}),
  };
  return (
    <>
      <Stack.Screen
        options={{
          // 给一条记录用的页面以这条记录为标题（在本机拼，AI 看不到）。
          title: opened && collection ? linkTitle(opened, collection, locale) : page.title,
          // 在当前页面直接发起修改，预览会聚焦这一页。
          // 编辑模式下不能返回：先在页面顶部点「完成」或「取消」，草稿不会丢失（D-054）。
          headerBackVisible: !editing,
          gestureEnabled: !editing,
          // AI 修改是改界面的唯一入口（D-190）；草稿模式里它打开聊天框。
          headerRight: () =>
            editing ? null : (
              <View style={styles.headerActions}>
                {opened ? (
                  <Pressable
                    testID="page-record-edit"
                    accessibilityLabel={t(locale, 'recordPageEdit')}
                    onPress={() => openEditor(router, opened.collectionId, opened.id)}
                    hitSlop={10}>
                    <UiIcon name="edit" size={20} color={palette.primaryText} />
                  </Pressable>
                ) : null}
                {/* 「编辑」进入整页编辑模式（D-053），入口继续关闭；长按单组件编辑另外开放（D-235，editing/entry.ts）。 */}
                {directEditEntry.pageButton && !inDraft ? (
                  <Pressable testID="page-edit" onPress={() => startEditing(page.id)} hitSlop={10}>
                    <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                      {t(locale, 'edit')}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  testID="page-ai"
                  accessibilityLabel={t(locale, 'changeTitle')}
                  onPress={() => (inDraft ? navigate('ai') : router.push('/change'))}
                  hitSlop={10}>
                  <Icon name="sparkles" size={22} color={palette.primaryText} />
                </Pressable>
              </View>
            ),
        }}
      />
      {/* 草稿模式里内容区用草稿的背景（D-190）；顶部导航栏仍跟着已保存的版本。 */}
      <View style={[styles.fill, inDraft && palette.backdrop]}>
        {inDraft ? null : <Banner palette={palette} />}
        <DraftNotice palette={palette} />
        {inDraft || editing ? null : <SampleHint pageId={page.id} palette={palette} />}
        <ErrorBoundary
          key={inDraft ? `${headId}-draft` : headId}
          onError={inDraft ? draftFailed : reportRenderError}
          fallback={<View />}>
          <EditablePage page={page} env={env} bottomInset={insets.bottom + (inDraft ? 90 : 0)} />
        </ErrorBoundary>
        <DraftBar palette={palette} bottom={insets.bottom + 16} />
        <Toast palette={palette} bottom={insets.bottom + (inDraft ? 90 : 16)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
});
