import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { RunScreen } from '@/run/RunScreen';
import { useIncoming } from '@/share/incoming';
import { useToolDownloads } from '@/tool-download/context';
import { toolRevoked } from '@/tool-download/state';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 运行一个工作流（工具页的单功能工作流、预设或用户自己的工作流）。 */
export default function RunRoute() {
  const { workflowId, shared } = useLocalSearchParams<{ workflowId: string; shared?: string }>();
  // 从收件页面来的（D-115）：用分享进来的那一批文件做第一步的输入。
  const [incoming] = useState(() => {
    const share = useIncoming.getState().share;
    return shared && share && String(share.id) === shared ? share : null;
  });
  const { locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const router = useRouter();
  const workflow = config.workflows.find((w) => w.id === workflowId);
  // 下载的工具被停用了（D-178）：它的快捷操作不能运行，配置和文件都留着。
  const revoked = useToolDownloads(
    (s) => workflow?.toolId !== undefined && toolRevoked(s, workflow.toolId),
  );
  if (workflow && revoked) {
    const name = registry.tools.get(workflow.toolId!)?.name[locale] ?? workflow.toolId!;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Stack.Screen options={{ title: workflow.name }} />
        <Text
          testID="run-revoked"
          style={[palette.font('body', 15), { color: palette.muted, textAlign: 'center' }]}>
          {t(locale, 'toolRevokedRun', { name })}
        </Text>
      </View>
    );
  }
  if (!workflow || (shared && !incoming)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, workflow ? 'shareGone' : 'toolMissing')}
        </Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: workflow.name }} />
      <RunScreen
        workflow={workflow}
        {...(incoming ? { incoming } : {})}
        onEdit={() => router.push({ pathname: '/workflow/[id]', params: { id: workflow.id } })}
        onAskAI={() => router.push({ pathname: '/change', params: { workflow: workflow.id } })}
      />
    </>
  );
}
