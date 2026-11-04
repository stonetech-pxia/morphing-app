import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 保存新记录前问一句（D-426）：记录页、「记一笔」、页面上的添加表单都走同一个检查。
// 三种状态：新用户（没有记录）、有数据（一样的、不一样的）、边界（回收站里的、没有标题、编辑已有的记录、同一次运行刚存的）。

const receipts: Collection = {
  id: 'claims',
  name: '报销',
  prefillRules: 'receipt',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    { id: 'date', name: '日期', type: 'date' },
    { id: 'merchant', name: '商家', type: 'text' },
  ],
};

const plain: Collection = { ...receipts, id: 'plain', name: '普通' };
delete plain.prefillRules;

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: receipts },
      { op: 'addData', table: plain },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'add',
          look: 'form',
          show: { mode: 'inline' },
          tools: [
            {
              as: 'submit',
              label: '记一下',
              do: 'create',
              table: 'claims',
              ask: ['amount', 'date'],
            },
          ],
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

function alerts() {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const last = () => spy.mock.calls.at(-1)!;
  return {
    spy,
    message: () => last()[1],
    labels: () => ((last()[2] ?? []) as AlertButton[]).map((b) => b.text),
    press: (label: string) =>
      act(async () => {
        ((last()[2] ?? []) as AlertButton[]).find((b) => b.text === label)!.onPress!();
      }),
  };
}

async function setup(records: { id: string; values: Record<string, unknown> }[] = []) {
  const repo = new MemoryWorkspaceRepo();
  for (const r of records)
    await repo.insertRecord({
      ...r,
      collectionId: 'claims',
      createdAt: new Date(2026, 10, 3).getTime(),
      updatedAt: 1,
    });
  await renderToolsApp(repo, new FakeFiles(), { seed });
  return repo;
}

/** 存好后页面退回去；等它退完，下一个测试才从头开始。 */
const leftForm = () => waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());

const open = (params: Record<string, string>) =>
  act(() => router.push({ pathname: '/record/[collectionId]', params }));

async function fillNew(collectionId = 'claims') {
  await open({ collectionId });
  await fireEvent.changeText(
    await screen.findByTestId('editor-amount', {}, { timeout: 4000 }),
    '30',
  );
  await fireEvent.changeText(screen.getByTestId('editor-date'), '2026-11-03');
}

const lunch = { id: 'r1', values: { amount: 30, date: '2026-11-03', merchant: '小店' } };

