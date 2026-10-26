import { BUILTIN_TOOLS, createRegistry, type RunResult, type Workflow } from '@morph/core';
import { qrMatrix, qrToRgba } from '@morph/tool-qr';

import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision } from '../test-utils/fake-files';

// 用识别出的文字命名（D-244）：文字只在本机用来取名，不出现在结果里。

const registry = createRegistry(BUILTIN_TOOLS);
const steps = (template: string): Workflow['steps'] => [
  { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
  { id: 'name', action: 'file.rename', params: { template } },
];

let ids = 0;
async function run(files: FakeFiles, template: string, locale: 'zh' | 'en' = 'zh') {
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => null as never,
  };
  const { result } = await startRun({
    workflow: { id: 'mine', name: '命名', steps: steps(template) },
    revisionId: 1,
    repo: new MemoryWorkspaceRepo(),
    files,
    registry,
    locale,
    now: () => new Date(2026, 9, 22),
    newId: () => `id${++ids}`,
    ui,
    collections: [],
  });
  return result;
}
const names = (r: RunResult) =>
  r.status === 'succeeded' && r.value && 'items' in r.value ? r.value.items.map((i) => i.name) : r;

describe('naming with recognized text', () => {
  it('names each receipt by the invoice number and date recognized on the device', async () => {
    const files = new FakeFiles();
    const vision = new FakeVision(files);
    files.vision = vision;
    vision.texts = [
      '发票号码：04418765\n开票日期：2026年10月21日\n合计：¥50.50',
      'Invoice No: INV-7\nnothing else',
    ];
    files.nextPhotos = [
      files.offerImage('IMG_1.jpg', 800, 1200),
      files.offerImage('IMG_2.jpg', 800, 1200),
    ];
    const result = await run(files, '发票-{ocr:invoiceNo}-{ocr:date}');
    // 第二张没有日期：去掉多出来的连接符。
    expect(names(result)).toEqual(['发票-04418765-2026-10-21', '发票-INV-7']);
    // 识别用界面语言加英文。
    expect(vision.calls.filter((c) => c.method === 'recognizeText').map((c) => c.args)).toEqual([
      ['zh-Hans', 'en-US'],
      ['zh-Hans', 'en-US'],
    ]);
  });

  it('keeps the original name when nothing matches', async () => {
    const files = new FakeFiles();
    files.vision = new FakeVision(files);
    files.nextPhotos = [files.offerImage('IMG_9.jpg', 100, 100)];
    expect(names(await run(files, '{ocr:invoiceNo}'))).toEqual(['IMG_9']);
  });

  it('reads a QR code without the system text recognition', async () => {
    const files = new FakeFiles();
    const photo = files.offerImage('ticket.png', 400, 400, 'image/png');
    const qr = qrToRgba(qrMatrix('Order 12345, call +33 1 23 45 67 89'), { scale: 4 });
    // 选中的照片会先复制进本次运行，地址变了：按任意地址都给这张二维码。
    files.imagePixels = async () => qr;
    files.nextPhotos = [photo];
    expect(names(await run(files, 'ticket-{qr:phone}', 'en'))).toEqual(['ticket-+33123456789']);
  });

  it('says so when the device has no built-in text recognition', async () => {
    const files = new FakeFiles();
    files.nextPhotos = [files.offerImage('IMG_1.jpg', 100, 100)];
    expect(await run(files, '{ocr:firstLine}')).toMatchObject({
      status: 'failed',
      error: { code: 'needsRecognition' },
    });
  });
});
