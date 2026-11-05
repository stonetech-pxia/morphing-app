import {
  applyOps,
  createDefaultWorkspace,
  initialParams,
  type Collection,
  type Locale,
  type Op,
  type Registry,
  type Workflow,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 记录里的附件交给工具（D-442）：附件字段、列表、单条记录块上的按钮，点了才把里面第一步收的文件的副本交给它。
// 三种状态都走：没有数据、有数据、边界情况（混着类型、文件已经不在了、太大、太多、视频不复制）。
// 原件（用户文件）一个都不动；副本在运行目录里，结束后一个不剩。

const docs: Collection = {
  id: 'docs',
  name: 'Docs',
  fields: [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'total', name: 'Total', type: 'number' },
    { id: 'scan', name: 'Scan', type: 'file' },
  ],
  recordRow: [
    { tool: 'share-all', field: 'scan' },
    { tool: 'pdf-only', field: 'scan' },
    { tool: 'record-copy', field: 'total' },
  ],
};

const own = (id: string, name: string, action: string): Workflow => ({
  id,
  kind: 'quickAction',
  name,
  steps: [{ id: 's0', action, params: {} }],
});

const seed =
  (extra: Op[] = []) =>
  (locale: Locale, registry: Registry) => {
    const pdfOnly = own('pdf-only', 'Only PDFs', 'pdf.compress');
    pdfOnly.steps[0]!.params = initialParams(registry.actions.get('pdf.compress')!);
    const result = applyOps(
      createDefaultWorkspace(locale),
      [
        { op: 'addData', table: docs },
        { op: 'addTool', tool: own('share-all', 'Share files', 'out.share') },
        { op: 'addTool', tool: pdfOnly },
        ...extra,
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

const asset = (id: string, name: string, mimeType: string, size = 1000) => ({
  id,
  name,
  mimeType,
  size,
  path: `assets/${id}/${name}`,
  source: 'picked' as const,
  createdAt: 1,
});

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
  });

/** 放一个用户文件：磁盘上有，记录里也有。 */
async function put(repo: MemoryWorkspaceRepo, files: FakeFiles, a: ReturnType<typeof asset>) {
  await repo.addAsset(a);
  files.disk.set(a.path, new TextEncoder().encode(`bytes of ${a.name}`));
}

async function start(
  records: { id: string; values: Record<string, unknown> }[],
  assets: ReturnType<typeof asset>[] = [],
  extra: Op[] = [],
  path?: Parameters<typeof router.push>[0],
) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  for (const a of assets) await put(repo, files, a);
  for (const r of records)
    await repo.insertRecord({
      id: r.id,
      collectionId: 'docs',
      values: r.values,
      createdAt: Number(r.id.replace(/\D/g, '')) || 1,
      updatedAt: 1,
    });
  await renderToolsApp(repo, files, { locale: 'en', seed: seed(extra) });
  await settle();
  if (path) {
    await act(() => router.push(path));
    await settle();
  }
  return { repo, files };
}

const entry = (recordId: string) =>
  ({ pathname: '/record/[collectionId]', params: { collectionId: 'docs', recordId } }) as const;
const page = (pageId: string) => ({ pathname: '/page/[pageId]', params: { pageId } }) as const;

const jpg = asset('a1', 'photo.jpg', 'image/jpeg');
const pdf = asset('a2', 'scan.pdf', 'application/pdf');
const pdf2 = asset('a3', 'other.pdf', 'application/pdf');
const word = asset('a4', 'letter.docx', 'application/octet-stream');
const video = asset('a5', 'clip.mp4', 'video/mp4');

const originals = (files: FakeFiles) =>
  [...files.disk.keys()].filter((k) => k.startsWith('assets/')).sort();

