import { localDate, prepareRecordValues, type FieldIssue } from '@morph/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { FieldsForm, toFormValues } from '../../renderer/data';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 记一笔（D-187）：快捷操作运行到这一步时，按数据表的字段填一条记录。附件由这一步自动放进去，
// 公式按填的值现算。填的内容直接写进本机的数据表，不进配置，也不发给 AI。

export function RecordEntryScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'recordEntry'>) {
  const zh = locale === 'zh';
  const { collection, prefill, file, index, total } = input;
  // 附件由这一步放进去，不显示；公式显示算出来的值。
  const fieldIds = collection.fields.filter((f) => f.type !== 'file').map((f) => f.id);
  // 新记录：先套用字段的默认值（日期是今天），再放进预先填好的文字。
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const f of collection.fields) {
      if ('default' in f && f.default !== undefined)
        defaults[f.id] = f.type === 'date' ? localDate(new Date()) : f.default;
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
    const prepared = prepareRecordValues(collection, values, null, new Date());
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
      doneLabel={zh ? '记下' : 'Save'}
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
              {zh ? `附件：${file.name}.${file.ext}` : `Attachment: ${file.name}.${file.ext}`}
            </Text>
          </View>
        ) : null}
        <FieldsForm
          collection={collection}
          fieldIds={fieldIds}
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
              {zh ? '这一个不记，看下一个' : 'Skip this one'}
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
