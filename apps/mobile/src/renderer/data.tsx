import {
  filterPresets,
  listGroups,
  findDatePhrase,
  createInput,
  smartDateOf,
  withoutPhrase,
  aggregateRecords,
  calendarOf,
  dateOfDayNumber,
  filterRecords,
  fieldDefinition,
  formatDuration,
  formatNumber,
  formatRef,
  formatValue,
  changeLabel,
  compareChange,
  elapsedOf,
  formatElapsed,
  groupRecords,
  previousFilter,
  previousLabel,
  progressOf,
  recordProgress,
  isSequenceAggregate,
  linkTitle,
  localDateTime,
  prepareRecordValues,
  readValue,
  recordValue,
  sequenceText,
  sequenceValue,
  shownRowAction,
  sortRecords,
  todayNumber,
  type Aggregate,
  type Collection,
  type BlockOf,
  type Calendar,
  type OpenUse,
  type RecordLook,
  type RecordToolUse,
  isOpenUse,
  isRecordToolUse,
  type ComponentStyle,
  type DataRecord,
  type LinkedGroups,
  type Field,
  type FieldIssue,
  type FieldOf,
  type FieldType,
  type FieldValue,
  type Backdrop,
  minusValue,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useComputedRecords, useLinkResolver, useRecordActions, useRecords } from '../data/records';
import { useCalendar, useWorkspace } from '../workspace/context';
import { t } from '../i18n';
import { AttachmentThumb, AttachmentsInput, firstImage, useAssetIndex } from './Attachments';
import { onPicture } from './Backdrop';
import { openRow } from './open-row';
import { RowActionButton } from './RecordActions';
import { ScheduleInput } from './ScheduleInput';
import type { RenderEnv } from './components';
import { Icon, UiIcon } from './Icon';
import { ProgressBar, ProgressRing } from './Progress';
import { useTicker } from './ticker';
import { cardColors, type Palette } from './theme';
import { Button, Card } from './ui';

// 数据组件（docs/DATA_DESIGN.md）：记录列表、快速添加表单、统计。
// 记录只在本机读取和显示，从不进入配置，也从不发给 AI。

type FormValues = Record<string, unknown>;

/** 记录的值 → 表单里的值（数字在编辑时是文字）。 */
export function toFormValues(collection: Collection, record: DataRecord | null): FormValues {
  const values: FormValues = {};
  for (const field of collection.fields) {
    const v = record ? readValue(field, record.values[field.id]) : undefined;
    if (v === undefined) continue;
    const toForm = (FIELD_EDITORS[field.type] as FieldEditor).toForm;
    values[field.id] = toForm ? toForm(v) : v;
  }
  return values;
}

/**
 * 一键操作打开的新记录表单（D-338）：预设的值（createInput 的输入，JSON）换成表单的写法。
 * 读不出来的、字段已经不在的不填。
 */
export function prefillFormValues(collection: Collection, json: string): FormValues {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof input !== 'object' || input === null) return {};
  const values: FormValues = {};
  for (const field of collection.fields) {
    const v = readValue(field, (input as Record<string, unknown>)[field.id]);
    if (v === undefined) continue;
    const toForm = (FIELD_EDITORS[field.type] as FieldEditor).toForm;
    values[field.id] = toForm ? toForm(v) : v;
  }
  return values;
}

function issueText(locale: RenderEnv['locale'], issue: FieldIssue['code']): string {
  return t(
    locale,
    issue === 'required' ? 'fieldRequired' : issue === 'tooLong' ? 'fieldTooLong' : 'fieldInvalid',
  );
}

/** 单个字段的输入控件。 */
export function FieldInput({
  field,
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
  labeled = false,
  onSubmit,
  autoFocus,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean;
  testID: string;
  /** 外面已经有字段名的标签（完整编辑页）。 */
  labeled?: boolean;
  /** 快速添加（D-352）：单行文字框按键盘上的「完成 / 发送」就是添加。 */
  onSubmit?: (() => void) | undefined;
  /** 底部弹出的添加框打开时，第一个文字框直接弹出键盘（D-352）。 */
  autoFocus?: boolean | undefined;
}) {
  const input = [
    styles.input,
    palette.font('body', 16),
    {
      color: palette.text,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderRadius: palette.controlRadius,
    },
  ];
  const chip = (selected: boolean) => [
    styles.chip,
    {
      borderColor: selected ? palette.primary : palette.border,
      backgroundColor: selected ? palette.primaryTint : palette.surface,
    },
  ];
  const editor = FIELD_EDITORS[field.type] as FieldEditor;
  return editor.input({
    field,
    value,
    onChange,
    palette,
    locale,
    disabled,
    testID,
    labeled,
    input,
    chip,
    onSubmit,
    autoFocus,
  });
}

interface FieldInputContext<F extends Field> {
  field: F;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled: boolean | undefined;
  testID: string;
  /** 外面已经有字段名的标签；没有时控件自己写上字段名（时长）。 */
  labeled: boolean;
  /** 输入框的样式。 */
  input: StyleProp<TextStyle>;
  /** 选项小块的样式。 */
  chip: (selected: boolean) => StyleProp<ViewStyle>;
  onSubmit?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
}

/** 一种字段在记录表单里怎么填（字段的结构、读写和显示在 core 的 fields/<type>.ts）。 */
interface FieldEditor<F extends Field = Field> {
  /** 输入控件。按函数调用（不是 React 组件），要用 hook 的放进自己的组件里。没有控件时返回 null。 */
  input: (ctx: FieldInputContext<F>) => ReactNode;
  /** 记录里的值 → 表单里的值（数字在编辑时是文字）。 */
  toForm?: (value: FieldValue) => unknown;
  /** 标签和控件在同一行（勾选）。 */
  inline?: true;
  /** 不能填，显示算出来的值（公式，D-188）。 */
  computed?: true;
}

