import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Collection,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { RecordEntryScreen } from '../run/local/RecordEntryScreen';
import type { LocalSteps, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 记一笔（D-187）：快捷操作运行时按数据表填一条记录，文件存成 Morph 的文件放进附件字段，
// 文字放进长文本字段；记录直接写进本机的数据表。

const registry = createRegistry(BUILTIN_TOOLS);

const expenses: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY', required: true },
    { id: 'date', name: '日期', type: 'date', default: 'today' },
    { id: 'note', name: '备注', type: 'note' },
    { id: 'receipt', name: '收据', type: 'file' },
    {
      id: 'withTax',
      name: '含税',
      type: 'formula',
      expression: '{amount} * 1.06',
      currency: 'CNY',
    },
  ],
};

const receiptWorkflow: Workflow = {
  id: 'receipts',
  name: '拍收据记账',
  steps: [
    { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'add', action: 'out.addRecord', params: { collectionId: 'expenses' } },
    { id: 'share', action: 'out.share', params: {} },
  ],
};

type Entry = LocalSteps['recordEntry'];

function setup(workflow: Workflow, answers: (Entry['out'] | null)[]) {
  const files = new FakeFiles();
  const repo = new MemoryWorkspaceRepo();
  const opened: Entry['in'][] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      if (kind !== 'recordEntry') return null;
      opened.push(input as Entry['in']);
      return (answers.shift() ?? null) as never;
    },
  };
  let n = 0;
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo,
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 24, 12),
        newId: () => `id${++n}`,
        ui,
        collections: [expenses],
        askParams: async (r) => r.params,
      })
    ).result;
  return { files, repo, opened, run };
}

describe('out.addRecord', () => {
  it('saves each receipt photo and adds a record with what the user filled in', async () => {
    const { files, repo, opened, run } = setup(receiptWorkflow, [
      { values: { amount: '35.5', date: '2026-10-24' } },
      { values: { amount: '12', note: '打车' } },
    ]);
    files.nextPhotos = [
      files.offerImage('IMG_1.jpg', 3000, 4000),
      files.offerImage('IMG_2.jpg', 3000, 4000),
    ];
    const result = await run();
    expect(result.status).toBe('succeeded');
    // 表单里附件先是占位值，第几张、一共几张。
    expect(opened.map((o) => [o.index, o.total, o.prefill])).toEqual([
      [0, 2, { receipt: 'pending-file' }],
      [1, 2, { receipt: 'pending-file' }],
    ]);
    const records = await repo.listRecords('expenses');
    expect(records.map((r) => r.values)).toEqual(
      expect.arrayContaining([
        { amount: 35.5, date: '2026-10-24', receipt: [expect.any(String)] },
        { amount: 12, date: '2026-10-24', note: '打车', receipt: [expect.any(String)] },
      ]),
    );
    // 收据存成了 Morph 的文件，授权给这个快捷操作；结果里的文件就是存好的那两个。
    const assets = await repo.listAssets();
    expect(assets.map((a) => a.name).sort()).toEqual(['IMG_1.jpg', 'IMG_2.jpg']);
    // 附件字段是一组文件 ID（D-263），每条记录一个。
    expect(records.flatMap((r) => r.values.receipt as string[]).sort()).toEqual(
      assets.map((a) => a.id).sort(),
    );
    expect(await repo.hasGrant('workflow:receipts', assets[0]!.id)).toBe(true);
    if (result.status === 'succeeded') expect(result.saved).toHaveLength(2);
    // 结果交给下一步「分享」：两张收据一起分享出去。
    expect(files.shared).toHaveLength(2);
  });

  it('keeps the photos the user added in the form after the step’s own file (D-263)', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [
      { values: { amount: '20', receipt: ['pending-file', 'extra1', 'extra2'] } },
    ]);
    files.nextPhotos = [files.offerImage('IMG_1.jpg', 100, 100)];
    expect((await run()).status).toBe('succeeded');
    const [saved] = (await repo.listAssets()).filter((a) => a.name === 'IMG_1.jpg');
    expect((await repo.listRecords('expenses'))[0]!.values.receipt).toEqual([
      saved!.id,
      'extra1',
      'extra2',
    ]);
  });

  it('skipping one receipt adds no record and does not save that file', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [
      { skip: true },
      { values: { amount: '8' } },
    ]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100), files.offerImage('b.jpg', 100, 100)];
    expect((await run()).status).toBe('succeeded');
    expect(await repo.listRecords('expenses')).toHaveLength(1);
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['b.jpg']);
  });

  it('closing the form stops the quick action', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [null]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100)];
    expect((await run()).status).toBe('cancelled');
    expect(await repo.listRecords('expenses')).toEqual([]);
  });

  it('puts text into the long-text field', async () => {
    const workflow: Workflow = {
      id: 'memo',
      name: '记一句',
      steps: [
        { id: 'text', action: 'in.text', params: { text: '午饭和同事' }, ask: [] },
        { id: 'add', action: 'out.addRecord', params: { collectionId: 'expenses' } },
      ],
    };
    const { repo, opened, run } = setup(workflow, [
      { values: { amount: '42', note: '午饭和同事' } },
    ]);
    expect((await run()).status).toBe('succeeded');
    expect(opened[0]!.prefill).toEqual({ note: '午饭和同事' });
    expect((await repo.listRecords('expenses'))[0]!.values).toEqual({
      amount: 42,
      date: '2026-10-24',
      note: '午饭和同事',
    });
  });
});

