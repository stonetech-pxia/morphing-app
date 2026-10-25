import { canEncodeStandardText } from '@morph/tool-pdf';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { t } from '../../i18n';
import { Chip } from '../ParamForm';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 填表（TOOLS_DESIGN §4 fillForm）：按字段类型生成输入（文字 / 勾选 / 下拉 / 单选 / 列表）。
// 只返回用户改过的字段；填的内容只在本次运行里使用，不进配置，也不发给 AI。

type Value = string | boolean;

/** pdf-lib 的标准字体只能写拉丁字母（D-073）；多行文字逐行检查。 */
const encodable = (text: string) => text.split(/\r\n|\r|\n/).every(canEncodeStandardText);

export function FillFormScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'fillForm'>) {
  const fields = input.fields.filter((f) => !f.readOnly && f.type !== 'other');
  const [values, setValues] = useState<Record<string, Value>>({});
  const set = (name: string, value: Value) => setValues((v) => ({ ...v, [name]: value }));
  const valueOf = (name: string, fallback: Value | undefined) =>
    name in values ? values[name] : fallback;
  const bad = Object.entries(values).filter(([, v]) => typeof v === 'string' && !encodable(v));

  const input_ = [
    styles.input,
    palette.font('body', 16),
    {
      color: palette.text,
      borderColor: palette.border,
      borderRadius: palette.controlRadius,
      backgroundColor: palette.surface,
    },
  ];

  return (
    <LocalFrame
      palette={palette}
      title={t(locale, 'FillFormScreen_Fill_in_form_5d701')}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'localDone')}
      onCancel={onCancel}
      onDone={() => onDone(values)}
      doneDisabled={bad.length > 0}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442', {
            v0: input.item.name,
            v1: input.item.ext,
            v2: fields.length,
          })}
        </Text>
        {fields.map((field, i) => {
          const value = valueOf(field.name, field.value);
          const invalid = typeof value === 'string' && !encodable(value);
          return (
            <View key={field.name} style={styles.field} testID={`form-field-${i}`}>
              <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
                {field.name}
              </Text>
              {field.type === 'text' ? (
                <TextInput
                  testID={`form-text-${i}`}
                  style={[input_, field.multiline ? styles.multiline : null]}
                  value={typeof value === 'string' ? value : ''}
                  onChangeText={(text) => set(field.name, text)}
                  multiline={field.multiline}
                  autoCorrect={false}
                />
              ) : field.type === 'checkbox' ? (
                <Switch
                  testID={`form-check-${i}`}
                  value={Boolean(value)}
                  onValueChange={(v) => set(field.name, v)}
                  trackColor={{ true: palette.primary }}
                />
              ) : (
                <View style={styles.wrap}>
                  {(field.options ?? []).map((option, j) => (
                    <Chip
                      key={option}
                      palette={palette}
                      testID={`form-option-${i}-${j}`}
                      label={option}
                      selected={value === option}
                      onPress={() => set(field.name, option)}
                    />
                  ))}
                </View>
              )}
              {invalid ? (
                <Text style={[palette.font('body', 13), { color: palette.danger }]}>
                  {t(locale, 'FillFormScreen_This_form_can_only_hold_Latin_letters__179fb')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, gap: 18 },
  field: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
