import {
  attachmentIds,
  prepareRecordValues,
  quickActionsOf,
  recordRowButtons,
  recordRowValue,
  type AttachmentInfo,
  type Collection,
  type DataRecord,
} from '@morph/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useHandedRun } from '../run/useHandedRun';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useAssets } from './Attachments';
import { Icon } from './Icon';
import type { Palette } from './theme';

// 已有记录的记录页顶部的一排按钮（D-428，取代 D-423 写死的那排）：有哪些由表上的 recordRow 决定，
// 每个按钮是一个快捷操作，点了才把这个字段的值或这一条记录交给它（底线 10）。看的是框里现在的值，什么都不写（底线 15）。

export function RecordActionRow({
  collection,
  record,
  values,
  palette,
}: {
  collection: Collection;
  /** 这一条（带算出来的值）。 */
  record: DataRecord;
  values: Readonly<Record<string, unknown>>;
  palette: Palette;
}) {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config!);
  const cal = useCalendar();
  const { run, elements } = useHandedRun(palette);
  /** 框里现在的值：还没保存的修改也算。框里写得不对（金额写了字）时那个字段按框里的原样交。 */
  const current = (): DataRecord => {
    const prepared = prepareRecordValues(collection, values, record.values, new Date(), cal);
    return {
      ...record,
      values: { ...record.values, ...(prepared.ok ? prepared.values : values) },
    };
  };
  // 按钮看的值：框里现在的（规范成存的样子，数字是数字；清空了的字段没有值）。
  const prepared = prepareRecordValues(collection, values, record.values, new Date(), cal);
  const shown = prepared.ok ? prepared.values : values;
  // 收文件的按钮要知道附件是什么文件（图片、PDF……），读到了才出现（D-442）。
  const fileIds = [
    ...new Set(
      (collection.recordRow ?? []).flatMap((item) => {
        const field = collection.fields.find((f) => f.id === item.field);
        return field?.type === 'file' ? attachmentIds(shown[field.id]) : [];
      }),
    ),
  ];
  const loaded = useAssets(fileIds);
  const infos = new Map<string, AttachmentInfo>(
    [...loaded].flatMap(([id, asset]) =>
      asset ? [[id, { id, name: asset.name, mimeType: asset.mimeType, size: asset.size }]] : [],
    ),
  );
  const buttons = recordRowButtons(
    collection,
    quickActionsOf(config),
    registry,
    locale,
    shown,
    infos,
  );
  if (buttons.length === 0) return null;
  return (
    <View testID="record-actions" style={styles.row}>
      {buttons.map((button) => (
        <Pressable
          key={button.key}
          testID={`record-action-${button.key}`}
          accessibilityRole="button"
          onPress={() => void run(button.workflow, recordRowValue(button, collection, current()))}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={button.workflow.icon ?? 'workflow'} size={22} color={palette.primaryText} />
          <Text
            numberOfLines={2}
            style={[palette.font('bodyMedium', 12), styles.label, { color: palette.primaryText }]}>
            {button.workflow.name}
          </Text>
          {button.showField ? (
            <Text
              numberOfLines={1}
              style={[palette.font('body', 11), styles.label, { color: palette.caption }]}>
              {button.field?.name}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {elements}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  action: {
    flexGrow: 1,
    flexBasis: 56,
    minHeight: 56,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  label: { textAlign: 'center' },
});
