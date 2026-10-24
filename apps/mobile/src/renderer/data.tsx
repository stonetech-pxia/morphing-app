import {
  aggregateRecords,
  filterRecords,
  formatMoney,
  formatNumber,
  formatRef,
  formatValue,
  localDate,
  prepareRecordValues,
  readValue,
  recordValue,
  sortRecords,
  type Collection,
  type Component,
  type ComponentStyle,
  type DataRecord,
  type Field,
  type FieldIssue,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useRecordActions, useRecords } from '../data/records';
import type { AssetRecord } from '../storage/types';
import { useWorkspaceContext } from '../workspace/context';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
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
    values[field.id] = field.type === 'number' || field.type === 'money' ? String(v) : v;
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
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean;
  testID: string;
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
  switch (field.type) {
    case 'text':
    case 'note':
    case 'number':
    case 'money':
      return (
        <TextInput
          testID={testID}
          editable={!disabled}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder={field.type === 'money' ? `${field.name} (${field.currency})` : field.name}
          placeholderTextColor={palette.caption}
          multiline={field.type === 'note'}
          keyboardType={
            field.type === 'number' || field.type === 'money' ? 'decimal-pad' : 'default'
          }
          style={[input, field.type === 'note' && styles.note]}
        />
      );
    case 'date': {
      const now = new Date();
      const today = localDate(now);
      const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
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
            [today, t(locale, 'today')],
            [yesterday, t(locale, 'yesterday')],
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
    case 'checkbox':
      return (
        <Switch
          testID={testID}
          disabled={disabled}
          value={value === true}
          onValueChange={onChange}
          trackColor={{ true: palette.primary, false: palette.border }}
          thumbColor="#FFFFFF"
        />
      );
    case 'choice':
      return (
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
      );
    case 'file':
      return (
        <AttachmentInput
          value={value}
          onChange={onChange}
          palette={palette}
          locale={locale}
          disabled={disabled}
          testID={testID}
        />
      );
    case 'formula':
      // 公式不能填，由 FieldsForm 显示算出来的值（D-188）。
      return null;
    case 'rating':
      return (
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
      );
  }
}

