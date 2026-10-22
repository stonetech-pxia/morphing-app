import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type RunResult,
  type Workflow,
} from '@morph/core';
import type { Quad } from '@morph/tool-image';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';

// 扫描和文字识别：扫描包 / 文字识别包页面换成假的（找边返回四个角，矫正返回真实的小 JPEG，识别返回文字）。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(toolId: string, id: string, locale: 'zh' | 'en' = 'zh'): Workflow {
  const result = applyOps(createDefaultWorkspace(locale), [{ op: 'installTool', toolId }], {
    registry,
    locale,
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

const paper: Quad = {
  tl: { x: 300, y: 400 },
  tr: { x: 2700, y: 350 },
  br: { x: 2800, y: 3700 },
  bl: { x: 200, y: 3650 },
};

class FakePacks implements PackRuntime {
  calls: { page: PackPageId; method: string; args: Record<string, unknown>; files: string[] }[] =
    [];
  /** 每次找边的结果（按顺序）。 */
  detected: (Quad | null)[] = [];
  texts: string[] = [];
  async call<T>(
    page: PackPageId,
    method: string,
    args: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<T> {
    this.calls.push({ page, method, args, files: Object.values(files) });
    if (method === 'detect') return { quad: this.detected.shift() ?? null } as T;
    if (method === 'warp') {
      return {
        width: args.width,
        height: args.height,
        data: btoa(String.fromCharCode(...TINY_JPEG)),
      } as T;
    }
    if (method === 'recognize') return { text: this.texts.shift() ?? '', confidence: 90 } as T;
    throw new Error(`unknown ${method}`);
  }
}

let ids = 0;
function setup(
  workflow: Workflow,
  local: Partial<Record<LocalKind, unknown>> = {},
  answers: Record<string, unknown> = {},
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
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        packs: { runtime: packs, isInstalled: async () => true },
        ensurePack: async (id) => (asked.push(id), true),
        askParams: async (request) => ({ ...request.params, ...answers }),
      })
    ).result;
  return { files, packs, run, opened, asked };
}

describe('scanner', () => {
  it('finds the paper, lets the user confirm the corners, straightens and makes a PDF', async () => {
    const { files, packs, run, opened, asked } = setup(toolWorkflow('scan', 'scan-library'), {
      corners: [paper, paper],
    });
    packs.detected = [paper, null];
    files.nextPhotos = [
      files.offerImage('IMG_1.HEIC', 3024, 4032, 'image/heic'),
      files.offerImage('IMG_2.jpg', 3024, 4032),
    ];
    const result = await run();
    expect(asked).toEqual(['scan']);
    // HEIC 先在 App 里重新编码成 JPG，页面只拿到这一个临时文件。
    const detects = packs.calls.filter((c) => c.method === 'detect');
    expect(detects).toHaveLength(2);
    expect(detects[0]!.files[0]).toMatch(/IMG_1\.jpg$/);
    // 找到的角交给本地界面确认；第二张没找到，给 null，界面会用默认框。
    const input = opened[0]!.input as { items: { quad: Quad | null }[] };
    expect(opened[0]!.kind).toBe('corners');
    expect(input.items.map((i) => i.quad)).toEqual([paper, null]);
    // 按用户确认的角矫正，长边 2400。
    const warp = packs.calls.find((c) => c.method === 'warp')!;
    expect(warp.args).toMatchObject({ quad: paper, height: 2400 });
    expect(files.enhanced).toEqual(['auto', 'auto']);
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'pdf', items: [{ name: '扫描-2026-10-22', pageCount: 2 }] },
    });
  });

  it('treats a tiny or crossed outline as "not found"', async () => {
    const { files, packs, run, opened } = setup(toolWorkflow('scan', 'scan-straighten'), {
      corners: [paper, paper],
    });
    packs.detected = [
      { tl: { x: 0, y: 0 }, tr: { x: 50, y: 0 }, br: { x: 50, y: 50 }, bl: { x: 0, y: 50 } },
      { ...paper, tr: paper.br, br: paper.tr },
    ];
    files.nextPhotos = [
      files.offerImage('a.jpg', 3000, 4000),
      files.offerImage('b.jpg', 3000, 4000),
    ];
    expect((await run()).status).toBe('succeeded');
    const input = opened[0]!.input as { items: { quad: Quad | null }[] };
    expect(input.items.map((i) => i.quad)).toEqual([null, null]);
  });

  it('cancels when the corner screen is closed, and shrinks huge photos for the WebView', async () => {
    const { files, run } = setup(toolWorkflow('scan', 'scan-straighten'));
    files.nextPhotos = [files.offerImage('big.jpg', 8000, 6000)];
    expect((await run()).status).toBe('cancelled');
    // 4800 万像素 → 长边 4096。
    expect(files.encodes[0]).toMatchObject({ width: 4096, height: 3072, format: 'jpeg' });
  });

  it('can keep the original look', async () => {
    const { files, run } = setup(
      toolWorkflow('scan', 'scan-library'),
      { corners: [paper] },
      { mode: 'none' },
    );
    files.nextPhotos = [files.offerImage('a.jpg', 3000, 4000)];
    expect((await run()).status).toBe('succeeded');
    expect(files.enhanced).toEqual([]);
  });
});

describe('text recognition', () => {
  it('asks the language, downloads that language pack, and keeps the text on the device', async () => {
    const { files, packs, run, asked } = setup(
      toolWorkflow('ocr', 'ocr-photos'),
      {},
      { lang: 'jpn' },
    );
    packs.texts = ['第一页', '  ', 'Page three'];
    files.nextPhotos = [
      files.offerImage('a.jpg', 1000, 1400),
      files.offerImage('b.jpg', 1000, 1400),
      files.offerImage('c.jpg', 1000, 1400),
    ];
    const result = await run();
    expect(asked).toEqual(['ocr-jpn']);
    expect(packs.calls.map((c) => c.args)).toEqual([
      { file: 'input', lang: 'jpn' },
      { file: 'input', lang: 'jpn' },
      { file: 'input', lang: 'jpn' },
    ]);
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: '第一页\n\nPage three', name: 'a' },
    });
  });

  it('defaults to the interface language and reports photos without text', async () => {
    expect(toolWorkflow('ocr', 'ocr-photos', 'en').steps[1]!.params).toEqual({ lang: 'eng' });
    expect(toolWorkflow('ocr', 'ocr-photos', 'zh').steps[1]!.params).toEqual({ lang: 'chi_sim' });
    const { files, run } = setup(toolWorkflow('ocr', 'ocr-photos'));
    files.nextPhotos = [files.offerImage('blank.jpg', 1000, 1400)];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'notFound', detail: { name: 'blank.jpg' } },
    });
  });
});
