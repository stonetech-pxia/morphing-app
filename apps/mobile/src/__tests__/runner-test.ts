import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type AskRequest,
  type Op,
  type Workflow,
} from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import { ACTION_IMPLS } from '../runtime/actions';
import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

const registry = createRegistry(BUILTIN_TOOLS);
const now = () => new Date(2026, 9, 22, 9, 0);

function pdfWorkspace(extraOps: Op[] = []) {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [{ op: 'installTool', toolId: 'pdf' }, ...extraOps],
    { registry, locale: 'zh' },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

let ids = 0;
function setup(workflow: Workflow, answer: string | null = '我的合并') {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const asked: string[] = [];
  const confirms: boolean[] = [];
  const ui: LocalUi = {
    confirm: async () => confirms.shift() ?? false,
    open: async () => null,
  };
  // 运行页面的询问：记录建议的名字，回答 answer。
  const askParams = async (request: AskRequest) => {
    asked.push(String(request.params.template));
    return answer === null ? null : { template: answer };
  };
  const run = async () =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo,
        files,
        registry,
        locale: 'zh',
        now,
        newId: () => `id${++ids}`,
        ui,
        askParams,
      })
    ).result;
  return { repo, files, asked, confirms, run };
}

const mergeWorkflow = (ops: Op[] = []) => pdfWorkspace(ops).workflows[0]!;

const custom = (steps: Workflow['steps']): Workflow => ({ id: 'mine', name: '我的', steps });

describe('action implementations', () => {
  it('every registered action has an implementation', () => {
    const missing = [...registry.actions.keys()].filter((id) => !ACTION_IMPLS[id]);
    expect(missing).toEqual([]);
  });
});