let alert: jest.SpiedFunction<typeof Alert.alert>;
beforeEach(() => {
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('new user, no data', () => {
  it('an entry without attachments has no file buttons, and no number means no copy button', async () => {
    await start([{ id: 'r1', values: { title: 'A' } }], [], [], entry('r1'));
    expect(screen.queryByTestId('record-actions')).toBeNull();
  });

  it('a list with no entries has no button for files', async () => {
    await start(
      [],
      [],
      [
        {
          op: 'addContainer',
          page: 'home',
          index: 0,
          block: {
            id: 'docs-list',
            look: 'list',
            source: { table: 'docs' },
            show: { title: 'title' },
            tools: [{ as: 'list', tool: 'share-all' }],
          },
        },
      ],
      page('home'),
    );
    expect(screen.queryByTestId('list-tool-share-all')).toBeNull();
  });
});

describe('with data: the entry page', () => {
  it('shows a button for each tool that takes some of the attachments, not for the others', async () => {
    await start([{ id: 'r1', values: { title: 'A', scan: ['a1'] } }], [jpg], [], entry('r1'));
    expect(await screen.findByTestId('record-action-share-all-scan')).toBeTruthy();
    // 只有一张图片：只收 PDF 的工具没有可交的。
    expect(screen.queryByTestId('record-action-pdf-only-scan')).toBeNull();
  });

  it('a PDF among the attachments shows the PDF tool too', async () => {
    await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1', 'a2'] } }],
      [jpg, pdf],
      [],
      entry('r1'),
    );
    expect(await screen.findByTestId('record-action-pdf-only-scan')).toBeTruthy();
  });

  it('runs on copies in the run folder: the originals stay, and nothing is left behind', async () => {
    const { files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1', 'a2'] } }],
      [jpg, pdf],
      [],
      entry('r1'),
    );
    const before = originals(files);
    await fireEvent.press(await screen.findByTestId('record-action-share-all-scan'));
    await waitFor(() => expect(files.shared.length).toBeGreaterThan(0));
    // 分享出去的是运行目录里的副本，不是用户文件。
    expect(files.shared.every((uri) => uri.startsWith('runs/'))).toBe(true);
    expect(files.shared.map((u) => u.split('/').pop()).sort()).toEqual(['photo.jpg', 'scan.pdf']);
    expect(originals(files)).toEqual(before);
    // 离开运行页面后，副本一个不剩。
    await act(() => router.back());
    await settle();
    await waitFor(() => expect(files.runFiles()).toEqual([]));
    expect(originals(files)).toEqual(before);
  });

  it('only the kind the first step takes is handed over', async () => {
    const { files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1', 'a2', 'a3', 'a4'] } }],
      [jpg, pdf, pdf2, word],
      [],
      entry('r1'),
    );
    // share-all 收任何文件：四个都交。
    await fireEvent.press(await screen.findByTestId('record-action-share-all-scan'));
    await waitFor(() => expect(files.shared).toHaveLength(4));
  });

  it('a number field still hands over text the same way as before', async () => {
    await start([{ id: 'r1', values: { title: 'A', total: 12.5 } }], [], [], entry('r1'));
    expect(await screen.findByTestId('record-action-record-copy-total')).toBeTruthy();
  });
});

describe('edge cases', () => {
  it('an attachment that is not on this device any more is skipped; none left means no button', async () => {
    await start([{ id: 'r1', values: { title: 'A', scan: ['gone'] } }], [], [], entry('r1'));
    expect(screen.queryByTestId('record-action-share-all-scan')).toBeNull();
  });

  it('a file deleted between showing the button and tapping it: says so, runs nothing, leaves nothing', async () => {
    const { repo, files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1'] } }],
      [jpg],
      [],
      entry('r1'),
    );
    const button = await screen.findByTestId('record-action-share-all-scan');
    await repo.deleteAsset('a1');
    await fireEvent.press(button);
    await waitFor(() => expect(screen.queryByTestId('run-screen')).toBeTruthy());
    await settle();
    expect(files.shared).toEqual([]);
    expect(files.runFiles()).toEqual([]);
    expect(originals(files)).toEqual(['assets/a1/photo.jpg']);
  });

  it('a file that is too large is refused before anything is copied', async () => {
    const huge = asset('a9', 'huge.pdf', 'application/pdf', 60 * 1024 * 1024);
    const { files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a9'] } }],
      [huge],
      [],
      entry('r1'),
    );
    await fireEvent.press(await screen.findByTestId('record-action-share-all-scan'));
    await settle();
    expect(files.shared).toEqual([]);
    expect(files.runFiles()).toEqual([]);
    expect(originals(files)).toEqual(['assets/a9/huge.pdf']);
  });

  it('a copy that fails halfway leaves nothing in the run folder, and the originals stay', async () => {
    const { repo, files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1', 'a2'] } }],
      [jpg],
      [],
      entry('r1'),
    );
    // 第二个文件在记录里、磁盘上却没有（读不了）：第一个已经复制的也要删。
    await repo.addAsset(pdf);
    await act(() => router.push(entry('r1')));
    await settle();
    await fireEvent.press(await screen.findByTestId('record-action-share-all-scan'));
    await settle();
    expect(files.shared).toEqual([]);
    expect(files.runFiles()).toEqual([]);
    expect(originals(files)).toEqual(['assets/a1/photo.jpg']);
  });

  it('a video is used where it is: not copied, never moved or deleted', async () => {
    const { files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a5'] } }],
      [video],
      [],
      entry('r1'),
    );
    await fireEvent.press(await screen.findByTestId('record-action-share-all-scan'));
    await waitFor(() => expect(files.shared).toHaveLength(1));
    // 原地使用：没有复制进运行目录，分享的就是用户文件的地址。
    expect(files.shared[0]).toBe('file:///fake/assets/a5/clip.mp4');
    expect(files.adopted).toEqual(['file:///fake/assets/a5/clip.mp4']);
    await act(() => router.back());
    await settle();
    expect(files.disk.has('assets/a5/clip.mp4')).toBe(true);
  });
});

describe('lists and single blocks', () => {
  const listBlock = (tool: object, id = 'docs-list') => ({
    op: 'addContainer' as const,
    page: 'home',
    index: 0,
    block: {
      id,
      look: 'list',
      source: { table: 'docs' },
      show: { title: 'title' },
      tools: [tool],
    },
  });

  it('the list hands over the attachments of everything it shows', async () => {
    const { files } = await start(
      [
        { id: 'r1', values: { title: 'A', scan: ['a1'] } },
        { id: 'r2', values: { title: 'B', scan: ['a2', 'a3'] } },
        { id: 'r3', values: { title: 'C' } },
      ],
      [jpg, pdf, pdf2],
      [listBlock({ as: 'list', tool: 'share-all' })],
      page('home'),
    );
    await fireEvent.press(await screen.findByTestId('list-tool-share-all'));
    await waitFor(() => expect(files.shared).toHaveLength(3));
  });

  it('more attachments than one entry can hold is refused, nothing is copied', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `m${i}`);
    const records = [
      { id: 'r1', values: { title: 'A', scan: ids.slice(0, 11) } },
      { id: 'r2', values: { title: 'B', scan: ids.slice(11) } },
    ];
    const many = ids.map((id) => asset(id, `${id}.jpg`, 'image/jpeg', 10));
    const { files } = await start(
      records,
      many,
      [listBlock({ as: 'list', tool: 'share-all' })],
      page('home'),
    );
    await fireEvent.press(await screen.findByTestId('list-tool-share-all'));
    await settle();
    expect(files.shared).toEqual([]);
    expect(files.runFiles()).toEqual([]);
    expect(originals(files)).toHaveLength(21);
  });

  it('a single block hands over the attachments of its one entry', async () => {
    const { files } = await start(
      [{ id: 'r1', values: { title: 'A', scan: ['a1', 'a2'] } }],
      [jpg, pdf],
      [
        {
          op: 'addContainer',
          page: 'home',
          index: 0,
          block: {
            id: 'one',
            look: 'single',
            source: { table: 'docs' },
            show: { fields: ['title'] },
            tools: [{ tool: 'share-all' }],
          },
        },
      ],
      page('home'),
    );
    await fireEvent.press(await screen.findByTestId('single-tool-share-all'));
    await waitFor(() => expect(files.shared).toHaveLength(2));
    expect(alert).not.toHaveBeenCalled();
  });
});
