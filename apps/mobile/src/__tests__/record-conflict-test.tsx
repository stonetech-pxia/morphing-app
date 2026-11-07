import {
  applyOps,
  createDefaultWorkspace,
  createMockAIProvider,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { Alert, type AlertButton } from 'react-native';

import { useRecordActions } from '../data/records';
import { MemoryWorkspaceRepo } from '../storage/memory';
import type { StoredRecord, WorkspaceRepo } from '../storage/types';
import { FakeFiles } from '../test-utils/fake-files';
import { sqliteRepo } from '../test-utils/node-sqlite';
import { renderToolsApp, testRegistry } from '../test-utils/render-app';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// R05：表单打开之后，同一条记录被别的入口（通知按钮、桌面小组件、别的页面）改了——保存时不能静默改回旧值。
// 在存储这一层按「打开时的值」做条件写入；冲突时让用户选：保留我的修改 / 用最新的 / 取消（创始人 2026-11-07 定）。

const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'count', name: '次数', type: 'number' },
    { id: 'note', name: '备注', type: 'text' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(createDefaultWorkspace(locale), [{ op: 'addData', table: tasks }], {
    registry,
    locale,
  });
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const opened = (values: Record<string, unknown> = { name: '跑步', count: 2 }) => ({
  id: 'run00001',
  collectionId: 'tasks',
  values,
  createdAt: 1,
  updatedAt: 1,
});

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('updateRecordIfUnchanged (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('值还是打开时的：写入；键的顺序不同不算变了', async () => {
    const repo = await make();
    await repo.insertRecord(opened({ name: '跑步', count: 2 }));
    const result = await repo.updateRecordIfUnchanged(
      'run00001',
      { count: 2, name: '跑步' },
      { name: '慢跑', count: 2 },
      5,
    );
    expect(result).toBe('updated');
    expect(await repo.getRecord('run00001')).toMatchObject({
      values: { name: '慢跑', count: 2 },
      updatedAt: 5,
    });
  });

  it('值已经被改过：不写，原样留着', async () => {
    const repo = await make();
    await repo.insertRecord(opened());
    await repo.updateRecord('run00001', { name: '跑步', count: 3 }, 2);
    const result = await repo.updateRecordIfUnchanged(
      'run00001',
      { name: '跑步', count: 2 },
      { name: '慢跑', count: 2 },
      5,
    );
    expect(result).toBe('conflict');
    expect(await repo.getRecord('run00001')).toMatchObject({
      values: { name: '跑步', count: 3 },
      updatedAt: 2,
    });
  });

  it('记录已经删了（在最近删除里）或不存在：gone，不写', async () => {
    const repo = await make();
    await repo.insertRecord(opened());
    await repo.deleteRecord('run00001', 9);
    expect(await repo.updateRecordIfUnchanged('run00001', opened().values, { name: 'x' }, 5)).toBe(
      'gone',
    );
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '跑步', count: 2 });
    expect(await repo.updateRecordIfUnchanged('nothere1', {}, { name: 'x' }, 5)).toBe('gone');
  });
});

async function hookSetup() {
  const repo = new MemoryWorkspaceRepo();
  await repo.commitRevision({
    baseId: null,
    config: seed('zh', testRegistry),
    source: 'user',
    summary: 'seed',
  });
  await repo.insertRecord(opened());
  const store = createWorkspaceStore({
    repo,
    registry: testRegistry,
    provider: createMockAIProvider(),
    locale: 'zh',
    now: () => new Date(),
  });
  await store.getState().boot();
  const files = new FakeFiles();
  const hook = await renderHook(() => useRecordActions(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WorkspaceProvider value={{ repo, files, store, registry: testRegistry, locale: 'zh' }}>
        {children}
      </WorkspaceProvider>
    ),
  });
  return { repo, hook };
}

