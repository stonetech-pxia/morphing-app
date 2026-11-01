import type { Collection, FieldSuggestions, PrefillEngine } from '@morph/core';
import { renderHook, waitFor } from '@testing-library/react-native';

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
