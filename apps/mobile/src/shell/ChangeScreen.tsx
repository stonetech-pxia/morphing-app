import {
  allComponents,
  createMockAIProvider,
  isKnownComponent,
  openItems,
  pageTarget,
  type PlanAbout,
  type PlanProgress,
  presetOfTheme,
  presetRequest,
  quickActionsOf,
  sessionProblems,
  type ThemePresetId,
} from '@morph/core';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAISettings } from '../ai/context';
import { useAfterApply } from '../draft/useApplyDraft';
import { LivelyTink } from '../guide/LivelyTink';
import { guideText, useGuide } from '../guide/store';
import { t, type StringKey } from '../i18n';
import { Icon, UiIcon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { sharedAbout } from '../share/about';
import { useIncoming } from '../share/incoming';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { ChangeResult, DraftResult } from '../workspace/store';
import { aboutFromParams, aboutPlace } from './ai-entry';
import { BuildPanel } from './BuildPanel';
import { aboutCandidates } from './examples';
import { closeButtonOption, stackScreenOptions } from './header';
import { NeedButton } from './NeedButton';
import { StylePicker } from './StylePicker';

/** 风格选择器填进去的原句由内置规则生成计划，不调用设置里的 AI（D-095）；新手引导的句子也是（D-149）。 */
const presetPlanner = createMockAIProvider();

/** 引导的句子打进输入框的速度：每个字的间隔，整句最多约 1.4 秒。 */
const typeDelay = (length: number) => Math.min(45, 1400 / Math.max(length, 1));

/** 规划的每个阶段在 Tink 旁边说的话（D-448）：每个阶段两句，打开 AI 页时随机选一组；还没报阶段时是 start。 */
const PROGRESS_TEXT: Record<PlanProgress | 'start', readonly [StringKey, StringKey]> = {
  start: ['tinkThinking', 'tinkThinking2'],
  full: ['tinkProgressFull', 'tinkProgressFull2'],
  files: ['tinkProgressFiles', 'tinkProgressFiles2'],
  records: ['tinkProgressRecords', 'tinkProgressRecords2'],
  look: ['tinkProgressLook', 'tinkProgressLook2'],
  style: ['tinkProgressStyle', 'tinkProgressStyle2'],
  checking: ['tinkProgressChecking', 'tinkProgressChecking2'],
  fixing: ['tinkProgressFixing', 'tinkProgressFixing2'],
};

/** 输入框下面最多几个例子（不算「换个风格」）。 */

/**
 * AI 修改入口（§4、D-190、D-191）：一个带发送箭头的输入框和几个例子。
 * 改外观：AI 处理完，页面关掉，直接进入草稿模式：App 换成改完后的样子，能看不能用，
 * 底部「修改 / 退一步 / 应用 / 离开」；已经有草稿时，新的一句接着改这份草稿，也可以继续或删除它。
 * 改功能（快捷操作、工具、数据表）：直接应用（可以撤销），打开「做好了」页面马上试用；
 * 这句话里剩下的外观变成一条「接着改」，在「做好了」页面上，也是这里的第一个例子。
 */

export function ChangeScreen() {
  const { locale, registry, store } = useWorkspaceContext();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const config = useWorkspace((s) => s.config)!;
  const draft = useWorkspace((s) => s.draft);
  const busy = useWorkspace((s) => s.busy);
  const planProgress = useWorkspace((s) => s.planProgress);
  const [progressVariant] = useState(() => (Math.random() < 0.5 ? 0 : 1));
  const change = useWorkspace((s) => s.change);
  const next = useWorkspace((s) => s.next);
  const suggest = useWorkspace((s) => s.suggest);
  const session = useWorkspace((s) => s.session);
  const clearSession = useWorkspace((s) => s.clearSession);
  const build = useWorkspace((s) => s.build);
  const endBuild = useWorkspace((s) => s.endBuild);
  const continueWithDraft = useWorkspace((s) => s.continueWithDraft);
  const fixProblems = useWorkspace((s) => s.fixProblems);
  const afterApply = useAfterApply();
  const openDraft = useWorkspace((s) => s.openDraft);
  const deleteDraft = useWorkspace((s) => s.deleteDraft);
  const selectTab = useWorkspace((s) => s.selectTab);
  const palette = usePalette(config.theme);
  const aiMode = useAISettings((s) => s.mode);
  // 从一个快捷操作（「让 AI 改这个」）或收件页面打开时带上的上下文（D-124）。
  const params = useLocalSearchParams<{
    workflow?: string;
    first?: string;
    second?: string;
    shared?: string;
    guide?: string;
    next?: string;
    text?: string;
    /** 从页面右上角的入口打开（D-406，aboutParams）。 */
    page?: string;
    table?: string;
    screen?: string;
    desk?: string;
  }>();
  // 从新手引导第 1 步打开（D-149、D-231）：句子打进输入框后停下，用户自己点发送；
  // 发送后直接生效，不进草稿。
  const [guide] = useState(() =>
    guideText(params.guide, locale) !== null ? params.guide : undefined,
  );
  // 点了「接着改」（D-191）：那句话自动打进输入框，用设置里的 AI 处理。
  // 引导的句子三种语言都用内置规则（D-449，改 D-228）。
  const [auto] = useState(() => guideText(guide, locale) ?? (params.next ? next : null));
  const propose = useWorkspace((s) => s.propose);
  const confirm = useWorkspace((s) => s.confirm);
  const setGuideStage = useGuide((s) => s.setStage);
  const [typing, setTyping] = useState(() => auto !== null);
  const share = useIncoming((s) => s.share);
  // 打开这一页时是哪一批（分享的、App 里选的、上一次的结果）：之后又分享进来一批，卡片上的说法也不变。
  const [source] = useState(() => share?.source);
  const [about] = useState<PlanAbout | undefined>(() => {
    if (
      params.first &&
      params.second &&
      [params.first, params.second].every((id) => quickActionsOf(config).some((w) => w.id === id))
    )
      return { kind: 'chain', first: params.first, second: params.second };
    if (params.workflow && quickActionsOf(config).some((w) => w.id === params.workflow))
      return { kind: 'workflow', workflowId: params.workflow };
    if (params.shared && share && String(share.id) === params.shared) return sharedAbout(share);
    return aboutFromParams(params, config);
  });
  const place = aboutPlace(about, config, locale);
  const aboutName =
    about?.kind === 'workflow'
      ? quickActionsOf(config).find((w) => w.id === about.workflowId)?.name
      : undefined;
  const aboutOnHome =
    about?.kind === 'workflow' &&
    config.containers.pages.some(
      (p) =>
        p.id === 'home' &&
        allComponents(p).some(
          (c) =>
            isKnownComponent(c) &&
            c.look === 'action' &&
            c.tools.some((u) => 'tool' in u && u.tool === about.workflowId),
        ),
    );
  // 有上下文时输入框里提示的例子（D-124）；内置规则只留它真的认得的句子，所以先试一遍。
  // 页面上不再列出预设的句子（D-233），只留「换个风格」。
  const [examples, setExamples] = useState<readonly string[]>(() =>
    !about || aiMode === 'mock'
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

  // 别处带来的一句话（样板、快捷操作的类别、合并卡片）先填进输入框。
  const [input, setInput] = useState(() => (auto ? '' : (params.text ?? '')));
  // 计划关掉后输入框重新出现时，键盘不要自己弹出来挡住页面。
  const [focusInput, setFocusInput] = useState(() => Boolean(params.text) && !auto);
  const [prefillSelection, setPrefillSelection] = useState(() =>
    !auto && params.text ? { start: params.text.length, end: params.text.length } : undefined,
  );
  /** 风格选择器最近填进去的句子；用户改过输入框后就不再相等，交给设置里的 AI。 */
  const [presetText, setPresetText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    | Extract<DraftResult, { kind: 'rejected' | 'invalid' }>
    | Extract<ChangeResult, { kind: 'needsDraft' }>
    | null
  >(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  /** 被拒绝的那句话（需求回收，D-189）。 */
  const [asked, setAsked] = useState('');

  /**
   * 关掉这个页面，回到草稿：从外壳或页面打开的回到原处（页面也显示草稿）；从运行页面、收件页面、
   * 「做好了」页面打开的（有上下文）一起关掉，因为草稿模式不在它们里面。
   * 从页面右上角的入口打开的回到原处（D-406）；原处显示不了草稿的（记录表单、快捷操作列表）进了草稿才一起关掉。
   */
  function leave(drafted = false) {
    const backToPlace =
      about?.kind === 'page' ||
      about?.kind === 'desk' ||
      ((about?.kind === 'table' || about?.kind === 'screen') && !drafted);
    if (!router.canGoBack()) router.replace('/');
    else if (about && !backToPlace && router.canDismiss()) router.dismissAll();
    else router.back();
  }

  async function submit(text: string, offline = text.trim() === presetText) {
    if (!text.trim() || busy) return;
    setFeedback(null);
    // 「撤销」会立即回到上一个版本、可能换主题：先把这个页面的导航栏固定住。Android 上带「关闭」
    // 按钮的导航栏在这时更新会崩（react-native-screens：child already has a parent）。
    navigation.setOptions({ ...stackScreenOptions(palette), ...closeButtonOption(palette) });
    if (guide) {
      // 顶部不出「已改好 · 撤销」（D-239）；回到首页显示第 2 步。
      const proposed = await propose(text.trim(), offline ? presetPlanner : undefined);
      // 重新看引导时首页已经有这两个按钮：第 1 步算做完了。
      const already = proposed.kind === 'rejected' && proposed.reason === 'noChange';
      if (!already && (proposed.kind === 'rejected' || proposed.kind === 'invalid')) {
        setFeedback(proposed);
        setAsked(text.trim());
        return;
      }
      if (!already && (proposed.kind !== 'preview' || !(await confirm({ quiet: true })))) return;
      void setGuideStage('goal');
      leave();
      return;
    }
    const result = await change(text.trim(), offline ? presetPlanner : undefined, {
      ...(about ? { about } : {}),
    });
    setAsked(text.trim());
    afterResult(result);
  }

  /** 一句话的结果：说明留在这一页，计划留在这一页；生效了或进草稿才离开。 */
  function afterResult(result: ChangeResult) {
    if (result.kind === 'build') {
      setInput('');
      setFocusInput(false);
      Keyboard.dismiss();
      return;
    }
    if (result.kind === 'rejected' || result.kind === 'invalid' || result.kind === 'needsDraft') {
      setFeedback(result);
      return;
    }
    // 进入草稿或回到 App 时显示改到的那一页（在导航栏里时）。
    // 从页面右上角的入口来的功能修改留在原处（D-406）：草稿才要跳到改到的那一页去看。
    if (result.kind === 'drafted' || (result.kind === 'applied' && !place)) {
      const target = pageTarget(result.focusPageId);
      const shown = result.kind === 'drafted' ? result.step.config : store.getState().config!;
      if (shown.nav.bar.includes(target)) selectTab(target);
    }
    leave(result.kind === 'drafted');
    // 功能类直接应用了（D-191）：去「做好了」页面（或回到收件页面）试用。
    if (result.kind === 'applied') afterApply(result.applied);
  }

  // 引导和「接着改」的句子一个字一个字打进输入框：用户看到「原来可以这么说」。引导的句子停下等用户发送，
  // 「接着改」打完自动处理。
  useEffect(() => {
    const text = auto;
    if (!text) return;
    let shown = 0;
    const timer = setInterval(() => {
      shown += 1;
      setInput(text.slice(0, shown));
      if (shown < text.length) return;
      clearInterval(timer);
      setTyping(false);
      // 引导的句子用内置规则（见 guide/store.ts）。
      if (guide) {
        setPresetText(text);
        return;
      }
      void submit(text, false);
    }, typeDelay(text.length));
    return () => clearInterval(timer);
    // 只在打开时打一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点选风格：直接用内置规则换成那个风格，进入草稿看效果（D-095）。 */
  function pickStyle(preset: ThemePresetId) {
    const text = presetRequest(preset, locale);
    setStylesOpen(false);
    setInput(text);
    setPresetText(text);
    void submit(text, true);
  }

  function askDelete() {
    if (!draft) return;
    Alert.alert(
      t(locale, 'draftDeleteTitle'),
      t(locale, 'draftDeleteBody', { n: draft.steps.length }),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        { text: t(locale, 'draftDelete'), style: 'destructive', onPress: () => void deleteDraft() },
      ],
    );
  }

  /** 用户点的（D-413）：先确认草稿，再做等着的那一步。 */
  async function applyDraftAndContinue(
    waiting: Extract<ChangeResult, { kind: 'needsDraft' }>['waiting'],
  ) {
    setFeedback(null);
    navigation.setOptions({ ...stackScreenOptions(palette), ...closeButtonOption(palette) });
    afterResult(await continueWithDraft(waiting));
  }

  function askClearSession() {
    Alert.alert(t(locale, 'sessionClearTitle'), t(locale, 'sessionClearBody'), [
      { text: t(locale, 'sessionKeep'), style: 'cancel' },
      { text: t(locale, 'sessionClear'), onPress: () => void clearSession() },
    ]);
  }

  /**
   * 「把这些补上」（D-418）：和说一句话一样，结果走同样的路。搭建结果的面板上补好了就留在面板上，
   * 看得到问题少了；外观在面板的「看看外观」里。
   */
  async function fix() {
    setFeedback(null);
    navigation.setOptions({ ...stackScreenOptions(palette), ...closeButtonOption(palette) });
    const result = await fixProblems();
    if (!result) return;
    setAsked(t(locale, 'fixProblems'));
    if (build && (result.kind === 'applied' || result.kind === 'drafted')) return;
    afterResult(result);
  }

  /** 做完了，去看草稿（D-415）：外观走现有的草稿确认。 */
  function seeBuiltLook() {
    openDraft();
    void endBuild();
    leave(true);
  }

  const sub = [palette.font('body', 15), { color: palette.muted }];
  // 计划开着时这一页只有它；停下了可以接着说别的。
  const planBusy = build !== null && build.phase !== 'paused';
  // 还差什么（D-414）：计划里的步骤已经在计划上了，「接着改」已经是下面的第一个例子。
  const stillOpen = openItems(session).filter(
    (item) => item.text !== next && !(build && item.id.startsWith('b-')),
  );
  const doneCount = session.items.filter((item) => item.status === 'done').length;
  // 这个会话新增、用户确认草稿后会看到的问题（D-418）。计划开着时在计划面板上算；「接着改」等着做页面时不算。
  const shownConfig = draft?.steps.at(-1)?.config ?? config;
  const problems = useMemo(
    () => (build ? [] : sessionProblems(session, shownConfig, registry, { later: Boolean(next) })),
    [build, session, shownConfig, registry, next],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.page, { padding: palette.pad, gap: palette.gap - 2 }]}
        keyboardShouldPersistTaps="handled">
        {build && !guide ? (
          <BuildPanel
            build={build}
            palette={palette}
            onSeeLook={seeBuiltLook}
            onFix={() => void fix()}
          />
        ) : null}

        {planBusy ? null : place ? (
          <Card palette={palette} background={palette.primaryTint} testID="change-about">
            <Text style={[palette.font('title', 15), { color: palette.text }]}>{place.title}</Text>
            <Text style={sub}>{place.hint}</Text>
          </Card>
        ) : about ? (
          <Card palette={palette} background={palette.primaryTint} testID="change-about">
            <Text style={[palette.font('title', 15), { color: palette.text }]}>
              {about.kind === 'chain'
                ? t(locale, 'chainAbout', {
                    first: quickActionsOf(config).find((w) => w.id === about.first)?.name ?? '',
                    second: quickActionsOf(config).find((w) => w.id === about.second)?.name ?? '',
                  })
                : about.kind === 'workflow'
                  ? t(locale, 'aboutWorkflow', { name: aboutName ?? '' })
                  : t(
                      locale,
                      source === 'result'
                        ? 'resultIncoming'
                        : source === 'picker'
                          ? 'sharePicked'
                          : 'aboutShared',
                      {
                        what: about.kind === 'shared' ? sharedWhat(about, locale) : '',
                      },
                    )}
            </Text>
            {about.kind === 'workflow' ? (
              <Text style={sub}>{t(locale, 'aboutWorkflowHint')}</Text>
            ) : null}
          </Card>
        ) : null}

        {draft && !guide && !build ? (
          <Card palette={palette} background={palette.primaryTint} testID="change-draft">
            <Text style={[palette.font('title', 15), { color: palette.text }]}>
              {t(locale, 'draftCard', { n: draft.steps.length })}
            </Text>
            <Text style={sub}>{t(locale, 'draftCardHint')}</Text>
            <View style={styles.row}>
              <Button
                palette={palette}
                testID="change-draft-continue"
                label={t(locale, 'draftContinue')}
                onPress={() => {
                  openDraft();
                  leave();
                }}
                style={styles.flex}
              />
              <Button
                palette={palette}
                testID="change-draft-delete"
                variant="outline"
                danger
                label={t(locale, 'draftDelete')}
                onPress={askDelete}
              />
            </View>
          </Card>
        ) : null}

        {/* 输入框：左边一个闪光图标、柔和阴影，和划屏介绍最后一页的对话框一样。 */}
        {planBusy ? null : (
          <View
            style={[
              styles.box,
              {
                padding: palette.inset,
                backgroundColor: palette.surface,
                borderColor: palette.border,
                borderRadius: palette.controlRadius,
                boxShadow: `0px 2px 6px ${palette.shadow}1F`,
              },
            ]}>
            <View style={styles.inputRow}>
              <TextInput
                testID="change-input"
                autoFocus={focusInput}
                selection={prefillSelection}
                onSelectionChange={() => setPrefillSelection(undefined)}
                value={input}
                onChangeText={setInput}
                editable={!typing}
                placeholder={
                  about?.kind === 'shared'
                    ? t(locale, 'sharePlaceholder')
                    : about && examples[0]
                      ? t(locale, 'aboutPlaceholder', { example: examples[0] })
                      : t(locale, 'changeAsk')
                }
                placeholderTextColor={palette.caption}
                multiline
                style={[styles.input, palette.font('body', 16), { color: palette.text }]}
              />
            </View>
            {/* 发送按钮就是 Tink（D-448）：发出去以后它动起来，旁边一句短话说规划走到哪一步。 */}
            <View style={styles.sendRow}>
              {busy ? (
                <Text
                  testID="change-progress"
                  numberOfLines={1}
                  style={[
                    palette.font('bodyMedium', 14),
                    styles.progress,
                    { color: palette.muted },
                  ]}>
                  {t(locale, PROGRESS_TEXT[planProgress ?? 'start'][progressVariant])}
                </Text>
              ) : null}
              <Pressable
                testID="change-submit"
                accessibilityRole="button"
                accessibilityLabel={t(locale, 'send')}
                disabled={busy || typing}
                onPress={() => void submit(input)}
                style={[styles.send, { backgroundColor: palette.primary }]}>
                {busy || typing ? (
                  <LivelyTink size={24} color={palette.onPrimary} />
                ) : (
                  <Icon name="tink" size={24} color={palette.onPrimary} />
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* 测试期服务器保存请求（D-240）：中英文新手引导用内置规则，不经过服务器；法语引导经过（D-228）。 */}
        {!planBusy && aiMode === 'server' && !guide ? (
          <Text
            testID="change-server-stored"
            style={[palette.font('body', 13), { color: palette.caption }]}>
            {t(locale, 'aiServerStoredNote')}
          </Text>
        ) : null}

        {feedback && (!planBusy || build?.phase === 'finished') ? (
          <Card palette={palette} testID="change-feedback">
            {feedback.kind === 'needsDraft' ? (
              <>
                <Text style={[palette.font('body', 15), { color: palette.text }]}>
                  {feedback.message}
                </Text>
                <Button
                  palette={palette}
                  testID="change-apply-draft-continue"
                  label={t(locale, 'draftApplyContinue')}
                  disabled={busy}
                  onPress={() => void applyDraftAndContinue(feedback.waiting)}
                />
              </>
            ) : feedback.kind === 'invalid' ? (
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
                <Text style={[palette.font('body', 15), { color: palette.text }]}>
                  {feedback.message}
                </Text>
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
                {feedback.kind === 'rejected' ? (
                  <NeedButton
                    key={asked}
                    text={asked}
                    reason={feedback.reason}
                    palette={palette}
                    locale={locale}
                  />
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        {/* 工具清单（D-414）：还差什么，点一项填进输入框。做没做好由代码判定。 */}
        {guide || planBusy || session.items.length === 0 ? null : (
          <View style={styles.session} testID="change-session">
            <View style={styles.sessionHead}>
              <Text style={[palette.font('title', 15), styles.flex, { color: palette.text }]}>
                {stillOpen.length > 0
                  ? t(locale, 'sessionTitle')
                  : t(locale, 'sessionDoneCount', { n: doneCount })}
              </Text>
              <Pressable
                testID="change-session-clear"
                accessibilityRole="button"
                hitSlop={10}
                onPress={askClearSession}>
                <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                  {t(locale, 'sessionClear')}
                </Text>
              </Pressable>
            </View>
            {problems.length > 0 ? (
              <View style={styles.fix} testID="change-fix">
                <Text style={[palette.font('body', 14), styles.fixText, { color: palette.text }]}>
                  {t(locale, 'fixCount', { n: problems.length })}
                </Text>
                <Button
                  palette={palette}
                  testID="change-fix-button"
                  label={t(locale, 'fixProblems')}
                  loading={busy}
                  disabled={busy}
                  onPress={() => void fix()}
                />
              </View>
            ) : null}
            {stillOpen.map((item) => (
              <Pressable
                key={item.id}
                testID={`change-session-item-${item.id}`}
                accessibilityRole="button"
                onPress={() => setInput(item.text)}
                style={({ pressed }) => [
                  styles.sessionItem,
                  {
                    paddingHorizontal: palette.inset,
                    backgroundColor: palette.primaryTint,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}>
                <Text
                  numberOfLines={2}
                  style={[palette.font('bodyMedium', 14), { color: palette.primaryText }]}>
                  {item.text}
                </Text>
                {item.reason ? (
                  <Text
                    numberOfLines={2}
                    style={[palette.font('body', 13), { color: palette.muted }]}>
                    {item.reason}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}

        {guide || planBusy ? null : (
          <View style={styles.chips} testID="change-examples">
            {/* 「接着改」是用户自己那句话剩下的部分（D-191），不是预设的句子。 */}
            {next && !auto ? (
              <Chip
                testID="change-next"
                label={next}
                palette={palette}
                onPress={() => setInput(next)}
              />
            ) : null}
            {/* AI 建议的下一步（D-355）：上一次修改时 AI 给的，点了填进输入框。 */}
            {suggest.map((text, i) => (
              <Chip
                key={text}
                testID={`change-suggest-${i}`}
                label={text}
                palette={palette}
                onPress={() => setInput(text)}
              />
            ))}
            {about && !place ? null : (
              <Chip
                testID="change-pick-style"
                label={t(locale, 'pickStyleChip')}
                icon
                palette={palette}
                onPress={() => setStylesOpen(true)}
              />
            )}
          </View>
        )}
      </ScrollView>

      {/* 「换个风格」：从底部弹出风格选择（D-095），选了直接进入草稿看效果。 */}
      <Modal
        visible={stylesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setStylesOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setStylesOpen(false)}
          accessibilityLabel={t(locale, 'close')}
        />
        <View
          testID="change-styles"
          style={[
            styles.sheet,
            {
              paddingHorizontal: palette.pad,
              backgroundColor: palette.surface,
              paddingBottom: insets.bottom + 16,
            },
          ]}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>
            {t(locale, 'pickStyle')}
          </Text>
          <StylePicker
            locale={locale}
            current={presetOfTheme(config.theme)}
            palette={palette}
            onPick={pickStyle}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Chip({
  label,
  palette,
  onPress,
  icon,
  testID,
}: {
  label: string;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
  icon?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: palette.primaryTint, opacity: pressed ? 0.6 : 1 },
      ]}>
      {icon ? <UiIcon name="palette" size={14} color={palette.primaryText} /> : null}
      <Text style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

/** 「2 张照片和 1 个 PDF」：分享进来的文件的类型和个数。 */
function sharedWhat(
  about: Extract<PlanAbout, { kind: 'shared' }>,
  locale: 'en' | 'zh' | 'fr',
): string {
  const parts = [
    about.images ? t(locale, 'sharedPhotos', { n: about.images }) : null,
    about.pdfs ? t(locale, 'sharedPdfs', { n: about.pdfs }) : null,
    about.videos ? t(locale, 'sharedVideos', { n: about.videos }) : null,
    about.audio ? t(locale, 'sharedAudio', { n: about.audio }) : null,
    about.others ? t(locale, 'sharedOthers', { n: about.others }) : null,
  ].filter(Boolean);
  return parts.join(t(locale, 'ChangeScreen_and_d40e9'));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  page: { paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  box: { borderWidth: 1, gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: { flex: 1, minHeight: 84, textAlignVertical: 'top', padding: 2 },
  sendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  progress: { flexShrink: 1, textAlign: 'right' },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  session: { gap: 8 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // 窄屏或文案长（法语）时按钮换到下一行。
  fix: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  fixText: { flex: 1, minWidth: 120 },
  sessionItem: { borderRadius: 12, paddingVertical: 8, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 34,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 18,
    gap: 14,
  },
});
