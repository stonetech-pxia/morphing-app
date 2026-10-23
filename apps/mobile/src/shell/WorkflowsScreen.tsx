import {
  PRESET_SCENARIOS,
  newWorkflowId,
  presetWorkflow,
  presetsIn,
  type WorkflowPreset,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Card, PageTitle, Pill, SectionLabel } from '../renderer/ui';
import { useWorkflowChange } from '../run/workflow-change';
import { packsNeeded } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { Banner } from './Shell';

/** 步骤串成一行：「选照片 → 证件照 → 命名」。 */
export function stepChain(wf: Pick<Workflow, 'steps'>, registry: Registry, locale: Locale): string {
  return wf.steps.map((s) => registry.actions.get(s.action)?.label[locale] ?? s.action).join(' → ');
}

/**
 * 「工作流」页（TOOLS_DESIGN §7，D-082）：我的工作流、工具自带的工作流、预设库。
 * 由内核提供（AI 不能修改这个页面）；添加预设是一次可撤销的修改。
 */
export function WorkflowsScreen({
  palette,
  locale,
  registry,
}: {
  palette: Palette;
  locale: Locale;
  registry: Registry;
}) {
  const zh = locale === 'zh';
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const { files } = useWorkspaceContext();
  const change = useWorkflowChange();
  const [showTools, setShowTools] = useState(false);
  const mine = config.workflows.filter((w) => !w.toolId);
  const toolOwned = config.workflows.filter((w) => w.toolId);
  const caption = [palette.font('body', 13), { color: palette.muted }];

  const run = (wf: Workflow) =>
    router.push({ pathname: '/run/[workflowId]', params: { workflowId: wf.id } });
  const edit = (wf: Workflow) => router.push({ pathname: '/workflow/[id]', params: { id: wf.id } });

  const row = (wf: Workflow, subtitle?: string) => (
    <Card key={wf.id} palette={palette} testID={`workflow-${wf.id}`}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>{wf.name}</Text>
      {subtitle ? <Text style={caption}>{subtitle}</Text> : null}
      <Text style={caption}>{stepChain(wf, registry, locale)}</Text>
      <View style={styles.actions}>
        <Pill
          palette={palette}
          testID={`workflow-run-${wf.id}`}
          label={zh ? '运行' : 'Run'}
          onPress={() => run(wf)}
        />
        <Pill
          palette={palette}
          testID={`workflow-edit-${wf.id}`}
          label={zh ? '编辑' : 'Edit'}
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
          {preset.name[locale]}
          {added.length > 0 ? (zh ? ' · 已添加' : ' · added') : ''}
        </Text>
        <Text style={caption}>{preset.description[locale]}</Text>
        {needsDownload ? (
          <Text style={caption}>
            {zh
              ? '首次使用需要下载一些内容，之后不联网也能用。'
              : 'The first run downloads what it needs; it works offline afterwards.'}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {/* 加好了就能直接用（D-125）。 */}
          {added.length > 0 ? (
            <Pill
              palette={palette}
              testID={`preset-run-${preset.id}`}
              label={zh ? '运行' : 'Run'}
              onPress={() => run(added.at(-1)!)}
            />
          ) : null}
          <Pill
            palette={palette}
            testID={`preset-add-${preset.id}`}
            label={added.length > 0 ? (zh ? '再添加一个' : 'Add another') : zh ? '添加' : 'Add'}
            onPress={() => {
              const wf = presetWorkflow(preset, locale, newWorkflowId(preset.id, config.workflows));
              void change(
                [{ op: 'addWorkflow', workflow: wf }],
                zh ? `添加了快捷操作「${wf.name}」` : `Added the quick action “${wf.name}”`,
              );
            }}
          />
        </View>
      </Card>
    );
  };

  return (
    <ScrollView
      testID="workflows-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <Banner palette={palette} />
      <PageTitle palette={palette}>{t(locale, 'workflowsTitle')}</PageTitle>
      <Text style={caption}>
        {zh
          ? '快捷操作把几个步骤串起来一次做完，全部在本机处理。可以从下面现成的里添加，也可以对 AI 说「新建一个快捷操作：选照片、压到 500KB、分享」。'
          : 'A quick action does several steps in one go, all on this device. Add a ready-made one below, or ask AI: “Create a quick action: choose photos, compress to 500 KB, share”.'}
      </Text>

      <SectionLabel palette={palette}>{zh ? '我的快捷操作' : 'My quick actions'}</SectionLabel>
      {mine.length === 0 ? (
        <Card palette={palette}>
          <Text testID="workflows-empty" style={caption}>
            {zh ? '还没有。从下面现成的里添加一个吧。' : 'None yet. Add a ready-made one below.'}
          </Text>
        </Card>
      ) : (
        mine.map((wf) => row(wf))
      )}

      {/* 现成的快捷操作按生活场景分组（D-130）。 */}
      <SectionLabel palette={palette}>{zh ? '现成的' : 'Ready-made'}</SectionLabel>
      {PRESET_SCENARIOS.map((scenario) => (
        <View key={scenario.id} style={styles.scenario} testID={`scenario-${scenario.id}`}>
          <Text style={[palette.font('title', 15), { color: palette.muted }]}>
            {scenario.name[locale]}
          </Text>
          {presetsIn(scenario.id).map(presetCard)}
        </View>
      ))}

      {toolOwned.length > 0 ? (
        <>
          <SectionLabel palette={palette}>{zh ? '工具自带的' : 'From your tools'}</SectionLabel>
          <Pill
            palette={palette}
            testID="workflows-show-tools"
            label={
              showTools
                ? zh
                  ? '收起'
                  : 'Hide'
                : zh
                  ? `显示 ${toolOwned.length} 个`
                  : `Show ${toolOwned.length}`
            }
            onPress={() => setShowTools((v) => !v)}
          />
          {showTools
            ? toolOwned.map((wf) =>
                row(wf, registry.tools.get(wf.toolId!)?.name[locale] ?? wf.toolId),
              )
            : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  scenario: { gap: 8 },
});
