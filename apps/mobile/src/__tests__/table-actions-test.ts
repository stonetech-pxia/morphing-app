import {
  BUILTIN_TOOLS,
  createRegistry,
  decodeUtf8,
  type RunItem,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { getLocales } from 'expo-localization';
import { parseTableDoc, type TableBlock } from '@morph/tool-office';
import { gridRects, renderPage } from '@morph/tool-office/src/test-helpers';
import { strFromU8, unzipSync } from 'fflate';

import type { RecognizedLine } from '../runtime/platform';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision } from '../test-utils/fake-files';

// 扫描件转 Excel（D-272）的执行：找线用的像素只解码一次（PP-OCRv6 在同一张图上认时共用），
// 有增强前的图时在它上面认、框换算回来（D-267）；结果是一个 xlsx，旁边存一份 TableDoc。

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

const registry = createRegistry(BUILTIN_TOOLS);
const XS = [100, 300, 500, 700, 900];
const YS = [100, 160, 220, 280];

/** 每格中间一行字，坐标按 k 倍放大（识别时的图比找线的图大）。 */
function cellLines(k = 1): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      out.push({
        text: r === 0 ? `列${c + 1}` : String(r * 100 + c),
        x: ((XS[c]! + XS[c + 1]!) / 2 - 60) * k,
        y: ((YS[r]! + YS[r + 1]!) / 2 - 12) * k,
        width: 120 * k,
        height: 24 * k,
      });
    }
  }
  return out;
}

let ids = 0;
function setup(steps: Workflow['steps'], visionOn = true) {
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  if (visionOn) files.vision = vision;
  const workflow: Workflow = { id: 'excel', name: 'excel', steps };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 28),
        newId: () => `id${++ids}`,
        ui: { confirm: async () => false, choose: async () => null, open: async () => null },
        packs: null,
        askParams: async (request) => request.params,
      })
    ).result;
  return { files, vision, run };
}

const pick = { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } };
const excel = (scope: 'all' | 'tables' = 'all', lang = 'chi_sim') => ({
  id: 'excel',
  action: 'ocr.toExcel',
  params: { lang, scope },
});

function resultItem(result: RunResult): RunItem {
  if (result.status !== 'succeeded' || !result.value || !('items' in result.value)) {
    throw new Error(`run did not succeed: ${JSON.stringify(result)}`);
  }
  return result.value.items[0]!;
}

async function unpack(files: FakeFiles, item: RunItem) {
  const zip = unzipSync(await files.readUri(item.uri));
  return (name: string) => strFromU8(zip[name]!);
}

