import {
  BUILTIN_TOOLS,
  MAX_ATTACHMENTS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Collection,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { RecordEntryScreen } from '../run/local/RecordEntryScreen';
import { RecordPickScreen } from '../run/local/RecordPickScreen';
import type { LocalSteps, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 记一笔放进已有的记录（D-443，out.addRecord 的 into: "existing"）：用户在运行时选一条已有的记录，
// 文件接在它的附件后面、文字接在它的文字后面，表单里核对并保存才写进去。只追加，不替换、不删除。

const registry = createRegistry(BUILTIN_TOOLS);

const docs: Collection = {
  id: 'docs',
  name: 'Docs',
  fields: [
    { id: 'title', name: 'Title', type: 'text', required: true },
    { id: 'body', name: 'Body', type: 'note' },
    { id: 'scan', name: 'Scan', type: 'file' },
  ],
};

const filesWorkflow: Workflow = {
  kind: 'quickAction',
  id: 'to-existing',
  name: 'Add to an entry',
  steps: [
    { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'add', action: 'out.addRecord', params: { collectionId: 'docs', into: 'existing' } },
  ],
};
const textWorkflow: Workflow = {
  kind: 'quickAction',
  id: 'text-to-existing',
  name: 'Add text to an entry',
  steps: [
    { id: 'text', action: 'in.text', params: { text: 'hello' }, ask: [] },
    { id: 'add', action: 'out.addRecord', params: { collectionId: 'docs', into: 'existing' } },
  ],
};

type Pick = LocalSteps['recordPick'];
type Entry = LocalSteps['recordEntry'];
/** 用户在选记录界面选哪一条（null：取消）；表单里的回答（null：取消，函数：照输入算）。 */
type Script = {
  pick?: string | null | ((input: Pick['in']) => string | null);
  entry?: Entry['out'] | null | ((input: Entry['in']) => Entry['out'] | null);
  /** 选完记录、表单还开着的时候发生的事（例如这条记录被删了）。 */
  during?: (repo: MemoryWorkspaceRepo) => Promise<void>;
};

async function setup(
  workflow: Workflow,
  records: { id: string; values: Record<string, unknown> }[],
  script: Script,
  assetCount = 0,
) {
  const files = new FakeFiles();
  const repo = new MemoryWorkspaceRepo();
  for (const r of records)
    await repo.insertRecord({
      id: r.id,
      collectionId: 'docs',
      values: r.values,
      createdAt: Number(r.id.replace(/\D/g, '')) || 1,
      updatedAt: 1,
    });
  for (let i = 0; i < assetCount; i++)
    await repo.addAsset({
      id: `old${i}`,
      name: `old${i}.jpg`,
      mimeType: 'image/jpeg',
      size: 10,
      path: `assets/old${i}/old${i}.jpg`,
      source: 'picked',
      createdAt: 1,
    });
  const picks: Pick['in'][] = [];
  const entries: Entry['in'][] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      if (kind === 'recordPick') {
        picks.push(input as Pick['in']);
        const pick =
          typeof script.pick === 'function' ? script.pick(input as Pick['in']) : script.pick;
        return (pick ? { recordId: pick } : null) as never;
      }
      if (kind === 'recordEntry') {
        entries.push(input as Entry['in']);
        await script.during?.(repo);
        const e = script.entry;
        return (typeof e === 'function' ? e(input as Entry['in']) : (e ?? null)) as never;
      }
      return null as never;
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
        locale: 'en',
        now: () => new Date(2026, 10, 5, 12),
        newId: () => `id${++n}`,
        ui,
        collections: [docs],
        askParams: async (r) => r.params,
      })
    ).result;
  return { files, repo, picks, entries, run };
}

const photos = (files: FakeFiles, n: number) => {
  files.nextPhotos = Array.from({ length: n }, (_, i) =>
    files.offerImage(`IMG_${i}.jpg`, 300, 400),
  );
};

describe('new user, no data', () => {
  it('a table with no entries has nothing to pick: says so, saves nothing', async () => {
    const { files, repo, picks, run } = await setup(filesWorkflow, [], { pick: 'x' });
    photos(files, 1);
    const result = await run();
    expect(result).toMatchObject({ status: 'failed', error: { code: 'notFound' } });
    expect(picks).toEqual([]);
    expect(await repo.listAssets()).toEqual([]);
    expect(files.runFiles()).toEqual([]);
  });
});

