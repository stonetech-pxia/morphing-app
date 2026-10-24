import { guideGoal, type Workflow } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isGoalParam } from '../guide/store';
import { t } from '../i18n';
import { UiIcon, type UiIconName } from '../renderer/Icon';
import { usePalette, type Palette } from '../renderer/theme';
import { NeedButton } from '../shell/NeedButton';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { shownConfig, type Draft, type DraftChatReply, type DraftStep } from '../workspace/store';
import { useDraftUi } from './ui';
import { useApplyDraft } from './useApplyDraft';

/**
 * 草稿模式（D-190）底部连在一起的四个按钮：修改（聊天框里接着说）、退一步、应用、离开（草稿保留）。
 * 外壳和推入的页面都显示它；AI 改不掉它（不在配置里）。上面是最新一步的回复。
 */
export function DraftBar({ palette, bottom }: { palette: Palette; bottom: number }) {
  const { locale } = useWorkspaceContext();
  const draft = useWorkspace((s) => s.draft);
  const busy = useWorkspace((s) => s.busy);
  const stepBack = useWorkspace((s) => s.stepBack);
  const closeDraft = useWorkspace((s) => s.closeDraft);
  const setChatOpen = useDraftUi((s) => s.setChatOpen);
  const apply = useApplyDraft();
  if (!draft?.open) return null;
  const canStepBack = draft.steps.length > 1;

  const button = (
    id: string,
    icon: UiIconName,
    label: string,
    onPress: () => void,
    opts: { primary?: boolean; disabled?: boolean } = {},
  ) => {
    const color = opts.primary ? palette.onPrimary : palette.text;
    return (
      <Pressable
        key={id}
        testID={`draft-${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!opts.disabled }}
        disabled={opts.disabled || busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          opts.primary && { backgroundColor: palette.primary },
          (opts.disabled || pressed) && { opacity: opts.disabled ? 0.35 : 0.7 },
        ]}>
        <UiIcon name={icon} size={20} color={color} />
        <Text style={[palette.font('bodyBold', 11), { color }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        <DraftReply draft={draft} palette={palette} />
        <View
          testID="draft-bar"
          style={[
            styles.bar,
            palette.cardStyle(palette.surface),
            { borderColor: palette.border, borderRadius: 999 },
          ]}>
          {button('edit', 'chat', t(locale, 'draftEdit'), () => setChatOpen(true))}
          {button('back', 'undo', t(locale, 'draftBack'), () => void stepBack(), {
            disabled: !canStepBack,
          })}
          {button('apply', 'done', t(locale, 'draftApply'), () => void apply(), {
            primary: true,
          })}
          {button('leave', 'close', t(locale, 'draftLeave'), closeDraft)}
        </View>
      </View>
    </>
  );
}

/**
 * 聊天框放在外壳外面：外壳每改一步会重新挂载（ErrorBoundary 的 key），聊天框不能跟着重新滑出来。
 */
export function DraftChatSheet() {
  const open = useWorkspace((s) => !!s.draft?.open);
  // 用草稿的样子；根布局的导航栏头部仍跟着已保存的版本。
  const palette = usePalette(useWorkspace(shownConfig)!.theme);
  const chatOpen = useDraftUi((s) => s.chatOpen);
  const setChatOpen = useDraftUi((s) => s.setChatOpen);
  return (
    <DraftChat visible={open && chatOpen} palette={palette} onClose={() => setChatOpen(false)} />
  );
}

/** 新做的快捷操作：比较这一步和上一步，找出多出来的那一个。 */
function addedWorkflow(draft: Draft, index: number): Workflow | undefined {
  const step = draft.steps[index]!;
  const before = index > 0 ? draft.steps[index - 1]!.config : null;
  const known = new Set(before?.workflows.map((w) => w.id));
  const added = step.ops.flatMap((op) => (op.op === 'addWorkflow' ? [op.workflow.id] : []));
  const id = added.find((x) => !known.has(x));
  return id ? step.config.workflows.find((w) => w.id === id) : undefined;
}

/** 最新一步的回复：改了什么（新做的快捷操作列出步骤，一条一条长出来）和 AI 的说明。可以关掉。 */
function DraftReply({ draft, palette }: { draft: Draft; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const seenStep = useDraftUi((s) => s.seenStep);
  const markSeen = useDraftUi((s) => s.markSeen);
  const chatOpen = useDraftUi((s) => s.chatOpen);
  const last = draft.steps.at(-1)!;
  if (chatOpen || seenStep === last.changeRequestId) return null;
  const guide = draft.origin.guide;
  return (
    <View
      testID="draft-reply"
      style={[
        styles.reply,
        palette.cardStyle(palette.surface),
        { borderRadius: palette.controlRadius, padding: palette.pad - 4 },
      ]}>
      <View style={styles.replyHead}>
        <Text style={[palette.font('title', 15), styles.flex, { color: palette.text }]}>
          {t(locale, 'draftReplyTitle')}
        </Text>
        <Pressable
          testID="draft-reply-close"
          accessibilityLabel={t(locale, 'close')}
          hitSlop={10}
          onPress={() => markSeen(last.changeRequestId)}>
          <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>✕</Text>
        </Pressable>
      </View>
      <StepReply draft={draft} index={draft.steps.length - 1} palette={palette} />
      {guide && draft.steps.length === 1 ? (
        <Text
          testID="draft-guide-hint"
          style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
          {t(locale, 'draftGuideHint')}
        </Text>
      ) : null}
    </View>
  );
}

/** 一步的回复内容（聊天框和最新一步的回复共用）。 */
function StepReply({
  draft,
  index,
  palette,
  animate = true,
}: {
  draft: Draft;
  index: number;
  palette: Palette;
  animate?: boolean;
}) {
  const step = draft.steps[index]!;
  const workflow = addedWorkflow(draft, index);
  const guide = draft.origin.guide;
  const added = index === 0 && isGoalParam(guide) ? new Set(guideGoal(guide).added) : new Set();
  const body = [palette.font('body', 14), { color: palette.text }];
  return (
    <View style={styles.stepReply}>
      {workflow ? (
        <GrowingSteps workflow={workflow} added={added} palette={palette} animate={animate} />
      ) : (
        step.lines.slice(0, 4).map((line, i) => (
          <Text key={i} style={body}>
            • {line}
          </Text>
        ))
      )}
      {step.notes?.map((note, i) => (
        <Text
          key={`n${i}`}
          testID={`draft-note-${i}`}
          style={[palette.font('body', 13), { color: palette.muted }]}>
          {note}
        </Text>
      ))}
    </View>
  );
}

/** 新做的快捷操作：步骤一条一条长出来，AI 按用途补上的步骤标出来（引导的惊喜，D-149）。 */
function GrowingSteps({
  workflow,
  added,
  palette,
  animate,
}: {
  workflow: Workflow;
  added: ReadonlySet<unknown>;
  palette: Palette;
  animate: boolean;
}) {
  const { locale, registry } = useWorkspaceContext();
  const [shown] = useState(() => workflow.steps.map(() => new Animated.Value(animate ? 0 : 1)));
  useEffect(() => {
    if (!animate) return;
    Animated.stagger(
      220,
      shown.map((v) => Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true })),
    ).start();
  }, [animate, shown]);
  return (
    <View testID="draft-steps" style={styles.stepReply}>
      <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>{workflow.name}</Text>
      {workflow.steps.map((step, i) => (
        <Animated.View
          key={step.id}
          testID={`draft-step-${step.id}`}
          style={[
            styles.step,
            {
              opacity: shown[i],
              transform: [
                { translateY: shown[i]!.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
              ],
            },
          ]}>
          <View style={[styles.stepNo, { backgroundColor: palette.primaryTint }]}>
            <Text style={[palette.font('bodyBold', 11), { color: palette.primaryText }]}>
              {i + 1}
            </Text>
          </View>
          <Text style={[palette.font('body', 14), styles.flex, { color: palette.text }]}>
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
    </View>
  );
}

/**
 * 「修改」：从底部拉起的聊天框（D-190）。每说一句就在草稿上再改一步，上面的 App 跟着变；
 * 做不到时说明原因并给出可以点的例子。草稿里只改外观：功能类的请求说明原因，可以带去「修改这个 App」说
 * （D-191，那里直接生效）。
 */
function DraftChat({
  visible,
  palette,
  onClose,
}: {
  visible: boolean;
  palette: Palette;
  onClose: () => void;
}) {
  const { locale } = useWorkspaceContext();
  const insets = useSafeAreaInsets();
  const draft = useWorkspace((s) => s.draft);
  const busy = useWorkspace((s) => s.busy);
  const draftChange = useWorkspace((s) => s.draftChange);
  const closeDraft = useWorkspace((s) => s.closeDraft);
  const router = useRouter();
  const [input, setInput] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const steps = draft?.steps ?? [];

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    // 做不到、退一步这些回复由 store 记在草稿里（D-207）。
    await draftChange(trimmed);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }

  const bubble = (mine: boolean) => [
    styles.bubble,
    mine
      ? { alignSelf: 'flex-end' as const, backgroundColor: palette.primaryTint }
      : { alignSelf: 'flex-start' as const, backgroundColor: palette.background },
    { borderRadius: palette.controlRadius },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Android 也要 padding：Modal 里窗口不跟着键盘缩小，三星键盘会挡住输入框（同 AskPanel）。 */}
      <KeyboardAvoidingView style={styles.chatRoot} behavior="padding">
        <Pressable
          style={styles.flex}
          onPress={onClose}
          accessibilityLabel={t(locale, 'draftChatClose')}
        />
        <View
          testID="draft-chat"
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              paddingBottom: insets.bottom + 12,
              borderColor: palette.border,
            },
          ]}>
          <View style={styles.replyHead}>
            <Text style={[palette.font('title', 16), styles.flex, { color: palette.text }]}>
              {t(locale, 'draftChatTitle')}
            </Text>
            <Pressable testID="draft-chat-close" hitSlop={10} onPress={onClose}>
              <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
                {t(locale, 'draftChatClose')}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            ref={scroll}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled">
            {draft
              ? steps.map((step: DraftStep, i) => (
                  <View key={step.changeRequestId} style={styles.turn}>
                    <View style={bubble(true)}>
                      <Text style={[palette.font('body', 14), { color: palette.text }]}>
                        {step.input}
                      </Text>
                    </View>
                    <View style={bubble(false)} testID={`draft-chat-reply-${i}`}>
                      <StepReply
                        draft={draft}
                        index={i}
                        palette={palette}
                        animate={i === steps.length - 1}
                      />
                    </View>
                    {draft.replies
                      .filter((r) => r.afterSteps === i + 1)
                      .map((r, j) => (
                        <ReplyBubble
                          key={j}
                          reply={r}
                          palette={palette}
                          style={bubble(false)}
                          onExample={setInput}
                          onHandOff={(text) => {
                            onClose();
                            closeDraft();
                            router.push({ pathname: '/change', params: { text } });
                          }}
                        />
                      ))}
                  </View>
                ))
              : null}
          </ScrollView>
          <View style={[styles.inputRow, { borderColor: palette.border }]}>
            <TextInput
              testID="draft-chat-input"
              value={input}
              onChangeText={setInput}
              placeholder={t(locale, 'draftChatPlaceholder')}
              placeholderTextColor={palette.caption}
              multiline
              style={[styles.input, palette.font('body', 15), { color: palette.text }]}
            />
            <Pressable
              testID="draft-chat-send"
              accessibilityRole="button"
              accessibilityLabel={t(locale, 'send')}
              disabled={busy}
              onPress={() => void send(input)}
              style={[styles.send, { backgroundColor: palette.primary }]}>
              {busy ? (
                <ActivityIndicator color={palette.onPrimary} />
              ) : (
                <UiIcon name="send" size={18} color={palette.onPrimary} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReplyBubble({
  reply,
  palette,
  style,
  onExample,
  onHandOff,
}: {
  reply: DraftChatReply;
  palette: Palette;
  style: object[];
  onExample: (text: string) => void;
  onHandOff: (text: string) => void;
}) {
  const { locale } = useWorkspaceContext();
  const message = reply.kind === 'steppedBack' ? reply.message : `${reply.input}\n${reply.message}`;
  return (
    <View style={style} testID="draft-chat-rejected">
      <Text style={[palette.font('body', 14), { color: palette.text }]}>{message}</Text>
      {reply.kind === 'functionInDraft' ? (
        <Pressable testID="draft-chat-handoff" onPress={() => onHandOff(reply.input)} hitSlop={4}>
          <Text style={[palette.font('bodyBold', 13), { color: palette.primaryText }]}>
            {t(locale, 'draftNoFunctionGo')}
          </Text>
        </Pressable>
      ) : null}
      {reply.examples.map((example) => (
        <Pressable key={example} onPress={() => onExample(example)} hitSlop={4}>
          <Text style={[palette.font('bodyBold', 13), { color: palette.primaryText }]}>
            {example}
          </Text>
        </Pressable>
      ))}
      {reply.kind === 'rejected' ? (
        <NeedButton text={reply.input} reason={reply.reason} palette={palette} locale={locale} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 10 },
  bar: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 68,
  },
  reply: { alignSelf: 'stretch', gap: 6 },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepReply: { gap: 5 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chatRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    height: '58%',
    flexShrink: 1,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  messages: { gap: 12, paddingBottom: 8 },
  turn: { gap: 8 },
  bubble: { maxWidth: '88%', paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 5,
  },
  input: { flex: 1, maxHeight: 110, paddingVertical: 6 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
