import { MAX_ATTACHMENTS, dayOf, prepareRecordValues, type FieldIssue } from '@morph/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { toFormValues } from '../../renderer/data';
import { SuggestedFields } from '../../renderer/SuggestedFields';
import { useCalendar } from '../../workspace/context';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 记一笔（D-187、D-397）：快捷操作运行到这一步时，打开和记录页同样的新记录表单。这一步的文件已经在附件里，
// 表单读它们给候选（D-394），用户还可以再拍照、选照片和文件（D-263）；公式按填的值现算。填的内容直接写进本机的数据表，不进

export function RecordEntryScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'recordEntry'>) {
  const { collection, prefill, file, overflow, index, total } = input;
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
        {overflow ? (
          <Text
            testID="entry-overflow"
            style={[palette.font('body', 13), { color: palette.muted }]}>
            {t(locale, 'shareRecordTooMany', { n: MAX_ATTACHMENTS })}
          </Text>
        ) : null}
        <SuggestedFields
          suggest
          collection={collection}
          values={values}
          onChange={setValues}
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
