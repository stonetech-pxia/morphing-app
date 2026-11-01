import { BUILTIN_TOOLS, createRegistry, type RunResult, type Workflow } from '@morph/core';

import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision } from '../test-utils/fake-files';

// 文字加工（D-245）：识别出的文字在本机整理、替换、提取、拆行，结果只在结果页显示。

const registry = createRegistry(BUILTIN_TOOLS);
let ids = 0;
async function run(files: FakeFiles, steps: Workflow['steps'], answers = {}) {
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => null as never,
  };
  const { result } = await startRun({
    workflow: { kind: 'quickAction', id: 'mine', name: '文字', steps },
    revisionId: 1,
    repo: new MemoryWorkspaceRepo(),
    files,
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22),
    newId: () => `id${++ids}`,
    ui,
    collections: [],
    askParams: async (request) => ({ ...request.params, ...answers }),
  });
  return result;
}
const text = (r: RunResult) =>
  r.status === 'succeeded' && r.value?.type === 'text' ? r.value.text : r;

describe('text actions', () => {
  it('pulls every phone number out of a recognized business card', async () => {
    const files = new FakeFiles();
    const vision = new FakeVision(files);
    files.vision = vision;
    vision.texts = ['王小明  经理\n\n手机 138 1234 5678\n办公 +86 10 8765 4321\nwang@example.cn'];
    files.nextPhotos = [files.offerImage('card.jpg', 1200, 800)];
    const result = await run(files, [
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
      { id: 'read', action: 'ocr.recognize', params: { lang: 'chi_sim' } },
      { id: 'phones', action: 'text.extract', params: { kind: 'phone' } },
    ]);
    expect(text(result)).toBe('13812345678\n+861087654321');
  });

  it('replaces words, tidies and joins typed text', async () => {
    const result = await run(
      new FakeFiles(),
      [
        { id: 'in', action: 'in.text', params: { text: '' }, ask: ['text'] },
        {
          id: 'rep',
          action: 'text.replace',
          params: { find: '甲方', replaceWith: '买方', ignoreCase: false },
        },
        { id: 'tidy', action: 'text.tidy', params: { blankLines: 'remove', spaces: true } },
        { id: 'join', action: 'text.lines', params: { mode: 'join', separator: 'semicolon' } },
      ],
      { text: '甲方：  张三\n\n\n甲方地址： 北京 ' },
    );
    expect(text(result)).toBe('买方： 张三; 买方地址： 北京');
  });

  it('says so when there is nothing of that kind', async () => {
    const result = await run(new FakeFiles(), [
      { id: 'in', action: 'in.text', params: { text: 'no contacts here' } },
      { id: 'mail', action: 'text.extract', params: { kind: 'email' } },
    ]);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'notFound' } });
  });
});
