import { reminderWhen, type Reminder } from '@morph/core';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { t } from '@/i18n';
import { useNotificationState } from '@/reminders/useReminders';
import { useWorkflowChange } from '@/run/workflow-change';
import { usePalette } from '@/renderer/theme';
import { Button, Card } from '@/renderer/ui';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/**
 * 「设置 → 提醒」（D-251）：列出提醒，可以开关、移除（都生成一个可撤销的版本）。
 * 新建和改时间由 AI 修改（「每天 9 点提醒我记账」），这里说明怎么做。
 */
export default function RemindersRoute() {
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const permission = useNotificationState((s) => s.permission);
  const change = useWorkflowChange();
  const reminders = config.reminders ?? [];
  const caption = [palette.font('body', 13), { color: palette.caption }];

  const toggle = (r: Reminder, enabled: boolean) =>
    change(
      [{ op: 'updateReminder', reminderId: r.id, changes: { enabled } }],
      t(locale, 'describeUpdateReminder', { title: r.title }),
    );
  const remove = (r: Reminder) =>
    change(
      [{ op: 'removeReminder', reminderId: r.id }],
      t(locale, 'describeRemoveReminder', { title: r.title }),
    );

  return (
    <ScrollView
      testID="reminders-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
      <Text style={caption}>{t(locale, 'remindersHint')}</Text>
      {permission === 'denied' && reminders.some((r) => r.enabled) ? (
        <Text
          testID="reminders-off"
          style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
          {t(locale, 'remindersOff')}
        </Text>
      ) : null}
      {reminders.length === 0 ? (
        <Card palette={palette}>
          <Text style={caption}>{t(locale, 'remindersNone')}</Text>
        </Card>
      ) : (
        reminders.map((r) => (
          <Card key={r.id} palette={palette} testID={`reminder-${r.id}`}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[palette.font('title', 16), { color: palette.text }]}>{r.title}</Text>
                <Text style={caption}>{reminderWhen(r, config, locale)}</Text>
              </View>
              <Switch
                testID={`reminder-${r.id}-enabled`}
                value={r.enabled}
                onValueChange={(on) => void toggle(r, on)}
                trackColor={{ true: palette.primary }}
              />
            </View>
            <Button
              palette={palette}
              variant="text"
              testID={`reminder-${r.id}-remove`}
              label={t(locale, 'reminderRemove')}
              onPress={() => void remove(r)}
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
