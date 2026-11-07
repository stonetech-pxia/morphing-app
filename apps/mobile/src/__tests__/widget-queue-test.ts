import { applyOps, createDefaultWorkspace, type WorkspaceConfig } from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import type { WorkspaceRepo } from '../storage/types';
import { sqliteRepo } from '../test-utils/node-sqlite';
import { testRegistry } from '../test-utils/render-app';
import { actionHash } from '../widgets/ops';
import { runQueuedWidgetOps } from '../widgets/useWidgets';

// R07：小组件上点的操作先读（不删）、一条一条执行并和「这条做过了」的标记一起存进数据库，最后才确认删掉。
// 中途出错、App 被杀，没做的还在队列里，下次接着做；做完的、删除失败的，下次读到也不会做第二遍。

const action = { do: 'create', table: 'water', values: { day: 'today' } } as const;

function config(): WorkspaceConfig {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [
      {
        op: 'addData',
        table: { id: 'water', name: '喝水', fields: [{ id: 'day', name: '日期', type: 'date' }] },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'drink',
          look: 'button',
          show: { label: '+1 杯水', variant: 'filled' },
          tools: [action],
        },
      },
    ],
    { registry: testRegistry, locale: 'zh' },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config as WorkspaceConfig;
}

const tap = (id: string, at: number) => ({
  id,
  text: JSON.stringify({ op: 'b:drink', component: 'drink', hash: actionHash(action), at }),
});
const now = new Date(2026, 10, 7, 12);
const count = async (repo: WorkspaceRepo) => (await repo.listRecords('water')).length;

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('queued widget taps (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('做完的点按确认删掉（用 id），没点按时返回 null', async () => {
    const repo = await make();
    const removed: string[] = [];
    const remove = async (ids: readonly string[]) => void removed.push(...ids);
    expect(await runQueuedWidgetOps([], repo, config(), now, remove)).toBeNull();
    const result = await runQueuedWidgetOps(
      [tap('a1', 1000), tap('a2', 2000)],
      repo,
      config(),
      now,
      remove,
    );
    expect(result).toEqual({ done: 2, skipped: 0 });
    expect(await count(repo)).toBe(2);
    expect(removed.sort()).toEqual(['a1', 'a2']);
  });

  it('第 2 条写不进去：第 1 条做完并确认删掉，第 2、3 条留在队列里；下次接着做、各一次', async () => {
    const repo = await make();
    const queue = [tap('a1', 1000), tap('a2', 2000), tap('a3', 3000)];
    const remove = async (ids: readonly string[]) => {
      for (const id of ids)
        queue.splice(
          queue.findIndex((q) => q.id === id),
          1,
        );
    };
    const original = repo.applyRecordWrites.bind(repo);
    let calls = 0;
    jest.spyOn(repo, 'applyRecordWrites').mockImplementation(async (writes, meta) => {
      if (++calls === 2) throw new Error('disk write failed');
      return original(writes, meta);
    });
    const first = await runQueuedWidgetOps([...queue], repo, config(), now, remove);
    expect(first).toMatchObject({ done: 1 });
    expect(queue.map((q) => q.id)).toEqual(['a2', 'a3']);
    expect(await count(repo)).toBe(1);
    // 下次：剩下的两条各做一次。
    const second = await runQueuedWidgetOps([...queue], repo, config(), now, remove);
    expect(second).toEqual({ done: 2, skipped: 0 });
    expect(queue).toEqual([]);
    expect(await count(repo)).toBe(3);
  });

  it('确认删除失败：下次又读到同样的点按，不会再做一遍，只再确认删除', async () => {
    const repo = await make();
    const queue = [tap('a1', 1000), tap('a2', 2000)];
    const failing = async () => {
      throw new Error('cannot delete');
    };
    const first = await runQueuedWidgetOps([...queue], repo, config(), now, failing);
    expect(first).toEqual({ done: 2, skipped: 0 });
    expect(await count(repo)).toBe(2);
    const removed: string[] = [];
    const again = await runQueuedWidgetOps([...queue], repo, config(), now, async (ids) => {
      removed.push(...ids);
    });
    expect(await count(repo)).toBe(2);
    expect(removed.sort()).toEqual(['a1', 'a2']);
    expect(again).toBeNull();
  });

  it('做不了的点按（组件改过了）算「没执行」，也确认删掉，不再留着', async () => {
    const repo = await make();
    const stale = {
      id: 'z1',
      text: JSON.stringify({ op: 'b:drink', component: 'drink', hash: 'oldhash', at: 1000 }),
    };
    const removed: string[] = [];
    const result = await runQueuedWidgetOps(
      [stale, tap('a1', 2000)],
      repo,
      config(),
      now,
      async (ids) => {
        removed.push(...ids);
      },
    );
    expect(result).toEqual({ done: 1, skipped: 1 });
    expect(removed.sort()).toEqual(['a1', 'z1']);
  });

  it('写坏的一条跳过并删掉', async () => {
    const repo = await make();
    const removed: string[] = [];
    const result = await runQueuedWidgetOps(
      [{ id: 'bad1', text: '{not json' }, tap('a1', 2000)],
      repo,
      config(),
      now,
      async (ids) => {
        removed.push(...ids);
      },
    );
    expect(result).toEqual({ done: 1, skipped: 1 });
    expect(removed.sort()).toEqual(['a1', 'bad1']);
  });
});
