import {
  applyOps,
  type AskRequest,
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  quickActionsOf,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';

// 压缩 PDF（D-145）：先只压图片、保留文字；压不到时问用户（转成图片 / 就用现在的），
// 或按参数直接转成图片 / 保留文字。系统编码器和 PDF 预览下载内容都换成假的。

const registry = createRegistry(BUILTIN_TOOLS);
const MB = 1024 * 1024;

function toolWorkflow(id: string): Workflow {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [{ op: 'setPackage', package: 'pdf', do: 'add' }],
    {
      registry,
      locale: 'zh',
    },
  );
  if (!result.ok) throw new Error(result.error);
  return quickActionsOf(result.config).find((w) => w.id === id)!;
}

/** TINY_JPEG 的头改成 width × height，后面补零到 bytes 字节：pdf-lib 只读头。 */
function bigJpeg(width: number, height: number, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(TINY_JPEG);
  for (let i = 0; i < TINY_JPEG.length - 8; i++) {
    if (out[i] === 0xff && out[i + 1] === 0xc0) {
      out[i + 5] = height >> 8;
      out[i + 6] = height & 0xff;
      out[i + 7] = width >> 8;
      out[i + 8] = width & 0xff;
      break;
    }
  }
  return out;
}

/** 扫描件：每页一张大 JPEG，第一页还有一行文字。 */
async function scannedPdf(pages: number, jpegBytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    const image = await doc.embedJpg(bigJpeg(2480, 3508, jpegBytes));
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    if (i === 0) page.drawText('Invoice 42', { x: 40, y: 800, size: 12, font });
  }
  return doc.save();
}

/** 没有图片、但带一个大附件的 PDF：只压图片压不动。 */
async function bulkyPdf(bytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([842, 595]);
  // 随机字节压不小（getRandomValues 每次最多 64 KB）。
  const junk = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 65536) {
    globalThis.crypto.getRandomValues(junk.subarray(i, Math.min(bytes, i + 65536)));
  }
  await doc.attach(junk, 'data.bin', { mimeType: 'application/octet-stream' });
  return doc.save();
}

class FakePacks implements PackRuntime {
  calls: { page: PackPageId; method: string }[] = [];
  async call<T>(page: PackPageId, method: string): Promise<T> {
    this.calls.push({ page, method });
    const data = btoa(String.fromCharCode(...TINY_JPEG));
    return [0, 1].map((index) => ({ index, width: 1414, height: 2000, data })) as T;
  }
}

let ids = 0;
function setup(
  workflow: Workflow,
  opts: { answers?: Record<string, unknown>; choice?: number | null } = {},
) {
  const files = new FakeFiles();
  const packs = new FakePacks();
  const asked: string[] = [];
  const questions: { title: string; message: string; options: readonly string[] }[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async (title, message, options) => {
      questions.push({ title, message, options });
      return opts.choice ?? null;
    },
    open: async () => null as never,
  };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 23),
        newId: () => `id${++ids}`,
        ui,
        packs: { runtime: packs, isInstalled: async () => true },
        ensurePack: async (id) => {
          asked.push(id);
          return true;
        },
        askParams: async (request: AskRequest) => ({ ...request.params, ...opts.answers }),
      })
    ).result;
  return { files, packs, run, asked, questions };
}

async function pdfOf(files: FakeFiles, result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'pdf') {
    throw new Error(`no pdf: ${JSON.stringify(result)}`);
  }
  const item = result.value.items[0]!;
  return {
    item,
    bytes: files.disk.get(item.uri)!,
    doc: await PDFDocument.load(files.disk.get(item.uri)!),
  };
}

const filters = (doc: PDFDocument) =>
  [...doc.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream && String(obj.dict.get(PDFName.of('Subtype'))) === '/Image',
    )
    .map((obj) => String(obj.dict.get(PDFName.of('Width'))));

