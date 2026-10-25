import {
  localize,
  QUICK_ACTION_KINDS,
  QUICK_ACTION_CATEGORIES,
  WORKFLOW_PRESETS,
  workflowKinds,
  presetKinds,
  shareFit,
  type QuickActionKind,
  newWorkflowId,
  presetWorkflow,
  type WorkflowPreset,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import { mimeOf } from '../runtime/actions/helpers';
import { useIncoming, releaseShare } from '../share/incoming';
import type { SucceededRuns } from '../storage/types';
import type { Palette } from '../renderer/theme';
import { Button, Card, PageTitle, Pill, SectionLabel } from '../renderer/ui';
import { useWorkflowChange } from '../run/workflow-change';
import { packsNeeded } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { Banner } from './Shell';

/** 步骤串成一行：「选照片 → 证件照 → 命名」。 */
export function stepChain(wf: Pick<Workflow, 'steps'>, registry: Registry, locale: Locale): string {
  return wf.steps
    .map((s) => localize(registry.actions.get(s.action)?.label, locale) ?? s.action)
    .join(' → ');
}

/**
 * 快捷操作分类页：先做自己的，再看我的、现成的和工具自带的。
 * 由内核提供（AI 不能修改这个页面）；添加预设是一次可撤销的修改。
 */
export function WorkflowsScreen({
  palette,
  locale,
  registry,
  kind,
  shared,
  embedded = false,
}: {
  palette: Palette;
  locale: Locale;
  registry: Registry;
  kind?: QuickActionKind;
  shared?: string;
  embedded?: boolean;
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
  const change = useWorkflowChange();
  const inCategory = (w: Workflow) => !kind || workflowKinds(w).includes(kind);
  const mine = config.workflows
    .filter((w) => !w.toolId && inCategory(w))
    .sort((a, b) => {
      const x = usage.get(a.id),
        y = usage.get(b.id);
      return (y?.count ?? 0) - (x?.count ?? 0) || (y?.lastAt ?? 0) - (x?.lastAt ?? 0);
    });
  const toolOwned = config.workflows.filter((w) => w.toolId && inCategory(w));
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

  const run = (wf: Workflow) => {
    if (!fits(wf) || (shared && !share)) return;
    handed.current = true;
    const route = {
      pathname: '/run/[workflowId]' as const,
      params: { workflowId: wf.id, ...(shared ? { shared } : {}) },
    };
    if (shared) router.replace(route);
    else router.push(route);
  };
  const edit = (wf: Workflow) => router.push({ pathname: '/workflow/[id]', params: { id: wf.id } });

  const row = (wf: Workflow, subtitle?: string) => (
    <Card key={wf.id} palette={palette} testID={`workflow-${wf.id}`}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>{wf.name}</Text>
      {subtitle ? <Text style={caption}>{subtitle}</Text> : null}
      <Text style={caption}>{stepChain(wf, registry, locale)}</Text>
      {usage.has(wf.id) ? (
        <Text style={caption}>{t(locale, 'shareUsed', { n: usage.get(wf.id)!.count })}</Text>
      ) : null}
      {share && !fits(wf) ? <Text style={caption}>{fitMessage(wf)}</Text> : null}
      <View style={styles.actions}>
        <Button
          variant="text"
          palette={palette}
          testID={`workflow-run-${wf.id}`}
          label={t(locale, 'WorkflowsScreen_Run_5cab2')}
          disabled={!fits(wf)}
          onPress={() => run(wf)}
        />
        <Pill
          palette={palette}
          testID={`workflow-edit-${wf.id}`}
          label={t(locale, 'WorkflowsScreen_Edit_ef7c8')}
          onPress={() => edit(wf)}
        />
      </View>
    </Card>
  );

  const presetCard = (preset: WorkflowPreset) => {
    const added = mine.filter((w) => w.presetId === preset.id);
    // iOS 用系统的识别和扫描，不需要扫描包和文字识别包（D-084）。
    const needsDownload = packsNeeded(preset.packs ?? [], files).length > 0;
    return (
      <Card key={preset.id} palette={palette} testID={`preset-${preset.id}`}>
        <Text style={[palette.font('title', 16), { color: palette.text }]}>
          {localize(preset.name, locale)}
          {added.length > 0 ? t(locale, 'WorkflowsScreen_added_db6a6') : ''}
        </Text>
        <Text style={caption}>{localize(preset.description, locale)}</Text>
        {needsDownload ? (
          <Text style={caption}>
            {t(locale, 'WorkflowsScreen_The_first_run_downloads_what_it_needs__3a8fa')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {/* 加好了就能直接用（D-125）。 */}
          {added.length > 0 ? (
            <Button
              variant="text"
              palette={palette}
              testID={`preset-run-${preset.id}`}
              label={t(locale, 'WorkflowsScreen_Run_5cab2')}
              disabled={!fits(added.at(-1)!)}
              onPress={() => run(added.at(-1)!)}
            />
          ) : null}
          <Pill
            palette={palette}
            testID={`preset-add-${preset.id}`}
            label={
              added.length > 0
                ? t(locale, 'WorkflowsScreen_Add_another_fea84')
                : t(locale, 'WorkflowsScreen_Add_b7a68')
            }
            onPress={() => {
              const wf = presetWorkflow(preset, locale, newWorkflowId(preset.id, config.workflows));
              void change(
                [{ op: 'addWorkflow', workflow: wf }],
                t(locale, 'WorkflowsScreen_Added_the_quick_action_ad5f0', { v0: wf.name }),
              );
            }}
          />
        </View>
      </Card>
    );
  };

  if (shared && !share) return <Text style={caption}>{t(locale, 'shareGone')}</Text>;

  if (!kind)
    return (
      <ScrollView
        testID="workflows-screen"
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
        {embedded ? null : <Banner palette={palette} />}
        <PageTitle palette={palette}>
          {t(locale, 'WorkflowsScreen_What_Morph_can_do_8f4f4')}
        </PageTitle>
        {QUICK_ACTION_KINDS.map((category) => (
          <Card key={category} palette={palette}>
            <Icon name={QUICK_ACTION_CATEGORIES[category].icon} size={24} color={palette.primary} />
            <Button
              palette={palette}
              testID={`category-${category}`}
              label={localize(QUICK_ACTION_CATEGORIES[category].name, locale)}
              onPress={() => {
                handed.current = true;
                const route = {
                  pathname: '/quick-actions/[kind]' as const,
                  params: { kind: category, ...(shared ? { shared } : {}) },
                };
                if (shared) router.replace(route);
                else router.push(route);
              }}
            />
          </Card>
        ))}
      </ScrollView>
    );

  return (
    <ScrollView
      testID={`quick-actions-${kind}`}
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      {embedded ? null : <Banner palette={palette} />}
      <PageTitle palette={palette}>
        {localize(QUICK_ACTION_CATEGORIES[kind].name, locale)}
      </PageTitle>
      <Button
        palette={palette}
        testID="quick-actions-create"
        label={t(locale, 'WorkflowsScreen_Make_your_own_quick_action_8bc98')}
        onPress={() => {
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
      <SectionLabel palette={palette}>
        {t(locale, 'WorkflowsScreen_My_quick_actions_07fc0')}
      </SectionLabel>
      {mine.length === 0 ? (
        <Text testID="workflows-empty" style={caption}>
          {t(locale, 'WorkflowsScreen_None_yet_Add_a_ready_made_one_below_c24f8')}
        </Text>
      ) : (
        mine.map((wf) => row(wf))
      )}
      <SectionLabel palette={palette}>{t(locale, 'WorkflowsScreen_Ready_made_1f239')}</SectionLabel>
      {WORKFLOW_PRESETS.filter((preset) => presetKinds(preset).includes(kind)).map(presetCard)}
      {toolOwned.length > 0 ? (
        <>
          <SectionLabel palette={palette}>
            {t(locale, 'WorkflowsScreen_From_your_tools_dca19')}
          </SectionLabel>
          {toolOwned.map((wf) =>
            row(wf, localize(registry.tools.get(wf.toolId!)?.name, locale) ?? wf.toolId),
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
