import {
  WORKFLOW_PRESETS,
  newWorkflowId,
  packById,
  presetWorkflow,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

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

  return (
    <ScrollView
      testID="workflows-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <Banner palette={palette} />
      <PageTitle palette={palette}>{zh ? '工作流' : 'Workflows'}</PageTitle>
      <Text style={caption}>
        {zh
          ? '工作流把几个步骤串起来一次做完，全部在本机处理。可以从预设添加，也可以对 AI 说「新建一个工作流：选照片、压到 500KB、分享」。'
          : 'A workflow does several steps in one go, all on this device. Add one from the presets, or ask AI: “Create a workflow: choose photos, compress to 500 KB, share”.'}
      </Text>

      <SectionLabel palette={palette}>{zh ? '我的工作流' : 'My workflows'}</SectionLabel>
      {mine.length === 0 ? (
        <Card palette={palette}>
          <Text testID="workflows-empty" style={caption}>
            {zh
              ? '还没有。从下面的预设库添加一个吧。'
              : 'None yet. Add one from the presets below.'}
          </Text>
        </Card>
      ) : (
        mine.map((wf) => row(wf))
      )}

      <SectionLabel palette={palette}>{zh ? '预设库' : 'Presets'}</SectionLabel>
      {WORKFLOW_PRESETS.map((preset) => {
        const added = mine.filter((w) => w.presetId === preset.id);
        // iOS 用系统的识别和扫描，不需要扫描包和文字识别包（D-084）。
        const packs = packsNeeded(preset.packs ?? [], files).map(
          (id) => packById(id)?.name[locale] ?? id,
        );
        return (
          <Card key={preset.id} palette={palette} testID={`preset-${preset.id}`}>
            <Text style={[palette.font('title', 16), { color: palette.text }]}>
              {preset.name[locale]}
              {added.length > 0 ? (zh ? ' · 已添加' : ' · added') : ''}
            </Text>
            <Text style={caption}>{preset.description[locale]}</Text>
            {packs.length > 0 ? (
              <Text style={caption}>
                {zh
                  ? `第一次运行时需要下载：${packs.join('、')}`
                  : `Downloads on first run: ${packs.join(', ')}`}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pill
                palette={palette}
                testID={`preset-add-${preset.id}`}
                label={added.length > 0 ? (zh ? '再添加一个' : 'Add another') : zh ? '添加' : 'Add'}
                onPress={() => {
                  const wf = presetWorkflow(
                    preset,
                    locale,
                    newWorkflowId(preset.id, config.workflows),
                  );
                  void change(
                    [{ op: 'addWorkflow', workflow: wf }],
                    zh ? `添加工作流「${wf.name}」` : `Add the workflow “${wf.name}”`,
                  );
                }}
              />
            </View>
          </Card>
        );
      })}

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
});
