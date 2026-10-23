import {
  allComponents,
  createMockAIProvider,
  guideGoal,
  pageTarget,
  presetOfTheme,
  presetRequest,
  type PlanAbout,
  type ThemePresetId,
} from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
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
import { guideText, isGoalParam, useGuide } from '../guide/store';
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

/** 风格选择器填进去的原句由内置规则生成计划，不调用设置里的 AI（D-095）；新手引导的句子也是（D-149）。 */
const presetPlanner = createMockAIProvider();

/** 引导的句子打进输入框的速度：每个字的间隔，整句最多约 1.4 秒。 */
const typeDelay = (length: number) => Math.min(45, 1400 / Math.max(length, 1));

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
  const params = useLocalSearchParams<{ workflow?: string; shared?: string; guide?: string }>();
  // 从新手引导打开（D-149）：句子自动打进输入框，用内置规则生成预览。
  const [guide] = useState(() =>
    guideText(params.guide, locale) !== null ? params.guide : undefined,
  );
  const setGuideStage = useGuide((s) => s.setStage);
  const [typing, setTyping] = useState(() => guideText(guide, locale) !== null);
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
  const aboutOnHome =
    about?.kind === 'workflow' &&
    config.pages.some(
      (p) =>
        p.id === 'home' &&
        allComponents(p).some(
          (c) => c.type === 'workflowRunner' && c.props.workflowId === about.workflowId,
        ),
    );
  // 有上下文时的例子（D-124）；内置规则只留它真的认得的句子，所以先试一遍再显示。
  const [examples, setExamples] = useState<readonly string[]>(() =>
    !about
      ? examplesFor(aiMode, locale)
      : aiMode === 'mock'
        ? []
        : aboutCandidates(about, aiMode, locale, { onHome: aboutOnHome }),
  );
  useEffect(() => {
    if (!about || aiMode !== 'mock') return;
    const candidates = aboutCandidates(about, aiMode, locale, { onHome: aboutOnHome });
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

  async function submit(text: string, offline = text.trim() === presetText) {
    if (!text.trim() || busy) return;
    setFeedback(null);
    setPreviewBroken(false);
    setSide('after');
    const result = await propose(text.trim(), offline ? presetPlanner : undefined, about);
    if (result.kind !== 'preview') setFeedback(result);
  }

  // 引导的句子一个字一个字打进输入框，打完自动预览：用户看到「原来可以这么说」。
  useEffect(() => {
    const text = guideText(guide, locale);
    if (!text) return;
    let shown = 0;
    const timer = setInterval(() => {
      shown += 1;
      setInput(text.slice(0, shown));
      if (shown < text.length) return;
      clearInterval(timer);
      setTyping(false);
      setPresetText(text);
      void submit(text, true);
    }, typeDelay(text.length));
    return () => clearInterval(timer);
    // 只在打开时打一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (ok && guide) void setGuideStage(isGoalParam(guide) ? 'done' : 'goal');
    if (!ok || !applied || about) return;
    const before = new Set(applied.before.workflows.map((w) => w.id));
    const added = applied.after.workflows.filter((w) => !before.has(w.id));
    const target = pageTarget(applied.focusPageId);
    if (applied.after.shell.nav.includes(target)) selectTab(target);
    if (added.length === 1) {
      // 引导做的快捷操作带示例文件时，「做好了」页面可以先用示例试一下（D-149）。
      const sample = isGoalParam(guide) ? guideGoal(guide).sample : null;
      router.push({
        pathname: '/ready/[workflowId]',
        params: { workflowId: added[0]!.id, ...(sample ? { sample } : {}) },
      });
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
              editable={!typing}
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
              loading={busy || typing}
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

            {about || guide ? null : (
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

            {examples.length > 0 && !guide ? (
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

            {isGoalParam(guide) ? <GrowingSteps guide={guide} /> : null}
            {proposal.focusWorkflowId ? (
              isGoalParam(guide) ? null : (
                <WorkflowSteps workflowId={proposal.focusWorkflowId} />
              )
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
    about.videos ? t(locale, 'sharedVideos', { n: about.videos }) : null,
    about.audio ? t(locale, 'sharedAudio', { n: about.audio }) : null,
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

/**
 * 引导做的快捷操作（D-149）：步骤一条一条长出来，AI 按用途补上的步骤标出来。
 * 一句话变成好几步，是这一步的惊喜。
 */
function GrowingSteps({ guide }: { guide: Parameters<typeof guideGoal>[0] }) {
  const { locale, registry } = useWorkspaceContext();
  const proposal = useWorkspace((s) => s.proposal)!;
  const palette = usePalette(proposal.after.theme);
  const before = new Set(proposal.before.workflows.map((w) => w.id));
  const workflow = proposal.after.workflows.find((w) => !before.has(w.id));
  const added = new Set(guideGoal(guide).added);
  const steps = workflow?.steps ?? [];
  const [shown] = useState(() => steps.map(() => new Animated.Value(0)));
  useEffect(() => {
    Animated.stagger(
      280,
      shown.map((v) => Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true })),
    ).start();
  }, [shown]);
  if (!workflow) return null;
  return (
    <Card palette={palette} testID="guide-steps">
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{workflow.name}</Text>
      {steps.map((step, i) => (
        <Animated.View
          key={step.id}
          testID={`guide-step-${step.id}`}
          style={[
            styles.step,
            {
              opacity: shown[i],
              transform: [
                { translateY: shown[i]!.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
              ],
            },
          ]}>
          <View style={[styles.stepNo, { backgroundColor: palette.primaryTint }]}>
            <Text style={[palette.font('bodyBold', 12), { color: palette.primaryText }]}>
              {i + 1}
            </Text>
          </View>
          <Text style={[palette.font('body', 15), styles.flex, { color: palette.text }]}>
            {registry.actions.get(step.action)?.label[locale] ?? step.action}
          </Text>
          {added.has(step.id) ? (
            <View style={[styles.tag, { backgroundColor: palette.secondary }]}>
              <Text style={[palette.font('bodyBold', 11), { color: '#FFFFFF' }]}>
                {t(locale, 'guideAdded')}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
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
