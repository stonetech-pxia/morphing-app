import { findWorkflow, quickActionsOf, t } from '@morph/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { usePalette } from '@/renderer/theme';
import { WorkflowEditor } from '@/run/WorkflowEditor';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 编辑一个工作流（参数、每次运行时问、步骤）。保存生成一个可撤销的版本。 */
export default function WorkflowRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const workflow = findWorkflow(quickActionsOf(config), id, locale);
  if (!workflow) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, '_id__This_quick_action_no_longer_exists_35f5a')}
        </Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: workflow.name }} />
      {/* 换了工作流（例如复制后）时重新建草稿。 */}
      <WorkflowEditor
        key={workflow.id}
        workflow={workflow}
        palette={palette}
        locale={locale}
        registry={registry}
      />
    </>
  );
}
