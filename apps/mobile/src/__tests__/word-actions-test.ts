import {
  BUILTIN_TOOLS,
  createRegistry,
  decodeUtf8,
  type RunItem,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { parseDocDoc, type LayoutRegion } from '@morph/tool-office';
import { gridRects, renderPage } from '@morph/tool-office/src/test-helpers';
import { strFromU8, unzipSync } from 'fflate';

import type { RecognizedLine } from '../runtime/platform';
import { devicePack, startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision } from '../test-utils/fake-files';

// 扫描件转 Word（D-310）的执行：像素只解码一次（认字、找线、版面分析共用）；版面分析模型没装或出错时
// 只按位置分段；图片区域按比例从原图剪下来嵌进 docx；结果是一个 docx，旁边存一份 DocDoc。

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

const registry = createRegistry(BUILTIN_TOOLS);
const W = 1000;
const H = 1400;
const XS = [100, 500, 900];
const YS = [900, 960, 1020];

const lines: RecognizedLine[] = [
  { text: '年度报告', x: 380, y: 60, width: 240, height: 48 },
  {
    text: '这是正文的第一行，写到了右边，下一行接着写没有缩进的',
    x: 100,
    y: 200,
    width: 800,
    height: 24,
  },
  { text: '第二行。', x: 100, y: 230, width: 120, height: 24 },
  { text: '名称', x: 250, y: 918, width: 100, height: 24 },
  { text: '金额', x: 650, y: 918, width: 100, height: 24 },
  { text: '午餐', x: 250, y: 978, width: 100, height: 24 },
  { text: '35', x: 680, y: 978, width: 40, height: 24 },
];

const regions: LayoutRegion[] = [
  { kind: 'title', label: 'doc_title', score: 0.9, box: { x: 370, y: 50, width: 260, height: 70 } },
  { kind: 'image', label: 'image', score: 0.8, box: { x: 300, y: 400, width: 400, height: 300 } },
];

let ids = 0;
function setup(steps: Workflow['steps'], visionOn = true) {
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  if (visionOn) files.vision = vision;
  const workflow: Workflow = { id: 'word', name: 'word', steps };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 29),
        newId: () => `id${++ids}`,
        ui: { confirm: async () => false, choose: async () => null, open: async () => null },
        packs: null,
        askParams: async (request) => request.params,
      })
    ).result;
  return { files, vision, run };
}

const pick = { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } };
const word = (lang = 'chi_sim') => ({ id: 'word', action: 'ocr.toWord', params: { lang } });

function resultItem(result: RunResult): RunItem {
  if (result.status !== 'succeeded' || !result.value || !('items' in result.value)) {
    throw new Error(`run did not succeed: ${JSON.stringify(result)}`);
  }
  return result.value.items[0]!;
}

async function documentXml(files: FakeFiles, item: RunItem) {
  const zip = unzipSync(await files.readUri(item.uri));
  return { xml: strFromU8(zip['word/document.xml']!), names: Object.keys(zip) };
}

/** 一页：表格线 + 识别结果（坐标和找线的图一样）。 */
function onePage(vision: FakeVision) {
  vision.tableImages = [renderPage(W, H, gridRects(XS, YS))];
  vision.layers = [{ width: W, height: H, lines }];
}

