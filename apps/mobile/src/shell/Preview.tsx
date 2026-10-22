import type { WorkspaceConfig } from '@morph/core';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { ErrorBoundary } from '../renderer/ErrorBoundary';
import { Icon } from '../renderer/Icon';
import { PageView, type RenderEnv } from '../renderer/components';
import { usePalette } from '../renderer/theme';
import { useWorkspaceContext } from '../workspace/context';
import { targetIcon, targetLabel } from './navigation';

/** 只读的小尺寸预览：用与正式界面相同的渲染器渲染某个配置的一页、它的导航和浮动按钮。 */
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
    navigate: () => {},
  };
  const navStyle = config.theme.navStyle;
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
            {config.shell.floating.map((target) => {
              const accent = target === 'ai';
              const fg = accent ? palette.onPrimary : palette.text;
              return (
                <View
                  key={target}
                  style={[
                    styles.fab,
                    palette.cardStyle(accent ? palette.primary : palette.surface),
                    { borderRadius: 999 },
                  ]}>
                  <Icon name={targetIcon(target, config)} size={13} color={fg} />
                  <Text style={[palette.font('title', 11), { color: fg }]}>
                    {targetLabel(target, config, locale)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
        <View
          style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {config.shell.nav.map((target) => (
            <View key={target} style={styles.tab}>
              {navStyle !== 'label' ? (
                <Icon name={targetIcon(target, config)} size={16} color={palette.caption} />
              ) : null}
              {navStyle !== 'icon' ? (
                <Text
                  numberOfLines={1}
                  style={[palette.font('bodyMedium', 10), { color: palette.caption }]}>
                  {targetLabel(target, config, locale)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  frame: { height: 420, borderRadius: 22, borderWidth: 1, overflow: 'hidden' },
  page: { flex: 1 },
  floating: { position: 'absolute', right: 10, bottom: 58, gap: 6, alignItems: 'flex-end' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bar: {
    flexDirection: 'row',
    height: 48,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
});