describe('ocr.toExcel (D-272)', () => {
  it('makes one xlsx from a ruled table, decoding the picture only once', async () => {
    const { files, vision, run } = setup([pick, excel()]);
    files.nextPhotos = [files.offerImage('发票明细.jpg', 2000, 1400)];
    const page = renderPage(1000, 700, gridRects(XS, YS));
    vision.tableImages = [page];
    // 识别时的图是找线那张的 2 倍大：框按比例换算回来。
    vision.layers = [{ width: 2000, height: 1400, lines: cellLines(2) }];
    const item = resultItem(await run());
    expect(item).toMatchObject({
      name: '发票明细',
      ext: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(vision.calls.filter((c) => c.method === 'tablePixels')).toHaveLength(1);
    // 认字用的是找线时解码的同一份像素。
    expect(vision.linePixels).toEqual([page]);
    const read = await unpack(files, item);
    expect(read('xl/workbook.xml')).toContain('<sheet name="第 1 页"');
    expect(read('xl/sharedStrings.xml')).toContain('<t>列1</t>');
    // 数字写成数字类型。
    expect(read('xl/worksheets/sheet1.xml')).toMatch(/<c r="D3" s="\d+"><v>203<\/v><\/c>/);
    // TableDoc 存在运行目录里，只对这个 xlsx 有效。
    expect(item.tableDoc?.for).toBe(item.uri);
    expect(item.tableDoc?.uri.startsWith('runs/')).toBe(true);
    expect(item.tableDoc?.pagesWithoutTables).toBeUndefined();
    const doc = parseTableDoc(decodeUtf8(await files.readUri(item.tableDoc!.uri)))!;
    const table = doc.pages[0]!.blocks[0] as TableBlock;
    expect([table.rows, table.cols]).toEqual([3, 4]);
    // 截原图用的是找线那张图。
    expect(doc.pages[0]!.source).toBe(vision.calls.find((c) => c.method === 'tablePixels')!.uri);
  });

  it('recognizes on the picture from before the cleanup and maps the boxes back (D-267)', async () => {
    const { files, vision, run } = setup([
      pick,
      { id: 'look', action: 'scan.enhance', params: { mode: 'auto' } },
      excel(),
    ]);
    const photo = files.offerImage('table.jpg', 1000, 700);
    files.nextPhotos = [photo];
    vision.tableImages = [renderPage(1000, 700, gridRects(XS, YS))];
    vision.layers = [{ width: 1000, height: 700, lines: cellLines() }];
    const item = resultItem(await run());
    const lineCalls = vision.calls.filter((c) => c.method === 'recognizeLines');
    // 找线用增强后的图，认字用增强前的图（运行目录里复制进来的那张）。
    const tableCall = vision.calls.find((c) => c.method === 'tablePixels')!;
    expect(lineCalls).toHaveLength(1);
    expect(lineCalls[0]!.uri).not.toBe(tableCall.uri);
    expect(vision.linePixels).toEqual([undefined]);
    const doc = parseTableDoc(decodeUtf8(await files.readUri(item.tableDoc!.uri)))!;
    const table = doc.pages[0]!.blocks[0] as TableBlock;
    expect(table.cells.find((c) => c.row === 2 && c.col === 3)!.text).toBe('203');
    expect(doc.pages[0]!.source).toBe(tableCall.uri);
  });

  it('writes everything on a page without a ruled table when “tables only” is chosen, and says so', async () => {
    const { files, vision, run } = setup([pick, excel('tables')]);
    files.nextPhotos = [files.offerImage('a.jpg', 1000, 700), files.offerImage('b.jpg', 1000, 700)];
    vision.tableImages = [renderPage(1000, 700, gridRects(XS, YS)), renderPage(1000, 700, [])];
    vision.layers = [
      {
        width: 1000,
        height: 700,
        lines: [...cellLines(), { text: '表格上面的标题', x: 100, y: 40, width: 300, height: 24 }],
      },
      {
        width: 1000,
        height: 700,
        lines: [{ text: '只有一段文字', x: 100, y: 100, width: 400, height: 24 }],
      },
    ];
    const item = resultItem(await run());
    expect(item.tableDoc?.pagesWithoutTables).toEqual([2]);
    const read = await unpack(files, item);
    const strings = read('xl/sharedStrings.xml');
    expect(strings).not.toContain('表格上面的标题');
    expect(strings).toContain('只有一段文字');
    expect(read('xl/workbook.xml')).toContain('<sheet name="第 2 页"');
  });

  it('says so when the device can’t read tables in that language', async () => {
    const { files, vision, run } = setup([pick, excel('all', 'rus')]);
    vision.unsupported.add('ru');
    files.nextPhotos = [files.offerImage('a.jpg', 1000, 700)];
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'tableUnsupported' } });
    const noVision = setup([pick, excel()], false);
    noVision.files.nextPhotos = [noVision.files.offerImage('a.jpg', 1000, 700)];
    expect(await noVision.run()).toMatchObject({
      status: 'failed',
      error: { code: 'tableUnsupported' },
    });
  });

  it('picks the language by the phone’s languages when lang is auto (D-278)', async () => {
    const phone = (languageTag: string) =>
      jest
        .mocked(getLocales)
        .mockReturnValue([{ languageTag } as ReturnType<typeof getLocales>[number]]);
    try {
      phone('ja-JP');
      const ja = setup([pick, excel('all', 'auto')]);
      ja.files.nextPhotos = [ja.files.offerImage('a.jpg', 1000, 700)];
      ja.vision.tableImages = [renderPage(1000, 700, gridRects(XS, YS))];
      ja.vision.layers = [{ width: 1000, height: 700, lines: cellLines() }];
      resultItem(await ja.run());
      expect(ja.vision.calls.find((c) => c.method === 'recognizeLines')?.args).toEqual([
        'ja-JP',
        'en-US',
      ]);
      // 手机是俄文、系统也认不了：说清楚不支持，不去下载文字识别包（它不给每行的位置）。
      phone('ru-RU');
      const ru = setup([pick, excel('all', 'auto')]);
      ru.vision.unsupported.add('ru');
      ru.files.nextPhotos = [ru.files.offerImage('a.jpg', 1000, 700)];
      expect(await ru.run()).toMatchObject({
        status: 'failed',
        error: { code: 'tableUnsupported' },
      });
    } finally {
      jest.mocked(getLocales).mockReturnValue([] as unknown as ReturnType<typeof getLocales>);
    }
  });

  it('fails with “nothing found” when no page has any text', async () => {
    const { files, run } = setup([pick, excel()]);
    files.nextPhotos = [files.offerImage('blank.jpg', 1000, 700)];
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'notFound' } });
  });
});
