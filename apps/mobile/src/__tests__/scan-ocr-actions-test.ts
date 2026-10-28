import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type RunResult,
  type Workflow,
} from '@morph/core';
import type { Quad } from '@morph/tool-image';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import { textLayerLanguages } from '../runtime/actions/pdf';
import type { LocalKind, LocalUi } from '../runtime/local';
import { packsNeeded, startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG } from '../test-utils/fake-files';

// 扫描和文字识别有两条路径（D-084）：
// - 没有系统识别（Android、Expo Go）：扫描包 / 文字识别包页面换成假的（找边返回四个角，矫正返回真实的小 JPEG，识别返回文字）；
// - iOS 的 Vision：换成 FakeVision，不需要扩展包；
// - Android 的 ML Kit：FakeVision 不能找边、不认俄文，这两种情况退回扩展包。

// 手机的语言列表（文字层按它选识别语言，D-266）；默认没有，由界面语言决定。
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

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
  native = false,
) {
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  if (native) files.vision = vision;
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
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        packs: { runtime: packs, isInstalled: async () => true },
        ensurePack: async (id) => (asked.push(id), true),
        askParams: async (request) => ({ ...request.params, ...answers }),
      })
    ).result;
  return { files, vision, packs, run, opened, asked };
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

describe('scanner and text recognition with the system Vision (iOS)', () => {
  it('reads text with Vision in the chosen language, without any pack', async () => {
    const { files, vision, packs, run, asked } = setup(
      toolWorkflow('ocr', 'ocr-photos'),
      {},
      { lang: 'chi_sim' },
      true,
    );
    vision.texts = ['租约 续签 通知\n月租 3200 元'];
    files.nextPhotos = [files.offerImage('IMG_1.HEIC', 3024, 4032, 'image/heic')];
    const result = await run();
    expect(asked).toEqual([]);
    expect(packs.calls).toEqual([]);
    // 送进识别的是重新编码的 JPG；中文后面补上英文。
    expect(vision.calls).toEqual([
      {
        method: 'recognizeText',
        uri: expect.stringMatching(/IMG_1\.jpg$/),
        args: ['zh-Hans', 'en-US'],
      },
    ]);
    // 行内中文之间的空格照样整理掉。
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: '租约续签通知\n月租3200元', name: 'IMG_1' },
    });
  });

  it('finds the corners with Vision, lets the user confirm them and straightens with Core Image', async () => {
    const { files, vision, packs, run, opened, asked } = setup(
      toolWorkflow('scan', 'scan-library'),
      { corners: [paper, paper] },
      {},
      true,
    );
    vision.found = [paper, null];
    files.nextPhotos = [
      files.offerImage('IMG_1.jpg', 3024, 4032),
      files.offerImage('IMG_2.jpg', 3024, 4032),
    ];
    const result = await run();
    expect(asked).toEqual([]);
    expect(packs.calls).toEqual([]);
    const input = opened[0]!.input as { items: { quad: Quad | null }[] };
    expect(opened[0]!.kind).toBe('corners');
    expect(input.items.map((i) => i.quad)).toEqual([paper, null]);
    const straighten = vision.calls.filter((c) => c.method === 'straighten');
    expect(straighten).toHaveLength(2);
    expect(straighten[0]!.args).toMatchObject({ quad: paper, height: 2400 });
    expect(files.enhanced).toEqual(['auto', 'auto']);
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'pdf', items: [{ name: '扫描-2026-10-22', pageCount: 2 }] },
    });
  });

  it('scans with the document camera: pages are already straight, so no corner screen', async () => {
    const { files, vision, run, opened, asked } = setup(
      toolWorkflow('scan', 'scan-camera'),
      {},
      {},
      true,
    );
    expect(toolWorkflow('scan', 'scan-camera').steps[0]!.params).toMatchObject({
      source: 'scanner',
    });
    vision.scanned = [1, 2, 3].map((n) => ({
      ...files.offerImage(`scan-${n}.jpg`, 1700, 2400),
      straightened: true,
    }));
    const result = await run();
    expect(vision.calls.map((c) => c.method)).toEqual(['scanDocuments']);
    expect(vision.calls[0]!.args).toEqual({ maxSide: 2400 });
    expect(opened).toEqual([]);
    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { type: 'pdf', items: [{ pageCount: 3 }] },
    });
  });

  it('adds an invisible text layer to scanned PDFs so they can be searched, Chinese included (D-195, D-266)', async () => {
    const wf: Workflow = {
      id: 'scan',
      name: 'scan',
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'scanner', min: 1, max: 5 } },
        {
          id: 'pdf',
          action: 'pdf.fromImages',
          params: {
            pageSize: 'a4',
            orientation: 'auto',
            marginMm: 0,
            fit: 'contain',
            maxMB: 0,
            textLayer: true,
          },
        },
      ],
    };
    const line = { text: 'Invoice 42', x: 10, y: 10, width: 60, height: 8 };
    const { files, vision, run } = setup(wf, {}, {}, true);
    vision.scanned = [1, 2, 3].map((n) => ({
      ...files.offerImage(`scan-${n}.jpg`, 1700, 2400),
      straightened: true,
    }));
    // 第二页按中文认失败、再按西欧语言认也失败：那一页不加文字层，PDF 照样生成。
    vision.layers = [
      { width: 100, height: 100, lines: [line] },
      new Error('vision failed'),
      new Error('vision failed'),
      { width: 100, height: 100, lines: [line, { ...line, text: '发票' }] },
    ];
    const result = await run();
    const zh = ['zh-Hans', 'en-US'];
    const latin = ['en-US', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR'];
    // 界面是中文：先按中文认（中文识别器也认英文）。
    expect(vision.calls.filter((c) => c.method === 'recognizeLines').map((c) => c.args)).toEqual([
      zh,
      zh,
      latin,
      zh,
    ]);
    const [pdf] =
      result.status === 'succeeded' && result.value && 'items' in result.value
        ? result.value.items
        : [];
    const doc = await PDFDocument.load(files.disk.get(pdf!.uri)!);
    expect(doc.getPageCount()).toBe(3);
    // 页面内容是压缩过的：解开所有流再找（图片的 JPEG 流跳过）。
    const decoded = (obj: unknown) => {
      if (!(obj instanceof PDFRawStream)) return '';
      try {
        return new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
      } catch {
        return '';
      }
    };
    const text = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => decoded(obj))
      .join('\n');
    // 第一页一行、第三页两行（中文那行用无字形字体按 UTF-16 写，D-266）。
    expect(text.match(/3 Tr/g)).toHaveLength(3);
    expect(text).toContain('<53D17968> Tj');

    // 没有系统识别（Expo Go）：不加文字层，PDF 照常。
    const library: Workflow = {
      ...wf,
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
        wf.steps[1]!,
      ],
    };
    const plain = setup(library);
    plain.files.nextPhotos = [plain.files.offerImage('a.jpg', 1700, 2400)];
    expect(await plain.run()).toMatchObject({ status: 'succeeded', value: { type: 'pdf' } });
    expect(plain.vision.calls).toEqual([]);
  });

  it('cancels when the document camera is closed', async () => {
    const { run } = setup(toolWorkflow('scan', 'scan-camera'), {}, {}, true);
    expect((await run()).status).toBe('cancelled');
  });

  it('falls back to the camera where the document camera is missing (simulator), then finds edges', async () => {
    const { files, vision, run, opened } = setup(
      toolWorkflow('ocr', 'ocr-scan'),
      { corners: [paper] },
      { lang: 'eng' },
      true,
    );
    vision.documentCamera = false;
    vision.found = [paper];
    vision.texts = ['Lease renewal'];
    files.camera = [files.offerImage('cam.jpg', 3024, 4032)];
    const result = await run();
    expect(vision.calls.map((c) => c.method)).toEqual(['findPaper', 'straighten', 'recognizeText']);
    expect(opened[0]!.kind).toBe('corners');
    expect(result).toMatchObject({ status: 'succeeded', value: { text: 'Lease renewal' } });
  });

  it('keeps document-camera pages and straightens only the photos that need it, in order', async () => {
    const { files, vision, run, opened } = setup(
      toolWorkflow('scan', 'scan-straighten'),
      { corners: [paper] },
      {},
      true,
    );
    const ready = { ...files.offerImage('scan-1.jpg', 1700, 2400), straightened: true };
    files.nextPhotos = [ready, files.offerImage('photo.jpg', 3024, 4032)];
    vision.found = [paper];
    const result = await run();
    const input = opened[0]!.input as { items: unknown[] };
    expect(input.items).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'succeeded',
      value: {
        items: [
          { name: 'scan-1', straightened: true },
          { name: 'photo', width: expect.any(Number) },
        ],
      },
    });
  });
});

