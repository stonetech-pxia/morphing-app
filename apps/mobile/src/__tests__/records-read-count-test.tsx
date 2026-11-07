import {
  applyOps,
  createDefaultWorkspace,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { act, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { readTable } from '../data/records';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// R13（量过再决定）：同一屏上有几个读同一张表的组件时，读这张表的次数不随组件个数增加——
// 首次显示一样，记录有写入（recordsVersion 变）之后重新读也一样。以后改了读取方式，这个性质不能丢。

const table = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text' },
    { id: 'n', name: 'n', type: 'number' },
  ],
};

const blocks = (count: number): NewComponent[] =>
  Array.from({ length: count }, (_, i) =>
    i % 2 === 0
      ? {
          id: `l${i}`,
          look: 'list',
          source: { table: 'tasks', limit: 30 },
          show: { title: 'title' },
        }
      : {
          id: `s${i}`,
          look: 'stat',
          source: { table: 'tasks' },
          show: { value: { aggregate: 'count' }, label: `数${i}` },
        },
  ) as never;

const seedWith = (count: number) => (locale: Locale, registry: Registry) => {
  const r = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table } as never,
      ...blocks(count).map((block) => ({ op: 'addContainer' as const, page: 'home', block })),
    ],
    { registry, locale },
  );
  if (!r.ok) throw new Error(r.error);
  return r.config as never;
};

async function reads(components: number) {
  const repo = new MemoryWorkspaceRepo();
  for (let i = 0; i < 5; i++)
    await repo.insertRecord({
      id: `r${i}aaaaaa`,
      collectionId: 'tasks',
      values: { title: `t${i}`, n: i },
      createdAt: i,
      updatedAt: i,
    });
  const spy = jest.spyOn(repo, 'listRecords');
  const { store } = await renderToolsApp(repo, undefined, { seed: seedWith(components) });
  await waitFor(() => expect(screen.getAllByText('t1').length).toBeGreaterThan(0));
  const count = () => spy.mock.calls.filter((c) => c[0] === 'tasks').length;
  const first = count();
  spy.mockClear();
  await act(async () => store.getState().bumpRecords());
  await waitFor(() => expect(count()).toBeGreaterThan(0));
  await act(async () => {
    await Promise.resolve();
  });
  return { first, afterWrite: count() };
}

it('reads of a table do not grow with the number of components showing it', async () => {
  const few = await reads(2);
  jest.restoreAllMocks();
  const many = await reads(8);
  expect(many.first).toBe(few.first);
  expect(many.afterWrite).toBe(few.afterWrite);
});

describe('readTable', () => {
  const rec = (id: string) => ({
    id,
    collectionId: 'tasks',
    values: {},
    createdAt: 1,
    updatedAt: 1,
  });

  it('shares only a read that is still running, and only within one version', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord(rec('aaaaaaa1'));
    const spy = jest.spyOn(repo, 'listRecords');
    const [a, b] = await Promise.all([readTable(repo, 1, 'tasks'), readTable(repo, 1, 'tasks')]);
    expect(spy).toHaveBeenCalledTimes(1);
    // 每个组件拿到自己的数组。
    expect(a).not.toBe(b);
    a.pop();
    expect(b).toHaveLength(1);
    // 另一个版本：不共用。
    await Promise.all([readTable(repo, 1, 'tasks'), readTable(repo, 2, 'tasks')]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not keep the result: a write that nobody bumped is still read next time', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord(rec('aaaaaaa1'));
    expect(await readTable(repo, 1, 'tasks')).toHaveLength(1);
    await repo.insertRecord(rec('aaaaaaa2'));
    expect(await readTable(repo, 1, 'tasks')).toHaveLength(2);
  });

  it('a failed read is not remembered', async () => {
    const repo = new MemoryWorkspaceRepo();
    jest.spyOn(repo, 'listRecords').mockRejectedValueOnce(new Error('locked'));
    await expect(readTable(repo, 1, 'tasks')).rejects.toThrow('locked');
    expect(await readTable(repo, 1, 'tasks')).toEqual([]);
  });
});