afterEach(async () => {
  jest.restoreAllMocks();
  // 提示条和退回去的动画还在计时器上：跑完，下一个测试才是干净的。
  const flush = () =>
    act(async () => {
      jest.runOnlyPendingTimers();
    });
  await flush();
  await flush();
  cleanup();
  await flush();
  // 卸载以后路由还有收尾的异步工作：换回真的计时器等它做完（renderRouter 下次会再换成假的）。
  jest.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe('the record page (D-426)', () => {
  it('new user: no records, no question, the record is saved', async () => {
    const a = alerts();
    const repo = await setup();
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(async () => expect(await repo.listRecords('claims')).toHaveLength(1));
    await leftForm();
    expect(a.spy).not.toHaveBeenCalled();
  });

  it('a different record is saved without a question', async () => {
    const a = alerts();
    const repo = await setup([{ id: 'r1', values: { amount: 31, date: '2026-11-03' } }]);
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(async () => expect(await repo.listRecords('claims')).toHaveLength(2));
    await leftForm();
    expect(a.spy).not.toHaveBeenCalled();
  });

  it('a similar record: names it; going back writes nothing, the form keeps its values', async () => {
    const a = alerts();
    const repo = await setup([lunch]);
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(a.spy).toHaveBeenCalledTimes(1));
    expect(a.message()).toContain('小店');
    expect(a.labels()).toEqual(['回到表单', '仍然保存']);
    await a.press('回到表单');
    expect(await repo.listRecords('claims')).toHaveLength(1);
    expect(screen.getByTestId('editor-amount').props.value).toBe('30');
  });

  it('save anyway saves a second record and leaves the first one alone (invariants 5, 19)', async () => {
    const a = alerts();
    const repo = await setup([lunch]);
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(a.spy).toHaveBeenCalled());
    const writes = {
      del: jest.spyOn(repo, 'deleteRecord'),
      update: jest.spyOn(repo, 'updateRecord'),
    };
    await a.press('仍然保存');
    await waitFor(async () => expect(await repo.listRecords('claims')).toHaveLength(2));
    await leftForm();
    expect(writes.del).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect((await repo.getRecord('r1'))!.values.merchant).toBe('小店');
  });

  it('a record in the recycle bin does not count', async () => {
    const a = alerts();
    const repo = await setup([lunch]);
    await repo.deleteRecord('r1', Date.now());
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(async () => expect(await repo.listRecords('claims')).toHaveLength(1));
    await leftForm();
    expect(a.spy).not.toHaveBeenCalled();
  });

  it('a record with no title is named by its table and day', async () => {
    const a = alerts();
    await setup([{ id: 'r1', values: { amount: 30, date: '2026-11-03' } }]);
    await fillNew();
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(a.spy).toHaveBeenCalled());
    expect(a.message()).toContain('报销 · ');
  });

  it('editing an existing record never asks', async () => {
    const a = alerts();
    const repo = await setup([lunch, { id: 'r2', values: { ...lunch.values, merchant: '别的' } }]);
    await open({ collectionId: 'claims', recordId: 'r2' });
    await fireEvent.changeText(
      await screen.findByTestId('editor-merchant', {}, { timeout: 4000 }),
      '小店',
    );
    await fireEvent.press(screen.getByTestId('editor-save'));
    await leftForm();
    expect(a.spy).not.toHaveBeenCalled();
    expect((await repo.listRecords('claims')).length).toBe(2);
  });

  it('a table without the parameter never asks and reads nothing on save', async () => {
    const a = alerts();
    const repo = await setup();
    await repo.insertRecord({
      id: 'p1',
      collectionId: 'plain',
      values: { amount: 30, date: '2026-11-03' },
      createdAt: 1,
      updatedAt: 1,
    });
    await fillNew('plain');
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(async () => expect(await repo.listRecords('plain')).toHaveLength(2));
    await leftForm();
    expect(a.spy).not.toHaveBeenCalled();
  });

  it('typing reads no record; only pressing save does', async () => {
    alerts();
    const repo = await setup([lunch]);
    await open({ collectionId: 'claims' });
    await screen.findByTestId('editor-amount', {}, { timeout: 4000 });
    const reads = jest.spyOn(repo, 'listRecords');
    const before = reads.mock.calls.length;
    await fireEvent.changeText(screen.getByTestId('editor-amount'), '3');
    await fireEvent.changeText(screen.getByTestId('editor-amount'), '30');
    expect(reads.mock.calls.length).toBe(before);
  });
});

describe('the form on a page (D-426)', () => {
  it('asks too; going back keeps what was typed', async () => {
    const a = alerts();
    const repo = await setup([lunch]);
    await fireEvent.changeText(await screen.findByTestId('form-add-amount'), '30');
    await fireEvent.changeText(screen.getByTestId('form-add-date'), '2026-11-03');
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    await waitFor(() => expect(a.spy).toHaveBeenCalledTimes(1));
    await a.press('回到表单');
    expect(await repo.listRecords('claims')).toHaveLength(1);
    expect(screen.getByTestId('form-add-amount').props.value).toBe('30');
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    await waitFor(() => expect(a.spy).toHaveBeenCalledTimes(2));
    await a.press('仍然保存');
    await waitFor(async () => expect(await repo.listRecords('claims')).toHaveLength(2));
  });
});
