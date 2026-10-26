import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type AskRequest,
  type RunItem,
  type Workflow,
} from '@morph/core';
import { PDFDocument } from 'pdf-lib';

import type { LocalSteps, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'pdf' }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

const custom = (steps: Workflow['steps']): Workflow => ({ id: 'mine', name: '我的', steps });

let ids = 0;
function setup(
  workflow: Workflow,
  answers: Record<string, unknown> = {},
  pages: LocalSteps['pages']['out'] | null | (() => Promise<never>) = null,
) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const opened: unknown[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (_kind, input) => {
      opened.push(input);
      return (typeof pages === 'function' ? await pages() : pages) as never;
    },
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
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        askParams: async (request: AskRequest) => ({ ...request.params, ...answers }),
      })
    ).result;
  return { files, run, opened };
}

async function pdfsOf(
  files: FakeFiles,
  result: Awaited<ReturnType<ReturnType<typeof setup>['run']>>,
) {
  if (result.status !== 'succeeded' || result.value?.type !== 'pdf') {
    throw new Error(`no pdf: ${JSON.stringify(result)}`);
  }
  return Promise.all(
    result.value.items.map(async (item: RunItem) => ({
      item,
      doc: await PDFDocument.load(files.disk.get(item.uri)!),
    })),
  );
}

/** 每页宽度 = 200 + 页码（0 起），用来检查页序。 */
const widths = (doc: PDFDocument) => doc.getPages().map((p) => p.getWidth());

