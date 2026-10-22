import {
  BUILTIN_TOOLS,
  ID_PHOTO_CHOICES,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type Collection,
  type RunResult,
  type Workflow,
} from '@morph/core';
import { ID_PHOTO_SPECS } from '@morph/tool-image';
import { qrMatrix, qrToRgba } from '@morph/tool-qr';

import type { DrawOp } from '../runtime/platform';
import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

// T6：拼图、打码、水印、证件照、相纸、ZIP、二维码、文字转 PDF、用记录生成 PDF。
// Skia 合成和 expo-print 换成记录调用的假实现；排版、ZIP、二维码用真实的库。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(toolId: string, id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

const mine = (steps: Workflow['steps']): Workflow => ({ id: 'mine', name: '我的', steps });

const expenses: Collection = {
  id: 'expenses',
  name: '报销',
  fields: [
    { id: 'item', name: '项目', type: 'text' },
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    { id: 'day', name: '日期', type: 'date' },
  ],
};

let ids = 0;
function setup(
  workflow: Workflow,
  answers: Record<string, unknown> = {},
  local: Partial<Record<LocalKind, unknown>> = {},
) {
  const files = new FakeFiles();
  const repo = new MemoryWorkspaceRepo();
  const opened: { kind: LocalKind; input: unknown }[] = [];
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
        repo,
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        collections: [expenses],
        askParams: async (request) => ({ ...request.params, ...answers }),
      })
    ).result;
  return { files, repo, run, opened };
}

const items = (result: RunResult) => {
  if (result.status !== 'succeeded' || !result.value || !('items' in result.value)) {
    throw new Error(`no files: ${JSON.stringify(result)}`);
  }
  return result.value.items;
};
const dsts = (ops: DrawOp[]) => ops.filter((o) => o.kind === 'image').map((o) => o.dst);

describe('stitch and grid', () => {
  it('stitches screenshots into one long image, narrowing it a little or splitting when very long', async () => {
    const short = setup(toolWorkflow('image', 'image-stitch'));
    short.files.nextPhotos = [1, 2, 3].map((i) => short.files.offerImage(`s${i}.png`, 1290, 2796));
    expect(items(await short.run())).toHaveLength(1);
    const [only] = short.files.composed;
    // 3 张 1290×2796 合计 8388 高，超过 8192：宽度收窄到 1259，拼成一张。
    expect(only!.canvas).toMatchObject({ width: 1259, background: '#FFFFFF' });
    expect(only!.canvas.height).toBeLessThanOrEqual(8192);
    expect(dsts(only!.ops)).toHaveLength(3);

    const long = setup(toolWorkflow('image', 'image-stitch'));
    // 10 张：收窄到 720 也放不下，分成两张。
    long.files.nextPhotos = Array.from({ length: 10 }, (_, i) =>
      long.files.offerImage(`s${i + 1}.png`, 1290, 2796),
    );
    const parts = items(await long.run());
    expect(parts.map((p) => p.name)).toEqual(['s1-1', 's1-2']);
    expect(
      long.files.composed.every((c) => c.canvas.height <= 8192 && c.canvas.width === 720),
    ).toBe(true);
  });

  it('puts photos in a 2-column grid with centered square crops', async () => {
    const { files, run } = setup(toolWorkflow('image', 'image-grid'), { columns: 2 });
    files.nextPhotos = [
      files.offerImage('a.jpg', 4000, 3000),
      files.offerImage('b.jpg', 3000, 4000),
      files.offerImage('c.jpg', 1000, 1000),
    ];
    items(await run());
    const [grid] = files.composed;
    expect(grid!.canvas.width).toBe(2400);
    const images = grid!.ops.filter((o) => o.kind === 'image');
    expect(images).toHaveLength(3);
    // 横图居中裁成正方形。
    expect(images[0]!.kind === 'image' && images[0]!.src).toEqual({
      x: 500,
      y: 0,
      width: 3000,
      height: 3000,
    });
  });
});

