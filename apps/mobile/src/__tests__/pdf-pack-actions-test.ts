import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { PDFDocument, PDFName } from 'pdf-lib';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG, makePdf, makePng } from '../test-utils/fake-files';

// 需要 PDF 预览包或本地界面的 PDF 动作：转图片、提取文字、签名、填表。
// 扩展包页面（WebView + pdf.js）换成假的：渲染返回真实的小 JPEG，文字按页返回。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('en'), [{ op: 'installTool', toolId: 'pdf' }], {
    registry,
    locale: 'en',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
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
      return Array.from({ length: this.pageCount }, (_, index) => ({
        index,
        width: 60,
        height: 40,
        data,
      })) as T;
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

    const scan = setup(toolWorkflow('pdf-text'));
    scan.packs.text = ['', ' '];
    scan.files.nextPick = [scan.files.offer('scan.pdf', await makePdf(2))];
    expect(await scan.run()).toMatchObject({
      status: 'failed',
      error: { code: 'notFound', detail: { name: 'scan.pdf' } },
    });
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
