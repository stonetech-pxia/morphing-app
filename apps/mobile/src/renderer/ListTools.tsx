import {
  attachmentIdsOfRecords,
  findWorkflowTarget,
  handedFilesFor,
  handedInput,
  isToolRefUse,
  quickActionsOf,
  recordsValue,
  type AttachmentInfo,
  type Collection,
  type DataRecord,
  type HandedFiles,
  type RunValue,
  type ToolUse,
} from '@morph/core';
import { Text, View } from 'react-native';

import { useHandedRun } from '../run/useHandedRun';
import { useWorkspaceContext } from '../workspace/context';
import { useAssets } from './Attachments';
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
  // 第一步收文件的快捷操作（D-442）：交列表现在选出的这些记录第一个附件字段里它收的文件。
  const { registry } = useWorkspaceContext();
  const takesFiles = (wf: (typeof shown)[number]) => handedInput(wf.steps, registry) === 'files';
  const fileIds = shown.some(takesFiles) ? attachmentIdsOfRecords(collection, records) : [];
  const loaded = useAssets(fileIds);
  if (shown.length === 0 || records.length === 0) return null;
  const infos = new Map<string, AttachmentInfo>(
    [...loaded].flatMap(([id, asset]) =>
      asset ? [[id, { id, name: asset.name, mimeType: asset.mimeType, size: asset.size }]] : [],
    ),
  );
  const buttons = shown.flatMap(
    (workflow): { workflow: typeof workflow; value: RunValue | HandedFiles }[] => {
      if (!takesFiles(workflow))
        return [{ workflow, value: recordsValue(collection, [...records]) }];
      const files = handedFilesFor(
        registry.actions.get(workflow.steps[0]!.action)!,
        collection,
        records,
        infos,
      );
      return files ? [{ workflow, value: files }] : [];
    },
  );
  if (buttons.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      {buttons.map(({ workflow, value }) => (
        <Button
          key={workflow.id}
          palette={palette}
          testID={`list-tool-${workflow.id}`}
          variant="outline"
          label={workflow.name}
          {...(workflow.icon ? { icon: workflow.icon } : {})}
          onPress={env.interactive ? (env.locked ?? (() => void run(workflow, value))) : undefined}
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
