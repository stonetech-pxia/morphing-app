import { BUILTIN_TOOLS, createRegistry, type RunResult, type Workflow } from '@morph/core';
import { PDFDocument } from 'pdf-lib';
import { extractZip } from '@morph/tool-archive';

import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

// 分组后各出一份（D-243）：真正的 pdf-lib 和 fflate，每组一个文件。

const registry = createRegistry(BUILTIN_TOOLS);
const A4 = { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 };
const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();

let ids = 0;
async function run(files: FakeFiles, steps: Workflow['steps']): Promise<RunResult> {
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => null as never,
  };
  return (
    await startRun({
      workflow: { kind: 'quickAction', id: 'mine', name: '分组', steps },
      revisionId: 1,
      repo: new MemoryWorkspaceRepo(),
      files,
      registry,
      locale: 'zh',
      now: () => new Date(2026, 9, 22),
      newId: () => `id${++ids}`,
      ui,
      collections: [],
    })
  ).result;
}
const outputs = (r: RunResult) => {
  if (r.status !== 'succeeded' || !r.value || !('items' in r.value))
    throw new Error(JSON.stringify(r));
  return r.value.items;
};
const photos = { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } };

describe('grouping', () => {
  it('makes one PDF per day taken, named by the date, undated photos last', async () => {
    const files = new FakeFiles();
    files.nextPhotos = [
      { ...files.offerImage('a.jpg', 40, 30), takenAt: day(21) },
      { ...files.offerImage('b.jpg', 40, 30), takenAt: day(22, 9) },
      { ...files.offerImage('c.jpg', 40, 30), takenAt: day(21, 20) },
      files.offerImage('d.jpg', 40, 30),
    ];
    const items = outputs(
      await run(files, [
        photos,
        { id: 'pdf', action: 'pdf.fromImages', params: { ...A4, group: 'day' } },
      ]),
    );
    expect(items.map((i) => [i.name, i.pageCount])).toEqual([
      ['2026-10-21', 2],
      ['2026-10-22', 1],
      ['没有日期', 1],
    ]);
    const first = await PDFDocument.load(files.disk.get(items[0]!.uri)!);
    expect(first.getPageCount()).toBe(2);
  });

  it('zips every 2 files into its own archive', async () => {
    const files = new FakeFiles();
    files.nextPick = ['a', 'b', 'c'].map((n) =>
      files.offer(`${n}.txt`, new TextEncoder().encode(n), 'text/plain'),
    );
    const items = outputs(
      await run(files, [
        { id: 'pick', action: 'in.files', params: { accept: 'any', min: 1, max: 10 } },
        { id: 'zip', action: 'zip.create', params: { group: 'count', groupSize: 2 } },
      ]),
    );
    expect(items.map((i) => i.name)).toEqual(['a', 'c']);
    expect(extractZip(files.disk.get(items[0]!.uri)!).map((e) => e.name)).toEqual([
      'a.txt',
      'b.txt',
    ]);
    expect(extractZip(files.disk.get(items[1]!.uri)!).map((e) => e.name)).toEqual(['c.txt']);
  });

  it('merging by month keeps a month with a single PDF as it is', async () => {
    const files = new FakeFiles();
    files.nextPick = [
      { ...files.offer('sep.pdf', await makePdf(1)), modifiedAt: day(-5) },
      { ...files.offer('oct1.pdf', await makePdf(2)), modifiedAt: day(3) },
      { ...files.offer('oct2.pdf', await makePdf(1)), modifiedAt: day(9) },
    ];
    const items = outputs(
      await run(files, [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } },
        { id: 'merge', action: 'pdf.merge', params: { group: 'month' } },
      ]),
    );
    expect(items.map((i) => [i.name, i.pageCount])).toEqual([
      ['2026-09', 1],
      ['2026-10', 3],
    ]);
  });

  it('without grouping, merging a single PDF still asks for at least two', async () => {
    const files = new FakeFiles();
    files.nextPick = [files.offer('one.pdf', await makePdf(1))];
    const result = await run(files, [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } },
      { id: 'merge', action: 'pdf.merge', params: {} },
    ]);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'tooFew' } });
  });
});
