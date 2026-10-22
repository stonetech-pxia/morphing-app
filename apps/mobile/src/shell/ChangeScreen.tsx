import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { ProposeResult } from '../workspace/store';
import { Preview } from './Preview';

const EXAMPLES = {
  zh: ['把 PDF 放到最上面', '导航栏只保留首页、工具、设置', '主题换成绿色', '撤销刚才的修改'],
  en: [
    'Put PDF at the top',
    'Only keep Home, Tools and Settings in the navigation',
    'Change the theme color to green',
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
    const result = await propose(text.trim());
    if (result.kind !== 'preview') setFeedback(result);
  }

  async function apply() {
    await confirm();
    router.back();
  }

  async function discard() {
    await cancel();
    router.back();
  }

  const text = { color: palette.text };
  const sub = { color: palette.subtext };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {!proposal ? (
          <>
            <Text style={[styles.hint, sub]}>{t(locale, 'changeHint')}</Text>
            <TextInput
              testID="change-input"
              value={input}
              onChangeText={setInput}
              placeholder={t(locale, 'changePlaceholder')}
              placeholderTextColor={palette.subtext}
              multiline
              style={[
                styles.input,
                text,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            />
            <Pressable
              testID="change-submit"
              onPress={() => submit(input)}
              disabled={busy}
              style={[
                styles.primary,
                { backgroundColor: palette.primary, opacity: busy ? 0.6 : 1 },
              ]}>
              {busy ? (
                <ActivityIndicator color={palette.onPrimary} />
              ) : (
                <Text style={[styles.primaryText, { color: palette.onPrimary }]}>
                  {t(locale, 'preview')}
                </Text>
              )}
            </Pressable>

            {feedback ? (
              <View
                testID="change-feedback"
                style={[
                  styles.card,
                  { backgroundColor: palette.card, borderColor: palette.border },
                ]}>
                {feedback.kind === 'invalid' ? (
                  <>
                    <Text style={[styles.bold, { color: palette.danger }]}>
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
              </View>
            ) : null}

            <Text style={[styles.section, sub]}>{t(locale, 'examples')}</Text>
            <View style={styles.chips}>
              {EXAMPLES[locale].map((example) => (
                <Pressable
                  key={example}
                  onPress={() => setInput(example)}
                  style={[
                    styles.chip,
                    { borderColor: palette.border, backgroundColor: palette.card },
                  ]}>
                  <Text style={text}>{example}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text testID="proposal-summary" style={[styles.goal, text]}>
              {proposal.summary}
            </Text>
            <View
              style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.bold, text]}>{t(locale, 'planTitle')}</Text>
              {proposal.lines.map((line, i) => (
                <Text key={i} testID={`plan-line-${i}`} style={text}>
                  • {line}
                </Text>
              ))}
            </View>

            <View style={[styles.segment, { borderColor: palette.border }]}>
              {(['before', 'after'] as const).map((s) => (
                <Pressable
                  key={s}
                  testID={`preview-${s}`}
                  onPress={() => setSide(s)}
                  style={[styles.segmentItem, side === s && { backgroundColor: palette.primary }]}>
                  <Text
                    style={{
                      color: side === s ? palette.onPrimary : palette.text,
                      fontWeight: '600',
                    }}>
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
              <Pressable
                testID="change-cancel"
                onPress={discard}
                style={[styles.secondary, { borderColor: palette.border }]}>
                <Text style={[styles.primaryText, text]}>{t(locale, 'cancel')}</Text>
              </Pressable>
              <Pressable
                testID="change-apply"
                onPress={apply}
                disabled={busy || previewBroken}
                style={[
                  styles.primary,
                  styles.flex,
                  { backgroundColor: palette.primary, opacity: busy || previewBroken ? 0.5 : 1 },
                ]}>
                <Text style={[styles.primaryText, { color: palette.onPrimary }]}>
                  {t(locale, 'apply')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { padding: 16, gap: 12, paddingBottom: 48 },
  hint: { fontSize: 15 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  primary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  bold: { fontWeight: '700', fontSize: 15 },
  section: { marginTop: 8, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  goal: { fontSize: 20, fontWeight: '700' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  flex: { flex: 1 },
});
