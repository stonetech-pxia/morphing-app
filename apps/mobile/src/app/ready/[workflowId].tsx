import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { isSampleKind } from '@/guide/samples';
import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { ReadyScreen } from '@/shell/ReadyScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** AI 新做的快捷操作（D-125）。被撤销后打开时说明它已经不在了。 */
export default function ReadyRoute() {
  const { workflowId, sample } = useLocalSearchParams<{ workflowId: string; sample?: string }>();
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
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
  return <ReadyScreen workflow={workflow} {...(isSampleKind(sample) ? { sample } : {})} />;
}
