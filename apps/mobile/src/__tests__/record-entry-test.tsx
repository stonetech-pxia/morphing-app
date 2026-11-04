import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Collection,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
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
  kind: 'quickAction',
  id: 'receipts',
  name: '拍收据记账',
  steps: [
    { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'add', action: 'out.addRecord', params: { collectionId: 'expenses' } },
    { id: 'share', action: 'out.share', params: {} },
  ],
};

type Entry = LocalSteps['recordEntry'];

type Answer = Entry['out'] | null | ((input: Entry['in']) => Entry['out'] | null);

function setup(workflow: Workflow, answers: Answer[], collections = [expenses]) {
  const files = new FakeFiles();
  const repo = new MemoryWorkspaceRepo();
  const opened: Entry['in'][] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      if (kind !== 'recordEntry') return null;
      opened.push(input as Entry['in']);
      const answer = answers.shift() ?? null;
      return (typeof answer === 'function' ? answer(input as Entry['in']) : answer) as never;
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
        collections,
        askParams: async (r) => r.params,
      })
    ).result;
  return { files, repo, opened, run };
}

/** 同一个快捷操作，每个文件记一条（D-397 的 each）。 */
const eachWorkflow: Workflow = {
  ...receiptWorkflow,
  id: 'each',
  steps: receiptWorkflow.steps.map((step) =>
    step.action === 'out.addRecord'
      ? { ...step, params: { collectionId: 'expenses', each: true } }
      : step,
  ),
};