describe('PDF merge workflow (migrated to typed steps)', () => {
  it('B: picks files, merges them for real, asks for a name and saves only the result', async () => {
    const { repo, files, asked, run } = setup(mergeWorkflow());
    files.nextPick = [
      files.offer('报告.pdf', await makePdf(1)),
      files.offer('附录.pdf', await makePdf(2)),
    ];

    const result = await run();
    expect(result).toMatchObject({ status: 'succeeded' });
    if (result.status !== 'succeeded' || result.value?.type !== 'pdf') throw new Error('no pdf');
    expect(files.lastPickTypes).toEqual(['application/pdf']);
    // 询问时传入的是模板，运行页面再把它显示成「报告-合并」。
    expect(asked).toEqual(['{sourceName}-合并']);
    const [out] = result.value.items;
    expect(out).toMatchObject({ name: '我的合并', ext: 'pdf', pageCount: 3 });

    const saved = (await repo.listAssets())[0]!;
    expect(saved).toMatchObject({ name: '我的合并.pdf', source: 'generated', id: out!.assetId });
    const merged = await PDFDocument.load(files.disk.get(saved.path)!);
    expect(merged.getPages().map((p) => p.getWidth())).toEqual([200, 200, 201]);

    // 选中的 PDF 不再导入成用户文件（D-063）；输出授权给 PDF 工具；执行记录只有元数据。
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['我的合并.pdf']);
    expect(await repo.hasGrant('pdf', saved.id)).toBe(true);
    expect(await repo.listToolRuns(1)).toEqual([
      expect.objectContaining({ status: 'succeeded', outputAssetId: saved.id, error: null }),
    ]);
  });

  it('C: after simplification it saves automatically as 合并-日期, never overwriting', async () => {
    const simplified = mergeWorkflow([
      {
        op: 'setStepParams',
        workflowId: 'pdf-merge',
        stepId: 'name',
        params: { template: '合并-{date:YYYY-MM-DD}' },
        ask: [],
      },
    ]);
    const { files, asked, repo, run } = setup(simplified);
    const pick = async () => [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    files.nextPick = await pick();
    await run();
    files.nextPick = await pick();
    await run();
    expect(asked).toEqual([]);
    expect((await repo.listAssets()).map((a) => a.name)).toEqual([
      '合并-2026-10-22-2.pdf',
      '合并-2026-10-22.pdf',
    ]);
  });

  it('cancelling the picker or the name question is not an error, and cleans up', async () => {
    const a = setup(mergeWorkflow());
    a.files.nextPick = null;
    expect(await a.run()).toEqual({ status: 'cancelled' });

    const b = setup(mergeWorkflow(), null);
    b.files.nextPick = [
      b.files.offer('a.pdf', await makePdf(1)),
      b.files.offer('b.pdf', await makePdf(1)),
    ];
    expect(await b.run()).toEqual({ status: 'cancelled' });
    expect(b.files.runFiles()).toEqual([]);
    expect(await b.repo.listToolRuns(1)).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
  });

  it('reports wrong counts and types, size limits and broken or locked files clearly', async () => {
    const { files, run } = setup(mergeWorkflow());

    files.nextPick = [files.offer('only.pdf', await makePdf(1))];
    expect(await run()).toMatchObject({
      status: 'failed',
      stepIndex: 0,
      error: { code: 'tooFew', detail: { min: 2 } },
    });

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('photo.jpg', new Uint8Array([1]), 'image/jpeg'),
    ];
    expect(await run()).toMatchObject({
      error: { code: 'wrongType', detail: { name: 'photo.jpg', kind: 'PDF' } },
    });

    const huge = { ...files.offer('huge.pdf', new Uint8Array([1])), size: 60 * 1024 * 1024 };
    files.nextPick = [files.offer('a.pdf', await makePdf(1)), huge];
    expect(await run()).toMatchObject({
      error: { code: 'tooLarge', detail: { name: 'huge.pdf', mb: 50 } },
    });

    const big = (n: string) => ({ ...files.offer(n, new Uint8Array([1])), size: 40 * 1024 * 1024 });
    files.nextPick = [big('1.pdf'), big('2.pdf'), big('3.pdf')];
    expect(await run()).toMatchObject({ error: { code: 'tooLargeTotal' } });

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('broken.pdf', Uint8Array.from([37, 80, 68, 70])),
    ];
    expect(await run()).toMatchObject({
      stepIndex: 1,
      error: { code: 'unreadable', detail: { name: 'broken.pdf' } },
    });

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      { uri: 'picker://gone.pdf', name: 'gone.pdf', size: 10, mimeType: 'application/pdf' },
    ];
    expect(await run()).toMatchObject({
      error: { code: 'accessDenied', detail: { name: 'gone.pdf' } },
    });
    // 失败时临时文件已经删掉。
    expect(files.runFiles()).toEqual([]);
  });
});

