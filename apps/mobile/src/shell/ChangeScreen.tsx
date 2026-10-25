import {
  allComponents,
  createMockAIProvider,
  pageTarget,
  presetOfTheme,
  presetRequest,
  type PlanAbout,
  type ThemePresetId,
} from '@morph/core';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { guideText } from '../guide/store';
import { t } from '../i18n';
import { Icon, UiIcon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { sharedAbout } from '../share/about';
import { useIncoming } from '../share/incoming';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { DraftResult } from '../workspace/store';
import { aboutCandidates, examplesFor } from './examples';
import { closeButtonOption, stackScreenOptions } from './header';
import { NeedButton } from './NeedButton';
import { StylePicker } from './StylePicker';

/** 风格选择器填进去的原句由内置规则生成计划，不调用设置里的 AI（D-095）；新手引导的句子也是（D-149）。 */
const presetPlanner = createMockAIProvider();

/** 引导的句子打进输入框的速度：每个字的间隔，整句最多约 1.4 秒。 */
const typeDelay = (length: number) => Math.min(45, 1400 / Math.max(length, 1));

/** 输入框下面最多几个例子（不算「换个风格」）。 */
const MAX_EXAMPLES = 2;

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
  const change = useWorkspace((s) => s.change);
  const next = useWorkspace((s) => s.next);
  const afterApply = useAfterApply();
  const openDraft = useWorkspace((s) => s.openDraft);
  const deleteDraft = useWorkspace((s) => s.deleteDraft);
  const selectTab = useWorkspace((s) => s.selectTab);
  const palette = usePalette(config.theme);
  const aiMode = useAISettings((s) => s.mode);
  // 从一个快捷操作（「让 AI 改这个」）或收件页面打开时带上的上下文（D-124）。
  const params = useLocalSearchParams<{
    workflow?: string;
    shared?: string;
    guide?: string;
    next?: string;
    text?: string;
  }>();
  // 从新手引导打开（D-149）：句子自动打进输入框，用内置规则处理。
  const [guide] = useState(() =>
    guideText(params.guide, locale) !== null ? params.guide : undefined,
  );
  // 点了「接着改」（D-191）：那句话自动打进输入框，用设置里的 AI 处理。
  const [auto] = useState(() => guideText(guide, locale) ?? (params.next ? next : null));
  const [typing, setTyping] = useState(() => auto !== null);
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

  // 草稿聊天框里说的功能类请求，带到这里来说（D-191）。
  const [input, setInput] = useState(() => (auto ? '' : (params.text ?? '')));
  const [prefillSelection, setPrefillSelection] = useState(() =>
    !auto && params.text ? { start: params.text.length, end: params.text.length } : undefined,
  );
  /** 风格选择器最近填进去的句子；用户改过输入框后就不再相等，交给设置里的 AI。 */
  const [presetText, setPresetText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Extract<
    DraftResult,
    { kind: 'rejected' | 'invalid' }
  > | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  /** 被拒绝的那句话（需求回收，D-189）。 */
  const [asked, setAsked] = useState('');

  /**
   * 关掉这个页面，回到草稿：从外壳或页面打开的回到原处（页面也显示草稿）；从运行页面、收件页面、
   * 「做好了」页面打开的（有上下文）一起关掉，因为草稿模式不在它们里面。
   */
  function leave() {
    if (!router.canGoBack()) router.replace('/');
    else if (about && router.canDismiss()) router.dismissAll();
    else router.back();
  }

  async function submit(text: string, offline = text.trim() === presetText) {
    if (!text.trim() || busy) return;
    setFeedback(null);
    // 「撤销」会立即回到上一个版本、可能换主题：先把这个页面的导航栏固定住。Android 上带「关闭」
    // 按钮的导航栏在这时更新会崩（react-native-screens：child already has a parent）。
    navigation.setOptions({ ...stackScreenOptions(palette), ...closeButtonOption(palette) });
    const result = await change(text.trim(), offline ? presetPlanner : undefined, {
      ...(guide ? { guide } : {}),
      ...(about ? { about } : {}),
    });
    if (result.kind === 'rejected' || result.kind === 'invalid') {
      setFeedback(result);
      setAsked(text.trim());
      return;
    }
    // 进入草稿或回到 App 时显示改到的那一页（在导航栏里时）。
    if (result.kind === 'drafted' || result.kind === 'applied') {
      const target = pageTarget(result.focusPageId);
      const shown = result.kind === 'drafted' ? result.step.config : store.getState().config!;
      if (shown.shell.nav.includes(target)) selectTab(target);
    }
    leave();
    // 功能类直接应用了（D-191）：去「做好了」页面（或回到收件页面）试用。
    if (result.kind === 'applied') afterApply(result.applied);
  }

  // 引导和「接着改」的句子一个字一个字打进输入框，打完自动处理：用户看到「原来可以这么说」。
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
      if (guide) setPresetText(text);
      void submit(text, !!guide);
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

  const sub = [palette.font('body', 15), { color: palette.muted }];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.page, { padding: palette.pad, gap: palette.gap - 2 }]}
        keyboardShouldPersistTaps="handled">
        {about ? (
          <Card palette={palette} background={palette.primaryTint} testID="change-about">
            <Text style={[palette.font('title', 15), { color: palette.text }]}>
              {about.kind === 'workflow'
                ? t(locale, 'aboutWorkflow', { name: aboutName ?? '' })
                : t(locale, share?.source === 'picker' ? 'sharePicked' : 'aboutShared', {
                    what: sharedWhat(about, locale),
                  })}
            </Text>
            {about.kind === 'workflow' ? (
              <Text style={sub}>{t(locale, 'aboutWorkflowHint')}</Text>
            ) : null}
          </Card>
        ) : null}

        {draft && !guide ? (
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
        <View
          style={[
            styles.box,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              borderRadius: palette.controlRadius,
              boxShadow: `0px 2px 6px ${palette.shadow}1F`,
            },
          ]}>
          <View style={styles.inputRow}>
            <Icon name="sparkles" size={18} color={palette.primary} />
            <TextInput
              testID="change-input"
              autoFocus={Boolean(params.text) && !auto}
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
          <Pressable
            testID="change-submit"
            accessibilityRole="button"
            accessibilityLabel={t(locale, 'send')}
            disabled={busy || typing}
            onPress={() => void submit(input)}
            style={[styles.send, { backgroundColor: palette.primary }]}>
            {busy || typing ? (
              <ActivityIndicator color={palette.onPrimary} />
            ) : (
              <UiIcon name="send" size={20} color={palette.onPrimary} />
            )}
          </Pressable>
        </View>

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

        {guide ? null : (
          <View style={styles.chips} testID="change-examples">
            {(next && !auto ? [next, ...examples.filter((e) => e !== next)] : examples)
              .slice(0, MAX_EXAMPLES)
              .map((example) => (
                <Chip
                  key={example}
                  label={example}
                  palette={palette}
                  onPress={() => setInput(example)}
                  {...(example === next ? { testID: 'change-next' } : {})}
                />
              ))}
            {about ? null : (
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
            { backgroundColor: palette.surface, paddingBottom: insets.bottom + 16 },
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
  box: { borderWidth: 1, padding: 12, gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: { flex: 1, minHeight: 84, textAlignVertical: 'top', padding: 2 },
  send: {
    alignSelf: 'flex-end',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 14,
  },
});