describe('without the system recognition (Expo Go)', () => {
  it('scans with the camera and the scanner pack when the workflow asks for the document camera', async () => {
    const { files, packs, run, asked } = setup(toolWorkflow('scan', 'scan-camera'), {
      corners: [paper],
    });
    packs.detected = [paper];
    files.camera = [files.offerImage('cam.jpg', 3024, 4032), null];
    const result = await run();
    expect(asked).toEqual(['scan']);
    expect(packs.calls.map((c) => c.method)).toEqual(['detect', 'warp']);
    expect(result).toMatchObject({ status: 'succeeded', value: { type: 'pdf' } });
  });

  it('lists the packs this device needs', () => {
    const files = new FakeFiles();
    expect(packsNeeded(['scan', 'ocr-jpn', 'pdfview'], files)).toEqual([
      'scan',
      'ocr-jpn',
      'pdfview',
    ]);
    files.vision = new FakeVision(files);
    expect(packsNeeded(['scan', 'ocr', 'ocr-jpn', 'pdfview'], files)).toEqual(['pdfview']);
  });
});

describe('Android (ML Kit): no edge finding, no Russian', () => {
  const android = (vision: FakeVision) => {
    vision.canFindPaper = false;
    vision.unsupported.add('ru');
  };

  it('reads Chinese with ML Kit, but downloads the language pack for Russian', async () => {
    const zh = setup(toolWorkflow('ocr', 'ocr-photos'), {}, { lang: 'chi_sim' }, true);
    android(zh.vision);
    zh.vision.texts = ['租约续签通知'];
    zh.files.nextPhotos = [zh.files.offerImage('a.jpg', 1000, 1400)];
    expect(await zh.run()).toMatchObject({ status: 'succeeded', value: { text: '租约续签通知' } });
    expect(zh.asked).toEqual([]);
    expect(zh.packs.calls).toEqual([]);

    const ru = setup(toolWorkflow('ocr', 'ocr-photos'), {}, { lang: 'rus' }, true);
    android(ru.vision);
    ru.packs.texts = ['Привет'];
    ru.files.nextPhotos = [ru.files.offerImage('a.jpg', 1000, 1400)];
    expect(await ru.run()).toMatchObject({ status: 'succeeded', value: { text: 'Привет' } });
    expect(ru.asked).toEqual(['ocr-rus']);
    expect(ru.vision.calls).toEqual([]);
  });

  it('finds edges of library photos with the scanner pack', async () => {
    const { files, vision, packs, run, asked } = setup(
      toolWorkflow('scan', 'scan-straighten'),
      { corners: [paper] },
      {},
      true,
    );
    android(vision);
    packs.detected = [paper];
    files.nextPhotos = [files.offerImage('a.jpg', 3000, 4000)];
    expect((await run()).status).toBe('succeeded');
    expect(asked).toEqual(['scan']);
    expect(packs.calls.map((c) => c.method)).toEqual(['detect', 'warp']);
    expect(vision.calls).toEqual([]);
  });

  it('scans with the ML Kit document scanner without asking for the scanner pack', async () => {
    const { files, vision, run, opened, asked } = setup(
      toolWorkflow('scan', 'scan-camera'),
      {},
      {},
      true,
    );
    android(vision);
    vision.scanned = [{ ...files.offerImage('page-1.jpg', 1700, 2400), straightened: true }];
    const result = await run();
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
    expect(result).toMatchObject({ status: 'succeeded', value: { type: 'pdf' } });
  });

  it('lists the packs an Android phone still needs', () => {
    const files = new FakeFiles();
    const vision = new FakeVision(files);
    android(vision);
    files.vision = vision;
    expect(packsNeeded(['scan', 'ocr', 'ocr-jpn', 'ocr-rus', 'pdfview'], files)).toEqual([
      'ocr-rus',
      'pdfview',
    ]);
    // 没有 Google Play 服务：没有文档扫描，扫描包也要下载。
    vision.documentCamera = false;
    expect(packsNeeded(['scan'], files)).toEqual(['scan']);
  });
});

