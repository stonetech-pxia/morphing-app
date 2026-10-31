import type { DataRecord, FieldIssue } from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { useComputedRecords, useRecordActions } from '@/data/records';
import { t } from '@/i18n';
import { FieldsForm, prefillFormValues, toFormValues } from '@/renderer/data';
import { usePalette } from '@/renderer/theme';
import { Button } from '@/renderer/ui';
import { useCalendar, useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 记录编辑页：由内核按数据表的字段自动生成，不可配置（docs/DATA_DESIGN.md §5）。 */
export default function RecordRoute() {
  const { collectionId, recordId, prefill } = useLocalSearchParams<{
    collectionId: string;
    recordId?: string;
    /** 一键操作打开的新记录表单（D-338）：预设的值，JSON。 */
    prefill?: string;
  }>();
  const { repo, locale } = useWorkspaceContext();
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const actions = useRecordActions();
  const collection = config.data.tables.find((c) => c.id === collectionId);
  // 查找、汇总、上一条（D-291）：显示这条记录存好以后算出来的值。
  const computed = useComputedRecords(config.data.tables, collection, useCalendar());
  const [record, setRecord] = useState<DataRecord | null | undefined>(recordId ? undefined : null);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    !recordId && prefill && collection ? prefillFormValues(collection, prefill) : {},
  );
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  useEffect(() => {
    if (!recordId || !collection) return;
    void repo.getRecord(recordId).then((r) => {
      const active = r && r.deletedAt === null ? r : null;
      setRecord(active);
      setValues(toFormValues(collection, active));
    });
  }, [repo, recordId, collection]);

  if (!collection) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'tableMissing')}
        </Text>
      </View>
    );
  }

  async function save() {
    if (!collection) return;
    const result = record
      ? await actions.update(collection, record, values)
      : await actions.add(collection, values);
    if (result.ok) router.back();
    else if ('issues' in result) setIssues(result.issues);
  }

  async function remove() {
    if (!record) return;
    await actions.remove(record);
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: `${collection.name} · ${t(locale, record ? 'editRecord' : 'newRecord')}`,
        }}
      />
      {record === undefined ? null : (
        <ScrollView
          contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled">
          <FieldsForm
            collection={collection}
            fieldIds={collection.fields.map((f) => f.id)}
            values={values}
            onChange={setValues}
            issues={issues}
            palette={palette}
            locale={locale}
            testPrefix="editor"
            related={
              computed.view && {
                view: computed.view,
                record: computed.records?.find((r) => r.id === recordId) ?? null,
              }
            }
          />
          <Button
            palette={palette}
            testID="editor-save"
            label={t(locale, 'save')}
            onPress={() => void save()}
          />
          {record ? (
            <Button
              palette={palette}
              testID="editor-delete"
              variant="outline"
              danger
              label={t(locale, 'delete')}
              onPress={() => void remove()}
            />
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
