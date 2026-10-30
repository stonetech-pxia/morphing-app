import type { ButtonAction, Collection, DataRecord, IconValue, RowAction } from '@morph/core';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { useRecordActionRunner } from '../data/record-actions';
import type { RenderEnv } from './components';
import type { Palette } from './theme';
import { Button } from './ui';

// 一键记录操作（D-300）的两种按钮：页面上的按钮（button 的 action）和记录列表每一行右边的小按钮。
// 草稿里（D-190）点了只提示应用之后才能用。

export function ActionButton({
  action,
  label,
  variant,
  icon,
  env,
  style,
}: {
  action: ButtonAction;
  label: string;
  variant: 'filled' | 'outline' | 'text' | 'icon';
  icon?: IconValue;
  env: RenderEnv;
  style?: StyleProp<ViewStyle>;
}) {
  const runner = useRecordActionRunner();
  return (
    <Button
      palette={env.palette}
      label={label}
      variant={variant}
      icon={icon}
      onPress={
        env.interactive ? (env.locked ?? (() => void runner.runButton(action, label))) : undefined
      }
      onLongPress={env.onLongPress}
      style={style}
    />
  );
}

/** 列表一行右边的按钮：至少 44 高，按下变淡；点了不会打开这条记录。 */
export function RowActionButton({
  action,
  record,
  collection,
  env,
  palette,
}: {
  action: RowAction;
  record: DataRecord;
  collection: Collection;
  env: RenderEnv;
  palette: Palette;
}) {
  const runner = useRecordActionRunner();
  return (
    <Pressable
      testID={`row-action-${record.id}`}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      disabled={!env.interactive}
      onPress={env.locked ?? (() => void runner.runRow(action, record, collection))}
      onLongPress={env.onLongPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: palette.controlRadius,
        backgroundColor: palette.primary,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text numberOfLines={1} style={[palette.font('bodyBold', 14), { color: palette.onPrimary }]}>
        {action.label}
      </Text>
    </Pressable>
  );
}
