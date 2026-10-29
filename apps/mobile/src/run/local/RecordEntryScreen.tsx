import { attachmentIds, dayOf, prepareRecordValues, type FieldIssue } from '@morph/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { FieldsForm, toFormValues } from '../../renderer/data';
import { PENDING_FILE, recordTargets } from '../../runtime/actions/records';
import { useCalendar } from '../../workspace/context';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 记一笔（D-187）：快捷操作运行到这一步时，按数据表的字段填一条记录。这一步的文件自动放进附件，
// 用户还可以再拍照、选照片和文件（D-263）；公式按填的值现算。填的内容直接写进本机的数据表，不进配置，也不发给 AI。

export function RecordEntryScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'recordEntry'>) {
  const { collection, prefill, file, index, total } = input;
  // 公式显示算出来的值。这一步的文件放在第一个附件字段的最前面（占位值，存好后换成文件 ID），
  // 表单里只显示用户另外添加的照片和文件（D-263）。
  const fieldIds = collection.fields.map((f) => f.id);
  const target = recordTargets(collection).fileField;
  const fileField =
    target !== undefined && attachmentIds(prefill[target]).includes(PENDING_FILE)
      ? target
      : undefined;
  const cal = useCalendar();
  // 新记录：先套用字段的默认值（日期是今天，按一天从几点开始算，D-286），再放进预先填好的文字。
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const f of collection.fields) {
      if ('default' in f && f.default !== undefined)
        defaults[f.id] = f.type === 'date' ? dayOf(new Date(), cal) : f.default;
    }
    const base = toFormValues(collection, {
      id: '',
      collectionId: collection.id,
      values: defaults,
      createdAt: 0,
      updatedAt: 0,
    });
    return { ...base, ...prefill };
  });
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const shown =
    fileField === undefined
      ? values
      : {
          ...values,
          [fileField]: attachmentIds(values[fileField]).filter((id) => id !== PENDING_FILE),
        };
  const change = (next: Record<string, unknown>) =>
    setValues(
      fileField === undefined
        ? next
        : { ...next, [fileField]: [PENDING_FILE, ...attachmentIds(next[fileField])] },
    );

  function done() {
    const prepared = prepareRecordValues(collection, values, null, new Date(), cal);
    if (!prepared.ok) {
      setIssues(prepared.issues);
      return;
    }
    onDone({ values });
  }

  const isImage = file?.mimeType.startsWith('image/') && file.ext !== 'heic';
  return (
    <LocalFrame
      palette={palette}
      title={total > 1 ? `${collection.name} · ${index + 1}/${total}` : collection.name}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'RecordEntryScreen_Save_0e67b')}
      onCancel={onCancel}
      onDone={done}
      avoidKeyboard>
      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {file ? (
          <View style={styles.file}>
            {isImage ? (
              <Image
                source={{ uri: file.uri }}
                contentFit="contain"
                style={[styles.preview, { borderRadius: palette.controlRadius }]}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={[palette.font('bodyMedium', 14), { color: palette.muted }]}>
              {t(locale, 'RecordEntryScreen_Attachment_9a7fe', { v0: file.name, v1: file.ext })}
            </Text>
          </View>
        ) : null}
        <FieldsForm
          collection={collection}
          fieldIds={fieldIds}
          values={shown}
          onChange={change}
          issues={issues}
          palette={palette}
          locale={locale}
          testPrefix="entry"
        />
        {total > 1 ? (
          <Pressable
            testID="entry-skip"
            onPress={() => onDone({ skip: true })}
            style={styles.skip}
            hitSlop={8}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
              {t(locale, 'RecordEntryScreen_Skip_this_one_d0de1')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, gap: 18 },
  file: { gap: 8 },
  preview: { width: '100%', height: 220 },
  skip: { alignSelf: 'center', paddingVertical: 8 },
});