describe('with data', () => {
  const records = [
    { id: 'r1', values: { title: 'First', body: 'old text', scan: ['old0'] } },
    { id: 'r2', values: { title: 'Second' } },
  ];

  it('asks which entry, then opens its form with the new files after the old ones; saving updates it', async () => {
    const { files, repo, picks, entries, run } = await setup(
      filesWorkflow,
      records,
      {
        pick: 'r1',
        entry: (input) => ({ values: { ...input.prefill, title: 'First', body: 'old text' } }),
      },
      1,
    );
    photos(files, 2);
    const result = await run();
    expect(result.status).toBe('succeeded');
    // 选记录的界面拿到这张表的记录。
    expect(picks).toHaveLength(1);
    expect(picks[0]!.records.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    // 表单是这条记录的表单：原来的值在，新文件接在原来的后面。
    expect(entries).toHaveLength(1);
    expect(entries[0]!.existing?.id).toBe('r1');
    const added = (await repo.listAssets()).filter((a) => a.id !== 'old0').map((a) => a.id);
    expect(added).toHaveLength(2);
    const scan = entries[0]!.prefill.scan as string[];
    expect(scan[0]).toBe('old0');
    expect(scan.slice(1).sort()).toEqual([...added].sort());
    // 没有新建记录；这一条更新了，别的字段没动。
    const after = await repo.listRecords('docs');
    expect(after).toHaveLength(2);
    const r1 = after.find((r) => r.id === 'r1')!;
    expect(r1.values).toMatchObject({ title: 'First', body: 'old text' });
    expect(r1.values.scan).toHaveLength(3);
    expect((r1.values.scan as string[])[0]).toBe('old0');
    expect(after.find((r) => r.id === 'r2')!.values).toEqual({ title: 'Second' });
    // 新文件是用户文件，授权给这个快捷操作；文件原样交给下一步。
    for (const id of added) expect(await repo.hasGrant('workflow:to-existing', id)).toBe(true);
    if (result.status === 'succeeded') expect(result.saved).toHaveLength(2);
  });

  it('text goes into an empty text field, or on a new line after the text that is there', async () => {
    const empty = await setup(textWorkflow, records, {
      pick: 'r2',
      entry: (input) => ({ values: { title: 'Second', ...input.prefill } }),
    });
    expect((await empty.run()).status).toBe('succeeded');
    expect(empty.entries[0]!.prefill).toEqual({ body: 'hello' });
    expect((await empty.repo.getRecord('r2'))!.values).toEqual({ title: 'Second', body: 'hello' });

    const filled = await setup(textWorkflow, records, {
      pick: 'r1',
      entry: (input) => ({ values: { title: 'First', ...input.prefill } }),
    });
    expect((await filled.run()).status).toBe('succeeded');
    expect(filled.entries[0]!.prefill).toEqual({ body: 'old text\nhello' });
    expect((await filled.repo.getRecord('r1'))!.values).toMatchObject({ body: 'old text\nhello' });
  });
});

describe('edge cases', () => {
  const records = [{ id: 'r1', values: { title: 'First', scan: ['old0'] } }];

  it('cancelling the choice saves nothing and changes nothing', async () => {
    const { files, repo, run } = await setup(filesWorkflow, records, { pick: null }, 1);
    photos(files, 2);
    expect((await run()).status).toBe('cancelled');
    expect((await repo.listAssets()).map((a) => a.id)).toEqual(['old0']);
    expect((await repo.getRecord('r1'))!.values).toEqual({ title: 'First', scan: ['old0'] });
    expect(files.runFiles()).toEqual([]);
  });

  it('cancelling the form deletes the copies saved for it and leaves the entry as it was', async () => {
    const { files, repo, run } = await setup(
      filesWorkflow,
      records,
      { pick: 'r1', entry: null },
      1,
    );
    photos(files, 2);
    expect((await run()).status).toBe('cancelled');
    expect((await repo.listAssets()).map((a) => a.id)).toEqual(['old0']);
    expect(
      [...files.disk.keys()].filter((k) => k.startsWith('assets/') && !k.includes('old0')),
    ).toEqual([]);
    expect((await repo.getRecord('r1'))!.values).toEqual({ title: 'First', scan: ['old0'] });
  });

  it('an entry that already holds the most files takes no more: says so, saves nothing', async () => {
    const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => `old${i}`);
    const { files, repo, entries, run } = await setup(
      filesWorkflow,
      [{ id: 'r1', values: { title: 'First', scan: full } }],
      { pick: 'r1', entry: { values: {} } },
      MAX_ATTACHMENTS,
    );
    photos(files, 1);
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'recordFull' } });
    expect(entries).toEqual([]);
    expect(await repo.listAssets()).toHaveLength(MAX_ATTACHMENTS);
    expect(files.runFiles()).toEqual([]);
  });

  it('only as many files go in as the entry has room for; the form says the rest did not fit', async () => {
    const almost = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => `old${i}`);
    const { files, repo, entries, run } = await setup(
      filesWorkflow,
      [{ id: 'r1', values: { title: 'First', scan: almost } }],
      {
        pick: 'r1',
        entry: (input) => ({ values: { title: 'First', ...input.prefill } }),
      },
      MAX_ATTACHMENTS - 1,
    );
    photos(files, 3);
    expect((await run()).status).toBe('succeeded');
    expect(entries[0]!.overflow).toBe(true);
    expect((entries[0]!.prefill.scan as string[]).slice(0, almost.length)).toEqual(almost);
    expect(entries[0]!.prefill.scan).toHaveLength(MAX_ATTACHMENTS);
    // 放不下的那两个没有存成用户文件。
    expect(await repo.listAssets()).toHaveLength(MAX_ATTACHMENTS);
    expect(((await repo.getRecord('r1'))!.values.scan as string[]).length).toBe(MAX_ATTACHMENTS);
  });

  it('an entry deleted while the form was open: nothing is written, the copies are deleted', async () => {
    const { files, repo, run } = await setup(
      filesWorkflow,
      records,
      {
        pick: 'r1',
        during: (r) => r.deleteRecord('r1', 5),
        entry: (input) => ({ values: { title: 'First', ...input.prefill } }),
      },
      1,
    );
    photos(files, 1);
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'notFound' } });
    expect((await repo.listAssets()).map((a) => a.id)).toEqual(['old0']);
  });

  it('the old files stay if the user keeps the form as it was offered (nothing is replaced)', async () => {
    const { repo, run, files } = await setup(
      filesWorkflow,
      records,
      { pick: 'r1', entry: (input) => ({ values: { title: 'First', ...input.prefill } }) },
      1,
    );
    photos(files, 1);
    expect((await run()).status).toBe('succeeded');
    expect(((await repo.getRecord('r1'))!.values.scan as string[])[0]).toBe('old0');
    expect(await repo.getAsset('old0')).not.toBeNull();
  });
});

