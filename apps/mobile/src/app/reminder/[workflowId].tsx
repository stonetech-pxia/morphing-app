import { findWorkflow, localize } from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { Button, Card } from '@/renderer/ui';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/**
 * 点了提醒、提醒要打开一个快捷操作（D-251）：只把它摆出来，用户自己点「开始」才运行。
 * 不能直接打开运行页面：运行页面一打开就开始运行，而提醒绝不自动运行任何东西。
 */
export default function ReminderRoute() {
  const { workflowId } = useLocalSearchParams<{ workflowId: string }>();
  const { locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const router = useRouter();
  const workflow = findWorkflow(config.workflows, workflowId, locale);
  const body = [palette.font('body', 15), { color: palette.text }];
  return (
    <ScrollView
      testID="reminder-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
      <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
        {t(locale, 'reminderOpenTitle')}
      </Text>
      {workflow ? (
        <>
          <Card palette={palette}>
            <Text
              testID="reminder-name"
              style={[palette.font('title', 17), { color: palette.text }]}>
              {workflow.name}
            </Text>
            {workflow.steps.map((step, i) => (
              <Text key={step.id} style={body}>
                {`${i + 1}. ${localize(registry.actions.get(step.action)?.label, locale) ?? step.action}`}
              </Text>
            ))}
          </Card>
          <Button
            palette={palette}
            testID="reminder-run"
            label={t(locale, 'reminderOpenRun')}
            onPress={() =>
              router.replace({ pathname: '/run/[workflowId]', params: { workflowId: workflow.id } })
            }
          />
        </>
      ) : (
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'reminderOpenMissing')}
        </Text>
      )}
    </ScrollView>
  );
}
