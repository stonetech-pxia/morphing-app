import type { SQLiteDatabase } from 'expo-sqlite';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { SQLiteWorkspaceRepo } from '../storage/sqlite';

it('counts all successful runs per workflow, ignores failures and uses latest start', async () => {
  const repo = new MemoryWorkspaceRepo();
  expect(await repo.countSucceededRuns()).toEqual(new Map());
  for (const [workflowId, status] of [
    ['a', 'succeeded'],
    ['b', 'succeeded'],
    ['a', 'failed'],
    ['a', 'cancelled'],
    ['a', 'succeeded'],
  ] as const) {
    const id = await repo.startToolRun({ toolId: 'image', workflowId, revisionId: 1 });
    await repo.finishToolRun(id, { status });
  }
  await repo.startToolRun({ toolId: 'image', workflowId: 'a', revisionId: 1 });
  const all = await repo.listToolRuns(100);
  const counts = await repo.countSucceededRuns();
  expect(counts.get('a')).toEqual({
    count: 2,
    lastAt: all.find((r) => r.workflowId === 'a' && r.status === 'succeeded')!.startedAt,
  });
  expect(counts.get('b')?.count).toBe(1);
});

it('SQLite aggregates in one query without a history limit', async () => {
  const getAllAsync = jest.fn(async () => [{ workflowId: 'a', count: 32, lastAt: 123 }]);
  const repo = new SQLiteWorkspaceRepo({ getAllAsync } as unknown as SQLiteDatabase);
  expect(await repo.countSucceededRuns()).toEqual(new Map([['a', { count: 32, lastAt: 123 }]]));
  expect(getAllAsync).toHaveBeenCalledTimes(1);
  const query = getAllAsync.mock.calls[0] as unknown as [string];
  expect(query[0]).toContain("WHERE status = 'succeeded' GROUP BY workflow_id");
  expect(query[0]).not.toContain('LIMIT');
});