describe('out.addRecord', () => {
  it('puts all the files of the run into one record by default (D-397)', async () => {
    const { files, repo, opened, run } = setup(receiptWorkflow, [
      { values: { amount: '35.5', date: '2026-10-24' } },
    ]);
    files.nextPhotos = [
      files.offerImage('IMG_1.jpg', 3000, 4000),
      files.offerImage('IMG_2.jpg', 3000, 4000),
    ];
    const result = await run();
    expect(result.status).toBe('succeeded');
    const assets = await repo.listAssets();
    expect(assets.map((a) => a.name).sort()).toEqual(['IMG_1.jpg', 'IMG_2.jpg']);
    const ids = assets.map((a) => a.id).sort();
    // 只开一张表单，打开时文件已经是用户文件、已经在附件里（表单才能读它们，给候选）。
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ index: 0, total: 1 });
    expect([...(opened[0]!.prefill.receipt as string[])].sort()).toEqual(ids);
    const records = await repo.listRecords('expenses');
    expect(records).toHaveLength(1);
    expect(records[0]!.values).toMatchObject({ amount: 35.5, date: '2026-10-24' });
    expect([...(records[0]!.values.receipt as string[])].sort()).toEqual(ids);
    expect(await repo.hasGrant('workflow:receipts', assets[0]!.id)).toBe(true);
    if (result.status === 'succeeded') expect(result.saved).toHaveLength(2);
    // 文件原样交给下一步。
    expect(files.shared).toHaveLength(2);
  });

  it('adds a record per file when the step says each', async () => {
    const { files, repo, opened, run } = setup(eachWorkflow, [
      { values: { amount: '35.5', date: '2026-10-24' } },
      { values: { amount: '12', note: '打车' } },
    ]);
    files.nextPhotos = [
      files.offerImage('IMG_1.jpg', 3000, 4000),
      files.offerImage('IMG_2.jpg', 3000, 4000),
    ];
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect(opened.map((o) => [o.index, o.total])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    const records = await repo.listRecords('expenses');
    expect(records.map((r) => r.values)).toEqual(
      expect.arrayContaining([
        { amount: 35.5, date: '2026-10-24', receipt: [expect.any(String)] },
        { amount: 12, date: '2026-10-24', note: '打车', receipt: [expect.any(String)] },
      ]),
    );
    const assets = await repo.listAssets();
    expect(records.flatMap((r) => r.values.receipt as string[]).sort()).toEqual(
      assets.map((a) => a.id).sort(),
    );
    if (result.status === 'succeeded') expect(result.saved).toHaveLength(2);
    expect(files.shared).toHaveLength(2);
  });

  it('keeps the order of the form, with the photos the user added (D-263)', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [
      (input) => ({
        values: { amount: '20', receipt: [...(input.prefill.receipt as string[]), 'extra1'] },
      }),
    ]);
    files.nextPhotos = [files.offerImage('IMG_1.jpg', 100, 100)];
    expect((await run()).status).toBe('succeeded');
    const [saved] = (await repo.listAssets()).filter((a) => a.name === 'IMG_1.jpg');
    expect((await repo.listRecords('expenses'))[0]!.values.receipt).toEqual([saved!.id, 'extra1']);
  });

  it('deletes the copy of a file the user took out of the form; the run keeps its file', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [
      (input) => ({
        values: { amount: '20', receipt: (input.prefill.receipt as string[]).slice(0, 1) },
      }),
    ]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100), files.offerImage('b.jpg', 100, 100)];
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['a.jpg']);
    if (result.status === 'succeeded') expect(result.saved).toHaveLength(1);
    expect(files.shared).toHaveLength(2);
  });

  it('skipping one file adds no record and leaves no copy of it', async () => {
    const { files, repo, run } = setup(eachWorkflow, [{ skip: true }, { values: { amount: '8' } }]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100), files.offerImage('b.jpg', 100, 100)];
    expect((await run()).status).toBe('succeeded');
    expect(await repo.listRecords('expenses')).toHaveLength(1);
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['b.jpg']);
  });

  it('closing the form stops the quick action and leaves no copies', async () => {
    const { files, repo, run } = setup(receiptWorkflow, [null]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100)];
    expect((await run()).status).toBe('cancelled');
    expect(await repo.listRecords('expenses')).toEqual([]);
    expect(await repo.listAssets()).toEqual([]);
  });

  it('never deletes a file an earlier step saved, even when the form is closed', async () => {
    const saving: Workflow = {
      ...receiptWorkflow,
      steps: [
        receiptWorkflow.steps[0]!,
        { id: 'save', action: 'file.save', params: {} },
        receiptWorkflow.steps[1]!,
      ],
    };
    const { files, repo, run } = setup(saving, [null]);
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100)];
    expect((await run()).status).toBe('cancelled');
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['a.jpg']);
  });

  it('an entry holds 20 files: the rest stay out and the form says so', async () => {
    const many: Workflow = {
      ...receiptWorkflow,
      steps: receiptWorkflow.steps.map((step) =>
        step.action === 'in.photos' ? { ...step, params: { ...step.params, max: 30 } } : step,
      ),
    };
    const { files, repo, opened, run } = setup(many, [{ values: { amount: '8' } }]);
    files.nextPhotos = Array.from({ length: 21 }, (_, i) =>
      files.offerImage(`p${i}.jpg`, 100, 100),
    );
    expect((await run()).status).toBe('succeeded');
    expect(opened[0]!.prefill.receipt).toHaveLength(20);
    expect(opened[0]!.overflow).toBe(true);
    expect(await repo.listAssets()).toHaveLength(20);
    expect(files.shared).toHaveLength(21);
  });

  it('a table with no attachment field: one form per file, showing the file', async () => {
    const plain: Collection = {
      ...expenses,
      fields: expenses.fields.filter((f) => f.type !== 'file'),
    };
    const { files, repo, opened, run } = setup(
      receiptWorkflow,
      [{ values: { amount: '1' } }, { values: { amount: '2' } }],
      [plain],
    );
    files.nextPhotos = [files.offerImage('a.jpg', 100, 100), files.offerImage('b.jpg', 100, 100)];
    expect((await run()).status).toBe('succeeded');
    expect(opened.map((o) => o.file?.name)).toEqual(['a', 'b']);
    expect(await repo.listRecords('expenses')).toHaveLength(2);
    expect(await repo.listAssets()).toEqual([]);
  });

  it('puts text into the long-text field', async () => {
    const workflow: Workflow = {
      kind: 'quickAction',
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
  async function open(
    input: Partial<Entry['in']> = {},
    files = new FakeFiles(),
    repo = new MemoryWorkspaceRepo(),
  ) {
    const onDone = jest.fn();
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

  /** 这一步已经存好的文件（真实的用户文件，和 out.addRecord 打开表单时一样）。 */
  async function withFile(repo: MemoryWorkspaceRepo, id: string, name: string) {
    await repo.addAsset({
      id,
      name,
      mimeType: 'image/jpeg',
      size: 3,
      path: `assets/${id}/${name}`,
      source: 'generated',
      createdAt: 0,
    });
  }

  it('starts with today, shows the formula, and needs the required amount', async () => {
    const { onDone } = await open();
    expect(screen.getByTestId('entry-date').props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByTestId('entry-receipt-add')).toBeTruthy();
    await fireEvent.press(screen.getByText('记下'));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/必填|required/i)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('entry-amount'), '100');
    expect(screen.getByTestId('entry-withTax').props.children).toBe('¥106.00');
    await fireEvent.press(screen.getByText('记下'));
    expect(onDone).toHaveBeenCalledWith({
      values: expect.objectContaining({ amount: '100' }),
    });
  });

  it('shows the step’s files in the attachment field, like every other form', async () => {
    const repo = new MemoryWorkspaceRepo();
    await withFile(repo, 'a1', 'scan-1.jpg');
    await withFile(repo, 'a2', 'scan-2.jpg');
    await open({ prefill: { receipt: ['a1', 'a2'], amount: '9' } }, new FakeFiles(), repo);
    expect(await screen.findByTestId('entry-receipt-file-0')).toBeTruthy();
    expect(await screen.findByTestId('entry-receipt-file-1')).toBeTruthy();
    expect(screen.queryByTestId('entry-overflow')).toBeNull();
  });

  it('says when not every file fits', async () => {
    await open({ overflow: true });
    expect(screen.getByTestId('entry-overflow')).toBeTruthy();
  });

  it('keeps a photo added in the form when saved (D-263)', async () => {
    const files = new FakeFiles();
    const { onDone, repo } = await open({ prefill: { amount: '9' } }, files);
    files.nextMedia = [files.offerImage('IMG_2.jpg', 100, 100)];
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.text === '从相册选')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('entry-receipt-add'));
    expect(await screen.findByText('IMG_2.jpg')).toBeTruthy();
    await fireEvent.press(screen.getByText('记下'));
    const [asset] = await repo.listAssets();
    expect(onDone).toHaveBeenCalledWith({
      values: expect.objectContaining({ receipt: [asset!.id] }),
    });
  });

  it('offers to skip when there are several files', async () => {
    const { onDone } = await open({ total: 3, index: 1 });
    expect(screen.getByText('账目 · 2/3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('entry-skip'));
    expect(onDone).toHaveBeenCalledWith({ skip: true });
  });
});