describe('redact and watermark', () => {
  it('blacks out or blurs the boxes the user drew, image by image', async () => {
    const box = { x: 10, y: 20, width: 300, height: 80 };
    const black = setup(toolWorkflow('image', 'image-redact'), {}, { redact: [[box], []] });
    black.files.nextPhotos = [
      black.files.offerImage('a.png', 1170, 2532),
      black.files.offerImage('b.png', 1170, 2532),
    ];
    expect(items(await black.run())).toHaveLength(2);
    expect(black.files.composed[0]!.ops.slice(1)).toEqual([
      { kind: 'rect', rect: box, color: '#000000' },
    ]);
    expect(black.files.composed[1]!.ops).toHaveLength(1);

    const blur = setup(
      toolWorkflow('image', 'image-redact'),
      { style: 'blur' },
      { redact: [[box]] },
    );
    blur.files.nextPhotos = [blur.files.offerImage('a.png', 1170, 2532)];
    items(await blur.run());
    expect(blur.files.composed[0]!.ops[1]).toMatchObject({ kind: 'blur', rect: box });

    const cancelled = setup(toolWorkflow('image', 'image-redact'));
    cancelled.files.nextPhotos = [cancelled.files.offerImage('a.png', 100, 100)];
    expect((await cancelled.run()).status).toBe('cancelled');
  });

  it('draws the watermark text with the system font, in one corner or across the image', async () => {
    const corner = setup(toolWorkflow('image', 'image-watermark'), {
      text: '仅供签证使用',
      mode: 'corner',
    });
    corner.files.nextPhotos = [corner.files.offerImage('a.jpg', 4000, 3000)];
    items(await corner.run());
    expect(corner.files.renderedTexts).toEqual(['仅供签证使用']);
    const marks = corner.files.composed[0]!.ops.slice(1);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'image', opacity: 0.35 });

    const tile = setup(toolWorkflow('image', 'image-watermark'), {
      text: 'COPY',
      mode: 'tile',
      sizePercent: 20,
    });
    tile.files.nextPhotos = [tile.files.offerImage('a.jpg', 4000, 3000)];
    items(await tile.run());
    expect(tile.files.composed[0]!.ops.length).toBeGreaterThan(4);
    expect(tile.files.composed[0]!.ops[1]).toMatchObject({ angleDeg: -30 });
  });
});

describe('ID photos', () => {
  it('keeps the core spec list and the pixel specs in step', () => {
    expect(ID_PHOTO_CHOICES.map((c) => c.id)).toEqual(ID_PHOTO_SPECS.map((s) => s.id));
  });

  it('frames at the spec shape, cuts to the spec pixels and stays under the size limit', async () => {
    const frame = { x: 100, y: 100, width: 2000, height: 2000 };
    const { files, run, opened } = setup(
      toolWorkflow('image', 'image-idphoto'),
      {},
      {
        crop: [frame],
      },
    );
    files.nextPhotos = [files.offerImage('me.heic', 3024, 4032, 'image/heic')];
    const [photo] = items(await run());
    expect(opened[0]).toMatchObject({ kind: 'crop', input: { aspect: 1 } });
    expect(photo).toMatchObject({ width: 600, height: 600, ext: 'jpg' });
    expect(photo!.size).toBeLessThanOrEqual(240 * 1024);
    expect(files.encodes.at(-1)).toMatchObject({
      ops: { crop: frame, resize: { width: 600, height: 600 } },
    });

    // 只降质量、不缩小像素；做不到时说清楚最小能到多少。
    const tight = setup(
      toolWorkflow('image', 'image-idphoto'),
      { spec: 'cn-visa', maxKB: 10 },
      {
        crop: [frame],
      },
    );
    tight.files.nextPhotos = [tight.files.offerImage('me.jpg', 3024, 4032)];
    expect(await tight.run()).toMatchObject({ status: 'failed', error: { code: 'targetNotMet' } });
    expect(tight.files.encodes.every((e) => e.width === 390 && e.height === 567)).toBe(true);
  });

  it('arranges six 2×2 in photos on 4×6 paper with cut lines, and refuses photos that do not fit', async () => {
    const sheet = setup(
      mine([
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
        { id: 'sheet', action: 'image.printSheet', params: { sheet: '4x6', guides: true } },
      ]),
    );
    sheet.files.nextPhotos = [sheet.files.offerImage('me.jpg', 600, 600)];
    const [paper] = items(await sheet.run());
    expect(paper).toMatchObject({ width: 1200, height: 1800, name: 'me-4x6' });
    const { ops } = sheet.files.composed[0]!;
    expect(ops.filter((o) => o.kind === 'image')).toHaveLength(6);
    expect(ops.some((o) => o.kind === 'line')).toBe(true);

    const big = setup(
      mine([
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
        { id: 'sheet', action: 'image.printSheet', params: { sheet: '4x6', guides: false } },
      ]),
    );
    big.files.nextPhotos = [big.files.offerImage('photo.jpg', 4000, 3000)];
    expect(await big.run()).toMatchObject({
      status: 'failed',
      error: { code: 'doesNotFit', detail: { name: 'photo.jpg' } },
    });
  });
});

describe('ZIP', () => {
  it('zips files and unzips them back with their names', async () => {
    const zip = setup(toolWorkflow('zip', 'zip-files'), { template: '材料' });
    zip.files.nextPick = [
      zip.files.offer('报告.pdf', await makePdf(2)),
      zip.files.offer('notes.txt', new TextEncoder().encode('hello')),
    ];
    const [archive] = items(await zip.run());
    expect(archive).toMatchObject({ name: '材料', ext: 'zip', mimeType: 'application/zip' });

    const unzip = setup(toolWorkflow('zip', 'zip-extract'));
    unzip.files.nextPick = [unzip.files.offer('材料.zip', zip.files.disk.get(archive!.uri)!)];
    const out = items(await unzip.run());
    expect(out.map((i) => `${i.name}.${i.ext}`)).toEqual(['报告.pdf', 'notes.txt']);
    expect(new TextDecoder().decode(unzip.files.disk.get(out[1]!.uri))).toBe('hello');
    expect(out[0]!.mimeType).toBe('application/pdf');
  });

  it('reports a damaged archive', async () => {
    const { files, run } = setup(toolWorkflow('zip', 'zip-extract'));
    files.nextPick = [files.offer('broken.zip', new Uint8Array([1, 2, 3, 4]))];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'unreadable', detail: { name: 'broken.zip' } },
    });
  });
});

