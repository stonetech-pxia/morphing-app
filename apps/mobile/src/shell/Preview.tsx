import { navTargetLabel, type WorkspaceConfig } from '@morph/core';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { ErrorBoundary } from '../renderer/ErrorBoundary';
import { PageView, type RenderEnv } from '../renderer/components';
import { usePalette } from '../renderer/theme';
import { useWorkspaceContext } from '../workspace/context';

/** 只读的小尺寸预览：用与正式界面相同的渲染器渲染某个配置的一页和它的导航。 */
export function Preview({
  config,
  pageId,
  onError,
}: {
  config: WorkspaceConfig;
  pageId: string;
  onError: (error: unknown) => void;
}) {
  const { registry, locale } = useWorkspaceContext();
  const palette = usePalette(config.theme);
  const page = config.pages.find((p) => p.id === pageId) ?? config.pages[0]!;
  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: false,
    onOpenTools: () => {},
  };
  return (
    <ErrorBoundary
      onError={onError}
      fallback={
        <Text style={{ color: palette.danger, padding: 16 }}>{t(locale, 'previewFailed')}</Text>
      }>
      <View
        pointerEvents="none"
        style={[
          styles.frame,
          { backgroundColor: palette.background, borderColor: palette.border },
        ]}>
        <View style={styles.page}>
          <PageView page={page} env={env} />
        </View>
        {config.shell.floating.length > 0 ? (
          <View style={styles.floating}>
            {config.shell.floating.map((target) => (
              <View key={target} style={[styles.fab, { backgroundColor: palette.primary }]}>
                <Text style={[styles.fabText, { color: palette.onPrimary }]}>
                  {navTargetLabel(target, config, locale)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={[styles.bar, { backgroundColor: palette.card, borderColor: palette.border }]}>
          {config.shell.nav.map((target) => (
            <Text key={target} numberOfLines={1} style={[styles.tab, { color: palette.subtext }]}>
              {navTargetLabel(target, config, locale)}
            </Text>
          ))}
        </View>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  frame: { height: 380, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  page: { flex: 1 },
  floating: { position: 'absolute', right: 10, bottom: 52, gap: 6, alignItems: 'flex-end' },
  fab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  fabText: { fontSize: 12, fontWeight: '600' },
  bar: {
    flexDirection: 'row',
    height: 40,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, textAlign: 'center', fontSize: 12 },
});
