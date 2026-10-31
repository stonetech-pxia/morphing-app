import { attachmentIds, type DataRecord, type FieldIssue } from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { useFieldSuggestions } from '@/data/field-suggestions';
import { useComputedRecords, useRecordActions } from '@/data/records';
import { t } from '@/i18n';
import { PackGate } from '@/packs/PackGate';
import { usePacks } from '@/packs/PackHost';
import { FormFilesContext } from '@/renderer/Attachments';
import { FieldsForm, prefillFormValues, toFormValues } from '@/renderer/data';
import { usePalette } from '@/renderer/theme';
import { Button, Pill } from '@/renderer/ui';
import { takeFormCopies } from '@/share/save-as-record';
import { deleteUserFiles } from '@/storage/user-files';
import { useCalendar, useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 记录编辑页：由内核按数据表的字段自动生成，不可配置（docs/DATA_DESIGN.md §5）。 */
export default function RecordRoute() {
  const { collectionId, recordId, prefill, copies } = useLocalSearchParams<{
    collectionId: string;
    recordId?: string;
    /** 一键操作打开的新记录表单（D-338）：预设的值，JSON。 */
    prefill?: string;
    /** 收件页面「存成记录」（D-392）：为这张表单复制出来的用户文件的键（share/save-as-record.ts）。 */
    copies?: string;
  }>();
  const { repo, files, locale } = useWorkspaceContext();
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
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
  // 候选值（D-394）：只在新记录的表单里。点了或输入以后候选留在原地，下面的字段不往上跳
  // （iOS 模拟器 2026-10-31）；和字段的值一样的那个标成已选。
  const packs = usePacks();
  const suggest = useFieldSuggestions({ enabled: !recordId, collection, values, locale });
  // 收件页面复制来的文件（D-392）和桌上改好交回来的附件（D-395）：离开这一页时，没存进这条记录的删掉
  // （没保存就离开时全部删掉）。它们是这张表单自己新建的，原件、收件那一批和记录里原来的文件不动。
  const [copied] = useState(() => (recordId ? [] : takeFormCopies(copies)));
  const owned = useRef<Set<string>>(new Set(copied));
  const [formFiles] = useState(() => ({
    hold: (ids: readonly string[]) => ids.forEach((id) => owned.current.add(id)),
  }));
  const kept = useRef<Set<string>>(new Set());
  useEffect(
    () => () => {
      const unused = [...owned.current].filter((id) => !kept.current.has(id));
      if (unused.length === 0) return;
      void deleteUserFiles(unused, repo, files)
        .then(bumpAssets)
        .catch(() => undefined);
    },
    [repo, files, bumpAssets],
  );

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
    if (result.ok) {
      kept.current = new Set(
        collection.fields.flatMap((f) => (f.type === 'file' ? attachmentIds(values[f.id]) : [])),
      );
      router.back();
    } else if ('issues' in result) setIssues(result.issues);
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
          {!record && suggest.missing.length > 0 && packs ? (
            <View testID="suggestions-notice" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                {t(locale, 'suggestionsNeedDownload')}
              </Text>
              <Pill
                palette={palette}
                testID="suggestions-download"
                label={t(locale, 'suggestionsDownload')}
                onPress={suggest.ask}
              />
            </View>
          ) : null}
          {!record && suggest.working ? (
            <Text
              testID="suggestions-working"
              style={[palette.font('body', 13), { color: palette.caption }]}>
              {t(locale, 'suggestionsWorking')}
            </Text>
          ) : null}
          <FormFilesContext.Provider value={formFiles}>
            <FieldsForm
              collection={collection}
              fieldIds={collection.fields.map((f) => f.id)}
              values={values}
              onChange={setValues}
              suggestions={record ? undefined : suggest.suggestions}
              onSuggestion={suggest.remember}
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
          </FormFilesContext.Provider>
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
      {suggest.asking && packs ? (
        <PackGate
          needs={suggest.asking}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={suggest.answered}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