describe('compress PDF', () => {
  it('recompresses the pictures and keeps the text; no question asked', async () => {
    const { files, run, questions, asked } = setup(toolWorkflow('pdf-compress'));
    files.nextPick = [files.offer('scan.pdf', await scannedPdf(3, 1_500_000))];
    const { item, bytes, doc } = await pdfOf(files, await run());
    expect(item).toMatchObject({ name: 'scan', ext: 'pdf', pageCount: 3 });
    expect(bytes.length).toBeLessThanOrEqual(2 * MB);
    expect(doc.getPageCount()).toBe(3);
    // 文字还在第一页的内容流里（没有转成图片）。
    expect(doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'))).toBeTruthy();
    // 2480 像素的扫描图缩到长边 2400 以内。
    expect(filters(doc).every((w) => Number(w) < 2480)).toBe(true);
    expect(questions).toEqual([]);
    expect(asked).toEqual([]);
    expect(files.encodes.every((e) => e.format === 'jpeg')).toBe(true);
  });

  it('passes PDFs that are already small enough through untouched', async () => {
    const { files, run } = setup(toolWorkflow('pdf-compress'));
    const small = files.offer('small.pdf', await scannedPdf(1, 100_000));
    files.nextPick = [small];
    const { bytes } = await pdfOf(files, await run());
    expect(bytes.length).toBe(small.size);
    expect(files.encodes).toEqual([]);
  });

  it('asks when keeping the text is not enough, and keeps the text when told to', async () => {
    const { files, run, questions } = setup(toolWorkflow('pdf-compress'), {
      answers: { maxMB: 1 },
      choice: 1,
    });
    files.nextPick = [files.offer('bulky.pdf', await bulkyPdf(3 * MB))];
    const { bytes, doc } = await pdfOf(files, await run());
    expect(questions).toHaveLength(1);
    expect(questions[0]!.title).toBe('「bulky.pdf」压不到 1.0 MB');
    expect(questions[0]!.options[0]).toBe('转成图片');
    expect(questions[0]!.options[1]).toMatch(/^就用 3\.\d MB 的$/);
    expect(bytes.length).toBeGreaterThan(MB);
    expect(doc.getPageCount()).toBe(2);
  });

  it('turns the pages into pictures (keeping the paper sizes) when the user agrees', async () => {
    const { files, packs, run, asked } = setup(toolWorkflow('pdf-compress'), {
      answers: { maxMB: 1 },
      choice: 0,
    });
    files.nextPick = [files.offer('bulky.pdf', await bulkyPdf(3 * MB))];
    const { bytes, doc } = await pdfOf(files, await run());
    expect(asked).toEqual(['pdfview']);
    expect(packs.calls).toEqual([{ page: 'pdfview', method: 'render' }]);
    expect(bytes.length).toBeLessThanOrEqual(MB);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [595, 842],
      [842, 595],
    ]);
  });

  it('does not shrink scans until they are unreadable: asks instead', async () => {
    const { files, run, questions } = setup(toolWorkflow('pdf-compress'), {
      answers: { maxMB: 0.1 },
      choice: 1,
    });
    files.nextPick = [files.offer('scan.pdf', await scannedPdf(3, 1_500_000))];
    const { doc } = await pdfOf(files, await run());
    expect(questions).toHaveLength(1);
    // 保留文字时图片长边不小于约 960 像素（2400 × 0.4）。
    const smallest = Math.min(...files.encodes.map((e) => Math.max(e.width, e.height)));
    expect(smallest).toBeGreaterThanOrEqual(940);
    expect(doc.getPageCount()).toBe(3);
  });

  it('cancels when the question is dismissed; follows whenTooBig without asking', async () => {
    const dismissed = setup(toolWorkflow('pdf-compress'), { answers: { maxMB: 1 }, choice: null });
    dismissed.files.nextPick = [dismissed.files.offer('b.pdf', await bulkyPdf(3 * MB))];
    expect((await dismissed.run()).status).toBe('cancelled');

    const images = setup(toolWorkflow('pdf-compress'), {
      answers: { maxMB: 1, whenTooBig: 'images' },
    });
    images.files.nextPick = [images.files.offer('b.pdf', await bulkyPdf(3 * MB))];
    const { bytes } = await pdfOf(images.files, await images.run());
    expect(images.questions).toEqual([]);
    expect(bytes.length).toBeLessThanOrEqual(MB);
  });

  it('reports password-protected PDFs', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 1, R: 2 });
    const encrypted = await doc.save();
    const padded = new Uint8Array(3 * MB);
    padded.set(encrypted);
    const { files, run } = setup(toolWorkflow('pdf-compress'));
    files.nextPick = [files.offer('locked.pdf', padded)];
    const result = await run();
    expect(result.status === 'failed' && result.error.code).toBe('encrypted');
  });

  it('runs the ready-made «PDF too big to upload»', async () => {
    const wf = presetWorkflow(presetById('pdf-too-big')!, 'zh', 'p');
    const { files, run } = setup(wf);
    files.nextPick = [files.offer('scan.pdf', await scannedPdf(2, 1_500_000))];
    const { item } = await pdfOf(files, await run());
    expect(item.size).toBeLessThanOrEqual(2 * MB);
    expect(files.shareSheets).toEqual([[item.uri]]);
  });
});
