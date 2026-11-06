import {
  applyOps,
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  quickActionsOf,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { PDFDocument, PDFName } from 'pdf-lib';
import { stampText } from '@morph/tool-pdf';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG, makePdf, makePng } from '../test-utils/fake-files';

// 需要 PDF 预览包或本地界面的 PDF 动作：转图片、提取文字、签名、填表。
// 扩展包页面（WebView + pdf.js）换成假的：渲染返回真实的小 JPEG，文字按页返回。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(id: string): Workflow {
  const result = applyOps(
    createDefaultWorkspace('en'),
    [{ op: 'setPackage', package: 'pdf', do: 'add' }],
    {
      registry,
      locale: 'en',
    },
  );
  if (!result.ok) throw new Error(result.error);
  return quickActionsOf(result.config).find((w) => w.id === id)!;
}

/** 假的扩展包页面：记录每次调用和允许页面读取的文件。 */
class FakePacks implements PackRuntime {
  calls: { page: PackPageId; method: string; args: Record<string, unknown>; files: string[] }[] =
    [];
  pageCount = 3;
  text: string[] = ['Hello', 'World', ''];
  async call<T>(
    page: PackPageId,
    method: string,
    args: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<T> {
    this.calls.push({ page, method, args, files: Object.values(files) });
    if (method === 'render') {
      const data = btoa(String.fromCharCode(...TINY_JPEG));
      const all = Array.from({ length: this.pageCount }, (_, index) => index);
      const wanted = (args.pages as number[] | undefined) ?? all;
      return wanted.map((index) => ({ index, width: 60, height: 40, data })) as T;
    }
    if (method === 'text') return { pages: this.text } as T;
    throw new Error(`unknown method ${method}`);
  }
}

let ids = 0;
function setup(
  workflow: Workflow,
  local: Partial<Record<LocalKind, unknown>> = {},
  installed = true,
) {
  const files = new FakeFiles();
  const packs = new FakePacks();
  const opened: { kind: LocalKind; input: unknown }[] = [];
  const asked: string[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      opened.push({ kind, input });
      return (local[kind] ?? null) as never;
    },
  };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'en',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        packs: { runtime: packs, isInstalled: async () => installed },
        ensurePack: async (id) => {
          asked.push(id);
          return installed;
        },
        askParams: async (request) => request.params,
      })
    ).result;
  return { files, packs, run, opened, asked };
}

async function onlyPdf(files: FakeFiles, result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'pdf') {
    throw new Error(`no pdf: ${JSON.stringify(result)}`);
  }
  return PDFDocument.load(files.disk.get(result.value.items[0]!.uri)!);
}

async function makeForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  form.createTextField('full_name').addToPage(page, { x: 20, y: 300, width: 200, height: 24 });
  form.createCheckBox('agree').addToPage(page, { x: 20, y: 250, width: 16, height: 16 });
  const dd = form.createDropdown('country');
  dd.addOptions(['France', 'Japan']);
  dd.addToPage(page, { x: 20, y: 200, width: 120, height: 24 });
  return doc.save();
}

const hasImage = (doc: PDFDocument, index: number) =>
  Boolean(doc.getPage(index).node.Resources()?.lookup(PDFName.of('XObject')));

