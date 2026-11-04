import {
  findWorkflowTarget,
  isToolRefUse,
  quickActionsOf,
  recordsValue,
  type Collection,
  type DataRecord,
  type ToolUse,
} from '@morph/core';
import { Text, View } from 'react-native';

import { useHandedRun } from '../run/useHandedRun';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { onPage } from './theme';
import { Button } from './ui';

// 列表上方的按钮（as: "list"，D-428）：点了才运行，把列表现在选出的记录交给快捷操作：筛选、搜索之后的全部，
// 不截到 limit（导出要全部对得上的）。按钮下面写明交的是几条（底线 17）。一条都没有时没有按钮。

export function ListTools({
  tools,
  collection,
  records,
  searching,
  env,
}: {
  tools: readonly ToolUse[];
  collection: Collection;
  records: readonly DataRecord[];
  searching: boolean;
  env: RenderEnv;
}) {
  const { palette, locale } = env;
  const page = onPage(palette);
  const { run, elements } = useHandedRun(palette);
  const quickActions = quickActionsOf(env.config);
  const shown = tools.flatMap((u) => {
    if (u.as !== 'list' || !isToolRefUse(u)) return [];
    const workflow = findWorkflowTarget(quickActions, u.tool, locale);
    return workflow ? [workflow] : [];
  });
  if (shown.length === 0 || records.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      {shown.map((workflow) => (
        <Button
          key={workflow.id}
          palette={palette}
          testID={`list-tool-${workflow.id}`}
          variant="outline"
          label={workflow.name}
          {...(workflow.icon ? { icon: workflow.icon } : {})}
          onPress={
            env.interactive
              ? (env.locked ?? (() => void run(workflow, recordsValue(collection, [...records]))))
              : undefined
          }
          onLongPress={env.onLongPress}
        />
      ))}
      <Text testID="list-tool-count" style={[page.font('body', 13), { color: page.caption }]}>
        {t(locale, searching ? 'listToolFound' : 'listToolAll', { n: records.length })}
      </Text>
      {elements}
    </View>
  );
}