/** 附件（D-187）：显示文件名，点一下打开分享面板（用别的 App 看），可以去掉。换文件要重新「记一笔」。 */
function AttachmentInput({
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean | undefined;
  testID: string;
}) {
  const { repo, files } = useWorkspaceContext();
  // 读到的文件连同它的 ID 一起记：值换了以后旧的那条不再显示。
  const [loaded, setLoaded] = useState<{ id: string; asset: AssetRecord | null } | null>(null);
  useEffect(() => {
    if (typeof value !== 'string' || !value) return;
    let alive = true;
    void repo.getAsset(value).then((asset) => alive && setLoaded({ id: value, asset }));
    return () => {
      alive = false;
    };
  }, [repo, value]);
  const asset = loaded && loaded.id === value ? loaded.asset : null;
  if (typeof value !== 'string' || !value) {
    return (
      <Text style={[palette.font('body', 14), { color: palette.caption }]}>
        {t(locale, 'noAttachment')}
      </Text>
    );
  }
  return (
    <View style={styles.dateRow}>
      <Pressable
        testID={testID}
        disabled={!asset}
        onPress={() => asset && void files.share(asset.path, asset.mimeType)}
        style={[styles.flex, styles.attachment]}>
        <Icon name="document" size={18} color={palette.secondary} />
        <Text
          numberOfLines={1}
          style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
          {asset?.name ?? t(locale, 'attachmentMissing')}
        </Text>
      </Pressable>
      <Pressable
        testID={`${testID}-remove`}
        disabled={disabled}
        hitSlop={8}
        onPress={() => onChange('')}>
        <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
          {t(locale, 'removeAttachment')}
        </Text>
      </Pressable>
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
}) {
  // 公式按表单里现在的值算（D-188）。
  const computed = () => {
    const prepared = prepareRecordValues(collection, values, null, new Date());
    return {
      id: '',
      collectionId: collection.id,
      values: prepared.ok ? prepared.values : {},
      createdAt: 0,
      updatedAt: 0,
    };
  };
  return (
    <View style={styles.fields}>
      {fieldIds.map((id) => {
        const field = collection.fields.find((f) => f.id === id);
        if (!field) return null;
        if (field.type === 'formula') {
          const shown = formatValue(field, recordValue(computed(), collection, id), locale);
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
        const inline = field.type === 'checkbox';
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

function useCollection(env: RenderEnv, id: string): Collection | undefined {
  return env.config.collections.find((c) => c.id === id);
}

function openEditor(router: ReturnType<typeof useRouter>, collectionId: string, recordId?: string) {
  router.push({
    pathname: '/record/[collectionId]',
    params: recordId ? { collectionId, recordId } : { collectionId },
  });
}

type RecordListProps = Extract<Component, { type: 'recordList' }>['props'];

type Tone = ComponentStyle['tone'];

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
  const background = cardColors(palette, tone).background;
  const router = useRouter();
  const collection = useCollection(env, props.collectionId);
  const records = useRecords(props.collectionId);
  const actions = useRecordActions();
  if (!collection) return null;
  const shown = sortRecords(
    filterRecords(records ?? [], collection, props.filter, new Date()),
    collection,
    props.sort,
  ).slice(0, props.limit);

  if (records !== null && shown.length === 0) {
    return (
      <Card palette={palette} background={background}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {props.emptyText ?? t(locale, 'noRecords')}
        </Text>
      </Card>
    );
  }

  const row = (r: DataRecord, index: number) => {
    const title = formatRef(r, collection, props.titleField, locale) || '—';
    const subtitle = (props.subtitleFields ?? [])
      .map((f) => formatRef(r, collection, f, locale))
      .filter(Boolean)
      .join(' · ');
    const trailing = props.trailingField
      ? formatRef(r, collection, props.trailingField, locale)
      : '';
    const checked = props.checkField ? r.values[props.checkField] === true : false;
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
        <View style={styles.flex}>
          <Text
            numberOfLines={props.display === 'cards' ? 2 : 1}
            style={[
              palette.font('title', 15),
              { color: checked ? palette.caption : palette.text },
              checked && styles.done,
            ]}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={props.display === 'cards' ? 3 : 1}
              style={[palette.font('body', 13), { color: palette.muted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing ? (
          <Text style={[palette.font('title', 15), { color: palette.text }]}>{trailing}</Text>
        ) : null}
      </View>
    );
    const open = env.interactive
      ? (env.locked ?? (() => openEditor(router, collection.id, r.id)))
      : undefined;
    if (props.display === 'cards') {
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

  if (props.display === 'cards')
    return <View style={{ gap: palette.gap - 4 }}>{shown.map(row)}</View>;
  return (
    <Card palette={palette} background={background} style={styles.listCard}>
      {shown.map(row)}
    </Card>
  );
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

export function Stat({ props, env, tone }: { props: StatProps; env: RenderEnv; tone?: Tone }) {
  const { palette } = env;
  const collection = useCollection(env, props.collectionId);
  const records = useRecords(props.collectionId);
  if (!collection) return null;
  const matched = filterRecords(records ?? [], collection, props.filter, new Date());
  const value =
    records === null ? null : aggregateRecords(matched, collection, props.aggregate, props.fieldId);
  const field = props.fieldId ? collection.fields.find((f) => f.id === props.fieldId) : undefined;
  let shown = '—';
  if (value !== null) {
    if (props.aggregate !== 'count' && field?.type === 'formula')
      shown = formatValue(field, value, env.locale);
    else if (props.aggregate !== 'count' && field?.type === 'money')
      shown = formatMoney(value, field.currency);
    else if (props.aggregate !== 'count' && field?.type === 'number')
      shown = `${formatNumber(value, field.decimals)}${field.unit ? ` ${field.unit}` : ''}`;
    else shown = formatNumber(value);
  }
  return (
    <Card
      palette={palette}
      background={tone ? cardColors(palette, tone).background : palette.primaryTint}
      style={styles.fillCard}>
      <Text
        style={[palette.font('bodyBold', 12), { color: palette.primaryText, letterSpacing: 0.5 }]}>
        {props.label.toUpperCase()}
      </Text>
      <Text
        testID={`stat-value-${props.collectionId}-${props.label}`}
        style={[palette.font('display', 26), { color: palette.text }]}>
        {shown}
      </Text>
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
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
