import {
  HOME_PAGE_ID,
  allComponents,
  initialParams,
  insertableActions,
  newWorkflowId,
  presetById,
  stepIdFor,
  topIndex,
  workflowProblems,
  type ActionDefinition,
  type Locale,
  type Registry,
  type Workflow,
  type WorkflowStep,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Palette } from '../renderer/theme';
import { Button, Card, Pill } from '../renderer/ui';
import { Banner } from '../shell/Shell';
import { useWorkspace } from '../workspace/context';
import { Chip, ParamForm, visibleFields } from './ParamForm';
import { confirmDelete, useWorkflowChange } from './workflow-change';

// 工作流编辑页（TOOLS_DESIGN §7，D-082）：改名字和参数、哪些参数每次运行时问、加 / 删 / 移动步骤。
// 改动先放在草稿里，点「保存」生成一个版本（可撤销）；只能插入类型接得上的动作，接不上的步骤会标出来。

interface Draft {
  name: string;
  steps: WorkflowStep[];
}

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function WorkflowEditor({
  workflow,
  palette,
  locale,
  registry,
}: {
  workflow: Workflow;
  palette: Palette;
  locale: Locale;
  registry: Registry;
}) {
  const zh = locale === 'zh';
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const change = useWorkflowChange();
  const saved: Draft = { name: workflow.name, steps: workflow.steps };
  const [draft, setDraft] = useState<Draft>(saved);
  // 工作流在别处被改了（提示条上的「撤销」、AI）：草稿没有未保存的改动时跟着更新。
  const [base, setBase] = useState<Draft>(saved);
  if (!same(base, saved)) {
    setBase(saved);
    if (same(draft, base)) setDraft(saved);
  }
  // 插入步骤的选择框：在第几步之前插入。
  const [inserting, setInserting] = useState<number | null>(null);
  const dirty = !same(draft, saved);
  const candidate: Workflow = { ...workflow, name: draft.name, steps: draft.steps };
  const problems = useMemo(
    () => workflowProblems(candidate, registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, registry],
  );
  const nameOk = draft.name.trim().length > 0 && draft.name.trim().length <= 40;
  const canSave = dirty && problems.length === 0 && nameOk;
  const label = (a: ActionDefinition | undefined, id: string) => a?.label[locale] ?? id;
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID)!;
  const onHome = allComponents(home).some(
    (c) => c.type === 'workflowRunner' && c.props.workflowId === workflow.id,
  );
  const preset = workflow.presetId ? presetById(workflow.presetId) : undefined;
  const caption = [palette.font('body', 13), { color: palette.muted }];

  const setStep = (i: number, next: Partial<WorkflowStep>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, j) => (j === i ? { ...s, ...next } : s)),
    }));
  const move = (i: number, delta: number) =>
    setDraft((d) => {
      const steps = [...d.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + delta, 0, s!);
      return { ...d, steps };
    });
  const remove = (i: number) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }));
  const insert = (index: number, action: ActionDefinition) =>
    setDraft((d) => {
      const steps = [...d.steps];
      steps.splice(index, 0, {
        id: stepIdFor(action.id, d.steps),
        action: action.id,
        params: initialParams(action),
      });
      return { ...d, steps };
    });

  async function save() {
    const name = draft.name.trim();
    const ok = await change(
      [{ op: 'updateWorkflow', workflowId: workflow.id, name, steps: draft.steps }],
      zh ? `调整了快捷操作「${name}」` : `Adjusted the quick action “${name}”`,
    );
    if (ok) setDraft({ name, steps: draft.steps });
  }

  async function duplicate() {
    const id = newWorkflowId(workflow.presetId ?? 'my-workflow', config.workflows);
    const name = `${workflow.name}${zh ? ' 副本' : ' copy'}`.slice(0, 40);
    const copy: Workflow = { id, name, steps: workflow.steps };
    if (workflow.icon) copy.icon = workflow.icon;
    if (workflow.presetId) copy.presetId = workflow.presetId;
    const ok = await change(
      [{ op: 'addWorkflow', workflow: copy }],
      zh ? `复制了快捷操作「${workflow.name}」` : `Copied the quick action “${workflow.name}”`,
    );
    if (ok) router.replace({ pathname: '/workflow/[id]', params: { id } });
  }

  // 「新」步骤的参数：前面最近一个「读取记录」步骤的数据表（报表选字段用）。
  const collectionBefore = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const s = draft.steps[j]!;
      if (s.action === 'in.records') {
        return config.collections.find((c) => c.id === s.params.collectionId);
      }
    }
    return undefined;
  };

  const addHere = (index: number) => (
    <Pressable
      testID={`step-insert-${index}`}
      onPress={() => setInserting(index)}
      style={styles.insert}
      hitSlop={6}>
      <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>
        {zh ? '＋ 在这里加一步' : '＋ Add a step here'}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView
        testID="workflow-editor"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 6, paddingBottom: 80 }}>
        <Banner palette={palette} />
        <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
          {zh ? '名称' : 'Name'}
        </Text>
        <TextInput
          testID="workflow-name"
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          maxLength={40}
          style={[
            styles.input,
            palette.font('body', 16),
            {
              color: palette.text,
              borderColor: nameOk ? palette.border : palette.danger,
              borderRadius: palette.controlRadius,
              backgroundColor: palette.surface,
            },
          ]}
        />
        {workflow.toolId ? (
          <Text style={caption}>
            {zh
              ? `这个快捷操作来自「${registry.tools.get(workflow.toolId)?.name.zh ?? workflow.toolId}」工具：可以修改，移除工具时会一起移除。`
              : `This quick action comes with the ${registry.tools.get(workflow.toolId)?.name.en ?? workflow.toolId} tool: you can change it; it goes away when the tool is removed.`}
          </Text>
        ) : null}

        {draft.steps.map((step, i) => {
          const action = registry.actions.get(step.action);
          const stepProblems = problems.filter((p) => p.stepId === step.id);
          const fields = action ? visibleFields(action, step.params) : [];
          const ask = step.ask ?? [];
          return (
            <View key={step.id} style={{ gap: 6 }}>
              {i > 0 ? addHere(i) : null}
              <Card palette={palette} testID={`step-${i}`}>
                <View style={styles.stepHead}>
                  <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                    {i + 1}
                  </Text>
                  <Text
                    style={[palette.font('title', 16), styles.flex, { color: palette.text }]}
                    numberOfLines={1}>
                    {label(action, step.action)}
                  </Text>
                  <Pressable
                    testID={`step-up-${i}`}
                    disabled={i === 0}
                    onPress={() => move(i, -1)}
                    hitSlop={6}
                    style={[
                      styles.round,
                      { borderColor: palette.border, opacity: i === 0 ? 0.3 : 1 },
                    ]}>
                    <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>↑</Text>
                  </Pressable>
                  <Pressable
                    testID={`step-down-${i}`}
                    disabled={i === draft.steps.length - 1}
                    onPress={() => move(i, 1)}
                    hitSlop={6}
                    style={[
                      styles.round,
                      {
                        borderColor: palette.border,
                        opacity: i === draft.steps.length - 1 ? 0.3 : 1,
                      },
                    ]}>
                    <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>↓</Text>
                  </Pressable>
                  <Pressable
                    testID={`step-remove-${i}`}
                    disabled={draft.steps.length === 1}
                    onPress={() => remove(i)}
                    hitSlop={6}
                    style={[
                      styles.round,
                      { borderColor: palette.border, opacity: draft.steps.length === 1 ? 0.3 : 1 },
                    ]}>
                    <Text style={[palette.font('bodyBold', 15), { color: palette.danger }]}>✕</Text>
                  </Pressable>
                </View>
                {action ? <Text style={caption}>{action.description[locale]}</Text> : null}
                {action?.local ? (
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                    {zh ? '运行时你在手机上操作这一步。' : 'You do this step by hand when it runs.'}
                  </Text>
                ) : null}
                {action?.fields.some((f) => f.kind === 'secret') ? (
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                    {zh
                      ? '密码在每次运行时问，不会保存。'
                      : 'The password is asked on every run and never saved.'}
                  </Text>
                ) : null}
                {action && action.fields.length > 0 ? (
                  <ParamForm
                    action={action}
                    values={step.params}
                    onChange={(params) => setStep(i, { params })}
                    palette={palette}
                    locale={locale}
                    testPrefix={`step-${i}`}
                    collection={collectionBefore(i)}
                  />
                ) : null}
                {fields.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                      {zh ? '每次运行时问：' : 'Ask on every run:'}
                    </Text>
                    <View style={styles.wrap}>
                      {fields.map((f) => (
                        <Chip
                          key={f.key}
                          palette={palette}
                          testID={`step-${i}-ask-${f.key}`}
                          label={f.label[locale]}
                          selected={ask.includes(f.key)}
                          onPress={() => {
                            const next = ask.includes(f.key)
                              ? ask.filter((k) => k !== f.key)
                              : [...ask, f.key];
                            const { ask: _old, ...rest } = step;
                            setDraft((d) => ({
                              ...d,
                              steps: d.steps.map((s, j) =>
                                j === i ? (next.length ? { ...rest, ask: next } : rest) : s,
                              ),
                            }));
                          }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                {stepProblems.length > 0 ? (
                  <Text
                    testID={`step-problem-${i}`}
                    style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>
                    {stepProblems[0]!.code === 'binding' || stepProblems[0]!.code === 'source'
                      ? zh
                        ? i === 0
                          ? '第一步要选照片、选文件、输入文字或读取记录。'
                          : '这一步接不上前一步（类型不对）。'
                        : i === 0
                          ? 'The first step has to choose photos or files, take text or read records.'
                          : 'This step doesn’t fit after the one before it.'
                      : zh
                        ? '请检查这一步的设置。'
                        : 'Check the settings of this step.'}
                  </Text>
                ) : null}
              </Card>
            </View>
          );
        })}
        {addHere(draft.steps.length)}

        <View style={styles.row}>
          <Button
            palette={palette}
            testID="workflow-save"
            label={zh ? '保存' : 'Save'}
            disabled={!canSave}
            onPress={() => void save()}
            style={styles.flex}
          />
          {dirty ? (
            <Button
              palette={palette}
              testID="workflow-discard"
              variant="outline"
              label={zh ? '放弃修改' : 'Discard'}
              onPress={() => setDraft(saved)}
              style={styles.flex}
            />
          ) : (
            <Button
              palette={palette}
              testID="workflow-run"
              variant="outline"
              label={zh ? '运行' : 'Run'}
              onPress={() =>
                router.push({ pathname: '/run/[workflowId]', params: { workflowId: workflow.id } })
              }
              style={styles.flex}
            />
          )}
        </View>
        <View style={styles.wrap}>
          <Pill
            palette={palette}
            testID="workflow-duplicate"
            label={zh ? '复制' : 'Duplicate'}
            onPress={() => void duplicate()}
          />
          {onHome ? null : (
            <Pill
              palette={palette}
              testID="workflow-to-home"
              label={zh ? '放到首页' : 'Put on Home'}
              onPress={() =>
                void change(
                  [
                    {
                      op: 'addComponent',
                      pageId: HOME_PAGE_ID,
                      index: topIndex(home),
                      component: {
                        id: newWorkflowId(`run-${workflow.id}`.slice(0, 36), allComponents(home)),
                        type: 'workflowRunner',
                        props: { workflowId: workflow.id },
                      },
                    },
                  ],
                  zh ? `把「${workflow.name}」放到了首页` : `Put “${workflow.name}” on Home`,
                )
              }
            />
          )}
          {preset ? (
            <Pill
              palette={palette}
              testID="workflow-reset"
              label={zh ? '恢复成原来的样子' : 'Reset to the original'}
              onPress={() =>
                void change(
                  [
                    {
                      op: 'updateWorkflow',
                      workflowId: workflow.id,
                      steps: preset.steps(locale),
                    },
                  ],
                  zh ? `「${workflow.name}」恢复预设` : `Reset “${workflow.name}” to the preset`,
                ).then((ok) => ok && setDraft({ name: draft.name, steps: preset.steps(locale) }))
              }
            />
          ) : null}
          {workflow.toolId ? null : (
            <Pill
              palette={palette}
              danger
              testID="workflow-delete"
              label={zh ? '删除' : 'Delete'}
              onPress={() =>
                confirmDelete(locale, workflow.name, () => {
                  void change(
                    [{ op: 'removeWorkflow', workflowId: workflow.id }],
                    zh
                      ? `删除了快捷操作「${workflow.name}」`
                      : `Deleted the quick action “${workflow.name}”`,
                  ).then((ok) => ok && router.back());
                })
              }
            />
          )}
        </View>
      </ScrollView>

      {inserting !== null ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setInserting(null)}>
          <View style={styles.backdrop}>
            <View
              testID="step-picker"
              style={[styles.sheet, { backgroundColor: palette.background }]}>
              <View style={styles.stepHead}>
                <Text style={[palette.font('title', 17), styles.flex, { color: palette.text }]}>
                  {zh ? '加一步' : 'Add a step'}
                </Text>
                <Pressable
                  testID="step-picker-close"
                  onPress={() => setInserting(null)}
                  hitSlop={8}>
                  <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                    {zh ? '取消' : 'Cancel'}
                  </Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 40 }}>
                {insertableActions(draft.steps, inserting, registry).length === 0 ? (
                  <Text style={caption}>
                    {zh ? '这里没有能接上的步骤。' : 'No step fits here.'}
                  </Text>
                ) : null}
                {insertableActions(draft.steps, inserting, registry).map((a) => (
                  <Card
                    key={a.id}
                    palette={palette}
                    testID={`step-pick-${a.id}`}
                    onPress={() => {
                      insert(inserting, a);
                      setInserting(null);
                    }}>
                    <Text style={[palette.font('title', 15), { color: palette.text }]}>
                      {a.label[locale]}
                    </Text>
                    <Text style={caption}>{a.description[locale]}</Text>
                  </Card>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  round: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insert: { alignSelf: 'center', paddingVertical: 4 },
  backdrop: { flex: 1, backgroundColor: '#2A242080', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '80%',
    padding: 20,
    gap: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
