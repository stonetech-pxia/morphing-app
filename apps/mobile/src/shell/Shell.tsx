import { navTargetLabel, pageIdOf, type NavTarget, type WorkspaceConfig } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { PageView, type RenderEnv } from '../renderer/components';
import { usePalette, type Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { ToolsView } from './ToolsView';

const BAR_HEIGHT = 56;

function firstTab(config: WorkspaceConfig): NavTarget {
  return (
    config.shell.nav.find((n) => n !== 'ai') ??
    config.shell.floating.find((n) => n !== 'ai') ??
    'settings'
  );
}

function Banner({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const banner = useWorkspace((s) => s.banner);
  const undo = useWorkspace((s) => s.undo);
  const dismiss = useWorkspace((s) => s.dismissBanner);
  if (!banner) return null;
  const warn = banner.kind !== 'applied';
  return (
    <View
      testID="banner"
      style={[styles.banner, { backgroundColor: warn ? palette.danger : palette.primary }]}>
      <Text style={[styles.bannerText, { color: palette.onPrimary }]}>{banner.message}</Text>
      {banner.undoTo !== undefined ? (
        <Pressable onPress={undo} hitSlop={8}>
          <Text style={[styles.bannerAction, { color: palette.onPrimary }]}>
            {t(locale, 'undo')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel={t(locale, 'close')}>
        <Text style={[styles.bannerAction, { color: palette.onPrimary }]}>✕</Text>
      </Pressable>
    </View>
  );
}

/** App 外壳：内容区域、按配置渲染的底部导航、受保护元素的浮动按钮。 */
export function Shell() {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const headId = useWorkspace((s) => s.head!.id);
  const markRendered = useWorkspace((s) => s.markRendered);
  const palette = usePalette(config.theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<NavTarget>(() => firstTab(config));

  // 渲染完成（没有被 ErrorBoundary 拦截）才确认这次提交成功（§4）。
  useEffect(() => {
    void markRendered(headId);
  }, [headId, markRendered]);

  const entries = [...config.shell.nav, ...config.shell.floating];
  const active = entries.includes(selected) && selected !== 'ai' ? selected : firstTab(config);
  const open = (target: NavTarget) =>
    target === 'ai' ? router.push('/change') : setSelected(target);

  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    onOpenTools: () => setSelected('tools'),
  };
  const barSpace = BAR_HEIGHT + insets.bottom;

  let content;
  const pageId = pageIdOf(active);
  if (pageId !== null) {
    const page = config.pages.find((p) => p.id === pageId)!;
    content = <PageView page={page} env={env} bottomInset={barSpace + 64} />;
  } else if (active === 'tools') {
    content = <ToolsView env={env} />;
  } else if (active === 'history') {
    content = <HistoryView env={env} />;
  } else {
    content = <SettingsView env={env} onOpenHistory={() => setSelected('history')} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <Banner palette={palette} />
      <View style={styles.content}>{content}</View>

      {config.shell.floating.length > 0 ? (
        <View style={[styles.floating, { bottom: barSpace + 16 }]}>
          {config.shell.floating.map((target) => (
            <Pressable
              key={target}
              testID={`floating-${target}`}
              onPress={() => open(target)}
              style={[
                styles.fab,
                {
                  backgroundColor: target === 'ai' ? palette.primary : palette.card,
                  borderColor: palette.border,
                },
              ]}>
              <Text
                style={{
                  color: target === 'ai' ? palette.onPrimary : palette.text,
                  fontWeight: '600',
                }}>
                {navTargetLabel(target, config, locale)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View
        style={[
          styles.bar,
          {
            height: barSpace,
            paddingBottom: insets.bottom,
            backgroundColor: palette.card,
            borderColor: palette.border,
          },
        ]}>
        {config.shell.nav.map((target) => {
          const isActive = target === active;
          const isAi = target === 'ai';
          return (
            <Pressable
              key={target}
              testID={`nav-${target}`}
              style={styles.tab}
              onPress={() => open(target)}>
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  { color: isActive || isAi ? palette.primary : palette.subtext },
                  (isActive || isAi) && styles.tabLabelActive,
                ]}>
                {navTargetLabel(target, config, locale)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  bannerText: { flex: 1, fontSize: 14 },
  bannerAction: { fontSize: 14, fontWeight: '700' },
  floating: { position: 'absolute', right: 16, gap: 10, alignItems: 'flex-end' },
  fab: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: BAR_HEIGHT },
  tabLabel: { fontSize: 13 },
  tabLabelActive: { fontWeight: '700' },
});
