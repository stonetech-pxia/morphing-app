import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { RunScreen } from '@/run/RunScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 运行一个工作流（工具页的单功能工作流、预设或用户自己的工作流）。 */
export default function RunRoute() {
  const { workflowId } = useLocalSearchParams<{ workflowId: string }>();
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const router = useRouter();
  const workflow = config.workflows.find((w) => w.id === workflowId);
  if (!workflow) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'toolMissing')}
        </Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: workflow.name }} />
      <RunScreen
        workflow={workflow}
        onEdit={() => router.push({ pathname: '/workflow/[id]', params: { id: workflow.id } })}
      />
    </>
  );
}
