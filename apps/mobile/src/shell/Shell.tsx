import { HOME_PAGE_ID, pageIdOf, type NavTarget, type WorkspaceConfig } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftBar } from '../draft/DraftBar';
import { useDraftUi } from '../draft/ui';
import { directEditEntry } from '../editing/entry';
import { GuideCard } from '../guide/GuideCard';
import { useGuide } from '../guide/store';
import { t } from '../i18n';
import { EditablePage } from '../editing/EditablePage';
import type { RenderEnv } from '../renderer/components';
import { GlassFill } from '../renderer/GlassFill';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { shownConfig } from '../workspace/store';
import { Banner, DraftNotice } from './Banner';
import { HistoryView } from './HistoryView';
import { targetIcon, targetLabel, useNavigate } from './navigation';
import { SettingsView } from './SettingsView';
import { Toast } from './Toast';
import { ToolsView } from './ToolsView';
import { WorkflowsScreen } from './WorkflowsScreen';

// 提示条单独放在 Banner.tsx（WorkflowsScreen 也要用，放这里会循环引用）；这里照样导出，旧的引用不用改。
export { APPLIED_BANNER_MS, Banner, DraftNotice } from './Banner';

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

/** 外壳给页面的环境（D-190）：在草稿模式里打开页面照常，「AI 修改」打开聊天框，真的做事的操作只提示。 */
export function useShellEnv(): Pick<RenderEnv, 'navigate' | 'locked'> & { inDraft: boolean } {
  const { locale } = useWorkspaceContext();
  const inDraft = useWorkspace((s) => !!s.draft?.open);
  const showToast = useWorkspace((s) => s.showToast);
  const setChatOpen = useDraftUi((s) => s.setChatOpen);
  const markSeen = useDraftUi((s) => s.markSeen);
  const lastStep = useWorkspace((s) => s.draft?.steps.at(-1)?.changeRequestId);
  const navigate = useNavigate();
  if (!inDraft) return { navigate, inDraft };
  return {
    inDraft,
    navigate: (target) => (target === 'ai' ? setChatOpen(true) : navigate(target)),
    // 提示「应用之后才能用」；最新一步的回复会挡住提示，先收起来。
    locked: () => {
      if (lastStep !== undefined) markSeen(lastStep);
      showToast({ message: t(locale, 'draftLocked') });
    },
  };
}

/** App 外壳：内容区域、按配置渲染的底部导航和浮动按钮。 */
export function Shell() {
  const { registry, locale } = useWorkspaceContext();
  // 草稿模式里显示草稿（D-190）。
  const config = useWorkspace(shownConfig)!;
  const headId = useWorkspace((s) => s.head!.id);
  const tab = useWorkspace((s) => s.tab);
  const markRendered = useWorkspace((s) => s.markRendered);
  const editing = useWorkspace((s) => s.editing !== null);
  const startEditing = useWorkspace((s) => s.startEditing);
  const palette = usePalette(config.theme);
  const { navigate, locked, inDraft } = useShellEnv();
  const insets = useSafeAreaInsets();

  // 渲染完成（没有被 ErrorBoundary 拦截）才确认这次提交成功（§4）。
  useEffect(() => {
    void markRendered(headId);
  }, [headId, markRendered]);

  // 第一次打开（或在设置里选了重新看）：先看划屏介绍（D-149）。
  const guideStage = useGuide((s) => s.stage);
  const router = useRouter();
  useEffect(() => {
    if (guideStage === 'intro') router.push('/welcome');
  }, [guideStage, router]);

  const active = canShow(tab, config) ? tab : firstTab(config);
  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    navigate,
    ...(locked ? { locked } : {}),
  };
  const navStyle = config.theme.navStyle;
  // 编辑模式下隐藏导航栏和浮动按钮：先「完成」或「取消」，草稿不会在切换页面时丢失（D-054）。
  const barSpace = editing ? insets.bottom : BAR_HEIGHT[navStyle] + insets.bottom;

  let content;
  const pageId = pageIdOf(active);
  if (pageId !== null) {
    const page = config.pages.find((p) => p.id === pageId)!;
    content = <EditablePage page={page} env={env} bottomInset={barSpace + (editing ? 0 : 64)} />;
  } else if (active === 'tools') {
    content = <ToolsView env={env} />;
  } else if (active === 'quickActions') {
    content = <WorkflowsScreen palette={palette} locale={locale} registry={registry} embedded />;
  } else if (active === 'history') {
    content = <HistoryView env={env} />;
  } else {
    content = <SettingsView env={env} />;
  }

  return (
    <View style={[styles.root, palette.backdrop, { paddingTop: insets.top }]}>
      {inDraft ? null : <Banner palette={palette} />}
      <DraftNotice palette={palette} />
      {pageId === HOME_PAGE_ID && !editing && !inDraft ? <GuideCard palette={palette} /> : null}
      <View style={styles.content}>{content}</View>

      {/* 编辑模式的开关（D-053）：导航栏里的页面没有标题栏，放在左下角；编辑模式下隐藏。
          整页入口继续关闭，长按入口单独开放（D-235，editing/entry.ts）。 */}
      {pageId !== null && directEditEntry.pageButton && !inDraft ? (
        <Pressable
          testID={editing ? undefined : 'page-edit'}
          accessibilityRole="button"
          accessibilityElementsHidden={editing}
          pointerEvents={editing ? 'none' : 'auto'}
          onPress={() => startEditing(pageId)}
          style={({ pressed }) => [
            styles.fab,
            styles.editButton,
            palette.cardStyle(palette.surface),
            { bottom: barSpace + 16, borderRadius: 999 },
            pressed && { transform: [{ scale: 0.96 }] },
            editing && styles.invisible,
          ]}>
          <GlassFill palette={palette} radius={999} />
          <Text style={[palette.font('title', 14), { color: palette.primaryText }]}>
            {t(locale, 'edit')}
          </Text>
        </Pressable>
      ) : null}

      {config.shell.floating.length > 0 && !editing && !inDraft ? (
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
                <GlassFill palette={palette} radius={999} />
                <Icon name={targetIcon(target, config)} size={18} color={fg} />
                <Text style={[palette.font('title', 14), { color: fg }]}>
                  {targetLabel(target, config, locale)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <DraftBar palette={palette} bottom={barSpace + 12} />
      <Toast palette={palette} bottom={barSpace + (inDraft ? 84 : 12)} />

      <View
        style={[
          styles.bar,
          editing && styles.hidden,
          {
            height: barSpace,
            paddingBottom: insets.bottom,
            backgroundColor: palette.barBackground,
            borderColor: palette.border,
          },
        ]}>
        <GlassFill palette={palette} radius={0} />
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
                  style={[palette.barFont(isActive ? 'bodyBold' : 'bodyMedium', 12), { color }]}>
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
  floating: { position: 'absolute', right: 16, gap: 10, alignItems: 'flex-end' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  invisible: { opacity: 0 },
  editButton: { position: 'absolute', left: 16, minHeight: 40, paddingHorizontal: 16 },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  hidden: { display: 'none' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabIcon: {
    width: 52,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