describe('the prompt before saving a similar record (D-426)', () => {
  const claims: Collection = { ...expenses, prefillRules: 'receipt' };
  const same = { amount: '35.5', date: '2026-10-24' };

  async function renderForm(repo: MemoryWorkspaceRepo, collection = claims) {
    const onDone = jest.fn();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'zh',
      now: () => new Date(),
    });
    await store.getState().boot();
    await render(
      <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale: 'zh' }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 400, height: 800 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }}>
          <RecordEntryScreen
            input={{ collection, prefill: same, index: 0, total: 1 }}
            palette={makePalette(createDefaultWorkspace('zh').theme, false)}
            locale="zh"
            onDone={onDone}
            onCancel={jest.fn()}
          />
        </SafeAreaProvider>
      </WorkspaceProvider>,
    );
    return onDone;
  }

  const spyAlert = () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    alert.mockClear();
    return alert;
  };

  const seedRecord = (repo: MemoryWorkspaceRepo) =>
    repo.insertRecord({
      id: 'r1',
      collectionId: 'expenses',
      values: { amount: 35.5, date: '2026-10-24', note: '午饭' },
      createdAt: 1,
      updatedAt: 1,
    });

  const press = async () => {
    await fireEvent.press(screen.getByTestId('local-done'));
    await act(async () => undefined);
  };

  it('asks; back to the form does not finish, save anyway does', async () => {
    const alert = spyAlert();
    const repo = new MemoryWorkspaceRepo();
    await seedRecord(repo);
    const onDone = await renderForm(repo);
    await press();
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = () => alert.mock.calls.at(-1)![2]!;
    await act(async () => buttons()[0]!.onPress!());
    expect(onDone).not.toHaveBeenCalled();
    await press();
    await act(async () => buttons()[1]!.onPress!());
    expect(onDone).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('does not ask for a table without the parameter', async () => {
    const alert = spyAlert();
    const repo = new MemoryWorkspaceRepo();
    await seedRecord(repo);
    const onDone = await renderForm(repo, expenses);
    await press();
    expect(alert).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('each: true, one form per file: the second form sees what the first just saved', async () => {
    const alert = spyAlert();
    const repo = new MemoryWorkspaceRepo();
    // 第一张表单存好（out.addRecord 存完才开下一张）：表里已经有这一条。
    const first = await renderForm(repo);
    await press();
    expect(alert).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
    await seedRecord(repo);
    await cleanup();
    const second = await renderForm(repo);
    await press();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
