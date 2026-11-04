import { attachmentIds, tableIsShown, type DataRecord, type FieldIssue } from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';

import { useComputedRecords, useRecordActions } from '@/data/records';
import { useSimilarCheck } from '@/data/similar-records';
import { t } from '@/i18n';
import { FormFilesContext } from '@/renderer/Attachments';
import { prefillFormValues, toFormValues } from '@/renderer/data';
import { RecordActionRow } from '@/renderer/RecordActionRow';
import { SuggestedFields } from '@/renderer/SuggestedFields';
import { usePalette } from '@/renderer/theme';
import { Button } from '@/renderer/ui';
import { takeFormCopies } from '@/share/save-as-record';
import { tableEntry } from '@/shell/ai-entry';
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
  const { repo, files, locale, registry } = useWorkspaceContext();
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const showToast = useWorkspace((s) => s.showToast);
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const actions = useRecordActions();
  const mayProceed = useSimilarCheck();
  const headerHeight = useHeaderHeight();
  const collection = config.data.tables.find((c) => c.id === collectionId);
  // 查找、汇总、上一条（D-291）：显示这条记录存好以后算出来的值。
  const computed = useComputedRecords(config.data.tables, collection, useCalendar());
  const [record, setRecord] = useState<DataRecord | null | undefined>(recordId ? undefined : null);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    !recordId && prefill && collection ? prefillFormValues(collection, prefill) : {},
  );
  const [issues, setIssues] = useState<FieldIssue[]>([]);
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
    // D-426：只有新记录问一句，用户总能选「仍然保存」。
    if (!record && !(await mayProceed(collection, values))) return;
    const result = record
      ? await actions.update(collection, record, values)
      : await actions.add(collection, values);
    if (result.ok) {
      kept.current = new Set(
        collection.fields.flatMap((f) => (f.type === 'file' ? attachmentIds(values[f.id]) : [])),
      );
      router.back();
      // 新记录回去看不到（这张表还没有页面读）：说一句，能接着改。
      if (!record && !tableIsShown(config, collection.id, registry))
        showToast({
          message: t(locale, 'recordSavedNoPage'),
          continueTable: collection.id,
        });
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
      // Android 是 edge-to-edge，窗口不会因为键盘变小（真机上键盘盖住下面的字段）：两边都留出键盘的高度。
      behavior="padding"
      // 这个页面在标题栏下面：键盘的位置按整个屏幕算，少了这段高度，下面的字段还是露不出来。
      keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          title: `${collection.name} · ${t(locale, record ? 'editRecord' : 'newRecord')}`,
          headerRight: tableEntry(collection.id, palette),
        }}
      />
      {record === undefined ? null : (
        <ScrollView
          contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled">
          {record ? (
            <RecordActionRow
              collection={collection}
              record={computed.records?.find((r) => r.id === record.id) ?? record}
              values={values}
              palette={palette}
            />
          ) : null}
          <FormFilesContext.Provider value={formFiles}>
            <SuggestedFields
              suggest={!recordId}
              collection={collection}
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
    </KeyboardAvoidingView>
  );
}
