import { createDefaultWorkspace, type WorkspaceConfig } from '@morph/core';
import { router } from 'expo-router';
import { act } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';
// v33 的 App 存下来的一份配置（core 冻结的 fixture）：一键记录的四张表，每张表一页（按钮模式的「添加」 + 列表）。
import v33OneTap from '../../../../packages/core/src/fixtures/v33/setup-oneTap-zh.json';

// 更新 App 之前的历史版本（schemaVersion 33）在 v34 里恢复：先升级（core 的 prepareSnapshot），再照常显示。

it('restoring a version saved by the v33 app brings its pages back, drawn from v34 blocks', async () => {
  const repo = new MemoryWorkspaceRepo();
  await repo.commitRevision({
    baseId: null,
    config: v33OneTap as unknown as WorkspaceConfig,
    source: 'user',
    summary: 'v33',
  });
  await repo.commitRevision({
    baseId: 1,
    config: createDefaultWorkspace('zh'),
    source: 'user',
    summary: '新的首页',
  });
  const at = Date.now();
  await repo.insertRecord({
    id: 'w1aaaaaa',
    collectionId: 'water',
    values: { date: '2026-10-29', glasses: 3 },
    createdAt: at,
    updatedAt: at,
  });
  const { store } = await renderToolsApp(repo);
  expect(store.getState().config!.data.tables).toEqual([]);

  const result = await act(() => store.getState().proposeRestore(1));
  expect(result.kind).toBe('preview');
  await act(() => store.getState().confirm());
  const config = store.getState().config!;
  expect(config.schemaVersion).toBe(34);
  expect(config.data.tables.map((t) => t.id)).toEqual(['water', 'worklog', 'packing', 'bills']);
  // v33 的 recordForm button 成了 button 块，列表成了 look list。
  const page = config.containers.pages.find((p) => p.id === 'page-water')!;
  expect(page.blocks.map((b) => b.look)).toEqual(['button', 'list']);

  await act(() => router.push('/page/page-water'));
  expect(await screen.findByTestId('record-w1aaaaaa')).toBeTruthy();
  expect(screen.getByText('添加')).toBeTruthy();
});
