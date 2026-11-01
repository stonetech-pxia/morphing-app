import { calendarOf, type Calendar } from '@morph/core';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useWorkflowChange } from '@/run/workflow-change';
import { usePalette } from '@/renderer/theme';
import { Card } from '@/renderer/ui';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

const HOURS = [0, 1, 2, 3, 4, 5, 6];

/**
 * 「设置 → 日期」（D-286）：一天从几点开始、一周从周几开始。每次改都生成一个可撤销的版本（和提醒一样）。
 * 两周一段的起算日只显示，由 AI 修改（要说哪一天，这里不放日期选择）。
 */
export default function CalendarRoute() {
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const change = useWorkflowChange();
  const cal = calendarOf(config);
  const caption = [palette.font('body', 13), { color: palette.caption }];
  const title = [palette.font('title', 16), { color: palette.text }];

  const setDayStart = (hour: number) =>
    change(
      [{ op: 'updateData', calendar: { dayStartHour: hour === 0 ? null : hour } }],
      t(locale, 'describeDayStart', { hour }),
    );
  const setWeekStart = (weekStart: Calendar['weekStart']) =>
    change(
      [{ op: 'updateData', calendar: { weekStart: weekStart === 'monday' ? null : weekStart } }],
      t(locale, weekStart === 'sunday' ? 'describeWeekStartSunday' : 'describeWeekStartMonday'),
    );

  const chip = (selected: boolean, label: string, testID: string, onPress: () => void) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={selected ? undefined : onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? palette.primary : palette.border,
          backgroundColor: selected ? palette.primaryTint : palette.surface,
        },
      ]}>
      <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      testID="calendar-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
      <Text style={caption}>{t(locale, 'calendarHint')}</Text>
      <Card palette={palette}>
        <Text style={title}>{t(locale, 'calendarDayStart')}</Text>
        <Text style={caption}>{t(locale, 'calendarDayStartHint')}</Text>
        <View style={styles.chips}>
          {HOURS.map((hour) =>
            chip(
              cal.dayStartHour === hour,
              t(locale, 'calendarHour', { hour }),
              `calendar-hour-${hour}`,
              () => void setDayStart(hour),
            ),
          )}
        </View>
      </Card>
      <Card palette={palette}>
        <Text style={title}>{t(locale, 'calendarWeekStart')}</Text>
        <View style={styles.chips}>
          {chip(
            cal.weekStart === 'monday',
            t(locale, 'calendarMonday'),
            'calendar-week-monday',
            () => void setWeekStart('monday'),
          )}
          {chip(
            cal.weekStart === 'sunday',
            t(locale, 'calendarSunday'),
            'calendar-week-sunday',
            () => void setWeekStart('sunday'),
          )}
        </View>
      </Card>
      <Text testID="calendar-two-weeks" style={caption}>
        {cal.twoWeekStart
          ? t(locale, 'calendarTwoWeeks', { date: cal.twoWeekStart })
          : t(locale, 'calendarTwoWeeksDefault')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: 'center',
  },
});
