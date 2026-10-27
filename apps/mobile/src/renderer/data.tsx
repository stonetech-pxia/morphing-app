import {
  aggregateRecords,
  filterRecords,
  formatMoney,
  formatNumber,
  formatRef,
  formatValue,
  groupedAggregate,
  linkTitle,
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
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useLinkResolver, useRecordActions, useRecords } from '../data/records';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
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
    case 'link':
      return (
        <LinkInput
          field={field}
          value={value}
          onChange={onChange}
          palette={palette}
          locale={locale}
          disabled={disabled}
          testID={testID}
        />
      );
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
  const links = useLinkResolver(collection);
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

  const openRecord = (r: DataRecord) =>
    env.interactive ? (env.locked ?? (() => openEditor(router, collection.id, r.id))) : undefined;

  if (props.display === 'table') {
    // 表格（D-255）：列就是已经选好的标题、副标题和右侧字段，不另加列；窄屏左右滑动。
    const columns = [
      props.titleField,
      ...(props.subtitleFields ?? []),
      ...(props.trailingField ? [props.trailingField] : []),
    ];
    const columnName = (ref: string) =>
      ref === 'createdAt'
        ? t(locale, 'html_Created_1626a')
        : ref === 'updatedAt'
          ? t(locale, 'html_Updated_74f0c')
          : (collection.fields.find((f) => f.id === ref)?.name ?? ref);
    const cell = (index: number) => [
      styles.cell,
      index === 0 && styles.firstCell,
      props.trailingField && index === columns.length - 1 && styles.trailingCell,
    ];
    return (
      <Card palette={palette} background={background} style={styles.listCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="record-table">
          <View>
            <View style={styles.tableRow}>
              {columns.map((ref, i) => (
                <Text
                  key={ref}
                  numberOfLines={1}
                  style={[cell(i), palette.font('bodyBold', 13), { color: palette.muted }]}>
                  {columnName(ref)}
                </Text>
              ))}
            </View>
            {shown.map((r) => {
              const open = openRecord(r);
              return (
                <Pressable
                  key={r.id}
                  testID={`record-${r.id}`}
                  onPress={open}
                  onLongPress={env.onLongPress}
                  disabled={!open}
                  style={[
                    styles.tableRow,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
                  ]}>
                  {columns.map((ref, i) => (
                    <Text
                      key={ref}
                      numberOfLines={2}
                      style={[
                        cell(i),
                        palette.font(i === 0 ? 'title' : 'body', 14),
                        { color: palette.text },
                      ]}>
                      {formatRef(r, collection, ref, locale, links) || '—'}
                    </Text>
                  ))}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Card>
    );
  }

  const row = (r: DataRecord, index: number) => {
    const title = formatRef(r, collection, props.titleField, locale, links) || '—';
    const subtitle = (props.subtitleFields ?? [])
      .map((f) => formatRef(r, collection, f, locale, links))
      .filter(Boolean)
      .join(' · ');
    const trailing = props.trailingField
      ? formatRef(r, collection, props.trailingField, locale, links)
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
    const open = openRecord(r);
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

/** 统计值的显示：金额按币种、数字按单位和小数位，计数和其他字段只显示数字。 */
export function statText(
  value: number | null,
  aggregate: StatProps['aggregate'],
  field: Field | undefined,
  locale: RenderEnv['locale'],
): string {
  if (value === null) return '—';
  if (aggregate !== 'count' && field?.type === 'formula') return formatValue(field, value, locale);
  if (aggregate !== 'count' && field?.type === 'money')
    return formatMoney(value, field.currency, locale);
  if (aggregate !== 'count' && field?.type === 'number')
    return `${formatNumber(value, field.decimals, locale)}${field.unit ? ` ${field.unit}` : ''}`;
  return formatNumber(value, undefined, locale);
}

export function Stat({ props, env, tone }: { props: StatProps; env: RenderEnv; tone?: Tone }) {
  const { palette } = env;
  const collection = useCollection(env, props.collectionId);
  const records = useRecords(props.collectionId);
  if (!collection) return null;
  const matched = filterRecords(records ?? [], collection, props.filter, new Date());
  const field = props.fieldId ? collection.fields.find((f) => f.id === props.fieldId) : undefined;
  const background = tone ? cardColors(palette, tone).background : palette.primaryTint;
  const heading = (
    <Text
      style={[palette.font('bodyBold', 12), { color: palette.primaryText, letterSpacing: 0.5 }]}>
      {props.label.toUpperCase()}
    </Text>
  );
  // D-248：按单选字段分组，每个选项一行。
  if (props.groupBy) {
    const groups =
      records === null
        ? []
        : groupedAggregate(
            matched,
            collection,
            props.aggregate,
            props.fieldId,
            props.groupBy,
            t(env.locale, 'statNoChoice'),
          );
    return (
      <Card palette={palette} background={background} style={styles.fillCard}>
        {heading}
        {groups.map((g) => (
          <View key={g.optionId ?? '-'} style={styles.row}>
            <Text
              numberOfLines={1}
              style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
              {g.label}
            </Text>
            <Text
              testID={`stat-group-${props.collectionId}-${g.optionId ?? 'none'}`}
              style={[palette.font('title', 16), { color: palette.text }]}>
              {statText(g.value, props.aggregate, field, env.locale)}
            </Text>
          </View>
        ))}
      </Card>
    );
  }
  const value =
    records === null ? null : aggregateRecords(matched, collection, props.aggregate, props.fieldId);
  return (
    <Card palette={palette} background={background} style={styles.fillCard}>
      {heading}
      <Text
        testID={`stat-value-${props.collectionId}-${props.label}`}
        style={[palette.font('display', 26), { color: palette.text }]}>
        {statText(value, props.aggregate, field, env.locale)}
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
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  cell: { width: 120, paddingRight: 12 },
  firstCell: { width: 150 },
  trailingCell: { textAlign: 'right' },
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
