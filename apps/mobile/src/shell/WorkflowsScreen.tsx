import {
  localize,
  QUICK_ACTION_KINDS,
  QUICK_ACTION_CATEGORIES,
  builtInWorkflows,
  presetById,
  workflowKinds,
  shareFit,
  type QuickActionKind,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { UiIcon, type UiIconName } from '../renderer/Icon';
import { mimeOf } from '../runtime/actions/helpers';
import { useIncoming, releaseShare } from '../share/incoming';
import type { SucceededRuns } from '../storage/types';
import type { Palette } from '../renderer/theme';
import { Button, Card, ListRow, PageTitle } from '../renderer/ui';
import { packsNeeded } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { Banner } from './Banner';

/** 步骤串成一行：「选照片 → 证件照 → 命名」。 */
export function stepChain(wf: Pick<Workflow, 'steps'>, registry: Registry, locale: Locale): string {
  return wf.steps
    .map((s) => localize(registry.actions.get(s.action)?.label, locale) ?? s.action)
    .join(' → ');
}

/**
 * 快捷操作分类页：先做自己的，再是这一类的全部快捷操作，用得多、最近用过的在前。
 * 由内核提供（AI 不能修改这个页面）；内设的快捷操作不用添加，直接运行（D-236）。
 * inPage：作为页面上的 quickActionList 组件显示（D-230），不滚动、没有提示条；
 * guard 返回 true 时不响应点按（草稿、预览）。
 */
export function WorkflowsScreen({
  palette,
  locale,
  registry,
  kind,
  shared,
  embedded = false,
  inPage,
}: {
  palette: Palette;
  locale: Locale;
  registry: Registry;
  kind?: QuickActionKind;
  shared?: string;
  embedded?: boolean;
  inPage?: { title?: string; guard: () => boolean };
}) {
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const { files, repo } = useWorkspaceContext();
  const incoming = useIncoming((s) => s.share);
  const share = shared && String(incoming?.id) === shared ? incoming : null;
  const handed = useRef(false);
  useEffect(
    () => () => {
      if (shared && !handed.current) void releaseShare(files, Number(shared));
    },
    [files, shared],
  );
  const [usage, setUsage] = useState<SucceededRuns>(new Map());
  useFocusEffect(
    useCallback(() => {
      handed.current = false;
      let alive = true;
      void repo
        .countSucceededRuns()
        .then((counts) => {
          if (alive) setUsage(counts);
        })
        .catch(() => {
          /* 统计暂时不可用时仍能浏览分类。 */
        });
      return () => {
        alive = false;
      };
    }, [repo]),
  );
  const inCategory = (w: Workflow) => !kind || workflowKinds(w).includes(kind);
  const builtIn = builtInWorkflows(config.workflows, locale);
  // 没用过的按：自己的、内设的、工具带的。
  const all = [
    ...config.workflows.filter((w) => !w.toolId),
    ...builtIn,
    ...config.workflows.filter((w) => w.toolId),
  ]
    .filter(inCategory)
    .sort((a, b) => {
      const x = usage.get(a.id),
        y = usage.get(b.id);
      return (y?.count ?? 0) - (x?.count ?? 0) || (y?.lastAt ?? 0) - (x?.lastAt ?? 0);
    });
  const fit = (w: Workflow) =>
    share
      ? shareFit(
          w,
          share.files.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) })),
        )
      : { ok: true as const };
  const fits = (w: Workflow) => fit(w).ok;
  const fitMessage = (w: Workflow) => {
    const result = fit(w);
    if (result.ok) return '';
    if (result.reason === 'tooFew')
      return t(locale, 'WorkflowsScreen_Needs_at_least_files_0ed9b', { v0: result.min });
    if (result.reason === 'tooMany')
      return t(locale, 'WorkflowsScreen_Takes_at_most_files_0fe59', { v0: result.max });
    return t(locale, 'WorkflowsScreen_Cannot_use_these_files_d0ca3');
  };
  const caption = [palette.font('body', 13), { color: palette.muted }];

  const blocked = () => inPage?.guard() ?? false;
  const run = (wf: Workflow) => {
    if (!fits(wf) || (shared && !share) || blocked()) return;
    handed.current = true;
    const route = {
      pathname: '/run/[workflowId]' as const,
      params: { workflowId: wf.id, ...(shared ? { shared } : {}) },
    };
    if (shared) router.replace(route);
    else router.push(route);
  };
  const edit = (wf: Workflow) => {
    if (!blocked()) router.push({ pathname: '/workflow/[id]', params: { id: wf.id } });
  };
  const row = (wf: Workflow) => {
    const preset = builtIn.includes(wf) ? presetById(wf.presetId!) : undefined;
    const toolName = wf.toolId
      ? (localize(registry.tools.get(wf.toolId)?.name, locale) ?? wf.toolId)
      : undefined;
    // 内设的有一句说明，就不再列步骤（说明里已经讲了这几步）。
    const description = preset && localize(preset.description, locale);
    // iOS 用系统的识别和扫描，不需要扫描包和文字识别包（D-084）。
    const needsDownload = preset && packsNeeded(preset.packs ?? [], files).length > 0;
    return (
      <Card key={wf.id} palette={palette} testID={`workflow-${wf.id}`}>
        <View style={styles.cardRow}>
          <View style={styles.cardText}>
            <Text style={[palette.font('title', 16), { color: palette.text }]}>{wf.name}</Text>
            {toolName ? <Text style={caption}>{toolName}</Text> : null}
            <Text style={caption}>{description || stepChain(wf, registry, locale)}</Text>
            {needsDownload ? (
              <Text style={caption}>
                {t(locale, 'WorkflowsScreen_The_first_run_downloads_what_it_needs__3a8fa')}
              </Text>
            ) : null}
            {usage.has(wf.id) ? (
              <Text style={caption}>{t(locale, 'shareUsed', { n: usage.get(wf.id)!.count })}</Text>
            ) : null}
            {share && !fits(wf) ? <Text style={caption}>{fitMessage(wf)}</Text> : null}
          </View>
          <View style={styles.actions}>
            <IconAction
              palette={palette}
              icon="play"
              testID={`workflow-run-${wf.id}`}
              label={t(locale, 'WorkflowsScreen_Run_5cab2')}
              disabled={!fits(wf)}
              onPress={() => run(wf)}
            />
            <IconAction
              palette={palette}
              icon="edit"
              testID={`workflow-edit-${wf.id}`}
              label={t(locale, 'WorkflowsScreen_Edit_ef7c8')}
              onPress={() => edit(wf)}
            />
          </View>
        </View>
      </Card>
    );
  };

  if (shared && !share) return <Text style={caption}>{t(locale, 'shareGone')}</Text>;

  if (!kind)
    return (
      <Body
        palette={palette}
        inPage={inPage}
        testID="workflows-screen"
        gap={inPage ? palette.gap - 4 : palette.gap}>
        {/* 页面栈里顶部已有标题，不再重复；嵌在主界面里时没有顶部标题。 */}
        {inPage ? null : embedded ? (
          <PageTitle palette={palette}>
            {t(locale, 'WorkflowsScreen_What_Morph_can_do_8f4f4')}
          </PageTitle>
        ) : (
          <Banner palette={palette} />
        )}
        {QUICK_ACTION_KINDS.map((category) => (
          <ListRow
            key={category}
            palette={palette}
            testID={`category-${category}`}
            icon={QUICK_ACTION_CATEGORIES[category].icon}
            label={localize(QUICK_ACTION_CATEGORIES[category].name, locale)}
            onPress={() => {
              if (blocked()) return;
              handed.current = true;
              const route = {
                pathname: '/quick-actions/[kind]' as const,
                params: { kind: category, ...(shared ? { shared } : {}) },
              };
              if (shared) router.replace(route);
              else router.push(route);
            }}
          />
        ))}
      </Body>
    );

  return (
    <Body palette={palette} inPage={inPage} testID={`quick-actions-${kind}`} gap={palette.gap - 4}>
      {/* 分类页总在页面栈里，顶部已有分类名。 */}
      {embedded || inPage ? null : <Banner palette={palette} />}
      <Button
        palette={palette}
        testID="quick-actions-create"
        label={t(locale, 'WorkflowsScreen_Make_your_own_quick_action_8bc98')}
        onPress={() => {
          if (blocked()) return;
          handed.current = true;
          router.push({
            pathname: '/change',
            params: {
              text: localize(QUICK_ACTION_CATEGORIES[kind].prefill, locale),
              ...(shared ? { shared } : {}),
            },
          });
        }}
      />
      {all.map(row)}
    </Body>
  );
}

/** 页面组件里不滚动，也没有提示条（页面自己有）；标题由 AI 决定。 */
function Body({
  palette,
  inPage,
  testID,
  gap,
  children,
}: {
  palette: Palette;
  inPage: { title?: string } | undefined;
  testID: string;
  gap: number;
  children: ReactNode;
}) {
  if (inPage)
    return (
      <View testID={testID} style={{ gap }}>
        {inPage.title ? (
          <Text style={[palette.font('title', 18), { color: palette.text }]}>{inPage.title}</Text>
        ) : null}
        {children}
      </View>
    );
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap, paddingBottom: 48 }}>
      {children}
    </ScrollView>
  );
}

/** 卡片右边的圆形图标按钮（运行、编辑）；文字留给读屏。 */
function IconAction({
  palette,
  icon,
  label,
  testID,
  disabled = false,
  onPress,
}: {
  palette: Palette;
  icon: UiIconName;
  label: string;
  testID: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        { backgroundColor: palette.primaryTint, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <UiIcon name={icon} size={18} color={palette.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardText: { flex: 1, gap: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  iconAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
