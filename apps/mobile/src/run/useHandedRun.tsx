import { calendarOf, runsInline, type RunValue, type Workflow } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useRunHost } from '../desk/useRunHost';
import { runErrorText } from '../i18n';
import type { Palette } from '../renderer/theme';
import { newAssetId, startRun, type Run } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { handOver } from './handed';

// 容器上的工具（D-428）：用户点了按钮才运行，把容器的值交给第一步。一个值或一条记录、最后交给 App 外面的
// （打电话、分享 vCard）在原地跑，没有结果页；别的打开运行页面（有进度和结果）。进入页面什么都不跑（底线 15、16）。

export function useHandedRun(palette: Palette) {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config!);
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const bumpRecords = useWorkspace((s) => s.bumpRecords);
  const host = useRunHost(palette, locale);
  const router = useRouter();
  const running = useRef(false);
  // 分享面板可能还在用文件：下一次运行或离开页面时才删。
  const last = useRef<Run | null>(null);
  useEffect(
    () => () => {
      void last.current?.dispose();
    },
    [],
  );

  async function run(workflow: Workflow, value: RunValue) {
    if (!runsInline(workflow, value)) {
      router.push({
        pathname: '/run/[workflowId]',
        params: { workflowId: workflow.id, handed: handOver(value) },
      });
      return;
    }
    if (running.current) return;
    running.current = true;
    try {
      await last.current?.dispose();
      last.current = null;
      const started = await startRun({
        workflow,
        revisionId,
        repo,
        files,
        registry,
        locale,
        now: () => new Date(),
        newId: newAssetId,
        ui: host.ui,
        collections: config.data.tables,
        calendar: calendarOf(config),
        packs: host.packs ?? null,
        ...(host.askParams ? { askParams: host.askParams } : {}),
        ...(host.ensurePack ? { ensurePack: host.ensurePack } : {}),
        ...(host.ensurePacks ? { ensurePacks: host.ensurePacks } : {}),
        handed: value,
      });
      last.current = started;
      const { result } = started;
      if (result.status === 'failed')
        Alert.alert(runErrorText(locale, result.error.code, result.error.detail));
      if (result.status === 'succeeded' && result.saved.length > 0) bumpAssets();
      if (workflow.steps.some((s) => s.action === 'out.addRecord')) bumpRecords();
    } finally {
      running.current = false;
    }
  }

  return { run, elements: host.elements };
}