describe('PDF tool workflows', () => {
  it('installs seventeen single-tool workflows that all validate', () => {
    const result = applyOps(createDefaultWorkspace('en'), [{ op: 'installTool', toolId: 'pdf' }], {
      registry,
      locale: 'en',
    });
    expect(result.ok && result.config.workflows).toHaveLength(17);
  });

  it('merges PDFs and images in order; images become A4 pages', async () => {
    const { files, run } = setup(toolWorkflow('pdf-combine'));
    files.nextPick = [
      files.offer('a.pdf', await makePdf(2)),
      files.offerImage('photo.heic', 4032, 3024, 'image/heic'),
      files.offer('b.pdf', await makePdf(1)),
    ];
    const [{ item, doc }] = await pdfsOf(files, await run());
    expect(item).toMatchObject({ name: 'a', pageCount: 4 });
    expect(widths(doc)[0]).toBe(200);
    // 横图放在横向 A4 上（842 × 595 pt）。
    expect(Math.round(doc.getPage(2).getWidth())).toBe(842);
    expect(widths(doc)[3]).toBe(200);
  });

  it('turns photos into one A4 PDF, and fits it under a size limit', async () => {
    const plain = setup(toolWorkflow('pdf-images'), { pageSize: 'a4', maxMB: 0 });
    plain.files.nextPhotos = [
      plain.files.offerImage('1.jpg', 3000, 4000),
      plain.files.offerImage('2.jpg', 3000, 4000),
    ];
    const [first] = await pdfsOf(plain.files, await plain.run());
    expect(first!.item.pageCount).toBe(2);
    const page = first!.doc.getPage(0);
    // A4：短边 595 pt。
    expect(Math.round(Math.min(page.getWidth(), page.getHeight()))).toBe(595);
    // 原图是 JPEG：直接嵌入，不重新编码。
    expect(plain.files.encodes).toEqual([]);

    const limited = setup(toolWorkflow('pdf-images'), { pageSize: 'a4', maxMB: 4 });
    // 6 张约 2 MB 的照片（真实 JPEG 开头 + 补零），合计远超 4 MB。
    const big = (name: string) => {
      const jpeg = limited.files.disk.get(limited.files.offerImage('x.jpg', 1, 1).uri)!;
      const bytes = new Uint8Array(2 * 1024 * 1024);
      bytes.set(jpeg);
      return limited.files.offerImage(name, 3000, 4000, 'image/jpeg', bytes);
    };
    limited.files.nextPhotos = Array.from({ length: 6 }, (_, i) => big(`${i}.jpg`));
    const [small] = await pdfsOf(limited.files, await limited.run());
    expect(small!.item.size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(small!.item.pageCount).toBe(6);
    expect(limited.files.encodes.length).toBeGreaterThan(6);
  });

  it('arranges pages from the local page screen: remove, reorder, rotate', async () => {
    const { files, run, opened } = setup(toolWorkflow('pdf-arrange'), {}, [
      { index: 2, rotate: 90 },
      { index: 0, rotate: 0 },
    ]);
    files.nextPick = [files.offer('report.pdf', await makePdf(3))];
    const [{ doc }] = await pdfsOf(files, await run());
    expect(opened[0]).toMatchObject({ pages: [{ width: 200 }, { width: 201 }, { width: 202 }] });
    expect(widths(doc)).toEqual([202, 200]);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  it('keeps the PDF as it is when nothing on the page screen changed', async () => {
    // 合并后的 PDF 直接点「完成」：不再把每一页复制一遍（手机上这一步曾报「文件可能已损坏」）。
    const { files, run } = setup(toolWorkflow('pdf-arrange'), {}, [
      { index: 0, rotate: 0 },
      { index: 1, rotate: 0 },
      { index: 2, rotate: 0 },
    ]);
    const original = await makePdf(3);
    files.nextPick = [files.offer('report.pdf', original)];
    const [{ item }] = await pdfsOf(files, await run());
    expect(files.disk.get(item.uri)).toEqual(original);
  });

  it('reports what really went wrong when arranging fails after the PDF opened', async () => {
    // 页面整理界面自己出错，不是文件坏了：照实说，下次能看出原因。
    const { files, run } = setup(toolWorkflow('pdf-arrange'), {}, async () => {
      throw new TypeError('page screen broke');
    });
    files.nextPick = [files.offer('report.pdf', await makePdf(2))];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'unexpected', detail: { detail: 'page screen broke' } },
    });
  });

  it('keeps pages by symbolic rules and page numbers, and reports pages that do not exist', async () => {
    const odd = setup(toolWorkflow('pdf-extract'), { rule: 'odd' });
    odd.files.nextPick = [odd.files.offer('r.pdf', await makePdf(5))];
    expect(widths((await pdfsOf(odd.files, await odd.run()))[0]!.doc)).toEqual([200, 202, 204]);

    const range = setup(toolWorkflow('pdf-extract'), { rule: 'range', range: '2-3, 5' });
    range.files.nextPick = [range.files.offer('r.pdf', await makePdf(5))];
    expect(widths((await pdfsOf(range.files, await range.run()))[0]!.doc)).toEqual([201, 202, 204]);

    const missing = setup(toolWorkflow('pdf-extract'), { rule: 'range', range: '9' });
    missing.files.nextPick = [missing.files.offer('r.pdf', await makePdf(2))];
    expect(await missing.run()).toMatchObject({
      status: 'failed',
      error: { code: 'badRange', detail: { name: 'r.pdf' } },
    });
  });

  it('rotates even pages and splits by ranges into separate PDFs', async () => {
    const rot = setup(toolWorkflow('pdf-rotate'), { angle: 180, rule: 'even' });
    rot.files.nextPick = [rot.files.offer('r.pdf', await makePdf(3))];
    const [{ doc }] = await pdfsOf(rot.files, await rot.run());
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 180, 0]);

    const split = setup(toolWorkflow('pdf-split'), { mode: 'ranges', ranges: '1-2; 3-4' });
    split.files.nextPick = [split.files.offer('book.pdf', await makePdf(4))];
    const parts = await pdfsOf(split.files, await split.run());
    expect(parts.map((p) => p.item.name)).toEqual(['book-1', 'book-2']);
    expect(parts.map((p) => widths(p.doc))).toEqual([
      [200, 201],
      [202, 203],
    ]);

    const each = setup(toolWorkflow('pdf-split'), { mode: 'every', n: 1 });
    each.files.nextPick = [each.files.offer('book.pdf', await makePdf(3))];
    expect(await pdfsOf(each.files, await each.run())).toHaveLength(3);
  });

  it('adds page numbers and stamps Latin text directly, CJK text as an image', async () => {
    const numbers = setup(toolWorkflow('pdf-numbers'));
    numbers.files.nextPick = [numbers.files.offer('r.pdf', await makePdf(2))];
    const [numbered] = await pdfsOf(numbers.files, await numbers.run());
    expect(numbered!.item.pageCount).toBe(2);

    const latin = setup(toolWorkflow('pdf-stamp'), { text: 'COPY {date}' });
    latin.files.nextPick = [latin.files.offer('r.pdf', await makePdf(1))];
    await pdfsOf(latin.files, await latin.run());
    expect(latin.files.renderedTexts).toEqual([]);

    const cjk = setup(toolWorkflow('pdf-stamp'), { text: '仅供签证使用 {date}' });
    cjk.files.nextPick = [cjk.files.offer('r.pdf', await makePdf(2))];
    const [stamped] = await pdfsOf(cjk.files, await cjk.run());
    expect(cjk.files.renderedTexts).toEqual(['仅供签证使用 2026-10-22']);
    expect(stamped!.item.pageCount).toBe(2);
  });

  it('reports a damaged or password-protected PDF clearly', async () => {
    const { files, run } = setup(
      custom([
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'r', action: 'pdf.rotate', params: { angle: 90, rule: 'all' } },
      ]),
    );
    const doc = await PDFDocument.create();
    doc.addPage();
    // 不用对象流保存才有 trailer 字典（默认是交叉引用流，下面的替换会落空）。
    const bytes = await doc.save({ useObjectStreams: false });
    // 在 trailer 里加一个 /Encrypt 引用，pdf-lib 会把它当作加密文件。
    const text = new TextDecoder('latin1')
      .decode(bytes)
      .replace('trailer\n<<', 'trailer\n<<\n/Encrypt 1 0 R');
    files.nextPick = [
      files.offer(
        'locked.pdf',
        Uint8Array.from(text, (c) => c.charCodeAt(0)),
      ),
    ];
    const result = await run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(['encrypted', 'unreadable']).toContain(result.error.code);
      expect(result.error.detail).toEqual({ name: 'locked.pdf' });
    }
  });
});