/** 文字、长文本、数字、金额：一个输入框。 */
function textBox<F extends Field>({
  field,
  value,
  onChange,
  palette,
  disabled,
  testID,
  input,
  onSubmit,
  autoFocus,
}: FieldInputContext<F>) {
  // 快速添加里的单行文字框：按键盘上的「完成」就添加（D-352），键盘不收起，接着写下一条。
  const submits = onSubmit !== undefined && field.type === 'text';
  return (
    <TextInput
      testID={testID}
      editable={!disabled}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      autoFocus={autoFocus === true && field.type === 'text'}
      {...(submits
        ? {
            returnKeyType: 'done' as const,
            onSubmitEditing: onSubmit,
            submitBehavior: 'submit' as const,
          }
        : {})}
      placeholder={field.type === 'money' ? `${field.name} (${field.currency})` : field.name}
      placeholderTextColor={palette.caption}
      multiline={field.type === 'note'}
      keyboardType={field.type === 'number' || field.type === 'money' ? 'decimal-pad' : 'default'}
      style={[input, field.type === 'note' && styles.note]}
    />
  );
}

/**
 * 日期：输入框加「今天」「明天」「昨天」；今天按一天从几点开始算（D-286）。框里也可以写「下周五」「Nov 5」
 * 「demain」，离开输入框时在本机换成日期（D-344）。
 */
