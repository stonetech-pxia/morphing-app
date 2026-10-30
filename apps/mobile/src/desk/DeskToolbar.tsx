import {
  deskToolIcon,
  deskToolWorkflow,
  deskWorkflowFits,
  findWorkflow,
  localize,
  type DeskFile,
  type DeskIcon,
  type DeskGroup,
  type DeskGroupId,
  type DeskTool,
  type IconValue,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t, type StringKey } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';

// 房间的工具栏（file-room DESIGN §4、§5，D-338）：一行横向滑动的图标加文字，按组排开。
// 组和工具来自布局配置（没写时由注册表按文件种类生成，见 @morph/core 的 deskToolbar）。
// 接不上桌上这些文件的项变灰、点不了。按钮只在用户点的时候才执行（D-113）。
// 最后固定一组「文件」（分享、保存、系统预览，D-342）：房间自己的事，不在配置里，每种文件都有，工具栏不会是空的。

const GROUP_TITLE: Record<DeskGroupId, StringKey> = {
  edit: 'deskGroupEdit',
  adjust: 'deskGroupAdjust',
  convert: 'deskGroupConvert',
  quick: 'deskGroupQuick',
};

/** 「文件」这一组：房间自己的按钮。 */
export type RoomTool = 'share' | 'save' | 'preview';

export interface ToolEntry {
  key: string;
  /** 工具、快捷操作；「文件」这一组的按钮没有。 */
  item?: DeskTool;
  room?: RoomTool;
  label: string;
  icon: IconValue | DeskIcon;
  /** 快捷操作（工作流）；工具时没有。 */
  workflow?: Workflow;
  enabled: boolean;
}

/** 工具栏上每一项的名字、图标、能不能用。 */
export function toolEntries(
  groups: readonly DeskGroup[],
  targets: readonly DeskFile[],
  registry: Registry,
  workflows: readonly Workflow[],
  locale: Locale,
): { title: string; entries: ToolEntry[] }[] {
  return groups.map((g) => ({
    title: g.title ?? (g.id ? t(locale, GROUP_TITLE[g.id]) : ''),
    entries: g.items.flatMap((item, i): ToolEntry[] => {
      if ('action' in item) {
        const action = registry.actions.get(item.action);
        if (!action) return [];
        const preset = item.preset ? action.presets?.find((p) => p.id === item.preset) : undefined;
        return [
          {
            key: `${item.action}-${item.preset ?? ''}-${i}`,
            item,
            label: localize(preset?.label ?? action.label, locale) ?? action.id,
            icon: deskToolIcon(action, registry),
            enabled:
              deskToolWorkflow(
                action.id,
                targets,
                registry,
                preset ? { ...preset.values } : undefined,
              ) !== null,
          },
        ];
      }
      const workflow = findWorkflow(workflows, item.workflowId, locale);
      if (!workflow) return [];
      return [
        {
          key: `wf-${workflow.id}-${i}`,
          item,
          label: workflow.name,
          icon: workflow.icon ?? 'workflow',
          workflow,
          enabled: deskWorkflowFits(workflow, targets),
        },
      ];
    }),
  }));
}

/** 「文件」这一组（每种文件都有）。 */
export function roomEntries(locale: Locale): { title: string; entries: ToolEntry[] } {
  const entry = (room: RoomTool, label: StringKey, icon: DeskIcon): ToolEntry => ({
    key: `room-${room}`,
    room,
    label: t(locale, label),
    icon,
    enabled: true,
  });
  return {
    title: t(locale, 'deskGroupFile'),
    entries: [
      entry('share', 'resultShare', 'share'),
      entry('save', 'resultSave', 'save'),
      entry('preview', 'deskToolPreview', 'preview'),
    ],
  };
}

export function DeskToolbar({
  groups,
  palette,
  disabled,
  onPress,
}: {
  groups: { title: string; entries: ToolEntry[] }[];
  palette: Palette;
  /** 正在跑一个工具时整排都点不了。 */
  disabled: boolean;
  onPress: (entry: ToolEntry) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="desk-toolbar"
      contentContainerStyle={styles.row}>
      {groups.map((g, gi) => (
        <View
          key={`${gi}-${g.title}`}
          style={[
            styles.group,
            gi > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
          ]}>
          {g.title ? (
            <Text style={[palette.font('bodyBold', 11), styles.title, { color: palette.caption }]}>
              {g.title}
            </Text>
          ) : null}
          <View style={styles.items}>
            {g.entries.map((entry) => {
              const off = disabled || !entry.enabled;
              return (
                <Pressable
                  key={entry.key}
                  testID={`desk-tool-${toolTestId(entry)}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: off }}
                  disabled={off}
                  onPress={() => onPress(entry)}
                  style={({ pressed }) => [
                    styles.item,
                    { opacity: off ? 0.35 : pressed ? 0.6 : 1 },
                  ]}>
                  <Icon name={entry.icon} size={22} color={palette.primaryText} />
                  <Text
                    numberOfLines={2}
                    style={[palette.font('body', 11), styles.label, { color: palette.text }]}>
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const toolTestId = (entry: ToolEntry) =>
  entry.room
    ? `room-${entry.room}`
    : entry.item && 'action' in entry.item
      ? entry.item.action
      : (entry.item?.workflowId ?? entry.key);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 8, paddingVertical: 6, alignItems: 'flex-start' },
  group: { paddingHorizontal: 6, gap: 2 },
  title: { paddingHorizontal: 4, letterSpacing: 0.4 },
  items: { flexDirection: 'row' },
  item: { width: 68, alignItems: 'center', gap: 4, paddingVertical: 6 },
  label: { textAlign: 'center' },
});
