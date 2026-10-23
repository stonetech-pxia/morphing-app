import {
  createMockAIProvider,
  presetOfTheme,
  presetRequest,
  type ThemePresetId,
} from '@morph/core';
import { useRouter } from 'expo-router';
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

import { t } from '../i18n';
import { usePalette } from '../renderer/theme';
import { Button, Card, SectionLabel } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { ProposeResult } from '../workspace/store';
import { Preview } from './Preview';
import { StylePicker } from './StylePicker';

/** 风格选择器填进去的原句由内置规则生成计划，不调用设置里的 AI（D-095）。 */
const presetPlanner = createMockAIProvider();

const EXAMPLES = {
  zh: [
    '主题换成绿色',
    '字体大一点',
    '去掉阴影',
    '新建一个叫「记账」的页面',
    '添加签证照片工作流',
    '导航栏只保留首页、工具、设置',
    '撤销刚才的修改',
  ],
  en: [
    'Change the theme color to green',
    'Bigger text',
    'Remove shadows',
    'Add a page called Budget',
    'Add the visa photo workflow',
    'Only keep Home, Tools and Settings in the navigation',
    'Undo the last change',
  ],
};

/**
 * AI 修改入口（§4）：复述目标 → 列出将要做的修改 → 修改前后预览 → 应用 / 取消。
 * 只有提交并重新渲染成功后，外壳才显示“已应用”。
 */
export function ChangeScreen() {
  const { locale } = useWorkspaceContext();
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const proposal = useWorkspace((s) => s.proposal);
  const busy = useWorkspace((s) => s.busy);
  const propose = useWorkspace((s) => s.propose);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const palette = usePalette(config.theme);

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
    const result = await propose(text.trim(), planner);
    if (result.kind !== 'preview') setFeedback(result);
  }

  /** 点选风格预设：把切换风格的句子填进输入框，用户点「预览」后照常走预览（D-095）。 */
  function pickStyle(preset: ThemePresetId) {
    const text = presetRequest(preset, locale);
    setFeedback(null);
    setInput(text);
    setPresetText(text);
  }

  async function apply() {
    await confirm();
    router.back();
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
            <Text style={sub}>{t(locale, 'changeHint')}</Text>
            <TextInput
              testID="change-input"
              value={input}
              onChangeText={setInput}
              placeholder={t(locale, 'changePlaceholder')}
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
                  <Text style={text}>{feedback.message}</Text>
                )}
              </Card>
            ) : null}

            <SectionLabel palette={palette}>{t(locale, 'pickStyle')}</SectionLabel>
            <StylePicker
              locale={locale}
              current={presetOfTheme(config.theme)}
              palette={palette}
              onPick={pickStyle}
            />

            <SectionLabel palette={palette}>{t(locale, 'examples')}</SectionLabel>
            <View style={styles.chips}>
              {EXAMPLES[locale].map((example) => (
                <Pressable
                  key={example}
                  onPress={() => setInput(example)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderColor: palette.border,
                      backgroundColor: palette.surface,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}>
                  <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>
                    {example}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text
              testID="proposal-summary"
              style={[palette.font('heading', 22), { color: palette.text, letterSpacing: -0.4 }]}>
              {proposal.summary}
            </Text>
            <Card palette={palette}>
              <Text style={[palette.font('title', 15), { color: palette.text }]}>
                {t(locale, 'planTitle')}
              </Text>
              {proposal.lines.map((line, i) => (
                <Text key={i} testID={`plan-line-${i}`} style={text}>
                  • {line}
                </Text>
              ))}
            </Card>

            {/* 两段式切换（Docudis 的 ClaySegmented）。 */}
            <View style={[styles.segment, { backgroundColor: palette.border }]}>
              {(['before', 'after'] as const).map((s) => (
                <Pressable
                  key={s}
                  testID={`preview-${s}`}
                  onPress={() => setSide(s)}
                  style={[styles.segmentItem, side === s && { backgroundColor: palette.surface }]}>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
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
