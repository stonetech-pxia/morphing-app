import {
  createMockAIProvider,
  pageTarget,
  presetOfTheme,
  presetRequest,
  type PlanAbout,
  type ThemePresetId,
} from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAISettings } from '../ai/context';
import { t } from '../i18n';
import { usePalette } from '../renderer/theme';
import { Button, Card, SectionLabel } from '../renderer/ui';
import { sharedAbout } from '../share/about';
import { useIncoming } from '../share/incoming';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { ProposeResult } from '../workspace/store';
import { aboutCandidates, examplesFor } from './examples';
import { Preview } from './Preview';
import { StylePicker } from './StylePicker';

/** 风格选择器填进去的原句由内置规则生成计划，不调用设置里的 AI（D-095）。 */
const presetPlanner = createMockAIProvider();

/**
 * AI 修改入口（§4）：复述目标 → 列出将要做的修改 → 修改前后预览 → 应用 / 取消。
 * 只有提交并重新渲染成功后，外壳才显示“已应用”。
 */
export function ChangeScreen() {
  const { locale, registry } = useWorkspaceContext();
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const proposal = useWorkspace((s) => s.proposal);
  const busy = useWorkspace((s) => s.busy);
  const propose = useWorkspace((s) => s.propose);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const setHomeEntry = useWorkspace((s) => s.setHomeEntry);
  const selectTab = useWorkspace((s) => s.selectTab);
  const palette = usePalette(config.theme);
  const aiMode = useAISettings((s) => s.mode);
  // 从一个快捷操作（「让 AI 改这个」）或收件页面打开时带上的上下文（D-124）。
  const params = useLocalSearchParams<{ workflow?: string; shared?: string }>();
  const share = useIncoming((s) => s.share);
  const [about] = useState<PlanAbout | undefined>(() => {
    if (params.workflow && config.workflows.some((w) => w.id === params.workflow))
      return { kind: 'workflow', workflowId: params.workflow };
    if (params.shared && share && String(share.id) === params.shared) return sharedAbout(share);
    return undefined;
  });
  const aboutName =
    about?.kind === 'workflow'
      ? config.workflows.find((w) => w.id === about.workflowId)?.name
      : undefined;
  // 有上下文时的例子（D-124）；内置规则只留它真的认得的句子，所以先试一遍再显示。
  const [examples, setExamples] = useState<readonly string[]>(() =>
    !about
      ? examplesFor(aiMode, locale)
      : aiMode === 'mock'
        ? []
        : aboutCandidates(about, aiMode, locale),
  );
  useEffect(() => {
    if (!about || aiMode !== 'mock') return;
    const candidates = aboutCandidates(about, aiMode, locale);
    let live = true;
    void Promise.all(
      candidates.map((c) => presetPlanner.plan(c, { config, registry, locale, about })),
    ).then((plans) => {
      if (live) setExamples(candidates.filter((_, i) => plans[i]!.kind === 'ops'));
    });
    return () => {
      live = false;
    };
    // 只在打开时算一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState('');
  /** 风格选择器最近填进去的句子；用户改过输入框后就不再相等，交给设置里的 AI。 */
  const [presetText, setPresetText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Exclude<ProposeResult, { kind: 'preview' }> | null>(
    null,
  );
  const [side, setSide] = useState<'before' | 'after'>('after');
  const [previewBroken, setPreviewBroken] = useState(false);

  // 关闭页面（例如下滑）时，未确认的修改视为取消。延迟判断，避免开发模式下的重复挂载误取消。
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) void cancel();
      }, 0);
    };
  }, [cancel]);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setFeedback(null);
    setPreviewBroken(false);
    setSide('after');
    const planner = text.trim() === presetText ? presetPlanner : undefined;
    const result = await propose(text.trim(), planner, about);
    if (result.kind !== 'preview') setFeedback(result);
  }

  /** 点选风格预设：把切换风格的句子填进输入框，用户点「预览」后照常走预览（D-095）。 */
  function pickStyle(preset: ThemePresetId) {
    const text = presetRequest(preset, locale);
    setFeedback(null);
    setInput(text);
    setPresetText(text);
  }

  /**
   * 应用后带用户去看改了什么（D-109）。新做了一个快捷操作时打开「做好了」页面，由用户自己点
   * 「现在就用一次」（D-125）；从快捷操作或收件页面打开的回到原来的页面（收件页面会列出新的快捷操作）。
   */
  async function apply() {
    const applied = proposal;
    const ok = await confirm();
    router.back();
    if (!ok || !applied || about) return;
    const before = new Set(applied.before.workflows.map((w) => w.id));
    const added = applied.after.workflows.filter((w) => !before.has(w.id));
    const target = pageTarget(applied.focusPageId);
    if (applied.after.shell.nav.includes(target)) selectTab(target);
    if (added.length === 1) {
      router.push({ pathname: '/ready/[workflowId]', params: { workflowId: added[0]!.id } });
      return;
    }
    if (applied.focusWorkflowId) router.push('/workflows');
  }

  async function discard() {
    await cancel();
    router.back();
  }

  const text = [palette.font('body', 15), { color: palette.text }];
  const sub = [palette.font('body', 15), { color: palette.muted }];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.page, { padding: palette.pad, gap: palette.gap - 2 }]}
        keyboardShouldPersistTaps="handled">
        {!proposal ? (
          <>
            {about ? (
              <Card palette={palette} background={palette.primaryTint} testID="change-about">
                <Text style={[palette.font('title', 15), { color: palette.text }]}>
                  {about.kind === 'workflow'
                    ? t(locale, 'aboutWorkflow', { name: aboutName ?? '' })
                    : t(locale, 'aboutShared', { what: sharedWhat(about, locale) })}
                </Text>
                <Text style={sub}>
                  {t(locale, about.kind === 'workflow' ? 'aboutWorkflowHint' : 'aboutSharedHint')}
                </Text>
              </Card>
            ) : (
              <Text style={sub}>{t(locale, 'changeHint')}</Text>
            )}
            <TextInput
              testID="change-input"
              value={input}
              onChangeText={setInput}
              placeholder={
                !about
                  ? t(locale, 'changePlaceholder')
                  : examples[0]
                    ? t(locale, 'aboutPlaceholder', { example: examples[0] })
                    : ''
              }
              placeholderTextColor={palette.caption}
              multiline
              style={[
                styles.input,
                palette.font('body', 16),
                {
                  color: palette.text,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  borderRadius: palette.controlRadius,
                },
              ]}
            />
            <Button
              palette={palette}
              testID="change-submit"
              onPress={() => submit(input)}
              loading={busy}
              label={t(locale, 'preview')}
            />

            {feedback ? (
              <Card palette={palette} testID="change-feedback">
                {feedback.kind === 'invalid' ? (
                  <>
                    <Text style={[palette.font('bodyBold', 15), { color: palette.danger }]}>
                      {t(locale, 'invalidPlan')}
                    </Text>
                    {feedback.issues.map((issue) => (
                      <Text key={issue} style={sub}>
                        • {issue}
                      </Text>
                    ))}
                  </>
                ) : (
                  <>
                    <Text style={text}>{feedback.message}</Text>
                    {/* 拒绝时给的例子（例如办事类请求能做成的快捷操作，D-128）：点一下填进输入框。 */}
                    {feedback.examples.length > 0 ? (
                      <View style={styles.chips} testID="change-feedback-examples">
                        {feedback.examples.map((example) => (
                          <Chip
                            key={example}
                            label={example}
                            palette={palette}
                            onPress={() => setInput(example)}
                          />
                        ))}
                      </View>
                    ) : null}
                  </>
                )}
              </Card>
            ) : null}

            {about ? null : (
              <>
                <SectionLabel palette={palette}>{t(locale, 'pickStyle')}</SectionLabel>
                <StylePicker
                  locale={locale}
                  current={presetOfTheme(config.theme)}
                  palette={palette}
                  onPick={pickStyle}
                />
              </>
            )}

            {examples.length > 0 ? (
              <>
                <SectionLabel palette={palette}>{t(locale, 'examples')}</SectionLabel>
                <View style={styles.chips} testID="change-examples">
                  {examples.map((example) => (
                    <Chip
                      key={example}
                      label={example}
                      palette={palette}
                      onPress={() => setInput(example)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Text
              testID="proposal-summary"
              style={[palette.font('heading', 22), { color: palette.text, letterSpacing: -0.4 }]}>
              {proposal.summary}
            </Text>
            {proposal.notes?.length ? (
              <Card palette={palette} background={palette.primaryTint} testID="plan-notes">
                <Text style={[palette.font('title', 15), { color: palette.text }]}>
                  {t(locale, 'notesTitle')}
                </Text>
                {proposal.notes.map((note, i) => (
                  <Text key={i} testID={`plan-note-${i}`} style={text}>
                    • {note}
                  </Text>
                ))}
              </Card>
            ) : null}
            <Card palette={palette}>
              <Text style={[palette.font('title', 15), { color: palette.text }]}>
                {t(locale, 'planTitle')}
              </Text>
              {proposal.lines.map((line, i) => (
                <Text key={i} testID={`plan-line-${i}`} style={text}>
                  • {line}
                </Text>
              ))}
              {proposal.homeEntry ? (
                <Pressable
                  testID="change-home-entry"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: proposal.homeEntry.on }}
                  onPress={() => setHomeEntry(!proposal.homeEntry!.on)}
                  hitSlop={6}
                  style={styles.check}>
                  <View
                    style={[
                      styles.box,
                      { borderColor: palette.primary },
                      proposal.homeEntry.on && { backgroundColor: palette.primary },
                    ]}>
                    {proposal.homeEntry.on ? (
                      <Text style={[palette.font('bodyBold', 14), { color: palette.onPrimary }]}>
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.flex, text]}>{t(locale, 'homeEntry')}</Text>
                </Pressable>
              ) : null}
            </Card>

            {proposal.focusWorkflowId ? (
              <WorkflowSteps workflowId={proposal.focusWorkflowId} />
            ) : (
              <>
                {/* 两段式切换（Docudis 的 ClaySegmented）。 */}
                <View style={[styles.segment, { backgroundColor: palette.border }]}>
                  {(['before', 'after'] as const).map((s) => (
                    <Pressable
                      key={s}
                      testID={`preview-${s}`}
                      onPress={() => setSide(s)}
                      style={[
                        styles.segmentItem,
                        side === s && { backgroundColor: palette.surface },
                      ]}>
                      <Text
                        style={[
                          palette.font('title', 14),
                          { color: side === s ? palette.text : palette.caption },
                        ]}>
                        {t(locale, s)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Preview
                  key={`${proposal.changeRequestId}-${side}`}
                  config={side === 'before' ? proposal.before : proposal.after}
                  pageId={proposal.focusPageId}
                  onError={() => side === 'after' && setPreviewBroken(true)}
                />
              </>
            )}

            <View style={styles.actions}>
              <Button
                palette={palette}
                testID="change-cancel"
                variant="outline"
                onPress={discard}
                label={t(locale, 'cancel')}
              />
              <Button
                palette={palette}
                testID="change-apply"
                onPress={apply}
                disabled={busy || previewBroken}
                label={t(locale, 'apply')}
                style={styles.flex}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Chip({
  label,
  palette,
  onPress,
}: {
  label: string;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: palette.border,
          backgroundColor: palette.surface,
          opacity: pressed ? 0.6 : 1,
        },
      ]}>
      <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/** 「2 张照片和 1 个 PDF」：分享进来的文件的类型和个数。 */
function sharedWhat(about: Extract<PlanAbout, { kind: 'shared' }>, locale: 'en' | 'zh'): string {
  const parts = [
    about.images ? t(locale, 'sharedPhotos', { n: about.images }) : null,
    about.pdfs ? t(locale, 'sharedPdfs', { n: about.pdfs }) : null,
    about.others ? t(locale, 'sharedOthers', { n: about.others }) : null,
  ].filter(Boolean);
  return parts.join(locale === 'zh' ? '和' : ' and ');
}

/** 新工作流不在任何页面上时，预览显示它的步骤，并说明在哪里找到它（D-109）。 */
function WorkflowSteps({ workflowId }: { workflowId: string }) {
  const { locale, registry } = useWorkspaceContext();
  const proposal = useWorkspace((s) => s.proposal)!;
  const palette = usePalette(proposal.after.theme);
  const workflow = proposal.after.workflows.find((w) => w.id === workflowId);
  if (!workflow) return null;
  return (
    <Card palette={palette} testID="preview-workflow">
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{workflow.name}</Text>
      {workflow.steps.map((step, i) => (
        <Text key={step.id} style={[palette.font('body', 15), { color: palette.text }]}>
          {`${i + 1}. ${registry.actions.get(step.action)?.label[locale] ?? step.action}`}
        </Text>
      ))}
      <Text style={[palette.font('body', 13), { color: palette.caption }]}>
        {t(locale, 'workflowWhere')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: { paddingBottom: 48 },
  input: { minHeight: 110, borderWidth: 1, padding: 14, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 34,
    justifyContent: 'center',
  },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    borderRadius: 11,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
