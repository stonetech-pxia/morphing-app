import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  applyOps,
  createRegistry,
  type Op,
  type Workflow,
} from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import { runWorkflow } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

const registry = createRegistry(BUILTIN_TOOLS);
const now = () => new Date(2026, 9, 22, 9, 0);

function pdfWorkspace(extraOps: Op[] = []) {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [{ op: 'installTool', toolId: 'pdf' }, ...extraOps],
    {
      registry,
      locale: 'zh',
    },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

let ids = 0;
function setup(workflow: Workflow, answer: string | null = '我的合并') {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const prompts = {
    asked: [] as string[],
    askText: async (_label: string, value: string) => (prompts.asked.push(value), answer),
  };
  const run = () =>
    runWorkflow({
      workflow,
      revisionId: 1,
      repo,
      files,
      prompts,
      registry,
      locale: 'zh',
      now,
      newId: () => `id${++ids}`,
    });
  return { repo, files, prompts, run };
}

const mergeWorkflow = (ops: Op[] = []) => pdfWorkspace(ops).workflows[0]!;

describe('PDF merge workflow', () => {
  it('B: picks files, merges them for real, asks for a name and saves the result', async () => {
    const { repo, files, prompts, run } = setup(mergeWorkflow());
    files.nextPick = [
      files.offer('报告.pdf', await makePdf(1)),
      files.offer('附录.pdf', await makePdf(2)),
    ];

    const result = await run();
    expect(result).toMatchObject({ status: 'succeeded', pageCount: 3 });
    if (result.status !== 'succeeded') return;
    expect(prompts.asked).toEqual(['报告-合并']);
    expect(result.savedFile).toMatchObject({ name: '我的合并.pdf', source: 'generated' });

    const merged = await PDFDocument.load(files.disk.get(result.savedFile!.path)!);
    expect(merged.getPageCount()).toBe(3);
    expect(merged.getPages().map((p) => p.getWidth())).toEqual([200, 200, 201]);

    // 输入和输出都是工作空间的文件，并授权给 PDF 工具；执行记录不含文件内容。
    expect((await repo.listAssets()).map((a) => a.name)).toEqual([
      '我的合并.pdf',
      '附录.pdf',
      '报告.pdf',
    ]);
    expect(await repo.hasGrant('pdf', result.savedFile!.id)).toBe(true);
    expect(await repo.listToolRuns(1)).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        outputAssetId: result.savedFile!.id,
        error: null,
      }),
    ]);
  });

  it('C: after simplification it saves automatically as 合并-日期, never overwriting', async () => {
    const simplified = mergeWorkflow([
      { op: 'removeWorkflowStep', workflowId: 'pdf-merge', stepId: 'name' },
      {
        op: 'setStepParams',
        workflowId: 'pdf-merge',
        stepId: 'save',
        params: { nameTemplate: '合并-{date:YYYY-MM-DD}' },
      },
    ]);
    const { files, prompts, run } = setup(simplified);
    const pick = async () => [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];

    files.nextPick = await pick();
    const first = await run();
    files.nextPick = await pick();
    const second = await run();

    expect(prompts.asked).toEqual([]);
    expect(first).toMatchObject({
      status: 'succeeded',
      savedFile: { name: '合并-2026-10-22.pdf' },
    });
    expect(second).toMatchObject({
      status: 'succeeded',
      savedFile: { name: '合并-2026-10-22-2.pdf' },
    });
  });

  it('picking the same files again gives the copies distinct names', async () => {
    const simplified = mergeWorkflow([
      { op: 'removeWorkflowStep', workflowId: 'pdf-merge', stepId: 'name' },
    ]);
    const { repo, files, run } = setup(simplified);
    const pick = async () => [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    files.nextPick = await pick();
    await run();
    files.nextPick = await pick();
    await run();
    const names = (await repo.listAssets()).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['a.pdf', 'b.pdf', 'a-2.pdf', 'b-2.pdf']));
  });

  it('cancelling the picker or the name prompt is not an error', async () => {
    const a = setup(mergeWorkflow());
    a.files.nextPick = null;
    expect(await a.run()).toEqual({ status: 'cancelled' });

    const b = setup(mergeWorkflow(), null);
    b.files.nextPick = [
      b.files.offer('a.pdf', await makePdf(1)),
      b.files.offer('b.pdf', await makePdf(1)),
    ];
    expect(await b.run()).toEqual({ status: 'cancelled' });
    expect(await b.repo.listToolRuns(1)).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
  });

  it('reports empty input, wrong file types, size limits and broken files clearly', async () => {
    const { files, run } = setup(mergeWorkflow());

    files.nextPick = [files.offer('only.pdf', await makePdf(1))];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'tooFew', detail: { min: 2 } },
    });

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('photo.jpg', new Uint8Array([1]), 'image/jpeg'),
    ];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'notPdf', detail: { name: 'photo.jpg' } },
    });

    const huge = { ...files.offer('huge.pdf', new Uint8Array([1])), size: 60 * 1024 * 1024 };
    files.nextPick = [files.offer('a.pdf', await makePdf(1)), huge];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'tooLarge', detail: { name: 'huge.pdf', mb: 50 } },
    });

    const big = (n: string) => ({ ...files.offer(n, new Uint8Array([1])), size: 40 * 1024 * 1024 });
    files.nextPick = [big('1.pdf'), big('2.pdf'), big('3.pdf')];
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'tooLargeTotal' } });

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('broken.pdf', Uint8Array.from([37, 80, 68, 70])),
    ];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'unreadable', detail: { name: 'broken.pdf' } },
    });
  });

  it('reports files that cannot be accessed', async () => {
    const { files, run } = setup(mergeWorkflow());
    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      { uri: 'picker://gone.pdf', name: 'gone.pdf', size: 10, mimeType: 'application/pdf' },
    ];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'accessDenied', detail: { name: 'gone.pdf' } },
    });
  });

  it('refuses to read files the tool was not granted', async () => {
    const { repo, files, run } = setup(mergeWorkflow());
    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    const original = repo.grantAsset.bind(repo);
    // 模拟授权缺失：第二个文件没有授权给 PDF 工具。
    let count = 0;
    repo.grantAsset = async (tool, asset) => (++count === 2 ? undefined : original(tool, asset));
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'noGrant', detail: { name: 'b.pdf' } },
    });
  });
});