describe('input and output actions', () => {
  const photo = (files: FakeFiles, name: string, takenAt?: number) => ({
    ...files.offer(name, new Uint8Array([0xff, 0xd8, 1]), 'image/jpeg'),
    width: 4032,
    height: 3024,
    ...(takenAt !== undefined ? { takenAt } : {}),
  });

  it('picks photos, names them by capture date and sequence, shares, saves to Photos and prints', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
      { id: 'name', action: 'file.rename', params: { template: '收据-{taken}-{seq}' } },
      { id: 'share', action: 'out.share', params: {} },
      { id: 'photos', action: 'out.saveToPhotos', params: {} },
      { id: 'print', action: 'out.print', params: {} },
    ]);
    const { files, run, repo } = setup(wf);
    files.nextPhotos = [
      photo(files, 'IMG_1.HEIC', new Date(2025, 0, 2).getTime()),
      photo(files, 'IMG_2.jpg'),
    ];
    const result = await run();
    if (result.status !== 'succeeded' || result.value?.type !== 'images') throw new Error('failed');
    expect(result.value.items.map((i) => `${i.name}.${i.ext}`)).toEqual([
      '收据-2025-01-02-01.heic',
      '收据-2026-10-22-02.jpg',
    ]);
    expect(result.value.items[0]).toMatchObject({ width: 4032, mimeType: 'image/jpeg' });
    // 分享出去的文件名就是命名后的名字。
    expect(files.shared.map((u) => u.split('/').pop())).toEqual([
      '收据-2025-01-02-01.heic',
      '收据-2026-10-22-02.jpg',
    ]);
    expect(files.savedToPhotos).toHaveLength(2);
    expect(files.printed).toHaveLength(2);
    // 没有保存步骤：没有产生用户文件，临时文件留给结果页使用。
    expect(await repo.listAssets()).toEqual([]);
    expect(files.runFiles().length).toBeGreaterThan(0);
  });

  it('shares all files in one sheet and saves them to a chosen folder', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
      { id: 'share', action: 'out.share', params: {} },
      { id: 'folder', action: 'out.saveToFolder', params: {} },
    ]);
    const { files, run } = setup(wf);
    files.nextPhotos = [photo(files, 'a.jpg'), photo(files, 'b.jpg'), photo(files, 'c.jpg')];
    expect(await run()).toMatchObject({ status: 'succeeded' });
    expect(files.shareSheets.map((sheet) => sheet.map((u) => u.split('/').pop()))).toEqual([
      ['a.jpg', 'b.jpg', 'c.jpg'],
    ]);
    const folder = files.folders.get('MorphOut')!;
    expect([...folder.keys()]).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(folder.get('a.jpg')).toEqual(new Uint8Array([0xff, 0xd8, 1]));
    expect(files.folderPicks).toBe(1);

    // 记住了文件夹（D-123）：下次直接存进去，不再弹选择器。
    files.nextPhotos = [photo(files, 'd.jpg')];
    expect(await run()).toMatchObject({ status: 'succeeded' });
    expect(files.folderPicks).toBe(1);
    expect(files.folders.get('MorphOut')!.has('d.jpg')).toBe(true);
  });

  it('keeps the result when the folder picker is closed, and reports a folder it cannot write', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
      { id: 'folder', action: 'out.saveToFolder', params: {} },
    ]);
    const { files, run } = setup(wf);
    files.nextPhotos = [photo(files, 'a.jpg')];
    files.folderChoice = 'cancel';
    // 和关掉分享面板一样：运行成功，结果页上还可以再存。
    expect(await run()).toMatchObject({ status: 'succeeded', value: { type: 'images' } });
    expect(files.folders.size).toBe(0);
    expect(files.remembered).toBeNull();

    files.folderChoice = 'notWritable';
    expect(await run()).toMatchObject({ stepIndex: 1, error: { code: 'folderNotWritable' } });
  });

  it('takes photos one by one until the user is done', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.photos', params: { source: 'camera', min: 1, max: 5 } },
    ]);
    const { files, confirms, run } = setup(wf);
    files.camera = [photo(files, 'a.jpg'), photo(files, 'b.jpg'), photo(files, 'c.jpg')];
    confirms.push(true, false);
    const result = await run();
    expect(
      result.status === 'succeeded' && result.value?.type === 'images' && result.value.items.length,
    ).toBe(2);

    files.cameraAvailable = false;
    expect(await run()).toMatchObject({ error: { code: 'cameraUnavailable' } });
  });

  it('reports missing permission to save to Photos', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
      { id: 'photos', action: 'out.saveToPhotos', params: {} },
    ]);
    const { files, run } = setup(wf);
    files.photosAllowed = false;
    files.nextPhotos = [photo(files, 'a.jpg')];
    expect(await run()).toMatchObject({ stepIndex: 1, error: { code: 'permissionDenied' } });
  });

  it('accepts PDFs and images together when asked to', async () => {
    const wf = custom([
      { id: 'pick', action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 5 } },
      { id: 'save', action: 'file.save', params: {} },
    ]);
    const { files, run, repo } = setup(wf);
    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.png', new Uint8Array([1]), 'image/png'),
    ];
    const result = await run();
    expect(result).toMatchObject({ status: 'succeeded', value: { type: 'files' } });
    expect(files.lastPickTypes).toEqual(['application/pdf', 'image/*']);
    expect((await repo.listAssets()).map((a) => a.name).sort()).toEqual(['a.pdf', 'b.png']);
    expect(await repo.hasGrant('workflow:mine', (await repo.listAssets())[0]!.id)).toBe(true);
  });
});
