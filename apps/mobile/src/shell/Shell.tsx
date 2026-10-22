import { pageIdOf, type NavTarget, type WorkspaceConfig } from '@morph/core';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { PageView, type RenderEnv } from '../renderer/components';
import { Icon } from '../renderer/Icon';
import { usePalette, type Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { HistoryView } from './HistoryView';
import { targetIcon, targetLabel, useNavigate } from './navigation';
import { SettingsView } from './SettingsView';
import { ToolsView } from './ToolsView';

const BAR_HEIGHT = { iconLabel: 64, label: 52, icon: 56 } as const;

export function firstTab(config: WorkspaceConfig): NavTarget {
  return (
    config.shell.nav.find((n) => n !== 'ai') ??
    config.shell.floating.find((n) => n !== 'ai') ??
    'settings'
  );
}

/** 外壳可以显示的目标：系统入口（AI 修改除外，它是单独的页面）和导航栏里的页面。 */
function canShow(target: NavTarget | null, config: WorkspaceConfig): target is NavTarget {
  if (target === null || target === 'ai') return false;
  const pageId = pageIdOf(target);
  return pageId === null || config.pages.some((p) => p.id === pageId);
}

function Banner({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const banner = useWorkspace((s) => s.banner);
  const undo = useWorkspace((s) => s.undo);
  const dismiss = useWorkspace((s) => s.dismissBanner);
  if (!banner) return null;
  const warn = banner.kind !== 'applied';
  const color = warn ? '#FFFFFF' : palette.onPrimary;
  return (
    <View
      testID="banner"
      style={[
        styles.banner,
        {
          backgroundColor: warn ? palette.danger : palette.primary,
          borderRadius: palette.controlRadius,
        },
      ]}>
      <Text style={[styles.bannerText, palette.font('bodyMedium', 14), { color }]}>
        {banner.message}
      </Text>
      {banner.undoTo !== undefined ? (
        <Pressable onPress={undo} hitSlop={8}>
          <Text style={[palette.font('bodyBold', 14), { color }]}>{t(locale, 'undo')}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel={t(locale, 'close')}>
        <Text style={[palette.font('bodyBold', 14), { color }]}>✕</Text>
      </Pressable>
    </View>
  );
}

/** App 外壳：内容区域、按配置渲染的底部导航和浮动按钮。 */
export function Shell() {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const headId = useWorkspace((s) => s.head!.id);
  const tab = useWorkspace((s) => s.tab);
  const markRendered = useWorkspace((s) => s.markRendered);
  const palette = usePalette(config.theme);
  const navigate = useNavigate();
  const insets = useSafeAreaInsets();

  // 渲染完成（没有被 ErrorBoundary 拦截）才确认这次提交成功（§4）。
  useEffect(() => {
    void markRendered(headId);
  }, [headId, markRendered]);

  const active = canShow(tab, config) ? tab : firstTab(config);
  const env: RenderEnv = { config, palette, locale, registry, interactive: true, navigate };
  const navStyle = config.theme.navStyle;
  const barSpace = BAR_HEIGHT[navStyle] + insets.bottom;

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
    content = <SettingsView env={env} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <Banner palette={palette} />
      <View style={styles.content}>{content}</View>

      {config.shell.floating.length > 0 ? (
        <View style={[styles.floating, { bottom: barSpace + 16 }]}>
          {config.shell.floating.map((target) => {
            const accent = target === 'ai';
            const fg = accent ? palette.onPrimary : palette.text;
            return (
              <Pressable
                key={target}
                testID={`floating-${target}`}
                onPress={() => navigate(target)}
                style={({ pressed }) => [
                  styles.fab,
                  palette.cardStyle(accent ? palette.primary : palette.surface),
                  { borderRadius: 999 },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}>
                <Icon name={targetIcon(target, config)} size={18} color={fg} />
                <Text style={[palette.font('title', 14), { color: fg }]}>
                  {targetLabel(target, config, locale)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View
        style={[
          styles.bar,
          {
            height: barSpace,
            paddingBottom: insets.bottom,
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}>
        {config.shell.nav.map((target) => {
          const isActive = target === active;
          const color = isActive || target === 'ai' ? palette.primaryText : palette.caption;
          const label = targetLabel(target, config, locale);
          return (
            <Pressable
              key={target}
              testID={`nav-${target}`}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: isActive }}
              style={styles.tab}
              onPress={() => navigate(target)}>
              {navStyle !== 'label' ? (
                <View
                  style={[
                    styles.tabIcon,
                    { backgroundColor: isActive ? palette.primaryTint : 'transparent' },
                  ]}>
                  <Icon name={targetIcon(target, config)} size={22} color={color} />
                </View>
              ) : null}
              {navStyle !== 'icon' ? (
                <Text
                  numberOfLines={1}
                  style={[palette.font(isActive ? 'bodyBold' : 'bodyMedium', 12), { color }]}>
                  {label}
                </Text>
              ) : null}
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
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bannerText: { flex: 1 },
  floating: { position: 'absolute', right: 16, gap: 10, alignItems: 'flex-end' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabIcon: {
    width: 52,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
