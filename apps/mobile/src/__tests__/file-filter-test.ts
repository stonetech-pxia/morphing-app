import {
  BUILTIN_TOOLS,
  createRegistry,
  type RunResult,
  type Workflow,
  type WorkflowStep,
} from '@morph/core';

import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';

// 按条件筛选（D-242）：在真正的执行器里跑，选择器没给的尺寸和时长要在本机补上再筛。

const registry = createRegistry(BUILTIN_TOOLS);
const NONE = {
  kind: 'any',
  size: 'any',
  orientation: 'any',
  date: 'any',
  duration: 'any',
  whenEmpty: 'stop',
};

const wf = (first: WorkflowStep, filter: Record<string, unknown>): Workflow => ({
  kind: 'quickAction',
  id: 'mine',
  name: '筛选',
  steps: [first, { id: 'keep', action: 'file.filter', params: { ...NONE, ...filter } }],
});
const photos: WorkflowStep = {
  id: 'pick',
  action: 'in.photos',
  params: { source: 'library', min: 1, max: 30 },
};

let ids = 0;
async function run(files: FakeFiles, workflow: Workflow): Promise<RunResult> {
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => null as never,
  };
  return (
    await startRun({
      workflow,
      revisionId: 1,
      repo: new MemoryWorkspaceRepo(),
      files,
      registry,
      locale: 'zh',
      now: () => new Date(2026, 9, 22, 10),
      newId: () => `id${++ids}`,
      ui,
      collections: [],
    })
  ).result;
}
const names = (r: RunResult) =>
  r.status === 'succeeded' && r.value && 'items' in r.value ? r.value.items.map((i) => i.name) : r;

describe('file.filter', () => {
  it('keeps landscape photos, reading the size in pixels when the picker did not give it', async () => {
    const files = new FakeFiles();
    const strip = ({ width: _w, height: _h, ...rest }: ReturnType<FakeFiles['offerImage']>) => rest;
    files.nextPhotos = [
      strip(files.offerImage('wide.jpg', 4032, 3024)),
      strip(files.offerImage('tall.jpg', 3024, 4032)),
    ];
    expect(names(await run(files, wf(photos, { orientation: 'landscape' })))).toEqual(['wide']);
  });

  it('keeps short videos, probing the length on the device', async () => {
    const files = new FakeFiles();
    const strip = ({ durationMs: _d, ...rest }: ReturnType<FakeFiles['offerVideo']>) => rest;
    files.nextVideos = [
      strip(files.offerVideo('short.mov', { size: 100, durationMs: 20_000 })),
      strip(files.offerVideo('long.mov', { size: 100, durationMs: 300_000 })),
    ];
    const videos: WorkflowStep = {
      id: 'pick',
      action: 'in.videos',
      params: { source: 'library', min: 1, max: 10 },
    };
    const result = await run(files, wf(videos, { duration: 'shorter', seconds: 60 }));
    expect(names(result)).toEqual(['short']);
  });

  it('stops with a clear message when nothing is left, or passes everything on with skip', async () => {
    const pdfs: WorkflowStep = {
      id: 'pick',
      action: 'in.files',
      params: { accept: 'any', min: 1, max: 10 },
    };
    const offer = (files: FakeFiles) => {
      files.nextPick = [
        files.offer('a.pdf', new Uint8Array(10)),
        files.offer('b.pdf', new Uint8Array(10)),
      ];
    };
    const stop = new FakeFiles();
    offer(stop);
    const stopped = await run(stop, wf(pdfs, { size: 'larger', sizeMB: 5 }));
    expect(stopped).toMatchObject({
      status: 'failed',
      error: { code: 'noneMatched', detail: { count: 2 } },
    });

    const skip = new FakeFiles();
    offer(skip);
    const skipped = await run(skip, wf(pdfs, { size: 'larger', sizeMB: 5, whenEmpty: 'skip' }));
    expect(names(skipped)).toEqual(['a', 'b']);
  });

  it('uses the modified date of files picked in Files', async () => {
    const files = new FakeFiles();
    files.nextPick = [
      { ...files.offer('new.pdf', new Uint8Array(1)), modifiedAt: new Date(2026, 9, 20).getTime() },
      { ...files.offer('old.pdf', new Uint8Array(1)), modifiedAt: new Date(2026, 0, 2).getTime() },
      files.offer('unknown.pdf', new Uint8Array(1)),
    ];
    const pdfs: WorkflowStep = {
      id: 'pick',
      action: 'in.files',
      params: { accept: 'pdf', min: 1, max: 10 },
    };
    const result = await run(files, wf(pdfs, { date: 'lastDays', days: 30 }));
    expect(names(result)).toEqual(['new']);
  });
});