describe('ocr.toWord (D-310)', () => {
  it('makes one docx with a heading, a paragraph, a ruled table and a cropped picture', async () => {
    const { files, vision, run } = setup([pick, word()]);
    vision.enableLayout();
    vision.layoutRegions = [regions];
    // 原图是找线那张的 2 倍大：图片按比例剪。
    files.nextPhotos = [files.offerImage('年度报告.jpg', 2 * W, 2 * H)];
    onePage(vision);
    const item = resultItem(await run());
    expect(item).toMatchObject({
      name: '年度报告',
      ext: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    // 像素只解码一次，认字和版面分析都用它。
    expect(vision.calls.filter((c) => c.method === 'tablePixels')).toHaveLength(1);
    expect(vision.calls.filter((c) => c.method === 'detectLayout')).toHaveLength(1);
    const { xml, names } = await documentXml(files, item);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('年度报告');
    expect(xml).toContain('这是正文的第一行，写到了右边，下一行接着写没有缩进的第二行。');
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
    expect(xml).toContain('午餐');
    expect(names).toContain('word/media/image1.jpg');
    expect(files.encodes.at(-1)).toMatchObject({
      ops: { crop: { x: 600, y: 800, width: 800, height: 600 } },
      format: 'jpeg',
    });
    // DocDoc 存在运行目录里，只对这个 docx 有效；图片块记着剪好的文件。
    expect(item.docDoc?.for).toBe(item.uri);
    const doc = parseDocDoc(decodeUtf8(await files.readUri(item.docDoc!.uri)))!;
    expect(doc.pages[0]!.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'image',
      'table',
    ]);
    const image = doc.pages[0]!.blocks[2]!;
    expect(image.kind === 'image' && image.src?.startsWith('runs/')).toBe(true);
    expect(doc.pages[0]!.source).toBe(vision.calls.find((c) => c.method === 'tablePixels')!.uri);
  });

  it('still converts without the layout model, or when it fails: paragraphs only, no pictures', async () => {
    for (const mode of ['missing', 'not installed', 'fails'] as const) {
      const { files, vision, run } = setup([pick, word()]);
      if (mode !== 'missing') vision.enableLayout();
      if (mode === 'fails') vision.layoutFails = true;
      files.nextPhotos = [files.offerImage('a.jpg', W, H)];
      onePage(vision);
      const item = resultItem(await run());
      const { xml, names } = await documentXml(files, item);
      expect(xml).toContain('第二行。');
      expect(xml).toContain('午餐');
      expect(names.some((n) => n.startsWith('word/media/'))).toBe(false);
    }
  });

  it('puts several pictures into one document named 文档-日期 (D-298), a page each', async () => {
    const { files, vision, run } = setup([pick, word()]);
    files.nextPhotos = [files.offerImage('a.jpg', W, H), files.offerImage('b.jpg', W, H)];
    vision.tableImages = [renderPage(W, H, []), renderPage(W, H, [])];
    vision.layers = [
      { width: W, height: H, lines: [lines[1]!] },
      { width: W, height: H, lines: [lines[2]!] },
    ];
    const item = resultItem(await run());
    expect(item).toMatchObject({ name: '文档-2026-10-29', ext: 'docx' });
    const { xml } = await documentXml(files, item);
    expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
  });

  it('says so when the device can’t read that language, and fails when nothing was read', async () => {
    const ru = setup([pick, word('rus')]);
    ru.vision.unsupported.add('ru');
    ru.files.nextPhotos = [ru.files.offerImage('a.jpg', W, H)];
    expect(await ru.run()).toMatchObject({ status: 'failed', error: { code: 'wordUnsupported' } });
    const noVision = setup([pick, word()], false);
    noVision.files.nextPhotos = [noVision.files.offerImage('a.jpg', W, H)];
    expect(await noVision.run()).toMatchObject({
      status: 'failed',
      error: { code: 'wordUnsupported' },
    });
    const blank = setup([pick, word()]);
    blank.files.nextPhotos = [blank.files.offerImage('blank.jpg', W, H)];
    expect(await blank.run()).toMatchObject({ status: 'failed', error: { code: 'notFound' } });
  });

  it('asks for the text model and, besides it, the optional layout model', () => {
    const files = new FakeFiles();
    const vision = new FakeVision(files);
    files.vision = vision;
    vision.ocrModel = { pack: 'ppocr', languages: ['zh', 'en'] };
    vision.enableLayout();
    expect(devicePack(files, 'ocr.toWord', { lang: 'chi_sim' })).toEqual([
      { pack: 'ppocr' },
      { pack: 'layout', optional: true, extra: true },
    ]);
    // 系统自己能认的语言（韩文）：只问版面分析模型。
    expect(devicePack(files, 'ocr.toWord', { lang: 'kor' })).toEqual([
      { pack: 'layout', optional: true, extra: true },
    ]);
    // 没配置扩展包下载地址（没有 layoutModel）：不问版面分析模型。
    vision.layoutModel = undefined;
    expect(devicePack(files, 'ocr.toWord', { lang: 'chi_sim' })).toEqual([{ pack: 'ppocr' }]);
  });
});
