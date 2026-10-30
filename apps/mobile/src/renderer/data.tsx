import {
  aggregateRecords,
  calendarOf,
  dateOfDayNumber,
  filterRecords,
  fieldDefinition,
  formatDuration,
  formatNumber,
  formatRef,
  formatValue,
  chartDateField,
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
  type Component,
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
import { RowActionButton } from './RecordActions';
import { ScheduleInput } from './ScheduleInput';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
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
 * 一键操作打开的新记录表单（D-328）：预设的值（createInput 的输入，JSON）换成表单的写法。
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
}: FieldInputContext<F>) {
  return (
    <TextInput
      testID={testID}
      editable={!disabled}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      placeholder={field.type === 'money' ? `${field.name} (${field.currency})` : field.name}
      placeholderTextColor={palette.caption}
      multiline={field.type === 'note'}
      keyboardType={field.type === 'number' || field.type === 'money' ? 'decimal-pad' : 'default'}
      style={[input, field.type === 'note' && styles.note]}
    />
  );
}

/** 日期：输入框加「今天」「昨天」；今天按一天从几点开始算（D-286）。 */
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
  const today = todayNumber(new Date(), useCalendar());
  return (
    <View style={styles.dateRow}>
      <TextInput
        testID={testID}
        editable={!disabled}
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={palette.caption}
        style={[input, styles.flex]}
      />
      {[
        [dateOfDayNumber(today), t(locale, 'today')],
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
  const target = useWorkspace((s) =>
    s.config?.collections.find((c) => c.id === field.collectionId),
  );
  const records = useRecords(field.collectionId);
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
}) {
  const cal = useCalendar();
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
  return env.config.collections.find((c) => c.id === id);
}

/**
 * 按引用字段分组（D-326）：被引用的那张表和它的记录。不是引用字段时 undefined，还没读完时 null。
 */
export function useLinkedGroups(
  env: RenderEnv,
  view: Collection | undefined,
  fieldId: string | undefined,
): LinkedGroups | null | undefined {
  const field = fieldId ? view?.fields.find((f) => f.id === fieldId) : undefined;
  const target =
    field?.type === 'link'
      ? env.config.collections.find((c) => c.id === field.collectionId)
      : undefined;
  const { records } = useComputedRecords(env.config.collections, target, calendarOf(env.config));
  if (!target) return undefined;
  return records === null ? null : { collection: target, records, locale: env.locale };
}

export function openEditor(
  router: ReturnType<typeof useRouter>,
  collectionId: string,
  recordId?: string,
) {
  router.push({
    pathname: '/record/[collectionId]',
    params: recordId ? { collectionId, recordId } : { collectionId },
  });
}

export type RecordListProps = Extract<Component, { type: 'recordList' }>['props'];

export type Tone = ComponentStyle['tone'];

/** 记录列表的 list / cards / checklist；月历（D-305）读法不同，是 MonthCalendar（registry 按 display 选）。 */
export function RecordList({
  props,
  env,
  tone,
}: {
  props: RecordListProps;
  env: RenderEnv;
  tone?: Tone;
}) {
  const { palette, locale } = env;
  const { collection, view, loaded, sorted } = useListRecords(props, env);
  const rows = useRecordRows(props, env, tone, collection, view);
  if (!collection || !view || !rows) return null;
  const shown = sorted.slice(0, props.limit);

  if (loaded && shown.length === 0) {
    return (
      <Card palette={palette} background={rows.background}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {props.emptyText ?? t(locale, 'noRecords')}
        </Text>
      </Card>
    );
  }
  return rows.list(shown);
}

/** 记录列表要显示的记录：筛选、排好序，还没截到 limit 条（看板按栏截，D-313）。 */
export function useListRecords(props: RecordListProps, env: RenderEnv) {
  const collection = useCollection(env, props.collectionId);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）：显示、筛选、排序用算好的记录和 view；改记录用原来的表。
  const { view, records } = useComputedRecords(env.config.collections, collection, cal);
  const now = new Date();
  const sorted = view
    ? sortRecords(
        filterRecords(records ?? [], view, props.filter, now, cal),
        view,
        props.sort,
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
  props: RecordListProps,
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
  const cards = props.display === 'cards';
  const now = new Date();

  const row = (r: DataRecord, index: number) => {
    const title = formatRef(r, view, props.titleField, locale, links, now, cal) || '—';
    const subtitle = (props.subtitleFields ?? [])
      .map((f) => formatRef(r, view, f, locale, links, now, cal))
      .filter(Boolean)
      .join(' · ');
    const checked = props.checkField ? r.values[props.checkField] === true : false;
    const thumb = hasFiles && assetIndex ? firstImage(r, collection, assetIndex) : null;
    // 一键操作（D-300）：第一个条件满足的按钮。
    const rowAction = shownRowAction(props.rowActions, r, view, now, cal);
    const body = (
      <View style={styles.row}>
        {props.display === 'checklist' && props.checkField ? (
          <Pressable
            testID={`check-${r.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            disabled={!env.interactive}
            hitSlop={8}
            onPress={
              env.locked ??
              (() => void actions.update(collection, r, { [props.checkField!]: !checked }))
            }
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
        {props.trailingField ? (
          <Trailing
            record={r}
            view={view}
            props={props}
            env={env}
            text={formatRef(r, view, props.trailingField, locale, links, now, cal)}
          />
        ) : null}
        {rowAction ? (
          <RowActionButton
            action={rowAction}
            record={r}
            collection={collection}
            env={env}
            palette={palette}
          />
        ) : null}
      </View>
    );
    const open = env.interactive
      ? (env.locked ?? (() => openEditor(router, collection.id, r.id)))
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
  props,
  env,
  text,
}: {
  record: DataRecord;
  view: Collection;
  props: RecordListProps;
  env: RenderEnv;
  text: string;
}) {
  const { palette, locale } = env;
  const format = props.trailingFormat;
  const style = [palette.font('title', 15), { color: palette.text }];
  const elapsedFormat = format?.kind === 'elapsed' ? format : undefined;
  const first = elapsedFormat
    ? elapsedOf(record, view, props.trailingField!, elapsedFormat.until, new Date())
    : undefined;
  const now = useTicker(first?.running === true);
  if (elapsedFormat) {
    const e = elapsedOf(record, view, props.trailingField!, elapsedFormat.until, now);
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
    const progress = recordProgress(record, view, props.trailingField!, format.goal, now, cal);
    if (progress) {
      const field = view.fields.find((f) => f.id === props.trailingField);
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

type RecordFormProps = Extract<Component, { type: 'recordForm' }>['props'];

export function RecordForm({
  props,
  env,
  componentId,
  tone,
}: {
  props: RecordFormProps;
  env: RenderEnv;
  componentId: string;
  tone?: Tone;
}) {
  const { palette, locale } = env;
  const router = useRouter();
  const collection = useCollection(env, props.collectionId);
  const actions = useRecordActions();
  const [values, setValues] = useState<FormValues>({});
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  if (!collection) return null;

  if (props.mode === 'button') {
    return (
      <Button
        palette={palette}
        testID={`form-${componentId}`}
        label={props.submitLabel}
        onPress={
          env.interactive ? (env.locked ?? (() => openEditor(router, collection.id))) : undefined
        }
        onLongPress={env.onLongPress}
      />
    );
  }

  async function submit() {
    if (!collection || !env.interactive) return;
    if (env.locked) return env.locked();
    const result = await actions.add(collection, values);
    if (result.ok) {
      setValues({});
      setIssues([]);
      setMessage(null);
    } else if ('full' in result) {
      setMessage(t(locale, 'tableFull'));
    } else {
      setIssues(result.issues.filter((i) => props.fieldIds.includes(i.fieldId)));
      // 不在这个表单里的必填字段：提示用完整表单添加。
      if (result.issues.some((i) => !props.fieldIds.includes(i.fieldId))) {
        setMessage(t(locale, 'useFullForm'));
      }
    }
  }

  return (
    <Card palette={palette} background={cardColors(palette, tone).background}>
      <FieldsForm
        collection={collection}
        fieldIds={props.fieldIds}
        values={values}
        onChange={setValues}
        issues={issues}
        palette={palette}
        locale={locale}
        disabled={!env.interactive}
        testPrefix={`form-${componentId}`}
        showLabels={false}
      />
      {message ? (
        <Text style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>{message}</Text>
      ) : null}
      <Button
        palette={palette}
        testID={`form-${componentId}-submit`}
        label={props.submitLabel}
        onPress={() => void submit()}
        onLongPress={env.onLongPress}
        disabled={!env.interactive}
      />
    </Card>
  );
}

type StatProps = Extract<Component, { type: 'stat' }>['props'];

/** 统计值的显示：金额按币种、数字按单位和小数位，按日子算的带「天」「周」，计数和其他字段只显示数字。 */
export function statText(
  value: number | null,
  aggregate: StatProps['aggregate'],
  field: Field | undefined,
  locale: RenderEnv['locale'],
  unit?: StatProps['unit'],
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
  props,
  env,
  tone,
  backdrop,
}: {
  props: StatProps;
  env: RenderEnv;
  tone?: Tone;
  backdrop?: Backdrop | undefined;
}) {
  const palette = onPicture(env.palette, backdrop);
  const table = useCollection(env, props.collectionId);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）按算好的值统计。
  const { view: collection, records } = useComputedRecords(env.config.collections, table, cal);
  // 按引用字段分组（D-326）要被引用的表的记录；减去另一个合计（D-327）要那张表的记录。
  const linked = useLinkedGroups(env, collection, props.groupBy);
  const minus = useComputedRecords(
    env.config.collections,
    env.config.collections.find((c) => c.id === props.minus?.collectionId),
    cal,
  );
  if (!collection) return null;
  const now = new Date();
  const matched = filterRecords(records ?? [], collection, props.filter, now, cal);
  // 按顺序的聚合（D-284）：日期默认用表里第一个日期字段，没有就用创建时间（和图表一样）。
  const sequence = isSequenceAggregate(props.aggregate)
    ? {
        spec: {
          aggregate: props.aggregate,
          unit: props.unit,
          perUnit: props.perUnit,
          skip:
            props.skipField && props.skipOption
              ? { fieldId: props.skipField, optionId: props.skipOption }
              : undefined,
        },
        ctx: { dateField: chartDateField(collection, props), now, cal },
      }
    : null;
  const valueOf = (list: DataRecord[]) =>
    sequence
      ? sequenceValue(list, collection, sequence.spec, sequence.ctx)
      : { value: aggregateRecords(list, collection, props.aggregate as Aggregate, props.fieldId) };
  // 还没读完被减的那张表时先不显示数（和自己的表没读完一样）。
  const loading = records === null || (props.minus !== undefined && minus.records === null);
  const minusOf = (value: number | null) =>
    props.minus && minus.view && minus.records
      ? minusValue(value, props.minus, minus.view, minus.records, now, cal)
      : value;
  const text = (v: { value: number | null }) =>
    statText(v.value, props.aggregate, field, env.locale, props.unit);
  const bestText = (v: { best?: number }) =>
    v.best === undefined
      ? null
      : t(env.locale, 'seqBest', {
          value: statText(v.best, props.aggregate, field, env.locale, props.unit),
        });
  const field = props.fieldId ? collection.fields.find((f) => f.id === props.fieldId) : undefined;
  // 目标（D-307）：「值 / 目标」和进度。
  const goalProgress = (v: { value: number | null }) => {
    const p = props.goal === undefined ? undefined : progressOf(v.value ?? 0, props.goal);
    return (
      p && {
        ratio: p.ratio,
        label: t(env.locale, 'progressOfGoal', { value: text(v), goal: text({ value: p.goal }) }),
      }
    );
  };
  // 和上一段同期比（D-308）：把筛选里的时间段换成上一段，再算一次；颜色不分好坏（多花钱和多运动方向相反）。
  const previous = props.compare ? previousFilter(props.filter, now, cal) : null;
  const compareText = (current: number | null) => {
    if (!previous) return null;
    const before = valueOf(filterRecords(records ?? [], collection, previous.filter, now, cal));
    const label = previousLabel(previous.period, text(before), env.locale);
    const changeText = changeLabel(compareChange(current, before.value), env.locale);
    return (
      <View style={styles.compareRow} testID={`stat-compare-${props.collectionId}-${props.label}`}>
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
      {props.label.toUpperCase()}
    </Text>
  );
  // D-248：按单选字段分组，每个选项一行。
  if (props.groupBy) {
    const noChoice = t(env.locale, 'statNoChoice');
    const groups =
      records === null || linked === null
        ? []
        : groupRecords(matched, collection, props.groupBy, noChoice, linked);
    // 和上一段比（D-308）：每个选项和它自己的上一段比。
    const before =
      previous && records !== null
        ? new Map(
            groupRecords(
              filterRecords(records, collection, previous.filter, now, cal),
              collection,
              props.groupBy,
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
                  testID={`stat-group-${props.collectionId}-${g.optionId ?? 'none'}`}
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
  const v = props.minus ? { value: minusOf(own.value) } : own;
  const best = loading ? null : bestText(v);
  const progress = goalProgress(v);
  const compareLine = loading ? null : compareText(v.value);
  return (
    <Card palette={palette} background={background} backdrop={backdrop} style={styles.fillCard}>
      {heading}
      <View style={styles.row}>
        <Text
          testID={`stat-value-${props.collectionId}-${props.label}`}
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
              testID={`stat-ring-${props.collectionId}-${props.label}`}
            />
            <Text style={[styles.ringLabel, palette.font('bodyBold', 12), { color: palette.text }]}>
              {t(env.locale, 'progressPercent', { n: Math.round(progress.ratio * 100) })}
            </Text>
          </View>
        ) : null}
      </View>
      {best ? (
        <Text
          testID={`stat-best-${props.collectionId}-${props.label}`}
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
