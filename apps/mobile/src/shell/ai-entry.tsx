import {
  DESK_KINDS,
  pageIdOf,
  quickActionsOf,
  type DeskKind,
  type Locale,
  type NavTarget,
  type PlanAbout,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { useDraftUi } from '../draft/ui';
import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

// 页面右上角的 AI 入口（D-406）：所有页面都有，除了设置（含它的子页面）、改动记录和 AI 页本身。
// 从这里进 AI 页，「这个页面」默认指这一页（PlanAbout，只有 ID，没有记录和文件名，底线 1、2）。
// 从别的地方进（导航栏、设置里的「修改这个 App」）不带页面。

/** 打开 AI 页时的路由参数；ChangeScreen 用 aboutFromParams 读回来。 */
export function aboutParams(about: PlanAbout): Record<string, string> {
  switch (about.kind) {
    case 'page':
      return { page: about.pageId };
    case 'table':
      return { table: about.tableId };
    case 'screen':
      return { screen: about.screen };
    case 'desk':
      return { desk: about.fileKind };
    case 'workflow':
      return { workflow: about.workflowId };
    default:
      return {};
  }
}

export function aboutFromParams(
  params: { page?: string; table?: string; screen?: string; desk?: string },
  config: WorkspaceConfig,
): PlanAbout | undefined {
  if (params.page && config.containers.pages.some((p) => p.id === params.page))
    return { kind: 'page', pageId: params.page };
  if (params.table && config.data.tables.some((c) => c.id === params.table))
    return { kind: 'table', tableId: params.table };
  if (params.screen === 'tools' || params.screen === 'quickActions')
    return { kind: 'screen', screen: params.screen };
  if (params.desk && (DESK_KINDS as readonly string[]).includes(params.desk))
    return { kind: 'desk', fileKind: params.desk as DeskKind };
  return undefined;
}

/** AI 页和草稿聊天框上「现在修改的是哪一页」的提示；快捷操作和收件页面有自己的说法。 */
export function aboutPlace(
  about: PlanAbout | undefined,
  config: WorkspaceConfig | null,
  locale: Locale,
): { title: string; hint: string } | null {
  if (!about || !config) return null;
  switch (about.kind) {
    case 'page': {
      const name = config.containers.pages.find((p) => p.id === about.pageId)?.title;
      return name === undefined
        ? null
        : { title: t(locale, 'aboutPage', { name }), hint: t(locale, 'aboutPageHint') };
    }
    case 'table': {
      const name = config.data.tables.find((c) => c.id === about.tableId)?.name;
      return name === undefined
        ? null
        : { title: t(locale, 'aboutTable', { name }), hint: t(locale, 'aboutTableHint') };
    }
    case 'screen':
      return about.screen === 'tools'
        ? { title: t(locale, 'aboutToolsScreen'), hint: t(locale, 'aboutToolsScreenHint') }
        : {
            title: t(locale, 'aboutQuickActionsScreen'),
            hint: t(locale, 'aboutQuickActionsScreenHint'),
          };
    case 'desk':
      return { title: t(locale, 'aboutDesk'), hint: t(locale, 'aboutDeskHint') };
    default:
      return null;
  }
}

/** 外壳里这一页的入口带什么；null = 没有入口（设置、改动记录）。 */
export function shellAbout(target: NavTarget): PlanAbout | null {
  const pageId = pageIdOf(target);
  if (pageId !== null) return { kind: 'page', pageId };
  if (target === 'tools' || target === 'quickActions') return { kind: 'screen', screen: target };
  return null;
}

/** AI 只看得到配置里的快捷操作；内设的还没改过（D-236），算在快捷操作页面上。 */
export function workflowAbout(config: WorkspaceConfig, workflowId: string): PlanAbout {
  return quickActionsOf(config).some((w) => w.id === workflowId)
    ? { kind: 'workflow', workflowId }
    : { kind: 'screen', screen: 'quickActions' };
}

/** 右上角的入口：草稿模式里打开聊天框（和 D-190 一样），否则打开 AI 页。 */
export function AIEntry({ about, palette }: { about: PlanAbout; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const router = useRouter();
  const inDraft = useWorkspace((s) => !!s.draft?.open);
  const setChatOpen = useDraftUi((s) => s.setChatOpen);
  return (
    <AIEntryButton
      palette={palette}
      locale={locale}
      onPress={() =>
        inDraft
          ? setChatOpen(true, about)
          : router.push({ pathname: '/change', params: aboutParams(about) })
      }
    />
  );
}

/** 入口的样子；收件页面打开 AI 前还要留住分享的文件，自己传 onPress。 */
export function AIEntryButton({
  palette,
  locale,
  onPress,
}: {
  palette: Palette;
  locale: Locale;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="page-ai"
      accessibilityRole="button"
      accessibilityLabel={t(locale, 'aboutEntryLabel')}
      hitSlop={10}
      onPress={onPress}>
      <Icon name="tink" size={24} color={palette.primaryText} />
    </Pressable>
  );
}

// 导航栏的 headerRight。
export function entryOption(about: PlanAbout, palette: Palette) {
  return function HeaderEntry() {
    return <AIEntry about={about} palette={palette} />;
  };
}
export const quickActionsEntry = (palette: Palette) =>
  entryOption({ kind: 'screen', screen: 'quickActions' }, palette);
export const tableEntry = (tableId: string, palette: Palette) =>
  entryOption({ kind: 'table', tableId }, palette);
export const workflowEntry = (config: WorkspaceConfig, workflowId: string, palette: Palette) =>
  entryOption(workflowAbout(config, workflowId), palette);