describe('QR codes and text', () => {
  it('makes a QR code PNG from typed text and reads one back from a photo', async () => {
    const make = setup(toolWorkflow('qr', 'qr-make'), { text: 'https://example.com/签证' });
    const [png] = items(await make.run());
    expect(png).toMatchObject({ ext: 'png', mimeType: 'image/png', name: '二维码' });
    expect([...make.files.disk.get(png!.uri)!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(png!.width).toBeGreaterThanOrEqual(500);

    const read = setup(toolWorkflow('qr', 'qr-read'));
    const photo = read.files.offerImage('shot.png', 400, 400, 'image/png');
    read.files.nextPhotos = [photo];
    read.files.pixels.set(
      // 选中的照片会复制进本次运行，按复制后的地址查。
      'runs/',
      qrToRgba(qrMatrix('WIFI:S:Home;T:WPA;P:secret;;'), { scale: 4 }),
    );
    const original = read.files.imagePixels.bind(read.files);
    read.files.imagePixels = async (uri: string) =>
      uri.startsWith('runs/') ? read.files.pixels.get('runs/')! : original(uri);
    expect(await read.run()).toMatchObject({
      status: 'succeeded',
      value: { type: 'text', text: 'WIFI:S:Home;T:WPA;P:secret;;' },
    });
  });

  it('refuses empty text and photos without a QR code', async () => {
    const empty = setup(toolWorkflow('qr', 'qr-make'), { text: '   ' });
    expect(await empty.run()).toMatchObject({ status: 'failed', error: { code: 'emptyText' } });

    const none = setup(toolWorkflow('qr', 'qr-read'));
    none.files.nextPhotos = [none.files.offerImage('cat.jpg', 400, 400)];
    expect(await none.run()).toMatchObject({
      status: 'failed',
      error: { code: 'notFound', detail: { name: 'cat.jpg' } },
    });
  });

  it('turns typed text into a PDF with the text escaped, or into a .txt file', async () => {
    const pdf = setup(toolWorkflow('text', 'text-pdf'), { text: '第一行 <b>\n\n第二段' });
    const [out] = items(await pdf.run());
    expect(out).toMatchObject({ ext: 'pdf', pageCount: 1, name: '文字' });
    expect(pdf.files.printedHtml[0]).toContain('<p>第一行 &lt;b&gt;</p>');

    const txt = setup(
      mine([
        { id: 'type', action: 'in.text', params: { text: 'hello 你好' } },
        { id: 'file', action: 'text.toFile', params: {} },
      ]),
    );
    const [file] = items(await txt.run());
    expect(new TextDecoder().decode(txt.files.disk.get(file!.uri))).toBe('hello 你好');
  });
});

describe('records to PDF', () => {
  const report = (period: string) =>
    mine([
      { id: 'read', action: 'in.records', params: { collectionId: 'expenses', period } },
      {
        id: 'pdf',
        action: 'print.records',
        params: {
          template: 'receipt',
          title: '十月报销',
          fields: ['day', 'item', 'amount'],
          pageSize: 'a4',
        },
      },
    ]);

  it('reads this month’s records by their date, fills the template on the device and totals the money', async () => {
    const { files, repo, run } = setup(report('thisMonth'));
    const add = (id: string, values: Record<string, unknown>) =>
      repo.insertRecord({ id, collectionId: 'expenses', values, createdAt: 1, updatedAt: 1 });
    await add('a', { item: '出租车', amount: 30, day: '2026-10-05' });
    await add('b', { item: '<午饭>', amount: 12.5, day: '2026-10-01' });
    await add('c', { item: '九月的', amount: 99, day: '2026-09-30' });
    const [pdf] = items(await run());
    expect(pdf).toMatchObject({ name: '十月报销', ext: 'pdf' });
    const html = files.printedHtml[0]!;
    expect(html).toContain('&lt;午饭&gt;');
    expect(html).not.toContain('九月的');
    expect(html).toContain('¥42.50');
    // 按日期从早到晚。
    expect(html.indexOf('2026-10-01')).toBeLessThan(html.indexOf('2026-10-05'));
  });

  it('says so when there are no records for that time', async () => {
    const { run } = setup(report('today'));
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'noRecords', detail: { name: '报销' } },
    });
  });
});
