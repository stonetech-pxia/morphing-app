import {
  localize,
  t,
  HOME_PAGE_ID,
  allComponents,
  homeScreenFull,
  initialParams,
  insertableActions,
  newWorkflowId,
  presetById,
  WORKFLOW_PRESETS,
  stepIdFor,
  topIndex,
  workflowProblems,
  type ActionDefinition,
  type Locale,
  type Op,
  type Registry,
  type Workflow,
  type WorkflowStep,
} from '@morph/core';

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HomeScreenCard } from '../home-screen/HomeScreenCard';
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
  const label = (a: ActionDefinition | undefined, id: string) => localize(a?.label, locale) ?? id;
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID)!;
  const onHome = allComponents(home).some(
    (c) => c.type === 'workflowRunner' && c.props.workflowId === workflow.id,
  );
  const preset = workflow.presetId ? presetById(workflow.presetId) : undefined;
  // 内设的快捷操作不在配置里（D-236）：保存、放到首页时才存进去，用预设 ID。
  const stored = config.workflows.some((w) => w.id === workflow.id);
  const addIfBuiltIn = (): Op[] => (stored ? [] : [{ op: 'addWorkflow', workflow }]);
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
      stored
        ? [{ op: 'updateWorkflow', workflowId: workflow.id, name, steps: draft.steps }]
        : [{ op: 'addWorkflow', workflow: { ...workflow, name, steps: draft.steps } }],
      t(locale, 'WorkflowEditor_Adjusted_the_quick_action_3c10b', { v0: name }),
    );
    if (ok) setDraft({ name, steps: draft.steps });
  }

  async function duplicate() {
    const id = newWorkflowId(workflow.presetId ?? 'my-workflow', [
      ...config.workflows,
      ...WORKFLOW_PRESETS,
    ]);
    const name = `${workflow.name}${t(locale, 'WorkflowEditor_copy_04014')}`.slice(0, 40);
    const copy: Workflow = { id, name, steps: workflow.steps };
    if (workflow.icon) copy.icon = workflow.icon;
    if (workflow.presetId) copy.presetId = workflow.presetId;
    const ok = await change(
      [{ op: 'addWorkflow', workflow: copy }],
      t(locale, 'WorkflowEditor_Copied_the_quick_action_a4506', { v0: workflow.name }),
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
        {t(locale, 'WorkflowEditor_Add_a_step_here_ffc74')}
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
          {t(locale, 'WorkflowEditor_Name_4406f')}
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
            {t(locale, 'workflowFromTool', {
              name: localize(registry.tools.get(workflow.toolId)?.name, locale) ?? workflow.toolId,
            })}
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
                {action ? (
                  <Text style={caption}>{localize(action.description, locale)}</Text>
                ) : null}
                {action?.local ? (
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                    {t(locale, 'WorkflowEditor_You_do_this_step_by_hand_when_it_runs_97fbe')}
                  </Text>
                ) : null}
                {action?.fields.some((f) => f.kind === 'secret') ? (
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                    {t(locale, 'WorkflowEditor_The_password_is_asked_on_every_run_and_8f613')}
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
                      {t(locale, 'WorkflowEditor_Ask_on_every_run_16477')}
                    </Text>
                    <View style={styles.wrap}>
                      {fields.map((f) => (
                        <Chip
                          key={f.key}
                          palette={palette}
                          testID={`step-${i}-ask-${f.key}`}
                          label={localize(f.label, locale)}
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
                      ? t(locale, i === 0 ? 'workflowInputRequired' : 'workflowTypeMismatch')
                      : t(locale, 'WorkflowEditor_Check_the_settings_of_this_step_c9b47')}
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
            label={t(locale, 'WorkflowEditor_Save_82522')}
            disabled={!canSave}
            onPress={() => void save()}
            style={styles.flex}
          />
          {dirty ? (
            <Button
              palette={palette}
              testID="workflow-discard"
              variant="outline"
              label={t(locale, 'WorkflowEditor_Discard_1a93f')}
              onPress={() => setDraft(saved)}
              style={styles.flex}
            />
          ) : (
            <Button
              palette={palette}
              testID="workflow-run"
              variant="outline"
              label={t(locale, 'WorkflowEditor_Run_5cab2')}
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
            label={t(locale, 'WorkflowEditor_Duplicate_6da85')}
            onPress={() => void duplicate()}
          />
          {onHome ? null : (
            <Pill
              palette={palette}
              testID="workflow-to-home"
              label={t(locale, 'WorkflowEditor_Put_on_Home_d5bc4')}
              onPress={() =>
                void change(
                  [
                    ...addIfBuiltIn(),
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
                  t(locale, 'WorkflowEditor_Put_on_Home_69b25', { v0: workflow.name }),
                )
              }
            />
          )}
          {/* 手机桌面（D-271）：长按 Morph 图标的菜单最多 4 个，满了先拿掉一个。 */}
          <Pill
            palette={palette}
            testID="workflow-home-screen"
            label={t(locale, workflow.homeScreen ? 'homeScreenRemove' : 'homeScreenAdd')}
            onPress={() => {
              if (!workflow.homeScreen && homeScreenFull(config)) {
                Alert.alert(t(locale, 'homeScreenFull'));
                return;
              }
              void change(
                [
                  ...addIfBuiltIn(),
                  {
                    op: 'setWorkflowHomeScreen',
                    workflowId: workflow.id,
                    homeScreen: !workflow.homeScreen,
                  },
                ],
                t(locale, workflow.homeScreen ? 'homeScreenRemoved' : 'homeScreenAdded', {
                  name: workflow.name,
                }),
              );
            }}
          />
          {preset && stored ? (
            <Pill
              palette={palette}
              testID="workflow-reset"
              label={t(locale, 'WorkflowEditor_Reset_to_the_original_6cfe2')}
              onPress={() =>
                void change(
                  [
                    {
                      op: 'updateWorkflow',
                      workflowId: workflow.id,
                      steps: preset.steps(locale),
                    },
                  ],
                  t(locale, 'WorkflowEditor_Reset_to_the_preset_567aa', { v0: workflow.name }),
                ).then((ok) => ok && setDraft({ name: draft.name, steps: preset.steps(locale) }))
              }
            />
          ) : null}
          {workflow.toolId || !stored ? null : (
            <Pill
              palette={palette}
              danger
              testID="workflow-delete"
              label={t(locale, 'WorkflowEditor_Delete_8940a')}
              onPress={() =>
                confirmDelete(locale, workflow.name, () => {
                  void change(
                    [{ op: 'removeWorkflow', workflowId: workflow.id }],
                    t(locale, 'WorkflowEditor_Deleted_the_quick_action_a2984', {
                      v0: workflow.name,
                    }),
                  ).then((ok) => ok && router.back());
                })
              }
            />
          )}
        </View>
        <HomeScreenCard workflow={workflow} palette={palette} />
      </ScrollView>

      {inserting !== null ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setInserting(null)}>
          <View style={styles.backdrop}>
            <View
              testID="step-picker"
              style={[styles.sheet, { backgroundColor: palette.background }]}>
              <View style={styles.stepHead}>
                <Text style={[palette.font('title', 17), styles.flex, { color: palette.text }]}>
                  {t(locale, 'WorkflowEditor_Add_a_step_40731')}
                </Text>
                <Pressable
                  testID="step-picker-close"
                  onPress={() => setInserting(null)}
                  hitSlop={8}>
                  <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                    {t(locale, 'WorkflowEditor_Cancel_bd576')}
                  </Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 40 }}>
                {insertableActions(draft.steps, inserting, registry).length === 0 ? (
                  <Text style={caption}>{t(locale, 'WorkflowEditor_No_step_fits_here_303a6')}</Text>
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
                      {localize(a.label, locale)}
                    </Text>
                    <Text style={caption}>{localize(a.description, locale)}</Text>
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
