import {
  localize,
  type ActionDefinition,
  type Collection,
  type Locale,
  type ParamField,
} from '@morph/core';

import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspace } from '../workspace/context';

// 根据动作的参数界面元数据自动生成表单（TOOLS_DESIGN §2）。运行时询问和工作流编辑页共用。

/** 要输两遍的密码，第二遍放在这个键里（只在表单里，不交出去）。 */
export const againKey = (key: string) => `${key}:again`;

export function visibleFields(
  action: ActionDefinition,
  values: Record<string, unknown>,
  only?: readonly string[],
): ParamField[] {
  // 密码只在运行时问（D-194），编辑页不显示。
  return action.fields.filter(
    (f) =>
      (only ? only.includes(f.key) : f.kind !== 'secret') &&
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
  collection,
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
  /** 「字段」参数从这张表里选（工作流里前面「读取记录」步骤的表）。 */
  collection?: Collection | undefined;
}) {
  // 运行时询问时也给常用规格，只填被问到的参数。
  const shown = visibleFields(action, values, only);
  const all = (action.presets ?? []).map((p) => ({
    ...p,
    values: only
      ? Object.fromEntries(Object.entries(p.values).filter(([k]) => only.includes(k)))
      : p.values,
  }));
  // 和下面某个选项同名、设的就是那个选项的规格（例如证件照规格）：按钮和选项重复，不显示；
  // 改由选那个选项时一起填上规格里的其他参数（证件照的大小上限）。
  const choiceFor = (p: (typeof all)[number]) =>
    shown.find(
      (f) =>
        f.kind === 'choice' &&
        f.key in p.values &&
        f.options?.some(
          (o) =>
            o.value === p.values[f.key] && localize(o.label, locale) === localize(p.label, locale),
        ),
    );
  const presets = all.filter((p, i) => {
    const keys = Object.keys(p.values);
    // 只剩一个选项参数时，按钮和下面的选项重复，不显示。
    const sameAsChoice =
      keys.length === 1 && action.fields.find((f) => f.key === keys[0])?.kind === 'choice';
    return (
      keys.length > 0 &&
      !sameAsChoice &&
      !choiceFor(p) &&
      all.findIndex((q) => JSON.stringify(q.values) === JSON.stringify(p.values)) === i
    );
  });
  const set = (key: string, value: unknown) => {
    const preset = all.find((p) => p.values[key] === value && choiceFor(p)?.key === key);
    onChange({ ...values, ...preset?.values, [key]: value });
  };
  return (
    <View style={styles.form}>
      {presets.length > 0 ? (
        <View style={styles.wrap}>
          {presets.map((p) => (
            <Chip
              key={p.id}
              palette={palette}
              testID={`${testPrefix}-preset-${p.id}`}
              label={localize(p.label, locale)}
              selected={Object.entries(p.values).every(([k, v]) => values[k] === v)}
              onPress={() => onChange({ ...values, ...p.values })}
            />
          ))}
        </View>
      ) : null}
      {shown.map((field) => (
        <View key={field.key} style={styles.field}>
          {hideLabels ? null : (
            <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
              {localize(field.label, locale)}
            </Text>
          )}
          <FieldInput
            field={field}
            value={values[field.key]}
            onChange={(v) => set(field.key, v)}
            palette={palette}
            locale={locale}
            testID={`${testPrefix}-${field.key}`}
            collection={collection}
          />
          {field.kind === 'secret' && field.confirm ? (
            <>
              <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
                {t(locale, 'askPasswordAgain')}
              </Text>
              <FieldInput
                field={field}
                value={values[againKey(field.key)]}
                onChange={(v) => set(againKey(field.key), v)}
                palette={palette}
                locale={locale}
                testID={`${testPrefix}-${field.key}-again`}
              />
            </>
          ) : null}
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
  collection,
}: {
  field: ParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: Locale;
  testID: string;
  collection?: Collection | undefined;
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
              label={localize(o.label, locale)}
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
          value={Boolean(value ?? field.defaultOn)}
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
    case 'collection':
      return (
        <CollectionInput value={value} onChange={onChange} palette={palette} testID={testID} />
      );
    case 'fields': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      if (!collection) {
        return (
          <Text style={[palette.font('body', 14), { color: palette.muted }]}>
            {t(locale, 'ParamForm_Choose_a_data_table_first_b5c9a')}
          </Text>
        );
      }
      return (
        <View style={styles.wrap}>
          {collection.fields.map((f) => (
            <Chip
              key={f.id}
              palette={palette}
              testID={`${testID}-${f.id}`}
              label={f.name}
              selected={chosen.includes(f.id)}
              onPress={() =>
                onChange(
                  chosen.includes(f.id) ? chosen.filter((x) => x !== f.id) : [...chosen, f.id],
                )
              }
            />
          ))}
        </View>
      );
    }
    case 'secret':
      return (
        <TextInput
          testID={testID}
          style={input}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
        />
      );
    default:
      return (
        <TextInput
          testID={testID}
          multiline={field.multiline}
          style={[input, field.multiline ? styles.multiline : null]}
          value={value === undefined || value === null ? '' : String(value)}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      );
  }
}

/** 选一张数据表（选项来自当前配置）。 */
function CollectionInput({
  value,
  onChange,
  palette,
  testID,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  testID: string;
}) {
  const collections = useWorkspace((s) => s.config?.collections ?? []);
  return (
    <View style={styles.wrap}>
      {collections.map((c) => (
        <Chip
          key={c.id}
          palette={palette}
          testID={`${testID}-${c.id}`}
          label={c.name}
          selected={value === c.id}
          onPress={() => onChange(c.id)}
        />
      ))}
    </View>
  );
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
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
