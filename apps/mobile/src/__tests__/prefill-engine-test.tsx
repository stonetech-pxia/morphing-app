import {
  parsePickStore,
  PICK_STORE_KEY,
  putPick,
  serializePickStore,
  type Collection,
  type FieldSuggestions,
  type PrefillEngine,
} from '@morph/core';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useFieldSuggestions } from '../data/field-suggestions';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG } from '../test-utils/fake-files';

// 表单只认预填引擎的接口（D-398）：引擎是异步的（本机模型要跑一会儿），拿到带位置的文字，
// 结果原样成为候选；报错就没有候选；离开表单时通知它取消，晚到的结果不算。

const mockContext: { repo?: MemoryWorkspaceRepo; files?: FakeFiles } = {};
jest.mock('../workspace/context', () => ({ useWorkspaceContext: () => mockContext }));

const collection: Collection = {
  id: 'c',
  name: 'Receipts',
  fields: [
    { id: 'total', name: 'Amount', type: 'money', currency: 'USD' },
    { id: 'files', name: 'Attachments', type: 'file' },
  ],
};
const values = { files: ['a1'] };
const LINE = { text: 'Total 9.00', x: 20, y: 40, width: 100, height: 20 };
const FOUND: FieldSuggestions = {
  total: [{ value: '42', score: 5, pick: { label: 'Total', relY: 0.5 } }],
};

async function setup() {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  vision.layers.push({ width: 600, height: 400, lines: [LINE] });
  files.vision = vision;
  files.disk.set('assets/a1.jpg', TINY_JPEG);
  await repo.addAsset({
    id: 'a1',
    name: 'a1.jpg',
    mimeType: 'image/jpeg',
    size: TINY_JPEG.length,
    path: 'assets/a1.jpg',
    source: 'picked',
    createdAt: 1,
  });
  mockContext.repo = repo;
  mockContext.files = files;
}

const open = (engine: PrefillEngine) =>
  renderHook(() =>
    useFieldSuggestions({ enabled: true, collection, values, locale: 'en', engine }),
  );

describe('预填引擎（D-398）', () => {
  beforeEach(setup);

  it('引擎拿到字段和带位置的文字，它给的就是候选', async () => {
    const engine = jest.fn<ReturnType<PrefillEngine>, Parameters<PrefillEngine>>(async () => FOUND);
    const { result } = await open(engine);
    await waitFor(() => expect(result.current.suggestions).toEqual(FOUND));
    expect(result.current.working).toBe(false);
    const input = engine.mock.calls[0]![0];
    expect(input.fields).toBe(collection.fields);
    expect(input.pages).toEqual([{ width: 600, height: 400, lines: [LINE] }]);
  });

  it('引擎报错：没有候选，不再显示正在读', async () => {
    const { result } = await open(async () => {
      throw new Error('model failed');
    });
    await waitFor(() => expect(result.current.working).toBe(false));
    expect(result.current.suggestions).toEqual({});
  });

  it('引擎分两步（D-398）：先给的立刻显示、不再显示正在读，后来的补上', async () => {
    let finish: ((s: FieldSuggestions) => void) | undefined;
    const { result } = await open(
      (_input, _signal, onPartial) =>
        new Promise((resolve) => {
          onPartial?.(FOUND);
          finish = resolve;
        }),
    );
    await waitFor(() => expect(result.current.suggestions).toEqual(FOUND));
    // 引擎还没结束，但「正在读」那一行已经收起来：它晚收起来，下面的字段会在用户点了以后往上跳（D-388）。
    expect(result.current.working).toBe(false);
    const later: FieldSuggestions = {
      total: [{ value: '7', score: 0, pick: { label: '', relY: 0 } }, ...FOUND.total!],
    };
    await act(async () => finish!(later));
    expect(result.current.suggestions).toEqual(later);
  });

  it('在文字里找不到位置的候选：点了也不记，字段原来的记忆还在', async () => {
    const good = { label: 'Total', relY: 0.5 };
    await mockContext.repo!.setMeta(
      PICK_STORE_KEY,
      serializePickStore(putPick(parsePickStore(null), 'c', 'total', good)),
    );
    const found: FieldSuggestions = { total: [{ value: '7', score: 0 }] };
    const { result } = await open(async () => found);
    await waitFor(() => expect(result.current.suggestions).toEqual(found));
    await act(async () => result.current.remember('total', found.total![0]!));
    await act(async () => undefined);
    const stored = parsePickStore(await mockContext.repo!.getMeta(PICK_STORE_KEY));
    expect(stored.c?.total).toEqual(good);
  });

  it('点过候选的字段（D-388）：后来的结果不再动它的候选，别的字段照常补', async () => {
    const one = (id: string, value: string): FieldSuggestions[string] => [
      { value, score: 1, pick: { label: id, relY: 0.5 } },
    ];
    let push: ((s: FieldSuggestions) => void) | undefined;
    const first: FieldSuggestions = { total: one('t', '42') };
    const { result } = await open(
      (_input, _signal, onPartial) =>
        new Promise(() => {
          push = onPartial;
          onPartial?.(first);
        }),
    );
    await waitFor(() => expect(result.current.suggestions).toEqual(first));
    await act(async () => result.current.remember('total', first.total![0]!));
    const later: FieldSuggestions = { total: one('t', '99'), other: one('o', 'x') };
    await act(async () => push!(later));
    expect(result.current.suggestions).toEqual({ total: first.total, other: later.other });
  });

  it('引擎拿到这张表存过的店名（现查记录，只读）', async () => {
    const merchant: Collection = {
      id: 'c',
      name: 'Receipts',
      fields: [
        { id: 'shop', name: 'Merchant', type: 'text' },
        { id: 'files', name: 'Attachments', type: 'file' },
      ],
    };
    await mockContext.repo!.insertRecord({
      id: 'r1',
      collectionId: 'c',
      values: { shop: 'Acme Coffee' },
      createdAt: 1,
      updatedAt: 1,
    });
    const before = JSON.stringify(await mockContext.repo!.listRecords('c'));
    const engine = jest.fn<ReturnType<PrefillEngine>, Parameters<PrefillEngine>>(async () => ({}));
    await renderHook(() =>
      useFieldSuggestions({ enabled: true, collection: merchant, values, locale: 'en', engine }),
    );
    await waitFor(() => expect(engine).toHaveBeenCalled());
    expect(engine.mock.calls[0]![0].known).toEqual({ shop: ['Acme Coffee'] });
    expect(JSON.stringify(await mockContext.repo!.listRecords('c'))).toBe(before);
  });

  it('离开表单：通知引擎取消', async () => {
    let signal: AbortSignal | undefined;
    const { unmount } = await open((_input, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    await waitFor(() => expect(signal?.aborted).toBe(false));
    await unmount();
    expect(signal?.aborted).toBe(true);
  });
});
