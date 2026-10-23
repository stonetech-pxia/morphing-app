import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeTranslator, FakeVision, makePdf } from '../test-utils/fake-files';

// 翻译（D-170）：系统翻译换成 FakeTranslator（按文字猜语言，译文是「[目标语言] 原文」）。
// iOS 要下载时系统自己弹窗（假的不给大小）；Android 给出大小，由 App 先问用户（D-064、D-112）。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(id: string, locale: 'zh' | 'en' = 'zh'): Workflow {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [{ op: 'installTool', toolId: 'translate' }],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

class PdfTextPack implements PackRuntime {
  pages: string[] = [];
  async call<T>(_page: PackPageId, method: string): Promise<T> {
    if (method === 'text') return { pages: this.pages } as T;
    throw new Error(`unknown ${method}`);
  }
}

let ids = 0;
function setup(workflow: Workflow, answers: Record<string, unknown> = {}, confirmDownload = true) {
  const files = new FakeFiles();
  const translator = new FakeTranslator();
  files.translator = translator;
  const vision = new FakeVision(files);
  files.vision = vision;
  const packs = new PdfTextPack();
  const confirms: string[] = [];
  const ui: LocalUi = {
    confirm: async (title, _ok, _cancel, message) => (
      confirms.push(`${title}｜${message}`),
      confirmDownload
    ),
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
        ensurePack: async () => true,
        askParams: async (request) =>
          Object.fromEntries(request.keys.map((k) => [k, answers[k] ?? request.params[k]])),
      })
    ).result;
  return { files, translator, vision, packs, run, confirms };
}

const LETTER =
  'Dear Tenant,\n\nYour lease will expire on\nApril 15, 2026.\n\n2026-04-15\n\n请于月底前回复。';

describe('translate.text', () => {
  it('translates typed text paragraph by paragraph and keeps the layout', async () => {
    const { translator, run } = setup(toolWorkflow('translate-typed'), {
      text: LETTER,
      to: 'zh-Hans',
    });
    const result = await run();
    expect(result).toMatchObject({
      status: 'succeeded',
      value: {
        type: 'text',
        // 英文的两行接成一句再翻；日期原样保留；本来就是中文的一段不翻。
        text: '[zh-Hans] Dear Tenant,\n\n[zh-Hans] Your lease will expire on April 15, 2026.\n\n2026-04-15\n\n请于月底前回复。',
      },
    });
    const translated = translator.calls.filter((c) => c.method === 'translate');
    expect(translated).toEqual([
      {
        method: 'translate',
        args: [['Dear Tenant,', 'Your lease will expire on April 15, 2026.'], 'en', 'zh-Hans'],
      },
    ]);
  });

  it('uses the source language the user picked instead of detecting it', async () => {
    const wf = toolWorkflow('translate-typed');
    wf.steps[1]!.params = { from: 'ja', to: 'en' };
    const { translator, run } = setup(wf, { text: 'こんにちは\n\n東京', to: 'en' });
    expect(await run()).toMatchObject({
      status: 'succeeded',
      value: { text: '[en] こんにちは\n\n[en] 東京' },
    });
    expect(translator.calls.some((c) => c.method === 'detectLanguages')).toBe(false);
  });

  it('passes text that is already in the target language straight through', async () => {
    const { translator, run } = setup(toolWorkflow('translate-typed'), {
      text: '这是中文。',
      to: 'zh-Hans',
    });
    expect(await run()).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: '这是中文。' },
    });
    expect(translator.calls.filter((c) => c.method === 'translate')).toEqual([]);
  });

  it('asks before downloading Android language models, once for every language', async () => {
    const ok = setup(toolWorkflow('translate-typed'), {
      text: 'Hello\n\nこんにちは',
      to: 'zh-Hans',
    });
    ok.translator.android = true;
    ok.translator.missing = new Set(['ja', 'zh-Hans']);
    expect((await ok.run()).status).toBe('succeeded');
    expect(ok.confirms).toEqual([
      '首次使用需下载约 60 MB｜翻译语言：简体中文、日文。之后不联网也能用，建议连接 Wi-Fi。',
    ]);
    expect(ok.translator.calls.filter((c) => c.method === 'download')).toEqual([
      { method: 'download', args: ['zh-Hans'] },
      { method: 'download', args: ['ja'] },
    ]);

    const no = setup(toolWorkflow('translate-typed'), { text: 'Hello', to: 'ja' }, false);
    no.translator.android = true;
    no.translator.missing = new Set(['ja']);
    expect((await no.run()).status).toBe('cancelled');
    expect(
      no.translator.calls.some((c) => c.method === 'download' || c.method === 'translate'),
    ).toBe(false);
  });

  it('lets iOS ask for the download itself, and stops when the user cancels it', async () => {
    const { translator, run, confirms } = setup(toolWorkflow('translate-typed'), {
      text: 'Hello',
      to: 'ja',
    });
    translator.missing = new Set(['ja']);
    translator.failWith = 'cancelled';
    expect((await run()).status).toBe('cancelled');
    expect(confirms).toEqual([]);
  });

  it('explains when translation is not possible here', async () => {
    const goExpo = setup(toolWorkflow('translate-typed'), { text: 'Hello', to: 'ja' });
    goExpo.files.translator = null;
    expect(await goExpo.run()).toMatchObject({
      status: 'failed',
      error: { code: 'unsupportedAction', detail: { action: expect.stringContaining('正式版') } },
    });

    const oldIos = setup(toolWorkflow('translate-typed'), { text: 'Hello', to: 'ja' });
    oldIos.translator.supported = false;
    expect(await oldIos.run()).toMatchObject({
      status: 'failed',
      error: { detail: { action: expect.stringContaining('iOS 18') } },
    });

    const pair = setup(toolWorkflow('translate-typed'), { text: 'Hello', to: 'zh-Hant' });
    pair.translator.unsupported = new Set(['zh-Hant']);
    expect(await pair.run()).toMatchObject({
      status: 'failed',
      error: { detail: { action: '把英文翻成繁体中文（这台手机不支持）' } },
    });

    const failed = setup(toolWorkflow('translate-typed'), { text: 'Hello', to: 'ja' });
    failed.translator.failWith = 'download';
    expect(await failed.run()).toMatchObject({
      status: 'failed',
      error: { code: 'packFailed', detail: { detail: '英文、日文的翻译语言（请检查网络后再试）' } },
    });
  });
});

describe('translation presets (D-173)', () => {
  const preset = (id: string) => presetWorkflow(presetById(id)!, 'zh', id);

  it('screenshot translation: recognize → translate → copy', async () => {
    const { files, vision, run } = setup(preset('screenshot-translate'), { lang: 'eng' });
    vision.texts = ['Your parcel is waiting\nat the front desk.'];
    files.nextPhotos = [files.offerImage('IMG_1.png', 1170, 2532, 'image/png')];
    expect(await run()).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: '[zh-Hans] Your parcel is waiting at the front desk.' },
    });
    expect(files.clipboard).toBe('[zh-Hans] Your parcel is waiting at the front desk.');
  });

  it('a foreign PDF becomes a Chinese plain-text PDF named after it', async () => {
    const { files, packs, run } = setup(preset('foreign-pdf'));
    packs.pages = ['Notice of rent increase', 'Starting May 1, the rent will be $1,250.'];
    files.nextPick = [files.offer('notice.pdf', await makePdf(2))];
    const result = await run();
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'pdf', items: [{ name: 'notice-中文' }] },
    });
    expect(files.printedHtml[0]).toContain('[zh-Hans] Starting May 1, the rent will be $1,250.');
    expect(files.shared).toHaveLength(1);
  });
});
