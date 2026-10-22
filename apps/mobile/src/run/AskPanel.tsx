import {
  renderNameTemplate,
  sanitizeFileName,
  type AskRequest,
  type Locale,
  type RunValue,
  isFileValue,
} from '@morph/core';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { ParamForm } from './ParamForm';

// 运行时询问参数（工作流步骤的 ask）。文件名模板显示成渲染好的名字，用户改的是最终的名字。

function suggestedName(template: string, input: RunValue | null, now: Date): string {
  const first = isFileValue(input) ? input.items[0] : undefined;
  return renderNameTemplate(template, {
    now,
    index: 1,
    sourceName: first?.name ?? '',
    ...(first?.takenAt !== undefined ? { takenAt: new Date(first.takenAt) } : {}),
  });
}

export function initialAnswers(request: AskRequest, now: Date): Record<string, unknown> {
  const values: Record<string, unknown> = { ...request.params };
  for (const field of request.action.fields) {
    if (field.kind === 'nameTemplate' && request.keys.includes(field.key)) {
      values[field.key] = suggestedName(String(request.params[field.key]), request.input, now);
    }
  }
  return values;
}

export function AskPanel({
  request,
  palette,
  locale,
  now,
  onAnswer,
}: {
  request: AskRequest;
  palette: Palette;
  locale: Locale;
  now: Date;
  onAnswer: (values: Record<string, unknown> | null) => void;
}) {
  const [values, setValues] = useState(() => initialAnswers(request, now));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const answers: Record<string, unknown> = {};
    for (const key of request.keys) {
      const field = request.action.fields.find((f) => f.key === key);
      let value = values[key];
      // 用户输入的是最终文件名，不是模板：去掉花括号，按文件名规则清理。
      if (field?.kind === 'nameTemplate') {
        const literal = String(value ?? '')
          .replace(/[{}]/g, '')
          .trim();
        if (!literal) return setError(t(locale, 'askInvalid', { detail: field.label[locale] }));
        value = sanitizeFileName(literal);
      }
      answers[key] = value;
    }
    const parsed = request.action.params.safeParse({ ...request.params, ...answers });
    if (!parsed.success) {
      const labels = parsed.error.issues.map((i) => {
        const key = String(i.path[0] ?? '');
        return request.action.fields.find((f) => f.key === key)?.label[locale] ?? i.message;
      });
      setError(
        t(locale, 'askInvalid', {
          detail: [...new Set(labels)].join(locale === 'zh' ? '、' : ', '),
        }),
      );
      return;
    }
    onAnswer(answers);
  }

  const onlyName =
    request.keys.length === 1 &&
    request.action.fields.find((f) => f.key === request.keys[0])?.kind === 'nameTemplate';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onAnswer(null)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View
          style={[
            styles.dialog,
            { backgroundColor: palette.surface, borderRadius: palette.radius },
          ]}>
          <Text style={[palette.font('title', 18), { color: palette.text }]}>
            {onlyName ? t(locale, 'askName') : request.action.label[locale]}
          </Text>
          <ParamForm
            action={request.action}
            values={values}
            onChange={(v) => {
              setValues(v);
              setError(null);
            }}
            palette={palette}
            locale={locale}
            only={request.keys}
            testPrefix="ask"
            hideLabels={onlyName}
          />
          {error ? (
            <Text
              testID="ask-error"
              style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable testID="prompt-cancel" onPress={() => onAnswer(null)} hitSlop={8}>
              <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                {t(locale, 'cancel')}
              </Text>
            </Pressable>
            <Pressable testID="prompt-ok" onPress={submit} hitSlop={8}>
              <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                {t(locale, 'ok')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#2A242080', justifyContent: 'center', padding: 24 },
  dialog: { padding: 22, gap: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24 },
});