describe('PDF actions that need the preview pack or a local screen', () => {
  it('turns every page into a JPG through the pack page, passing only the chosen file', async () => {
    const { files, packs, run, asked } = setup(toolWorkflow('pdf-toimages'));
    const picked = files.offer('report.pdf', await makePdf(3));
    files.nextPick = [picked];
    const result = await run();
    expect(asked).toEqual(['pdfview']);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded' || result.value?.type !== 'images') throw new Error();
    expect(result.value.items.map((i) => i.name)).toEqual(['report-1', 'report-2', 'report-3']);
    expect(result.value.items[0]).toMatchObject({ ext: 'jpg', width: 60, height: 40 });
    expect(files.disk.get(result.value.items[0]!.uri)).toEqual(TINY_JPEG);
    expect(packs.calls).toHaveLength(1);
    expect(packs.calls[0]).toMatchObject({ page: 'pdfview', method: 'render' });
    expect(packs.calls[0]!.args).toMatchObject({ file: 'input', maxSide: 2000 });
    // 页面只拿到这一个文件（复制进本次运行的临时文件），没有别的。
    expect(packs.calls[0]!.files).toHaveLength(1);
  });

  it('cancels when the user declines the pack download', async () => {
    const { files, packs, run } = setup(toolWorkflow('pdf-toimages'), {}, false);
    files.nextPick = [files.offer('report.pdf', await makePdf(1))];
    expect((await run()).status).toBe('cancelled');
    expect(packs.calls).toEqual([]);
  });

  it('extracts text that stays on the device, and says so when a scan has none', async () => {
    const ok = setup(toolWorkflow('pdf-text'));
    ok.files.nextPick = [ok.files.offer('letter.pdf', await makePdf(3))];
    expect(await ok.run()).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: 'Hello\n\nWorld', name: 'letter' },
    });

    // 没有文字识别（Expo Go）时扫描件读不出文字。
    const scan = setup(toolWorkflow('pdf-text'));
    scan.packs.text = ['', ' '];
    scan.files.nextPick = [scan.files.offer('scan.pdf', await makePdf(2))];
    expect(await scan.run()).toMatchObject({
      status: 'failed',
      error: { code: 'notFound', detail: { name: 'scan.pdf' } },
    });
  });

  it('reads the pages that have no text layer (scans) with text recognition', async () => {
    // 创始人 2026-10-31：图片版 PDF 提取文字时以为会用 OCR，结果没有。
    const { files, packs, run } = setup(toolWorkflow('pdf-text'));
    const vision = new FakeVision(files);
    files.vision = vision;
    vision.texts = ['Scanned one', 'Scanned two'];
    packs.text = ['', 'Typed', ' '];
    files.nextPick = [files.offer('mixed.pdf', await makePdf(3))];
    expect(await run()).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: 'Scanned one\n\nTyped\n\nScanned two', name: 'mixed' },
    });
    // 只画没有文字的那几页。
    expect(packs.calls.find((c) => c.method === 'render')!.args).toMatchObject({ pages: [0, 2] });
    expect(vision.calls.filter((c) => c.method === 'recognizeText')).toHaveLength(2);
  });

  it('signs: shows page previews, then stamps the PNG on the chosen page', async () => {
    const { files, packs, run, opened } = setup(toolWorkflow('pdf-sign'), {
      sign: { png: makePng(30, 10), pageIndex: 1, x: 0.6, y: 0.8, width: 0.3 },
    });
    packs.pageCount = 2;
    files.nextPick = [files.offer('contract.pdf', await makePdf(2))];
    const doc = await onlyPdf(files, await run());
    expect(opened[0]!.kind).toBe('sign');
    expect((opened[0]!.input as { pages: unknown[] }).pages).toHaveLength(2);
    expect(doc.getPageCount()).toBe(2);
    expect(hasImage(doc, 1)).toBe(true);
    expect(hasImage(doc, 0)).toBe(false);
  });

  it('annotates: shows the pages, then lays a transparent layer only on pages that got marks', async () => {
    const mine: Workflow = {
      kind: 'quickAction',
      id: 'mine',
      name: 'Mine',
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'mark', action: 'pdf.annotate', params: { start: 'pen' } },
      ],
    };
    const { files, packs, run, opened } = setup(mine, {
      annotate: [
        [],
        [
          {
            kind: 'highlight',
            points: [
              { x: 5, y: 5 },
              { x: 40, y: 5 },
            ],
            width: 4,
            color: '#FACC15',
          },
        ],
      ],
    });
    packs.pageCount = 2;
    files.nextPick = [files.offer('contract.pdf', await makePdf(2))];
    const doc = await onlyPdf(files, await run());
    expect(opened[0]!.kind).toBe('annotate');
    expect((opened[0]!.input as { items: unknown[] }).items).toHaveLength(2);
    expect(doc.getPageCount()).toBe(2);
    expect(hasImage(doc, 1)).toBe(true);
    expect(hasImage(doc, 0)).toBe(false);
    // 画的图层和预览页一样大，路径照原样画（荧光笔的半透明颜色在标注里）。
    expect(files.composed).toHaveLength(1);
    expect(files.composed[0]!.canvas).toMatchObject({ width: 60, height: 40 });
    expect(files.composed[0]!.ops).toEqual([expect.objectContaining({ kind: 'path' })]);
  });

  it('annotates: a page with erase or mosaic becomes a picture, so the hidden text is really gone', async () => {
    const mine: Workflow = {
      kind: 'quickAction',
      id: 'mine',
      name: 'Mine',
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'mark', action: 'pdf.annotate', params: { start: 'erase' } },
      ],
    };
    const { files, packs, run, opened } = setup(mine, {
      annotate: [
        [
          {
            kind: 'erase',
            points: [
              { x: 5, y: 5 },
              { x: 30, y: 20 },
            ],
            width: 2,
            color: '#FFFFFF',
          },
          {
            kind: 'mosaic',
            points: [
              { x: 30, y: 20 },
              { x: 55, y: 35 },
            ],
            width: 2,
            color: '#808080',
          },
        ],
        [],
      ],
    });
    packs.pageCount = 2;
    const pdf = await makePdf(2);
    const marked = await stampText(pdf, {
      text: 'SECRET',
      position: 'center',
      fontSize: 20,
      color: '#000000',
      opacity: 1,
    });
    files.nextPick = [files.offer('contract.pdf', marked)];
    const out = await run();
    const doc = await onlyPdf(files, out);
    expect(opened[0]!.input).toMatchObject({ tool: 'erase' });
    expect(doc.getPageCount()).toBe(2);
    expect(hasImage(doc, 0)).toBe(true);
    // 第一页换成了一张图；页面原来的文字不在了，第二页没有标注，原样。
    const value = (out as { value?: { items: { uri: string }[] } }).value!;
    const raw = Buffer.from(files.disk.get(value.items[0]!.uri)!).toString('latin1');
    expect(raw).not.toContain('SECRET');
    // 擦除是涂白，打码按格子取原图的平均色：画了几个色块。
    const rects = files.composed.at(-1)!.ops.filter((op) => op.kind === 'rect');
    expect(rects.length).toBeGreaterThan(1);
    expect(rects[0]).toMatchObject({ color: '#FFFFFF' });
    // 更大的页面图重新渲染过（只渲染有擦除、打码的那一页）。
    expect(packs.calls.filter((c) => c.method === 'render').at(-1)!.args).toMatchObject({
      pages: [0],
      maxSide: 2400,
    });
  });

  it('cancels signing when the user closes the signature screen', async () => {
    const { files, run } = setup(toolWorkflow('pdf-sign'));
    files.nextPick = [files.offer('contract.pdf', await makePdf(1))];
    expect((await run()).status).toBe('cancelled');
  });

  it('fills in form fields from the local screen and flattens them', async () => {
    const { files, run, opened } = setup(toolWorkflow('pdf-fill'), {
      fillForm: { full_name: 'Ada Lovelace', agree: true, country: 'Japan' },
    });
    files.nextPick = [files.offer('form.pdf', await makeForm())];
    const doc = await onlyPdf(files, await run());
    const fields = (opened[0]!.input as { fields: { name: string; type: string }[] }).fields;
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ['full_name', 'text'],
      ['agree', 'checkbox'],
      ['country', 'dropdown'],
    ]);
    // 拍平后表单字段没有了，内容画进了页面。
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it('keeps the form editable without flattening, and rejects PDFs without fields', async () => {
    const keep = setup(
      {
        kind: 'quickAction',
        id: 'mine',
        name: 'Mine',
        steps: [
          { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
          { id: 'fill', action: 'pdf.fillForm', params: { flatten: false } },
        ],
      },
      { fillForm: { full_name: 'Ada' } },
    );
    keep.files.nextPick = [keep.files.offer('form.pdf', await makeForm())];
    const doc = await onlyPdf(keep.files, await keep.run());
    expect(doc.getForm().getTextField('full_name').getText()).toBe('Ada');
    expect(doc.getForm().getCheckBox('agree').isChecked()).toBe(false);

    const plain = setup(toolWorkflow('pdf-fill'));
    plain.files.nextPick = [plain.files.offer('plain.pdf', await makePdf(1))];
    expect(await plain.run()).toMatchObject({
      status: 'failed',
      error: { code: 'noFormFields', detail: { name: 'plain.pdf' } },
    });

    const cjk = setup(toolWorkflow('pdf-fill'), { fillForm: { full_name: '张三' } });
    cjk.files.nextPick = [cjk.files.offer('form.pdf', await makeForm())];
    expect(await cjk.run()).toMatchObject({
      status: 'failed',
      error: { code: 'unsupportedText' },
    });
  });
});
