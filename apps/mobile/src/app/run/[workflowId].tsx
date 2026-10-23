import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { isSampleKind, loadSamples } from '@/guide/samples';
import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { RunScreen } from '@/run/RunScreen';
import { useIncoming, type IncomingShare } from '@/share/incoming';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 运行一个工作流（工具页的单功能工作流、预设或用户自己的工作流）。 */
export default function RunRoute() {
  const { workflowId, shared, sample } = useLocalSearchParams<{
    workflowId: string;
    shared?: string;
    sample?: string;
  }>();
  // 从收件页面来的（D-115）：用分享进来的那一批文件做第一步的输入。
  const [incoming] = useState(() => {
    const share = useIncoming.getState().share;
    return shared && share && String(share.id) === shared ? share : null;
  });
  // 新手引导的示例文件（D-149）：准备好之后当作分享进来的文件交给第一步。
  const sampleKind = isSampleKind(sample) ? sample : null;
  const [samples, setSamples] = useState<IncomingShare | null>(null);
  const [samplesFailed, setSamplesFailed] = useState(false);
  useEffect(() => {
    if (!sampleKind) return;
    loadSamples(sampleKind)
      .then((files) => setSamples({ id: 0, files, copies: [] }))
      .catch(() => setSamplesFailed(true));
  }, [sampleKind]);
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const router = useRouter();
  const workflow = config.workflows.find((w) => w.id === workflowId);
  if (!workflow || (shared && !incoming) || samplesFailed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, workflow && !samplesFailed ? 'shareGone' : 'toolMissing')}
        </Text>
      </View>
    );
  }
  if (sampleKind && !samples) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  const input = samples ?? incoming;
  return (
    <>
      <Stack.Screen options={{ title: workflow.name }} />
      <RunScreen
        workflow={workflow}
        {...(input ? { incoming: input } : {})}
        {...(sampleKind ? { sample: sampleKind } : {})}
        onEdit={() => router.push({ pathname: '/workflow/[id]', params: { id: workflow.id } })}
        onAskAI={() => router.push({ pathname: '/change', params: { workflow: workflow.id } })}
      />
    </>
  );
}