describe('text layer languages (D-266)', () => {
  const latin = ['en-US', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR'];

  it('reads Chinese, Japanese or Korean first when the phone or the interface uses it', () => {
    expect(textLayerLanguages('zh', [])).toEqual(['zh-Hans', 'en-US']);
    expect(textLayerLanguages('en', ['zh-Hant-TW', 'en-US'])).toEqual(['zh-Hant', 'en-US']);
    expect(textLayerLanguages('fr', ['zh-HK'])).toEqual(['zh-Hant', 'en-US']);
    expect(textLayerLanguages('en', ['en-GB', 'ja-JP'])).toEqual(['ja-JP', 'en-US']);
    expect(textLayerLanguages('fr', ['ko-KR'])).toEqual(['ko-KR', 'en-US']);
    // 手机语言排在界面语言前面：手机设成繁体时，中文界面也按繁体认。
    expect(textLayerLanguages('zh', ['zh-Hant-TW'])).toEqual(['zh-Hant', 'en-US']);
  });

  it('keeps the Western European languages otherwise', () => {
    expect(textLayerLanguages('en', [])).toEqual(latin);
    expect(textLayerLanguages('fr', ['fr-FR', 'de-DE'])).toEqual(latin);
  });
});

describe('recognition reads the page before enhancing (D-267)', () => {
  /** 文档相机拍两页；返回送进增强的图（增强前）和增强出来的图，运行时填上。 */
  const scanned = (files: FakeFiles, vision: FakeVision) => {
    vision.scanned = [1, 2].map((n) => ({
      ...files.offerImage(`scan-${n}.jpg`, 1700, 2400),
      straightened: true,
    }));
    const pages = { before: [] as string[], after: [] as string[] };
    const enhance = files.enhanceImage.bind(files);
    files.enhanceImage = async (uri, ...rest) => {
      const out = await enhance(uri, ...rest);
      pages.before.push(uri);
      pages.after.push(out.uri);
      return out;
    };
    return pages;
  };
  const pick = { id: 'pick', action: 'in.photos', params: { source: 'scanner', min: 1, max: 5 } };
  const bw = { id: 'look', action: 'scan.enhance', params: { mode: 'bw' } };
  const pdf = {
    id: 'pdf',
    action: 'pdf.fromImages',
    params: {
      pageSize: 'a4',
      orientation: 'auto',
      marginMm: 0,
      fit: 'contain',
      maxMB: 0,
      textLayer: true,
    },
  };

  it('recognizes text on the straightened pages, not on the black and white ones', async () => {
    const wf: Workflow = {
      id: 'ocr',
      name: 'ocr',
      steps: [pick, bw, { id: 'read', action: 'ocr.recognize', params: { lang: 'chi_sim' } }],
    };
    const { files, vision, run } = setup(wf, {}, {}, true);
    const pages = scanned(files, vision);
    vision.texts = ['第一页', '第二页'];
    const result = await run();
    expect(files.enhanced).toEqual(['bw', 'bw']);
    // 送去识别前重新编码的是增强前的页面，不是黑白图。
    expect(pages.after).toHaveLength(2);
    expect(files.encodedFrom).toEqual(pages.before);
    expect(result).toMatchObject({ value: { type: 'text', text: '第一页\n\n第二页' } });
  });

  it('falls back to the enhanced page when the page before enhancing is gone', async () => {
    const wf: Workflow = {
      id: 'ocr',
      name: 'ocr',
      steps: [pick, bw, { id: 'read', action: 'ocr.recognize', params: { lang: 'chi_sim' } }],
    };
    const { files, vision, run } = setup(wf, {}, {}, true);
    const pages = scanned(files, vision);
    const enhance = files.enhanceImage.bind(files);
    // 增强完就把原来的页面删掉。
    files.enhanceImage = async (uri, ...rest) => {
      const out = await enhance(uri, ...rest);
      files.disk.delete(uri);
      files.deleted.add(uri);
      return out;
    };
    vision.texts = ['第一页', '第二页'];
    expect(await run()).toMatchObject({ value: { type: 'text', text: '第一页\n\n第二页' } });
    // 增强前的图读不了（没编码成功），每页改用增强后的图。
    expect(files.encodedFrom).toEqual(pages.after);
    expect(vision.calls.filter((c) => c.method === 'recognizeText')).toHaveLength(2);
  });

  it('builds the PDF text layer from the straightened pages and moves the boxes with the deskew', async () => {
    const wf: Workflow = { id: 'pdf', name: 'pdf', steps: [pick, bw, pdf] };
    const { files, vision, run } = setup(wf, {}, {}, true);
    const pages = scanned(files, vision);
    // 第一页转正了 2°（画布变大），第二页没转。
    files.enhanceSkews = [2, 0];
    const line = { text: 'Invoice 42', x: 100, y: 200, width: 300, height: 40 };
    vision.layers = [
      { width: 1700, height: 2400, lines: [line] },
      { width: 1700, height: 2400, lines: [line] },
    ];
    expect(await run()).toMatchObject({ status: 'succeeded' });
    const read = vision.calls.filter((c) => c.method === 'recognizeLines').map((c) => c.uri);
    expect(read).toEqual(pages.before);
  });

  it('reads the current page once another step has changed the picture', async () => {
    const rotate = { id: 'turn', action: 'image.rotate', params: { angle: 90, flip: 'none' } };
    const wf: Workflow = { id: 'pdf', name: 'pdf', steps: [pick, bw, rotate, pdf] };
    const { files, vision, run } = setup(wf, {}, {}, true);
    const pages = scanned(files, vision);
    expect(await run()).toMatchObject({ status: 'succeeded' });
    const read = vision.calls.filter((c) => c.method === 'recognizeLines').map((c) => c.uri);
    expect(read).toHaveLength(2);
    expect(read.some((uri) => [...pages.before, ...pages.after].includes(uri))).toBe(false);
  });

  it('keeps the enhanced page for the text recognition pack (Tesseract reads it better)', async () => {
    const wf: Workflow = {
      id: 'ocr',
      name: 'ocr',
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
        bw,
        { id: 'read', action: 'ocr.recognize', params: { lang: 'eng' } },
      ],
    };
    const { files, packs, run } = setup(wf);
    files.nextPhotos = [files.offerImage('a.jpg', 1700, 2400)];
    packs.texts = ['hello'];
    expect(await run()).toMatchObject({ value: { type: 'text', text: 'hello' } });
    expect(files.encodedFrom).toEqual([expect.stringMatching(/^runs\//)]);
  });
});
