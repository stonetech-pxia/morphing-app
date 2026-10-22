import {
  BUILTIN_TOOLS,
  WORKFLOW_PRESETS,
  createRegistry,
  presetWorkflow,
  type RunResult,
} from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import type { PackRuntime } from '../packs/bridge';
import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG, makePdf, makePng } from '../test-utils/fake-files';

// 预设工作流从头跑到尾（T7）：平台、本地界面和扩展包页面换成假的，动作用真实实现。
// 预设不要求安装工具（用户工作流），所以这里不安装任何工具。

const registry = createRegistry(BUILTIN_TOOLS);
const preset = (id: string) =>
  presetWorkflow(
    WORKFLOW_PRESETS.find((p) => p.id === id)!,
    'zh',
    id,
  );

const fakePacks: PackRuntime = {
  async call<T>(_page: string, method: string): Promise<T> {
    if (method === 'render') {
      const data = btoa(String.fromCharCode(...TINY_JPEG));
      return [{ index: 0, width: 60, height: 40, data }] as T;
    }
    throw new Error(method);
  },
};

let ids = 0;
function setup(local: Partial<Record<LocalKind, unknown>> = {}) {
  const files = new FakeFiles();
  const opened: LocalKind[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    open: async (kind) => {
      opened.push(kind);
      return (local[kind] ?? null) as never;
    },
  };
  const run = async (id: string): Promise<RunResult> =>
    (
      await startRun({
        workflow: preset(id),
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        packs: { runtime: fakePacks, isInstalled: async () => true },
        ensurePack: async () => true,
        askParams: async (request) => request.params,
      })
    ).result;
  return { files, run, opened };
}

const items = (r: RunResult) => {
  if (r.status !== 'succeeded' || !r.value || !('items' in r.value)) {
    throw new Error(JSON.stringify(r));
  }
  return r.value.items;
};

describe('presets run end to end', () => {
  it('application packet: crop, put in order (dropping one), one PDF under 4 MB, shared', async () => {
    const { files, run, opened } = setup({
      crop: [0, 1, 2].map(() => ({ x: 0, y: 0, width: 1000, height: 1400 })),
      reorder: [2, 0],
    });
    files.nextPhotos = ['a', 'b', 'c'].map((n) => files.offerImage(`${n}.jpg`, 3000, 4000));
    const [pdf] = items(await run('document-packet'));
    expect(opened).toEqual(['crop', 'reorder']);
    expect(pdf).toMatchObject({ ext: 'pdf', pageCount: 2, name: '材料-2026-10-22' });
    expect(pdf!.size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(files.shared).toHaveLength(1);
  });

  it('sign and send back: a PDF without form fields skips filling and is signed', async () => {
    const { files, run, opened } = setup({
      sign: { png: makePng(30, 10), pageIndex: 0, x: 0.5, y: 0.8, width: 0.3 },
    });
    files.nextPick = [files.offer('lease.pdf', await makePdf(1))];
    const [pdf] = items(await run('sign-return'));
    expect(opened).toEqual(['sign']);
    const doc = await PDFDocument.load(files.disk.get(pdf!.uri)!);
    expect(doc.getPageCount()).toBe(1);
  });

  it('send many photos: JPG, no location, 2048 px, one ZIP', async () => {
    const { files, run } = setup();
    files.nextPhotos = [files.offerImage('1.heic', 4032, 3024, 'image/heic')];
    const [zip] = items(await run('send-photos'));
    expect(zip).toMatchObject({ ext: 'zip', name: '照片-2026-10-22' });
  });

  it('visa photo and ID photos to print', async () => {
    const frame = { x: 0, y: 0, width: 3000, height: 3000 };
    const visa = setup({ crop: [frame] });
    visa.files.nextPhotos = [visa.files.offerImage('me.jpg', 3024, 4032)];
    const [photo] = items(await visa.run('visa-photo'));
    expect(photo).toMatchObject({ width: 600, height: 600, name: '证件照-2026-10-22' });

    const print = setup({ crop: [frame] });
    print.files.nextPhotos = [print.files.offerImage('me.jpg', 3024, 4032)];
    const [sheet] = items(await print.run('print-id-photos'));
    expect(sheet).toMatchObject({ width: 1200, height: 1800 });
  });
});
