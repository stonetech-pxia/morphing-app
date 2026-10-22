import type { ActionDefinition, Locale, ParamField } from '@morph/core';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { Palette } from '../renderer/theme';

// 根据动作的参数界面元数据自动生成表单（TOOLS_DESIGN §2）。运行时询问和工作流编辑页共用。

export function visibleFields(
  action: ActionDefinition,
  values: Record<string, unknown>,
  only?: readonly string[],
): ParamField[] {
  return action.fields.filter(
    (f) =>
      (!only || only.includes(f.key)) &&
      (!f.showIf || f.showIf.equals.includes(values[f.showIf.key] as never)),
  );
}

export function ParamForm({
  action,
  values,
  onChange,
  palette,
  locale,
  only,
  testPrefix = 'param',
  hideLabels = false,
}: {
  action: ActionDefinition;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  palette: Palette;
  locale: Locale;
  only?: readonly string[];
  testPrefix?: string;
  /** 只有一个参数、标题已经说明时不再重复显示标签。 */
  hideLabels?: boolean;
}) {
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const presets = only ? [] : (action.presets ?? []);
  return (
    <View style={styles.form}>
      {presets.length > 0 ? (
        <View style={styles.wrap}>
          {presets.map((p) => (
            <Chip
              key={p.id}
              palette={palette}
              testID={`${testPrefix}-preset-${p.id}`}
              label={p.label[locale]}
              selected={Object.entries(p.values).every(([k, v]) => values[k] === v)}
              onPress={() => onChange({ ...values, ...p.values })}
            />
          ))}
        </View>
      ) : null}
      {visibleFields(action, values, only).map((field) => (
        <View key={field.key} style={styles.field}>
          {hideLabels ? null : (
            <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
              {field.label[locale]}
            </Text>
          )}
          <FieldInput
            field={field}
            value={values[field.key]}
            onChange={(v) => set(field.key, v)}
            palette={palette}
            locale={locale}
            testID={`${testPrefix}-${field.key}`}
          />
        </View>
      ))}
    </View>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  palette,
  locale,
  testID,
}: {
  field: ParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: Locale;
  testID: string;
}) {
  const input = [
    styles.input,
    palette.font('body', 16),
    {
      color: palette.text,
      borderColor: palette.border,
      borderRadius: palette.controlRadius,
      backgroundColor: palette.surface,
    },
  ];
  switch (field.kind) {
    case 'choice':
      return (
        <View style={styles.wrap}>
          {field.options!.map((o) => (
            <Chip
              key={String(o.value)}
              palette={palette}
              testID={`${testID}-${String(o.value)}`}
              label={o.label[locale]}
              selected={value === o.value}
              onPress={() => onChange(o.value)}
            />
          ))}
        </View>
      );
    case 'toggle':
      return (
        <Switch
          testID={testID}
          value={Boolean(value)}
          onValueChange={onChange}
          trackColor={{ true: palette.primary }}
        />
      );
    case 'number':
      return (
        <View style={styles.row}>
          <TextInput
            testID={testID}
            style={[input, styles.number]}
            keyboardType="decimal-pad"
            value={value === undefined || value === null ? '' : String(value)}
            onChangeText={(text) => {
              const n = Number(text.replace(',', '.'));
              onChange(text.trim() === '' || Number.isNaN(n) ? text : n);
            }}
          />
          {field.unit ? (
            <Text style={[palette.font('body', 15), { color: palette.muted }]}>{field.unit}</Text>
          ) : null}
          {field.min !== undefined && field.max !== undefined ? (
            <Text style={[palette.font('body', 13), { color: palette.caption }]}>
              {`${field.min}–${field.max}`}
            </Text>
          ) : null}
        </View>
      );
    default:
      return (
        <TextInput
          testID={testID}
          style={input}
          value={value === undefined || value === null ? '' : String(value)}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      );
  }
}

export function Chip({
  palette,
  label,
  selected,
  onPress,
  testID,
}: {
  palette: Palette;
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? palette.primary : palette.border,
          backgroundColor: selected ? palette.primary : palette.surface,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <Text
        style={[
          palette.font('bodyBold', 14),
          { color: selected ? palette.onPrimary : palette.text },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  field: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  number: { minWidth: 110 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