describe('the parameter', () => {
  it('each does not go with into existing: all the files go into the one entry', () => {
    const action = registry.actions.get('out.addRecord')!;
    expect(action.params.safeParse({ collectionId: 'docs', into: 'existing' }).success).toBe(true);
    expect(
      action.params.safeParse({ collectionId: 'docs', into: 'existing', each: true }).success,
    ).toBe(false);
    expect(action.params.safeParse({ collectionId: 'docs', into: 'new', each: true }).success).toBe(
      true,
    );
    expect(action.params.safeParse({ collectionId: 'docs', into: 'somewhere' }).success).toBe(
      false,
    );
    // 旧配置不写 into：还是新建一条。
    expect(action.params.safeParse({ collectionId: 'docs' }).success).toBe(true);
  });
});

describe('the screens', () => {
  const palette = makePalette(createDefaultWorkspace('en').theme, false);
  const frame = (children: React.ReactNode) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      {children}
    </SafeAreaProvider>
  );
  const rec = (id: string, title: string, updatedAt: number) => ({
    id,
    collectionId: 'docs',
    values: { title },
    createdAt: 1,
    updatedAt,
  });
  async function provider(children: React.ReactNode) {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'en',
      now: () => new Date(),
    });
    await store.getState().boot();
    await render(
      <WorkspaceProvider value={{ store, repo, files, registry, locale: 'en' }}>
        {frame(children)}
      </WorkspaceProvider>,
    );
  }
  afterEach(cleanup);

  it('the choice lists the titles of the entries, newest change first, and a choice needs a tap', async () => {
    const onDone = jest.fn();
    await provider(
      <RecordPickScreen
        input={{
          collection: docs,
          records: [rec('a', 'Old one', 1), rec('b', 'New one', 9), rec('c', 'Middle', 5)],
        }}
        palette={palette}
        locale="en"
        onDone={onDone}
        onCancel={() => undefined}
      />,
    );
    const rows = screen.getAllByTestId(/^pick-row-/).map((n) => n.props.testID);
    expect(rows).toEqual(['pick-row-b', 'pick-row-c', 'pick-row-a']);
    // 没选之前不能确定。
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('pick-row-c'));
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(onDone).toHaveBeenCalledWith({ recordId: 'c' });
  });

  it('a long list can be searched by title; nothing found says so', async () => {
    const records = Array.from({ length: 12 }, (_, i) => rec(`r${i}`, `Entry ${i}`, i));
    await provider(
      <RecordPickScreen
        input={{ collection: docs, records }}
        palette={palette}
        locale="en"
        onDone={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('pick-search'), 'entry 11');
    await waitFor(() => expect(screen.getAllByTestId(/^pick-row-/)).toHaveLength(1));
    await fireEvent.changeText(screen.getByTestId('pick-search'), 'zzz');
    expect(await screen.findByTestId('pick-none')).toBeTruthy();
  });

  it('the form of an existing entry starts from its values plus what is added; no "looks like another entry" question', async () => {
    const onDone = jest.fn();
    const tableWithRules = { ...docs, prefillRules: {} } as unknown as Collection;
    await provider(
      <RecordEntryScreen
        input={{
          collection: tableWithRules,
          prefill: { body: 'old\nnew' },
          existing: { ...rec('r1', 'First', 1), values: { title: 'First', body: 'old' } },
          index: 0,
          total: 1,
        }}
        palette={palette}
        locale="en"
        onDone={onDone}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByTestId('entry-title').props.value).toBe('First');
    expect(screen.getByTestId('entry-body').props.value).toBe('old\nnew');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('local-done'));
    });
    expect(onDone).toHaveBeenCalledWith({
      values: expect.objectContaining({ title: 'First', body: 'old\nnew' }),
    });
  });
});
