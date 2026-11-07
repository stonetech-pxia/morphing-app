import {
  appViewOf,
  attachmentIds,
  tableIsShown,
  type DataRecord,
  type FieldIssue,
} from '@morph/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';

import { useComputedRecords, useRecordActions, type SaveResult } from '@/data/records';
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
import { stackScreenOptions } from '@/shell/header';
import { useConfirmLeave } from '@/shell/useConfirmLeave';
import type { StoredRecord } from '@/storage/types';
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
  const config = useWorkspace((s) => s.config)!;
  // 记录页用这张表所属 app 的风格（D-485）；主页的表用主页的。
  const palette = usePalette(
    appViewOf(config, config.data.tables.find((c) => c.id === collectionId)?.app ?? null).theme,
  );
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
  // 打开时的值：填了、改了没保存就离开时先问「放弃修改？」（2026-11-06 测试：输入的字直接丢了）。
  const [initial, setInitial] = useState(() => JSON.stringify(values));
  const leave = useConfirmLeave(JSON.stringify(values) !== initial, 'formDiscardMessage', locale);
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
      const loaded = toFormValues(collection, active);
      setValues(loaded);
      setInitial(JSON.stringify(loaded));
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
    finish(result);
  }

  /** 保存的结果：存好了就回去；填得不对标出来；记录在你编辑时被别处改了、删了就问你。 */
  function finish(result: SaveResult) {
    if (!collection) return;
    if (result.ok) {
      kept.current = new Set(
        collection.fields.flatMap((f) => (f.type === 'file' ? attachmentIds(values[f.id]) : [])),
      );
      leave();
      // 新记录回去看不到（这张表还没有页面读）：说一句，能接着改。
      if (!record && !tableIsShown(config, collection.id, registry))
        showToast({
          message: t(locale, 'recordSavedNoPage'),
          continueTable: collection.id,
        });
    } else if ('issues' in result) setIssues(result.issues);
    else if ('conflict' in result) askConflict(result.conflict);
    else if ('gone' in result)
      Alert.alert(t(locale, 'recordConflictGoneTitle'), t(locale, 'recordConflictGoneMessage'), [
        { text: t(locale, 'ok'), onPress: () => leave() },
      ]);
  }

  /** 打开之后这条记录被别处改过（通知按钮、桌面小组件……）：不悄悄改回旧值，让用户选（R05）。 */
  function askConflict(latest: StoredRecord) {
    Alert.alert(t(locale, 'recordConflictTitle'), t(locale, 'recordConflictMessage'), [
      { text: t(locale, 'recordConflictKeep'), onPress: () => void keepMine(latest) },
      { text: t(locale, 'recordConflictLatest'), onPress: () => adoptLatest(latest) },
      { text: t(locale, 'cancel'), style: 'cancel' },
    ]);
  }

  /** 只保存我在这个表单里改过的项，别的项用现在存的（别处刚改的）。 */
  async function keepMine(latest: StoredRecord) {
    if (!collection) return;
    const opened = JSON.parse(initial) as Record<string, unknown>;
    const mine = Object.fromEntries(
      Object.entries(values).filter(
        ([key, v]) => JSON.stringify(v) !== JSON.stringify(opened[key]),
      ),
    );
    finish(await actions.update(collection, latest, mine));
  }

  /** 放弃我的修改：表单换成现在存的那份，接着看、接着改。 */
  function adoptLatest(latest: StoredRecord) {
    if (!collection) return;
    const loaded = toFormValues(collection, latest);
    setRecord(latest);
    setValues(loaded);
    setInitial(JSON.stringify(loaded));
    setIssues([]);
  }

  async function remove() {
    if (!record) return;
    await actions.remove(record);
    leave();
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
          ...stackScreenOptions(palette),
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
