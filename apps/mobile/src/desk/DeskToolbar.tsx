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
  type DeskKind,
  type DeskTool,
  type IconValue,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t, type StringKey } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { runsHere, UNSUPPORTED_ACTIONS } from '../runtime/device-support';

// 房间的工具栏（file-room DESIGN §4、§5，D-359）：一行横向滑动的图标加文字，按组排开。
// 组和工具来自布局配置（没写时由注册表按文件种类生成，见 @morph/core 的 deskToolbar）。
// 接不上桌上这些文件的项变灰、点不了。按钮只在用户点的时候才执行（D-113）。
// 最后固定一组「文件」（分享、保存、系统预览，D-363）：房间自己的事，不在配置里，每种文件都有，工具栏不会是空的。

const GROUP_TITLE: Record<DeskGroupId, StringKey> = {
  edit: 'deskGroupEdit',
  annotate: 'deskGroupAnnotate',
  pages: 'deskGroupPages',
  adjust: 'deskGroupAdjust',
  convert: 'deskGroupConvert',
  quick: 'deskGroupQuick',
};

/** 「文件」这一组：房间自己的按钮。 */
export type RoomTool = 'share' | 'save' | 'folder' | 'preview';

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
      if (typeof item === 'object') {
        const action = registry.actions.get(item.action);
        if (!action || UNSUPPORTED_ACTIONS.has(action.id)) return [];
        const preset = item.preset ? action.presets?.find((p) => p.id === item.preset) : undefined;
        return [
          {
            key: `${item.action}-${item.preset ?? ''}-${i}`,
            item,
            label: localize(preset?.label ?? action.label, locale) ?? action.id,
            icon: deskToolIcon(action, registry, item.preset),
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
      const workflow = findWorkflow(workflows, item, locale);
      if (!workflow || !runsHere(workflow)) return [];
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
export function roomEntries(
  locale: Locale,
  /** PDF 桌面只留分享（保存是「完成」的事，系统预览用不上）。 */
  kind?: DeskKind,
): { title: string; entries: ToolEntry[] } {
  const entry = (room: RoomTool, label: StringKey, icon: DeskIcon): ToolEntry => ({
    key: `room-${room}`,
    room,
    label: t(locale, label),
    icon,
    enabled: true,
  });
  return {
    title: t(locale, 'deskGroupFile'),
    entries:
      kind === 'pdf'
        ? [entry('share', 'resultShare', 'share')]
        : [
            entry('share', 'resultShare', 'share'),
            entry('save', 'resultSave', 'save'),
            entry('folder', 'resultFolder', 'folder'),
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
  const scroll = useRef<ScrollViewInstance>(null);
  // 有几组时上面是页签，下面只排当前这一组（2026-11-06：所有组排成一长条时，后面几组短、滑不到最左边，
  // 「处理」「转换」「文件」看起来是同一排，点回「标注」也不跟着跳）。
  const [active, setActive] = useState(0);
  const tabs = groups.length > 1;
  const at = Math.min(active, groups.length - 1);
  const shown = tabs ? [groups[at]!] : groups;
  return (
    <View>
      {tabs ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          testID="desk-tabs"
          contentContainerStyle={styles.tabs}>
          {groups.map((g, gi) => (
            <Pressable
              key={`${gi}-${g.title}`}
              testID={`desk-tab-${gi}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: gi === at }}
              onPress={() => {
                setActive(gi);
                scroll.current?.scrollTo({ x: 0, animated: false });
              }}
              style={[
                styles.tab,
                { backgroundColor: gi === at ? palette.primaryTint : 'transparent' },
              ]}>
              <Text
                style={[
                  palette.font(gi === at ? 'bodyBold' : 'bodyMedium', 14),
                  { color: gi === at ? palette.primaryText : palette.caption },
                ]}>
                {g.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="desk-toolbar"
        contentContainerStyle={styles.row}>
        {shown.map((g, gi) => (
          <View
            key={`${gi}-${g.title}`}
            style={[
              styles.group,
              gi > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
            ]}>
            {!tabs && g.title ? (
              <Text
                style={[palette.font('bodyBold', 11), styles.title, { color: palette.caption }]}>
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
                    <View style={[styles.itemIcon, { backgroundColor: palette.primaryTint }]}>
                      <Icon name={entry.icon} size={21} color={palette.primaryText} />
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[
                        palette.font('bodyMedium', 11),
                        styles.label,
                        { color: palette.text },
                      ]}>
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const toolTestId = (entry: ToolEntry) =>
  entry.room
    ? `room-${entry.room}`
    : typeof entry.item === 'object'
      ? entry.item.action
      : (entry.item ?? entry.key);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, alignItems: 'flex-start' },
  group: { paddingHorizontal: 6, gap: 2 },
  // D-488：页签是浅色药丸（选中的底色是主题的浅主色），图标放在圆底里。
  tabs: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  title: { paddingHorizontal: 4, letterSpacing: 0.4 },
  items: { flexDirection: 'row' },
  item: { width: 68, alignItems: 'center', gap: 4, paddingVertical: 6 },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});