describe('保存一条已有的记录', () => {
  it('表单是旧的，别处刚改过：不覆盖，报冲突并带上最新的那条', async () => {
    const { repo, hook } = await hookSetup();
    const openedRecord = (await repo.getRecord('run00001'))!;
    await repo.updateRecord('run00001', { name: '跑步', count: 3 }, 100);
    let result: Awaited<ReturnType<ReturnType<typeof useRecordActions>['update']>> | undefined;
    await act(async () => {
      result = await hook.result.current.update(tasks, openedRecord, { name: '慢跑' });
    });
    expect(result).toMatchObject({ ok: false, conflict: { values: { name: '跑步', count: 3 } } });
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '跑步', count: 3 });
  });

  it('没人改过：照常保存，别的项不动', async () => {
    const { repo, hook } = await hookSetup();
    const openedRecord = (await repo.getRecord('run00001'))!;
    await act(async () => {
      expect(await hook.result.current.update(tasks, openedRecord, { name: '慢跑' })).toEqual({
        ok: true,
        id: 'run00001',
      });
    });
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '慢跑', count: 2 });
  });

  it('列表上勾一下（只改一项）：按现在存的那条改，别处刚改的项保持最新', async () => {
    const { repo, hook } = await hookSetup();
    await repo.updateRecord('run00001', { name: '跑步', count: 3 }, 100);
    await act(async () => {
      expect(await hook.result.current.patch(tasks, 'run00001', { note: '下雨' })).toEqual({
        ok: true,
        id: 'run00001',
      });
    });
    expect((await repo.getRecord('run00001'))!.values).toEqual({
      name: '跑步',
      count: 3,
      note: '下雨',
    });
  });

  it('改的时候记录被删了：不写', async () => {
    const { repo, hook } = await hookSetup();
    const openedRecord = (await repo.getRecord('run00001'))!;
    await repo.deleteRecord('run00001', 9);
    await act(async () => {
      expect(await hook.result.current.update(tasks, openedRecord, { name: '慢跑' })).toEqual({
        ok: false,
        gone: true,
      });
    });
    expect((await repo.getRecord('run00001'))!.values.name).toBe('跑步');
  });
});

describe('记录页：保存时发现记录刚被别处改过', () => {
  afterEach(() => jest.restoreAllMocks());

  /** 打开记录页，把名字改成「慢跑」，别处把次数改成 3，再点保存。返回弹出的确认框。 */
  async function conflict(locale: Locale = 'zh') {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord(opened());
    const app = await renderToolsApp(repo, undefined, { locale, seed });
    await act(async () => router.push('/record/tasks?recordId=run00001'));
    await fireEvent.changeText(await screen.findByTestId('editor-name'), '慢跑');
    await repo.updateRecord('run00001', { name: '跑步', count: 3 }, 100);
    let shown: { title: string; buttons: AlertButton[] } | undefined;
    jest.spyOn(Alert, 'alert').mockImplementationOnce((title, _message, buttons) => {
      shown = { title: title ?? '', buttons: buttons ?? [] };
    });
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(shown).toBeDefined());
    const press = async (text: string) => {
      await act(async () => shown!.buttons.find((b) => b.text === text)!.onPress?.());
    };
    return { ...app, repo, shown: shown!, press };
  }

  it('先问：不覆盖，三个选项：保留我的修改、用最新的、取消', async () => {
    const { repo, shown } = await conflict();
    expect(shown.title).toBe('这条记录刚被别处改过');
    expect(shown.buttons.map((b) => b.text)).toEqual(['保留我的修改', '用最新的', '取消']);
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '跑步', count: 3 });
  });

  it('用最新的：放弃我的修改，表单换成最新的，什么都不写', async () => {
    const { repo, press } = await conflict();
    await press('用最新的');
    await waitFor(() => expect(screen.getByTestId('editor-name').props.value).toBe('跑步'));
    expect(screen.getByTestId('editor-count').props.value).toBe('3');
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '跑步', count: 3 });
  });

  it('取消：留在表单上，我的修改还在，什么都不写', async () => {
    const { repo, press } = await conflict();
    await press('取消');
    expect(screen.getByTestId('editor-name').props.value).toBe('慢跑');
    expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '跑步', count: 3 });
  });

  it('法语：确认框是法语', async () => {
    const { shown } = await conflict('fr');
    expect(shown.title).toBe('Cette entrée vient d’être modifiée ailleurs');
    expect(shown.buttons.map((b) => b.text)).toEqual([
      'Garder mes modifications',
      'Utiliser la dernière version',
      'Annuler',
    ]);
  });

  it('改的时候这条被删了：说一声，什么都没存', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord(opened());
    await renderToolsApp(repo, undefined, { seed });
    await act(async () => router.push('/record/tasks?recordId=run00001'));
    await fireEvent.changeText(await screen.findByTestId('editor-name'), '慢跑');
    await repo.deleteRecord('run00001', 9);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![0]).toBe('这条记录在你编辑时被删除了');
    expect(((await repo.getRecord('run00001')) as StoredRecord).values.name).toBe('跑步');
  });

  // 放在最后：存好以后页面返回，测试环境里 router 是全局的，返回会带走下一个用例的页面。
  it('保留我的修改：只保存我改过的项，别处改的次数保持最新', async () => {
    const { repo, press } = await conflict();
    await press('保留我的修改');
    await waitFor(async () =>
      expect((await repo.getRecord('run00001'))!.values).toEqual({ name: '慢跑', count: 3 }),
    );
    // 存好了就回去（等回去了再结束，免得下一个用例被它的返回带走）。
    await waitFor(() => expect(screen.queryByTestId('editor-name')).toBeNull());
  });
});
