import {
  dismissHabit,
  habitKey,
  habitLabel,
  habitWorkflow,
  hasSameWorkflow,
  homeEntryOps,
  newWorkflowId,
  recordHabit,
  rememberedAnswers,
  shouldSuggest,
  type AskedAnswer,
  type HabitRecord,
  type Workflow,
} from '@morph/core';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Card, Pill } from '../renderer/ui';
import type { WorkspaceRepo } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useWorkflowChange } from './workflow-change';

// 从使用习惯里提议（D-127）：连续几次在「每次运行时问」里选了同样的值，结果页问要不要做成一个
// 不用再选的快捷操作放到首页。统计只在本机（app_meta），不发给 AI；用户点了才修改，可以撤销。

const metaKey = (workflowId: string) => `habit:${workflowId}`;

async function readHabit(repo: WorkspaceRepo, workflowId: string): Promise<HabitRecord | null> {
  try {
    const raw = await repo.getMeta(metaKey(workflowId));
    return raw ? (JSON.parse(raw) as HabitRecord) : null;
  } catch {
    return null;
  }
}

const writeHabit = (repo: WorkspaceRepo, workflowId: string, record: HabitRecord) =>
  repo.setMeta(metaKey(workflowId), JSON.stringify(record));

interface Suggestion {
  label: string;
  workflow: Workflow;
  record: HabitRecord;
}

/**
 * 一次成功的运行结束后调用一次：记下这次的回答，够次数时显示提议。
 * answers 是这次运行里每一步「每次运行时问」的回答。
 */
export function HabitCard({
  workflow,
  answers,
  palette,
}: {
  workflow: Workflow;
  answers: readonly AskedAnswer[];
  palette: Palette;
}) {
  const { repo, registry, locale } = useWorkspaceContext();
  const workflows = useWorkspace((s) => s.config!.workflows);
  const change = useWorkflowChange();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [made, setMade] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const remembered = rememberedAnswers(workflow, answers, registry);
      const record = recordHabit(
        await readHabit(repo, workflow.id),
        remembered ? habitKey(remembered) : null,
      );
      await writeHabit(repo, workflow.id, record);
      if (!remembered || !shouldSuggest(record) || !live) return;
      const label = habitLabel(workflow, remembered, registry, locale, new Date());
      const candidate = habitWorkflow(
        workflow,
        remembered,
        newWorkflowId(`${workflow.id}-habit`, workflows),
        `${workflow.name} · ${label}`,
      );
      if (hasSameWorkflow(workflows, candidate)) return;
      setSuggestion({ label, workflow: candidate, record });
    })();
    return () => {
      live = false;
    };
    // 每次运行的结果只记一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const config = useWorkspace((s) => s.config!);
  if (made) {
    return (
      <Text testID="habit-made" style={[palette.font('bodyMedium', 14), { color: palette.muted }]}>
        {t(locale, 'habitMade', { name: made })}
      </Text>
    );
  }
  if (!suggestion) return null;

  async function make() {
    const wf = suggestion!.workflow;
    const ok = await change(
      [{ op: 'addWorkflow', workflow: wf }, ...homeEntryOps(config, [wf.id])],
      t(locale, 'habitMade', { name: wf.name }),
    );
    if (ok) setMade(wf.name);
  }

  async function dismiss() {
    await writeHabit(repo, workflow.id, dismissHabit(suggestion!.record));
    setSuggestion(null);
  }

  return (
    <Card palette={palette} background={palette.primaryTint} testID="habit-card">
      <Text style={[palette.font('title', 16), { color: palette.text }]}>
        {t(locale, 'habitTitle', { value: suggestion.label })}
      </Text>
      <Text style={[palette.font('body', 14), { color: palette.text }]}>
        {t(locale, 'habitBody', { name: suggestion.workflow.name })}
      </Text>
      <View style={styles.actions}>
        <Pill
          palette={palette}
          testID="habit-make"
          label={t(locale, 'habitMake')}
          onPress={() => void make()}
        />
        <Pill
          palette={palette}
          testID="habit-no"
          label={t(locale, 'habitNo')}
          onPress={() => void dismiss()}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
