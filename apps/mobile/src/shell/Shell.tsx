import {
  HOME_PAGE_ID,
  appViewOf,
  firstTarget,
  pageIdOf,
  type NavTarget,
  type ShellView,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { BlurTargetView } from 'expo-blur';
import { useEffect, useRef, type ComponentRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftBar } from '../draft/DraftBar';
import { useDraftUi } from '../draft/ui';
import { directEditEntry } from '../editing/entry';
import { GuideBubble } from '../guide/GuideBubble';
import { GuideCard } from '../guide/GuideCard';
import { SampleHint } from '../guide/SampleHint';
import { openLookGuide, useGuide } from '../guide/store';
import { t } from '../i18n';
import { usePacks } from '../packs/PackHost';
import { EditablePage } from '../editing/EditablePage';
import type { RenderEnv } from '../renderer/components';
import { GlassFill } from '../renderer/GlassFill';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { shownConfig } from '../workspace/store';
import { AIEntry, shellAbout } from './ai-entry';
import { BannerAnchor, DraftNotice } from './Banner';
import { HistoryView } from './HistoryView';
import { targetIcon, targetLabel, useNavigate } from './navigation';
import { SettingsView } from './SettingsView';
import { Toast } from './Toast';
import { ToolsView } from './ToolsView';
import { WorkflowsScreen } from './WorkflowsScreen';

// 提示条单独放在 Banner.tsx（WorkflowsScreen 也要用，放这里会循环引用）；这里照样导出，旧的引用不用改。
export { APPLIED_BANNER_MS, Banner, DraftNotice } from './Banner';

const BAR_HEIGHT = { iconLabel: 64, label: 52, icon: 56 } as const;

/**
 * 外壳可以显示的目标：当前 app（或主页）的页面，和主页里的系统入口（AI 修改除外，它是单独的页面）。
 * app 里只显示它自己的页面；别的 app、主页的页面不会混进来（D-485）。
 */
function canShow(
  target: NavTarget | null,
  config: WorkspaceConfig,
  view: ShellView,
): target is NavTarget {
  if (target === null || target === 'ai') return false;
  const pageId = pageIdOf(target);
  if (pageId === null) return view.appId === null;
  const page = config.containers.pages.find((p) => p.id === pageId);
  return page !== undefined && (page.app ?? null) === view.appId;
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
  const { registry, locale, store } = useWorkspaceContext();
  // 草稿模式里显示草稿（D-190）。
  const config = useWorkspace(shownConfig)!;
  const headId = useWorkspace((s) => s.head!.id);
  const tab = useWorkspace((s) => s.tab);
  const appId = useWorkspace((s) => s.appId);
  const leaveApp = useWorkspace((s) => s.leaveApp);
  const view = appViewOf(config, appId);
  const markRendered = useWorkspace((s) => s.markRendered);
  // 点了「后台下载」的下载结束时提示一次（用户已经去做别的事了）。
  const packs = usePacks();
  const showToast = useWorkspace((s) => s.showToast);
  useEffect(
    () =>
      packs?.store.onBackgroundEnd(({ ok }) =>
        showToast({ message: t(locale, ok ? 'packBackgroundDone' : 'packBackgroundFailed') }),
      ),
    [packs, showToast, locale],
  );
  const editing = useWorkspace((s) => s.editing !== null);
  const startEditing = useWorkspace((s) => s.startEditing);
  const palette = usePalette(view.theme);
  const { navigate, locked, inDraft } = useShellEnv();
  const insets = useSafeAreaInsets();

  // 在的那个 app 没有了（例如恢复到旧版本、删了 app）：回主页。
  const missingApp = appId !== null && view.appId === null;
  useEffect(() => {
    if (missingApp) leaveApp();
  }, [missingApp, leaveApp]);

  // 子 App 里没有「返回 Tinkrum」（D-485）：回主页只能从手机上打开 Tinkrum。离开 App 再回来（点图标、切换器）就是
  // 回到主页；从桌面菜单、深链接直接打开某个 App 时，进入 App 发生在回来之后，留在那个 App 里。

  // 渲染完成（没有被 ErrorBoundary 拦截）才确认这次提交成功（§4）。
  useEffect(() => {
    void markRendered(headId);
  }, [headId, markRendered]);

  // 第一次打开（或在设置里选了重新看）：先看划屏介绍（D-149）。
  const guideStage = useGuide((s) => s.stage);
  const router = useRouter();

  useEffect(() => {
    let left: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') left = store.getState().appEnters;
      else if (state === 'active' && left !== null) {
        const since = left;
        left = null;
        // 打开 App 的事件（桌面菜单、深链接）比「回到前台」晚一点到，等它。
        setTimeout(() => {
          const s = store.getState();
          if (s.appId === null || s.appEnters > since) return;
          if (router.canDismiss()) router.dismissAll();
          s.leaveApp();
        }, 700);
      }
    });
    return () => sub.remove();
  }, [store, router]);
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    // 外壳随版本重新挂载（例如收件页面建了一张表）时，介绍可能已经开着，不再推一次。
    if (guideStage !== 'intro' || useGuide.getState().introOpen) return;
    useGuide.setState({ introOpen: true });
    router.push('/welcome');
  }, [guideStage, router]);

  const active = canShow(tab, config, view) ? tab : firstTarget(view);
  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    navigate,
    ...(locked ? { locked } : {}),
  };
  const navStyle = view.theme.navStyle;
  // 编辑模式下隐藏导航栏和浮动按钮：先「完成」或「取消」，草稿不会在切换页面时丢失（D-054）。
  const barSpace = editing ? insets.bottom : BAR_HEIGHT[navStyle] + insets.bottom;

  let content;
  const pageId = pageIdOf(active);
  const entryAbout = shellAbout(active);
  // 引导第 1、2 步（D-447）：Tink 的气泡浮在首页上，Tink 会动、带光圈。
  const bubbleGuide =
    pageId === HOME_PAGE_ID &&
    (guideStage === 'look' || guideStage === 'goal') &&
    !editing &&
    !inDraft;
  const lookGuide = bubbleGuide && guideStage === 'look';
  if (pageId !== null) {
    const page = config.containers.pages.find((p) => p.id === pageId)!;
    // 导航栏在页面下面（不是盖在页面上），页面不用再给它留一份高度；编辑模式没有导航栏，才要让开系统的
    // 底部区域。有浮动按钮时让开浮动按钮（bottomInset 里那 64 是给滚动内容留的）。
    const floatingShown = view.floating.length > 0 && !editing && !inDraft;
    const below = editing ? insets.bottom : 0;
    content = (
      <EditablePage
        page={page}
        env={env}
        bottomInset={below + (editing ? 0 : 64)}
        zoneInset={below + (floatingShown ? 64 : 0)}
      />
    );
  } else if (active === 'ai') {
    // 新 app 还没有页面，底栏里只有 Tink（D-485）。
    content = (
      <View style={styles.empty}>
        <Text style={[palette.font('body', 15), { color: palette.caption, textAlign: 'center' }]}>
          {t(locale, 'appEmpty')}
        </Text>
      </View>
    );
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
      {/* 右上角的 AI 入口（D-406）：这里没有导航栏，占一行，不盖住页面内容。设置和改动记录没有。 */}
      {entryAbout && !editing ? (
        <View
          style={[
            styles.entryRow,
            { paddingHorizontal: palette.pad },
            bubbleGuide && styles.entryOnTop,
          ]}>
          {/* 引导第一步（D-447）：首页上的 Tink 会动，点它和点气泡一样，打开那句话。 */}
          {bubbleGuide ? (
            <AIEntry
              about={entryAbout}
              palette={palette}
              lively
              {...(lookGuide ? { onPress: () => openLookGuide(router) } : {})}
            />
          ) : (
            <AIEntry about={entryAbout} palette={palette} />
          )}
        </View>
      ) : null}
      {/* Tink 那一行以下的内容包进 BlurTargetView：引导气泡出现时整片轻微虚化（Android 需要它才真模糊）。 */}
      <BlurTargetView ref={blurTarget} style={styles.content}>
        {inDraft ? null : <BannerAnchor palette={palette} />}
        <DraftNotice palette={palette} />
        {pageId === HOME_PAGE_ID && !editing && !inDraft ? <GuideCard palette={palette} /> : null}
        {pageId !== null && !editing && !inDraft ? (
          <SampleHint pageId={pageId} palette={palette} />
        ) : null}
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
              { left: palette.pad },
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

        {view.floating.length > 0 && !editing && !inDraft ? (
          <View style={[styles.floating, { right: palette.pad, bottom: barSpace + 16 }]}>
            {view.floating.map((target) => {
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
                    {targetLabel(target, config, locale, registry)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <DraftBar palette={palette} bottom={barSpace + 12} top={12} tinkRight={palette.pad + 12} />
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
          {view.bar.map((target) => {
            const isActive = target === active;
            const color = isActive || target === 'ai' ? palette.primaryText : palette.caption;
            const label = targetLabel(target, config, locale, registry);
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
      </BlurTargetView>
      {bubbleGuide ? (
        <GuideBubble palette={palette} top={insets.top + ENTRY_ROW} blurTarget={blurTarget} />
      ) : null}
    </View>
  );
}

/** 右上角 Tink 那一行的高度（上下各 8 + 图标 24）：引导气泡从这里往下浮。 */
const ENTRY_ROW = 40;

const styles = StyleSheet.create({
  // 引导气泡出现时 Tink 那一行浮在虚化层上面，光圈不被挡住。
  entryOnTop: { zIndex: 2, elevation: 2 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 8,
  },
  root: { flex: 1 },
  content: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  // 浮在页面上的东西（右上角 Tink、编辑、浮动按钮）左右贴着页面边距 palette.pad（D-454），在用的地方写。
  floating: { position: 'absolute', gap: 10, alignItems: 'flex-end' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  invisible: { opacity: 0 },
  editButton: { position: 'absolute', minHeight: 40, paddingHorizontal: 16 },
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