describe('the record form', () => {
  async function open(input: Partial<Entry['in']> = {}, files = new FakeFiles()) {
    const onDone = jest.fn();
    const repo = new MemoryWorkspaceRepo();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'zh',
      now: () => new Date(),
    });
    await store.getState().boot();
    await render(
      <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 400, height: 800 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }}>
          <RecordEntryScreen
            input={{ collection: expenses, prefill: {}, index: 0, total: 1, ...input }}
            palette={makePalette(createDefaultWorkspace('zh').theme, false)}
            locale="zh"
            onDone={onDone}
            onCancel={jest.fn()}
          />
        </SafeAreaProvider>
      </WorkspaceProvider>,
    );
    return { onDone, repo, files };
  }

  it('starts with today, shows the formula, and needs the required amount', async () => {
    const { onDone } = await open({ prefill: { receipt: 'pending-file' } });
    expect(screen.getByTestId('entry-date').props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 附件字段能另外添加照片和文件，这一步的文件不在列表里（D-263）。
    expect(screen.getByTestId('entry-receipt-add')).toBeTruthy();
    expect(screen.queryByTestId('entry-receipt-file-0')).toBeNull();
    await fireEvent.press(screen.getByText('记下'));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/必填|required/i)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('entry-amount'), '100');
    expect(screen.getByTestId('entry-withTax').props.children).toBe('¥106.00');
    await fireEvent.press(screen.getByText('记下'));
    expect(onDone).toHaveBeenCalledWith({
      values: expect.objectContaining({ amount: '100', receipt: ['pending-file'] }),
    });
  });

  it('lets the user add more photos besides the step’s own file (D-263)', async () => {
    const files = new FakeFiles();
    const { onDone, repo } = await open(
      { prefill: { receipt: 'pending-file', amount: '9' } },
      files,
    );
    // 这一步的文件不在列表里（上面单独显示），只能另外添加。
    expect(screen.queryByTestId('entry-receipt-file-0')).toBeNull();
    files.nextMedia = [files.offerImage('IMG_2.jpg', 100, 100)];
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.text === '从相册选')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('entry-receipt-add'));
    expect(await screen.findByText('IMG_2.jpg')).toBeTruthy();
    await fireEvent.press(screen.getByText('记下'));
    const [asset] = await repo.listAssets();
    expect(onDone).toHaveBeenCalledWith({
      values: expect.objectContaining({ receipt: ['pending-file', asset!.id] }),
    });
  });

  it('offers to skip when there are several files', async () => {
    const { onDone } = await open({ total: 3, index: 1 });
    expect(screen.getByText('账目 · 2/3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('entry-skip'));
    expect(onDone).toHaveBeenCalledWith({ skip: true });
  });
});