function DateInput({
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
  input,
  chip,
}: FieldInputContext<FieldOf<'date'>>) {
  const cal = useCalendar();
  const today = todayNumber(new Date(), cal);
  const recognise = () => {
    if (typeof value !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return;
    const found = findDatePhrase(value, today, cal)?.value;
    if (found?.kind === 'date') onChange(found.date);
  };
  return (
    <View style={styles.dateRow}>
      <TextInput
        testID={testID}
        editable={!disabled}
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        onEndEditing={recognise}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={palette.caption}
        style={[input, styles.flex]}
      />
      {[
        [dateOfDayNumber(today), t(locale, 'today')],
        [dateOfDayNumber(today + 1), t(locale, 'scheduleTomorrow')],
        [dateOfDayNumber(today - 1), t(locale, 'yesterday')],
      ].map(([date, label]) => (
        <Pressable
          key={label}
          disabled={disabled}
          onPress={() => onChange(date)}
          style={chip(value === date)}>
          <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const FIELD_EDITORS: { [T in FieldType]: FieldEditor<FieldOf<T>> } = {
  text: { input: textBox },
  note: { input: textBox },
  number: { input: textBox, toForm: String },
  money: { input: textBox, toForm: String },
  date: { input: (ctx) => <DateInput {...ctx} /> },
  // D-279：几点几分，「现在」填上当前时间。
  time: {
    input: (ctx) => withNowChip(ctx, 'HH:MM', (now) => localDateTime(now).slice(11)),
  },
  // D-279：日期加时间，编辑时写成「2026-10-29 08:30」。
  datetime: {
    input: (ctx) =>
      withNowChip(ctx, 'YYYY-MM-DD HH:MM', (now) => localDateTime(now).replace('T', ' ')),
    toForm: (v) => String(v).replace('T', ' '),
  },
  // D-279：时长，小时和分钟两个框，表单里的值是「h:mm」（一边空着算 0）。
  duration: {
    input: (ctx) => <DurationInput {...ctx} />,
    toForm: (v) => formatDuration(v as number),
  },
  checkbox: {
    inline: true,
    input: ({ value, onChange, palette, disabled, testID }) => (
      <Switch
        testID={testID}
        disabled={disabled}
        value={value === true}
        onValueChange={onChange}
        trackColor={{ true: palette.primary, false: palette.border }}
        thumbColor="#FFFFFF"
      />
    ),
  },
  choice: {
    input: ({ field, value, onChange, palette, disabled, testID, chip }) => (
      <View style={styles.chips}>
        {field.options.map((o) => (
          <Pressable
            key={o.id}
            testID={`${testID}-${o.id}`}
            disabled={disabled}
            onPress={() => onChange(value === o.id ? '' : o.id)}
            style={chip(value === o.id)}>
            <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  },
  file: {
    input: ({ field, value, onChange, palette, locale, disabled, testID }) => (
      <AttachmentsInput
        field={field}
        value={value}
        onChange={onChange}
        palette={palette}
        locale={locale}
        disabled={disabled}
        testID={testID}
      />
    ),
  },
  // 公式不能填，由 FieldsForm 显示算出来的值（D-188）。
  formula: { computed: true, input: () => null },
  // 查找、汇总、上一条（D-287–D-289）也是算出来的：记录页显示存好的记录算出来的值。
  lookup: { computed: true, input: () => null },
  rollup: { computed: true, input: () => null },
  previous: { computed: true, input: () => null },
  link: {
    input: ({ field, value, onChange, palette, locale, disabled, testID }) => (
      <LinkInput
        field={field}
        value={value}
        onChange={onChange}
        palette={palette}
        locale={locale}
        disabled={disabled}
        testID={testID}
      />
    ),
  },
  // D-296：日程，先选重复方式再填数字或日子。
  schedule: {
    input: ({ field, value, onChange, palette, locale, disabled, testID }) => (
      <ScheduleInput
        field={field}
        value={value}
        onChange={onChange}
        palette={palette}
        locale={locale}
        disabled={disabled}
        testID={testID}
      />
    ),
  },
  rating: {
    input: ({ value, onChange, palette, disabled, testID }) => (
      <View style={styles.chips}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            testID={`${testID}-${n}`}
            disabled={disabled}
            hitSlop={4}
            onPress={() => onChange(value === n ? '' : n)}>
            <Text
              style={{
                fontSize: 26,
                color: typeof value === 'number' && n <= value ? palette.primary : palette.border,
              }}>
              ★
            </Text>
          </Pressable>
        ))}
      </View>
    ),
  },
};

/** 时间、日期时间：一个输入框，旁边的「现在」填上当前时间（D-279）。 */
function withNowChip<F extends Field>(
  { field, value, onChange, palette, locale, disabled, testID, input, chip }: FieldInputContext<F>,
  placeholder: string,
  nowValue: (now: Date) => string,
) {
  return (
    <View style={styles.dateRow}>
      <TextInput
        testID={testID}
        editable={!disabled}
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        // 快速添加表单里没有标签：占位文字写字段名和格式（和金额的「时薪 (CNY)」一样）。
        placeholder={`${field.name} (${placeholder})`}
        placeholderTextColor={palette.caption}
        keyboardType="numbers-and-punctuation"
        style={[input, styles.flex]}
      />
      <Pressable
        testID={`${testID}-now`}
        disabled={disabled}
        onPress={() => onChange(nowValue(new Date()))}
        style={chip(false)}>
        <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>
          {t(locale, 'now')}
        </Text>
      </Pressable>
    </View>
  );
}

/** 时长（D-279）：小时、分钟两个数字框，合起来是「h:mm」交给 core 校验（分钟要小于 60）。 */
function DurationInput({
  field,
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
  labeled,
  input,
}: FieldInputContext<Field>) {
  const [hours = '', minutes = ''] = typeof value === 'string' ? value.split(':') : [];
  const change = (h: string, m: string) => onChange(h === '' && m === '' ? '' : `${h}:${m}`);
  const box = (part: 'hours' | 'minutes') => (
    <View style={[styles.dateRow, styles.flex]}>
      <TextInput
        testID={`${testID}-${part}`}
        editable={!disabled}
        value={part === 'hours' ? hours : minutes}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '');
          if (part === 'hours') change(digits, minutes);
          else change(hours, digits.slice(0, 2));
        }}
        placeholder="0"
        placeholderTextColor={palette.caption}
        keyboardType="number-pad"
        accessibilityLabel={t(locale, part === 'hours' ? 'durationHours' : 'durationMinutes')}
        style={[input, styles.flex]}
      />
      <Text style={[palette.font('body', 15), { color: palette.muted }]}>
        {t(locale, part === 'hours' ? 'durationHours' : 'durationMinutes')}
      </Text>
    </View>
  );
  return (
    <View testID={testID} style={styles.dateRow}>
      {labeled ? null : (
        <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>{field.name}</Text>
      )}
      {box('hours')}
      {box('minutes')}
    </View>
  );
}

/** 选一条记录时最多列出几条（按最近修改排序，可以搜索）。 */
const LINK_LIST_LIMIT = 30;

/**
 * 引用字段（D-250）：显示选中的那条记录的标题；点开后列出被引用的表里的记录（可以搜索标题），点一条选它。
 * 被引用的记录删掉了显示「已删除的记录」，可以换一条或不选。
 */
function LinkInput({
  field,
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
}: {
  field: Extract<Field, { type: 'link' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean | undefined;
  testID: string;
}) {
  const target = useWorkspace((s) => s.config?.data.tables.find((c) => c.id === field.table));
  const records = useRecords(field.table);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (!target) return null;
  const chosen = typeof value === 'string' && value ? value : null;
  const chosenRecord = chosen ? records?.find((r) => r.id === chosen) : undefined;
  const shown = chosen
    ? chosenRecord
      ? linkTitle(chosenRecord, target, locale)
      : records === null
        ? ''
        : t(locale, 'linkDeleted')
    : t(locale, 'linkNone');
  const matches = (records ?? [])
    .map((r) => ({ r, title: linkTitle(r, target, locale) }))
    .filter(({ title }) => title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.r.updatedAt - a.r.updatedAt)
    .slice(0, LINK_LIST_LIMIT);
  const row = [styles.dateRow, styles.attachment];
  return (
    <View style={styles.fields}>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => setOpen(!open)}
        style={[
          styles.input,
          ...row,
          {
            borderColor: palette.border,
            borderRadius: palette.controlRadius,
            backgroundColor: palette.surface,
          },
        ]}>
        <Icon name="link" size={18} color={palette.secondary} />
        <Text
          numberOfLines={1}
          style={[
            styles.flex,
            palette.font('bodyMedium', 15),
            { color: chosen ? palette.text : palette.caption },
          ]}>
          {shown}
        </Text>
        <Text style={[palette.font('bodyBold', 13), { color: palette.primaryText }]}>
          {t(locale, 'linkChoose')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.fields}>
          {(records?.length ?? 0) > 8 ? (
            <TextInput
              testID={`${testID}-search`}
              value={query}
              onChangeText={setQuery}
              placeholder={t(locale, 'linkSearch')}
              placeholderTextColor={palette.caption}
              style={[
                styles.input,
                palette.font('body', 15),
                {
                  color: palette.text,
                  borderColor: palette.border,
                  borderRadius: palette.controlRadius,
                },
              ]}
            />
          ) : null}
          {records !== null && records.length === 0 ? (
            <Text style={[palette.font('body', 14), { color: palette.caption }]}>
              {t(locale, 'linkEmptyTable', { name: target.name })}
            </Text>
          ) : null}
          {matches.map(({ r, title }) => (
            <Pressable
              key={r.id}
              testID={`${testID}-option-${r.id}`}
              onPress={() => {
                onChange(r.id);
                setOpen(false);
              }}
              style={[
                styles.chip,
                { borderColor: palette.border },
                chosen === r.id && {
                  borderColor: palette.primary,
                  backgroundColor: palette.primaryTint,
                },
              ]}>
              <Text
                numberOfLines={1}
                style={[palette.font('bodyMedium', 14), { color: palette.text }]}>
                {title}
              </Text>
            </Pressable>
          ))}
          {chosen ? (
            <Pressable
              testID={`${testID}-clear`}
              onPress={() => {
                onChange('');
                setOpen(false);
              }}>
              <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                {t(locale, 'linkClear')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 一组字段的输入，带名称和错误提示。记录编辑页和 inline 表单共用。 */
export function FieldsForm({
  collection,
  fieldIds,
  values,
  onChange,
  issues,
  palette,
  locale,
  disabled,
  testPrefix,
  showLabels = true,
  related,
  onSubmit,
  autoFocus,
}: {
  collection: Collection;
  fieldIds: readonly string[];
  values: FormValues;
  onChange: (values: FormValues) => void;
  issues: FieldIssue[];
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean;
  testPrefix: string;
  showLabels?: boolean;
  /**
   * 记录页（D-291）：显示用的表和这条记录存好以后算出来的值（查找、汇总、上一条）；新记录是 null，
   * 这几种字段存了以后才有值。
   */
  related?: { view: Collection; record: DataRecord | null };
  /** 快速添加（D-352）：单行文字框按「完成」就添加。 */
  onSubmit?: (() => void) | undefined;
  /** 第一个文字框直接弹出键盘（底部弹出的添加框）。 */
  autoFocus?: boolean | undefined;
}) {
  const cal = useCalendar();
  const firstText = fieldIds.find(
    (id) => collection.fields.find((f) => f.id === id)?.type === 'text',
  );
  const view = related?.view ?? collection;
  // 公式按表单里现在的值算（D-188）；查找、汇总、上一条用存好的那条记录算出来的值。
  const computed = () => {
    const prepared = prepareRecordValues(collection, values, null, new Date(), cal);
    const saved = related?.record?.values ?? {};
    const derived = Object.fromEntries(
      collection.fields
        .filter((f) => !fieldDefinition(f.type).write && f.id in saved)
        .map((f) => [f.id, saved[f.id]]),
    );
    return {
      id: related?.record?.id ?? '',
      collectionId: collection.id,
      values: { ...derived, ...(prepared.ok ? prepared.values : {}) },
      createdAt: related?.record?.createdAt ?? 0,
      updatedAt: related?.record?.updatedAt ?? 0,
    };
  };
  return (
    <View style={styles.fields}>
      {fieldIds.map((id) => {
        const field = collection.fields.find((f) => f.id === id);
        if (!field) return null;
        const editor = FIELD_EDITORS[field.type] as FieldEditor;
        if (editor.computed) {
          const shown = formatValue(
            view.fields.find((f) => f.id === id) ?? field,
            recordValue(computed(), view, id, new Date(), cal),
            locale,
          );
          return (
            <View key={id} style={styles.field}>
              <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                {field.name}
              </Text>
              <Text
                testID={`${testPrefix}-${id}`}
                style={[palette.font('title', 16), { color: palette.text }]}>
                {shown || '—'}
              </Text>
            </View>
          );
        }
        const issue = issues.find((i) => i.fieldId === id);
        const inline = editor.inline === true;
        return (
          <View key={id} style={inline ? styles.inlineField : styles.field}>
            {showLabels || inline ? (
              <Text
                style={[
                  palette.font('bodyBold', 13),
                  { color: palette.muted },
                  inline && styles.flex,
                ]}>
                {field.name}
                {'required' in field && field.required ? ' *' : ''}
              </Text>
            ) : null}
            <FieldInput
              field={field}
              value={values[id]}
              onChange={(v) => onChange({ ...values, [id]: v })}
              palette={palette}
              locale={locale}
              disabled={disabled}
              testID={`${testPrefix}-${id}`}
              labeled={showLabels || inline}
              onSubmit={onSubmit}
              autoFocus={autoFocus === true && id === firstText}
            />
            {issue ? (
              <Text style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>
                {issueText(locale, issue.code)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function useCollection(env: RenderEnv, id: string): Collection | undefined {
  return env.config.data.tables.find((c) => c.id === id);
}

/**
 * 按引用字段分组（D-336）：被引用的那张表和它的记录。不是引用字段时 undefined，还没读完时 null。
 */
export function useLinkedGroups(
  env: RenderEnv,
  view: Collection | undefined,
  fieldId: string | undefined,
): LinkedGroups | null | undefined {
  const field = fieldId ? view?.fields.find((f) => f.id === fieldId) : undefined;
  const target =
    field?.type === 'link' ? env.config.data.tables.find((c) => c.id === field.table) : undefined;
  const { records } = useComputedRecords(env.config.data.tables, target, calendarOf(env.config));
  if (!target) return undefined;
  return records === null ? null : { collection: target, records, locale: env.locale };
}

/** 记录块（list cards checklist tiles board calendar）：source 读哪张表，show 每条的卡片，tools 每条上的工具。 */
export type RecordBlock = BlockOf<RecordLook>;

/** 每一段 / 每一天 / 每一栏下面的「添加」（as addHere，D-349）。 */
export const addHereOf = (block: RecordBlock) => block.tools?.find((u) => u.as === 'addHere');

/** 清单的勾（as check）：勾的是哪个勾选框字段。 */
export function checkOf(block: RecordBlock): { table: string; field: string } | undefined {
  const use = block.look === 'checklist' ? block.tools?.find((u) => u.as === 'check') : undefined;
  return use && isRecordToolUse(use) && use.do === 'toggle'
    ? { table: use.table, field: use.field }
    : undefined;
}

/** 这一条右边显示的按钮（第一个 when 满足的 button / tap）：一键记录工具或「打开」。 */
export function rowToolOf(
  block: RecordBlock,
  record: DataRecord,
  view: Collection,
  now: Date,
  cal: Calendar,
): RecordToolUse | OpenUse | undefined {
  const use = shownRowAction(block.tools, record, view, now, cal);
  return use && (isRecordToolUse(use) || isOpenUse(use)) ? use : undefined;
}

export type Tone = ComponentStyle['tone'];

/** 记录列表的 list / cards / checklist；月历（D-305）读法不同，是 MonthCalendar（registry 按 display 选）。 */
export function RecordList({
  block,
  env,
  tone,
}: {
  block: RecordBlock;
  env: RenderEnv;
  tone?: Tone;
}) {
  const { palette, locale } = env;
  const router = useRouter();
  const { collection, view, loaded, sorted } = useListRecords(block, env);
  const rows = useRecordRows(block, env, tone, collection, view);
  const group = block.source.group;
  const linked = useLinkedGroups(env, view, group?.by);
  const addHere = addHereOf(block) !== undefined;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (!collection || !view || !rows) return null;
  const add = (preset?: Record<string, unknown>) =>
    env.interactive
      ? (env.locked ?? (() => openAddHere(router, collection, view, block.source, preset)))
      : undefined;
  // D-347：分段。引用字段要等被引用的表读出来（linked 是 null 时还在读）。
  const groupBy = group?.by;
  if (group && groupBy && linked !== null) {
    const groups = listGroups(sorted, view, group, {
      locale,
      now: new Date(),
      cal: calendarOf(env.config),
      linked: linked ?? undefined,
    });
    if (loaded && groups.length === 0)
      return <Empty block={block} env={env} rows={rows} addHere={addHere} />;
    return (
      <View style={{ gap: palette.gap - 4 }}>
        {groups.map((g) => {
          const closed = collapsed.has(g.key);
          const toggle = () =>
            setCollapsed((s) => {
              const next = new Set(s);
              if (closed) next.delete(g.key);
              else next.add(g.key);
              return next;
            });
          return (
            <View key={g.key} style={{ gap: 6 }}>
              <View style={styles.groupHeader}>
                <Pressable
                  testID={`group-${g.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !closed }}
                  accessibilityLabel={`${g.label} ${g.records.length}`}
                  onPress={toggle}
                  onLongPress={env.onLongPress}
                  style={styles.groupTitle}>
                  <UiIcon
                    name={closed ? 'chevronRight' : 'chevronDown'}
                    size={14}
                    color={palette.muted}
                  />
                  <Text
                    style={[palette.font('bodyBold', 15), { color: palette.text }]}
                    numberOfLines={1}>
                    {g.label}
                  </Text>
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.caption }]}>
                    {g.records.length}
                  </Text>
                </Pressable>
                {addHere && g.key !== 'overdue' ? (
                  <Pressable
                    testID={`group-add-${g.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={t(locale, 'groupAdd', { group: g.label })}
                    onPress={add(g.preset === undefined ? {} : { [groupBy]: g.preset })}
                    hitSlop={8}
                    style={styles.groupAdd}>
                    <UiIcon name="add" size={18} color={palette.primaryText} />
                  </Pressable>
                ) : null}
              </View>
              {closed || g.records.length === 0
                ? null
                : rows.list(g.records.slice(0, block.source.limit))}
            </View>
          );
        })}
      </View>
    );
  }
  const shown = sorted.slice(0, block.source.limit);
  if (loaded && shown.length === 0)
    return <Empty block={block} env={env} rows={rows} addHere={addHere} add={add()} />;
  return addHere ? (
    <View style={{ gap: 6 }}>
      {rows.list(shown)}
      <AddHere label={t(locale, 'entryFormAdd')} onPress={add()} palette={palette} />
    </View>
  ) : (
    rows.list(shown)
  );
}

function Empty({
  block,
  env,
  rows,
  addHere,
  add,
}: {
  block: RecordBlock;
  env: RenderEnv;
  rows: { background: string };
  addHere: boolean;
  add?: (() => void) | undefined;
}) {
  const { palette, locale } = env;
  return (
    <Card palette={palette} background={rows.background}>
      <Text style={[palette.font('body', 14), { color: palette.caption }]}>
        {block.show.emptyText ?? t(locale, 'noRecords')}
      </Text>
      {addHere ? (
        <AddHere label={t(locale, 'entryFormAdd')} onPress={add} palette={palette} />
      ) : null}
    </Card>
  );
}

/** 列表、月历当天下面的「+ 添加」（D-349）。 */
export function AddHere({
  label,
  onPress,
  palette,
  testID = 'list-add-here',
}: {
  label: string;
  onPress: (() => void) | undefined;
  palette: Palette;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={styles.addHere}>
      <UiIcon name="add" size={18} color={palette.primaryText} />
      <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * 就地添加（D-349）：打开新记录的表单，预设列表筛选里的「等于」条件（给一条记录用的页面上已经换成这条，
 * D-342）和这一段、这一天的值。用户补完再保存。
 */
export function openAddHere(
  router: ReturnType<typeof useRouter>,
  collection: Collection,
  view: Collection,
  source: Pick<RecordBlock['source'], 'filter'>,
  preset: Record<string, unknown> = {},
) {
  const prefill = { ...filterPresets(view, source.filter), ...preset };
  router.push({
    pathname: '/record/[collectionId]',
    params: { collectionId: collection.id, prefill: JSON.stringify(prefill) },
  });
}

/** 记录列表要显示的记录：筛选、排好序，还没截到 limit 条（看板按栏截，D-313）。 */
export function useListRecords(block: RecordBlock, env: RenderEnv) {
  const collection = useCollection(env, block.source.table);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）：显示、筛选、排序用算好的记录和 view；改记录用原来的表。
  const { view, records } = useComputedRecords(env.config.data.tables, collection, cal);
  const now = new Date();
  const sorted = view
    ? sortRecords(
        filterRecords(records ?? [], view, block.source.filter, now, cal),
        view,
        block.source.sort,
        now,
        cal,
      )
    : [];
  return { collection, view, loaded: records !== null, sorted };
}

/**
 * 记录列表一行的画法（普通列表和月历当天的列表共用）：标题、副标题、右侧字段（带 trailingFormat，D-306）、
 * 打勾框和缩略图；点一下打开编辑页。
 */
export function useRecordRows(
  block: RecordBlock,
  env: RenderEnv,
  tone: Tone | undefined,
  collection: Collection | undefined,
  view: Collection | undefined,
) {
  const { palette, locale } = env;
  const background = cardColors(palette, tone).background;
  const router = useRouter();
  const actions = useRecordActions();
  const links = useLinkResolver(view);
  // 有附件字段的表：每条记录显示附件里第一张图片的缩略图（D-263，自动判断，组件不用设置）。
  const assetIndex = useAssetIndex();
  if (!collection || !view) return null;
  const cal = calendarOf(env.config);
  const hasFiles = collection.fields.some((f) => f.type === 'file');
  // 勾的写在工具自己的表（关系规则 12），通常就是列表这张表。
  const toggle = (c: { table: string; field: string }, r: DataRecord, next: boolean) => {
    const table = env.config.data.tables.find((x) => x.id === c.table);
    if (table) void actions.update(table, r, { [c.field]: next });
  };
  const cards = block.look === 'cards';
  const { show } = block;
  const check = checkOf(block);
  const now = new Date();

  const row = (r: DataRecord, index: number) => {
    const title = formatRef(r, view, show.title, locale, links, now, cal) || '—';
    const subtitle = (show.subtitles ?? [])
      .map((f) => formatRef(r, view, f, locale, links, now, cal))
      .filter(Boolean)
      .join(' · ');
    const checked = check ? r.values[check.field] === true : false;
    const thumb = hasFiles && assetIndex ? firstImage(r, collection, assetIndex) : null;
    // 一键记录工具（D-300）：第一个条件满足的按钮。
    const rowAction = rowToolOf(block, r, view, now, cal);
    const body = (
      <View style={styles.row}>
        {check ? (
          <Pressable
            testID={`check-${r.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            disabled={!env.interactive}
            hitSlop={8}
            onPress={env.locked ?? (() => void toggle(check, r, !checked))}
            onLongPress={env.onLongPress}
            style={[
              styles.check,
              {
                borderColor: checked ? palette.primary : palette.border,
                backgroundColor: checked ? palette.primary : palette.surface,
              },
            ]}>
            {checked ? <Icon name="check" size={16} color={palette.onPrimary} /> : null}
          </Pressable>
        ) : null}
        {thumb ? (
          <AttachmentThumb
            asset={thumb}
            size={cards ? 56 : 44}
            radius={Math.min(palette.controlRadius, 10)}
            testID={`record-thumb-${r.id}`}
          />
        ) : null}
        <View style={styles.flex}>
          <Text
            numberOfLines={cards ? 2 : 1}
            style={[
              palette.font('title', 15),
              { color: checked ? palette.caption : palette.text },
              checked && styles.done,
            ]}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={cards ? 3 : 1}
              style={[palette.font('body', 13), { color: palette.muted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {show.trailing ? (
          <Trailing
            record={r}
            view={view}
            show={show}
            env={env}
            text={formatRef(r, view, show.trailing, locale, links, now, cal)}
          />
        ) : null}
        {rowAction ? (
          <RowActionButton action={rowAction} record={r} env={env} palette={palette} />
        ) : null}
      </View>
    );
    const open = env.interactive
      ? (env.locked ?? (() => openRow(router, block.opens, collection.id, r.id)))
      : undefined;
    if (cards) {
      return (
        <Card
          key={r.id}
          palette={palette}
          background={background}
          onPress={open}
          onLongPress={env.onLongPress}
          testID={`record-${r.id}`}>
          {body}
        </Card>
      );
    }
    return (
      <Pressable
        key={r.id}
        testID={`record-${r.id}`}
        onPress={open}
        onLongPress={env.onLongPress}
        disabled={!open}
        style={[
          styles.listRow,
          index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
        ]}>
        {body}
      </Pressable>
    );
  };

  const list = (shown: DataRecord[]) =>
    cards ? (
      <View style={{ gap: palette.gap - 4 }}>{shown.map(row)}</View>
    ) : (
      <Card palette={palette} background={background} style={styles.listCard}>
        {shown.map(row)}
      </Card>
    );
  return { row, list, background };
}

/**
 * 右侧字段：没有 trailingFormat 时是它的显示文字；elapsed 是开始到结束（或到现在，每秒在走）的时长；
 * progress 是「值 / 目标」和一个小进度环或进度条（没有值或目标时照常显示文字）。
 */
export function Trailing({
  record,
  view,
  show,
  env,
  text,
}: {
  record: DataRecord;
  view: Collection;
  show: RecordBlock['show'];
  env: RenderEnv;
  text: string;
}) {
  const { palette, locale } = env;
  const format = show.format;
  const style = [palette.font('title', 15), { color: palette.text }];
  const elapsedFormat = format?.kind === 'elapsed' ? format : undefined;
  const first = elapsedFormat
    ? elapsedOf(record, view, show.trailing!, elapsedFormat.until, new Date())
    : undefined;
  const now = useTicker(first?.running === true);
  if (elapsedFormat) {
    const e = elapsedOf(record, view, show.trailing!, elapsedFormat.until, now);
    if (!e) return null;
    const time = formatElapsed(e);
    return (
      <Text
        testID={`elapsed-${record.id}`}
        accessibilityLabel={e.running ? t(locale, 'elapsedRunning', { time }) : undefined}
        style={[style, styles.tabular, e.running && { color: palette.primaryText }]}>
        {time}
      </Text>
    );
  }
  if (format?.kind === 'progress') {
    const cal = calendarOf(env.config);
    const progress = recordProgress(record, view, show.trailing!, format.goal, now, cal);
    if (progress) {
      const field = view.fields.find((f) => f.id === show.trailing);
      const label = t(locale, 'progressOfGoal', {
        value: amountText(progress.value, field, locale),
        goal: amountText(progress.goal, field, locale),
      });
      const testID = `progress-ring-${record.id}`;
      return format.style === 'bar' ? (
        <View style={styles.progressBar}>
          <Text style={[style, styles.tabular]}>{label}</Text>
          <ProgressBar ratio={progress.ratio} palette={palette} testID={testID} />
        </View>
      ) : (
        <View style={styles.progressRow}>
          <Text style={[style, styles.tabular]}>{label}</Text>
          <ProgressRing
            ratio={progress.ratio}
            size={28}
            stroke={4}
            palette={palette}
            testID={testID}
          />
        </View>
      );
    }
  }
  return text ? <Text style={style}>{text}</Text> : null;
}

/** 表单的提交工具：{as: "submit", do: "create", table, ask: [字段], values?, smartDate?}。 */
type SubmitTool = Extract<RecordToolUse, { do: 'create' }>;

/**
 * 表单（原 recordForm 的 inline / sheet）：问 ask 里的字段，提交 = 按 tools[0] 新建一条。
 * 按钮模式（打开完整表单）是 button 块（RecordActions.tsx 的 ActionButton）。
 */
export function RecordForm({
  block,
  env,
  tone,
}: {
  block: BlockOf<'form'>;
  env: RenderEnv;
  tone?: Tone;
}) {
  const { palette, locale } = env;
  const componentId = block.id;
  const use = block.tools[0];
  const submitTool = isRecordToolUse(use) && use.do === 'create' ? (use as SubmitTool) : undefined;
  const fieldIds = Array.isArray(submitTool?.ask) ? submitTool.ask : [];
  const submitLabel = submitTool?.label ?? t(locale, 'entryFormAdd');
  const collection = useCollection(env, submitTool?.table ?? '');
  const actions = useRecordActions();
  const [values, setValues] = useState<FormValues>({});
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const cal = useCalendar();
  // D-344：在本机认出文字里的日期；用户点掉后，这段文字不再认（改了文字再认）。
  const [dismissed, setDismissed] = useState<string | null>(null);
  // D-352：底部弹出的添加框开着没有。
  const [open, setOpen] = useState(false);
  if (!collection) return null;
  const smart = submitTool?.smartDate;
  const smartField = smart ? collection.fields.find((f) => f.id === smart.to) : undefined;
  const typed = smart ? values[smart.from] : undefined;
  const userSet = smart ? values[smart.to] !== undefined && values[smart.to] !== '' : false;
  const found =
    smart && smartField && typeof typed === 'string' && typed !== dismissed && !userSet
      ? smartDateOf(typed, smartField, todayNumber(new Date(), cal), locale, cal)
      : undefined;

  async function submit() {
    if (!collection || !env.interactive) return;
    if (env.locked) return env.locked();
    // D-343：不显示的预设值（"$record" 在画之前已经换成这条记录）；D-344：认出来的日期填进去，文字里去掉。
    const preset = createInput(collection, submitTool?.values, { now: new Date(), cal });
    const recognised =
      found && smart
        ? {
            [smart.from]: withoutPhrase(typed as string, found.phrase) || (typed as string),
            [smart.to]: found.input,
          }
        : {};
    const result = await actions.add(collection, { ...preset, ...values, ...recognised });
    if (result.ok) {
      setValues({});
      setIssues([]);
      setMessage(null);
      setDismissed(null);
    } else if ('full' in result) {
      setMessage(t(locale, 'tableFull'));
    } else {
      setIssues(result.issues.filter((i) => fieldIds.includes(i.fieldId)));
      // 不在这个表单里的必填字段：提示用完整表单添加。
      if (result.issues.some((i) => !fieldIds.includes(i.fieldId))) {
        setMessage(t(locale, 'useFullForm'));
      }
    }
  }

  const sheet = block.show.mode === 'sheet';
  const body = (
    <>
      <FieldsForm
        collection={collection}
        fieldIds={fieldIds}
        values={values}
        onChange={setValues}
        issues={issues}
        palette={palette}
        locale={locale}
        disabled={!env.interactive}
        testPrefix={`form-${componentId}`}
        showLabels={false}
        onSubmit={() => void submit()}
        autoFocus={sheet}
      />
      {found ? (
        <View style={styles.smartDate} testID={`form-${componentId}-smart`}>
          <Icon name="calendar" size={16} color={palette.primaryText} />
          <Text style={[palette.font('bodyMedium', 13), styles.flex, { color: palette.text }]}>
            {t(locale, 'smartDateFound', {
              text: (typed as string).slice(found.phrase.start, found.phrase.end),
              value: found.preview,
            })}
          </Text>
          <Pressable
            testID={`form-${componentId}-smart-dismiss`}
            accessibilityRole="button"
            accessibilityLabel={t(locale, 'smartDateDismiss')}
            hitSlop={12}
            onPress={() => setDismissed(typed as string)}
            style={styles.smartDismiss}>
            <UiIcon name="close" size={16} color={palette.muted} />
          </Pressable>
        </View>
      ) : null}
      {message ? (
        <Text style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>{message}</Text>
      ) : null}
      <Button
        palette={palette}
        testID={`form-${componentId}-submit`}
        label={submitLabel}
        onPress={() => void submit()}
        onLongPress={env.onLongPress}
        disabled={!env.interactive}
      />
    </>
  );
  if (!sheet) {
    return (
      <Card palette={palette} background={cardColors(palette, tone).background}>
        {body}
      </Card>
    );
  }
  // D-352：右下角一个圆形的「+」（页面把它放在滚动内容外面，PageView），点了从底部弹出添加框；
  // 添加以后框留着、文字清空，可以接着写下一条，点外面或「关闭」收起。
  return (
    <>
      <Pressable
        testID={`form-${componentId}`}
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        onPress={env.interactive ? (env.locked ?? (() => setOpen(true))) : undefined}
        onLongPress={env.onLongPress}
        style={[styles.fab, { backgroundColor: palette.primary }]}>
        <UiIcon name="add" size={28} color={palette.onPrimary} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.sheetRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            testID={`form-${componentId}-backdrop`}
            accessibilityRole="button"
            accessibilityLabel={t(locale, 'close')}
            style={styles.sheetBackdrop}
            onPress={() => setOpen(false)}
          />
          <View
            testID={`form-${componentId}-sheet`}
            style={[
              styles.sheet,
              {
                backgroundColor: palette.surface,
                borderTopLeftRadius: palette.radius,
                borderTopRightRadius: palette.radius,
                padding: palette.pad,
                gap: palette.gap - 4,
              },
            ]}>
            {body}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

type NumberSource = BlockOf<'number'>['source'];

/** 统计值的显示：金额按币种、数字按单位和小数位，按日子算的带「天」「周」，计数和其他字段只显示数字。 */
export function statText(
  value: number | null,
  aggregate: NumberSource['aggregate'],
  field: Field | undefined,
  locale: RenderEnv['locale'],
  unit?: NonNullable<NumberSource['days']>['unit'],
): string {
  if (isSequenceAggregate(aggregate)) return sequenceText(aggregate, unit, value, locale);
  if (value === null) return '—';
  return amountText(value, aggregate === 'count' ? undefined : field, locale);
}

/** 一个数按字段的写法显示（金额带货币、数字带单位，字段定义的 formatAmount）；没有字段时只是数字。 */
export function amountText(value: number, field: Field | undefined, locale: RenderEnv['locale']) {
  const amount = field && fieldDefinition(field.type).formatAmount;
  return amount ? amount(field, value, locale) : formatNumber(value, undefined, locale);
}

export function Stat({
  block,
  env,
  tone,
  backdrop,
}: {
  block: BlockOf<'number'>;
  env: RenderEnv;
  tone?: Tone;
  backdrop?: Backdrop | undefined;
}) {
  const palette = onPicture(env.palette, backdrop);
  const src = block.source;
  const label = block.show.label;
  const table = useCollection(env, src.table);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）按算好的值统计。
  const { view: collection, records } = useComputedRecords(env.config.data.tables, table, cal);
  // 按引用字段分组（D-336）要被引用的表的记录；减去另一个合计（D-337）要那张表的记录。
  const linked = useLinkedGroups(env, collection, src.group?.by);
  const minus = useComputedRecords(
    env.config.data.tables,
    env.config.data.tables.find((c) => c.id === src.minus?.table),
    cal,
  );
  if (!collection) return null;
  const now = new Date();
  const matched = filterRecords(records ?? [], collection, src.filter, now, cal);
  // 按顺序的聚合（D-284）：日期默认用表里第一个日期字段，没有就用创建时间（和图表一样）。
  const aggregate = src.aggregate;
  const valueOf = (list: DataRecord[]) =>
    isSequenceAggregate(aggregate)
      ? sequenceValue(list, collection, aggregate, src.days, now, cal)
      : { value: aggregateRecords(list, collection, aggregate as Aggregate, src.field) };
  // 还没读完被减的那张表时先不显示数（和自己的表没读完一样）。
  const loading = records === null || (src.minus !== undefined && minus.records === null);
  const minusOf = (value: number | null) =>
    src.minus && minus.view && minus.records
      ? minusValue(value, src.minus, minus.view, minus.records, now, cal)
      : value;
  const text = (v: { value: number | null }) =>
    statText(v.value, aggregate, field, env.locale, src.days?.unit);
  const bestText = (v: { best?: number }) =>
    v.best === undefined
      ? null
      : t(env.locale, 'seqBest', {
          value: statText(v.best, aggregate, field, env.locale, src.days?.unit),
        });
  const field = src.field ? collection.fields.find((f) => f.id === src.field) : undefined;
  // 目标（D-307）：「值 / 目标」和进度。
  const goalProgress = (v: { value: number | null }) => {
    const p = src.goal === undefined ? undefined : progressOf(v.value ?? 0, src.goal);
    return (
      p && {
        ratio: p.ratio,
        label: t(env.locale, 'progressOfGoal', { value: text(v), goal: text({ value: p.goal }) }),
      }
    );
  };
  // 和上一段同期比（D-308）：把筛选里的时间段换成上一段，再算一次；颜色不分好坏（多花钱和多运动方向相反）。
  const previous = src.compare ? previousFilter(src.filter, now, cal) : null;
  const compareText = (current: number | null) => {
    if (!previous) return null;
    const before = valueOf(filterRecords(records ?? [], collection, previous.filter, now, cal));
    const label = previousLabel(previous.period, text(before), env.locale);
    const changeText = changeLabel(compareChange(current, before.value), env.locale);
    return (
      <View style={styles.compareRow} testID={`stat-compare-${src.table}-${label}`}>
        <Text style={[styles.flex, palette.font('body', 13), { color: palette.muted }]}>
          {label}
        </Text>
        {changeText ? (
          <Text style={[palette.font('bodyBold', 13), { color: palette.text }]}>{changeText}</Text>
        ) : null}
      </View>
    );
  };
  const background = tone ? cardColors(palette, tone).background : palette.primaryTint;
  const heading = (
    <Text
      style={[palette.font('bodyBold', 12), { color: palette.primaryText, letterSpacing: 0.5 }]}>
      {label.toUpperCase()}
    </Text>
  );
  // D-248：按单选字段分组，每个选项一行。
  const groupBy = src.group?.by;
  if (groupBy) {
    const noChoice = t(env.locale, 'statNoChoice');
    const groups =
      records === null || linked === null
        ? []
        : groupRecords(matched, collection, groupBy, noChoice, linked);
    // 和上一段比（D-308）：每个选项和它自己的上一段比。
    const before =
      previous && records !== null
        ? new Map(
            groupRecords(
              filterRecords(records, collection, previous.filter, now, cal),
              collection,
              groupBy,
              noChoice,
              linked ?? undefined,
            ).map((g) => [g.optionId, valueOf(g.records).value]),
          )
        : null;
    return (
      <Card palette={palette} background={background} backdrop={backdrop} style={styles.fillCard}>
        {heading}
        {groups.map((g) => {
          const v = valueOf(g.records);
          const best = bestText(v);
          return (
            <View key={g.optionId ?? '-'} style={styles.row}>
              <Text
                numberOfLines={1}
                style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
                {g.label}
              </Text>
              <View style={styles.statValue}>
                <Text
                  testID={`stat-group-${src.table}-${g.optionId ?? 'none'}`}
                  style={[palette.font('title', 16), { color: palette.text }]}>
                  {goalProgress(v)?.label ?? text(v)}
                </Text>
                {best ? (
                  <Text style={[palette.font('body', 12), { color: palette.muted }]}>{best}</Text>
                ) : null}
                {goalProgress(v) ? (
                  <View style={styles.groupBar}>
                    <ProgressBar ratio={goalProgress(v)!.ratio} palette={palette} />
                  </View>
                ) : null}
                {before ? (
                  <Text style={[palette.font('bodyBold', 12), { color: palette.muted }]}>
                    {changeLabel(
                      compareChange(v.value, before.get(g.optionId) ?? null),
                      env.locale,
                    )}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>
    );
  }
  const own = loading ? { value: null } : valueOf(matched);
  const v = src.minus ? { value: minusOf(own.value) } : own;
  const best = loading ? null : bestText(v);
  const progress = goalProgress(v);
  const compareLine = loading ? null : compareText(v.value);
  return (
    <Card palette={palette} background={background} backdrop={backdrop} style={styles.fillCard}>
      {heading}
      <View style={styles.row}>
        <Text
          testID={`stat-value-${src.table}-${label}`}
          style={[styles.flex, palette.font('display', 26), { color: palette.text }]}>
          {progress ? progress.label : text(v)}
        </Text>
        {progress ? (
          <View style={styles.statRing}>
            <ProgressRing
              ratio={progress.ratio}
              size={56}
              stroke={6}
              palette={palette}
              testID={`stat-ring-${src.table}-${label}`}
            />
            <Text style={[styles.ringLabel, palette.font('bodyBold', 12), { color: palette.text }]}>
              {t(env.locale, 'progressPercent', { n: Math.round(progress.ratio * 100) })}
            </Text>
          </View>
        ) : null}
      </View>
      {best ? (
        <Text
          testID={`stat-best-${src.table}-${label}`}
          style={[palette.font('body', 13), { color: palette.muted }]}>
          {best}
        </Text>
      ) : null}
      {compareLine}
    </Card>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  note: { minHeight: 110, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smartDate: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { paddingBottom: 28 },
  groupTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  groupAdd: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addHere: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
  },
  smartDismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
  },
  fields: { gap: 12 },
  field: { gap: 6 },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statValue: { alignItems: 'flex-end' },
  listCard: { paddingVertical: 4, gap: 0 },
  listRow: { paddingVertical: 12 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { textDecorationLine: 'line-through' },
  fillCard: { flexGrow: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBar: { alignItems: 'flex-end', gap: 4, minWidth: 72 },
  statRing: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { position: 'absolute' },
  groupBar: { width: 72, marginTop: 4 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
