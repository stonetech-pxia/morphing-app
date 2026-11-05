import {
  applyOps,
  createStarterWorkspace,
  packById,
  PICK_STORE_KEY,
  templateOps,
  type Collection,
  type Locale,
  type Registry,
  type TextPage,
  type Workflow,
  type WorkspaceConfig,
} from '@morph/core';
import { qrMatrix, qrToRgba } from '@morph/tool-qr';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import type { PackBridge } from '../packs/bridge';
import type { Packs } from '../packs/PackHost';
import { PackStore } from '../packs/store';
import type { RecognizedLayer } from '../runtime/platform';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG } from '../test-utils/fake-files';
import { MemoryPackFs, sha256 } from '../test-utils/memory-packs';
import { renderToolsApp } from '../test-utils/render-app';

// 新记录表单的候选值（D-394）：附件里的照片、PDF 在本机读出文字，每个空字段下面最多 3 个候选，
// 点了才填，从不自动填。三种状态：新用户（没装文字识别 → 提示；装了 → 候选）、有数据（上次点的
// 标签下次排第一）、边界（没有文字、照片和 PDF 混着、超过 3 个附件、编辑已有记录、没读完就离开）。

afterEach(() => {
  useIncoming.getState().clear();
  useGuide.setState({ stage: null, repo: null, introOpen: false });
});

/** 一排一排的识别结果（每排一段，字高 20，排距 40）。 */
function layer(rows: string[]): RecognizedLayer {
  return {
    width: 600,
    height: rows.length * 40 + 40,
    lines: rows.map((text, i) => ({
      text,
      x: 20,
      y: 20 + i * 40,
      width: text.length * 10,
      height: 20,
    })),
  };
}

const RECEIPT = ['Maple Corner', 'Date 2026-10-20', 'Subtotal 165.03', 'Tax 13.20', 'Total 178.23'];

/** 假的 PDF 预览页面：lines 给文字层，render 给页面图片。 */
class FakePdfPages {
  calls: string[] = [];
  textPages: TextPage[] = [];
  /** 下一次文字层读出来以前一直等着（模拟没读完就离开）。 */
  hold: Promise<void> | null = null;
  async call<T>(_page: string, method: string): Promise<T> {
    this.calls.push(method);
    if (this.hold) await this.hold;
    if (method === 'lines') return { count: 1, pages: this.textPages } as T;
    if (method === 'render')
      return [{ index: 0, data: btoa(String.fromCharCode(...TINY_JPEG)) }] as T;
    throw new Error(`unexpected ${method}`);
  }
}

/** 扩展包环境：内存里的 PackStore（installed 里的算装好了）和假的 PDF 页面。 */
async function fakePacks(installed: string[]) {
  const fs = new MemoryPackFs();
  const store = new PackStore(fs, sha256);
  const install = async (id: string) =>
    fs.writeText(`${id}/${packById(id)!.version}/ready.json`, '{"bytes":1,"installedAt":1}');
  for (const id of installed) await install(id);
  const pdf = new FakePdfPages();
  const none: string[] = [];
  const bridge = {
    subscribe: () => () => undefined,
    activePages: () => none,
    call: pdf.call.bind(pdf),
    close: () => undefined,
  } as unknown as PackBridge;
  return { packs: { store, bridge } as Packs, fs, pdf, install };
}

/** 新建表单页的候选另有测试（new-table-test）；这里用已经建好的购物凭证表。 */
function withPurchases(locale: Locale, registry: Registry): WorkspaceConfig {
  const blank = createStarterWorkspace(locale, registry);
  const r = applyOps(blank, templateOps('purchase', blank, locale), { registry, locale });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

async function render(
  installed: string[] = ['ppocr', 'pdfview'],
  locale: 'zh' | 'en' | 'fr' = 'zh',
  seed?: (locale: Locale, registry: Registry) => WorkspaceConfig,
) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  vision.ocrModel = { pack: 'ppocr', languages: ['zh', 'ja', 'en', 'fr', 'de', 'es', 'pt', 'it'] };
  files.vision = vision;
  const p = await fakePacks(installed);
  const app = await renderToolsApp(repo, files, {
    packs: p.packs,
    locale,
    seed: seed ?? withPurchases,
  });
  return { ...app, vision, ...p };
}

/** 收件页面收到这些文件（真实的扩展名和类型，选择器给的是 picker:// 的地址），存成「购物凭证」。 */
async function shareInto(
  files: FakeFiles,
  items: { name: string; mime: string }[],
  choice = 'table-purchases',
) {
  const picked = items.map((i) =>
    files.offer(
      i.name,
      i.mime === 'application/pdf' ? new Uint8Array([37, 80, 68, 70]) : TINY_JPEG,
      i.mime,
    ),
  );
  await act(async () => useIncoming.getState().receive(picked, [], 'picker'));
  await act(() => router.push('/share'));
  await fireEvent.press(await screen.findByTestId('share-record-choose'));
  await fireEvent.press(await screen.findByTestId(`share-record-${choice}`));
  expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
}

const chipTexts = (field: string) =>
  screen
    .queryAllByTestId(new RegExp(`^editor-${field}-suggestion-\\d$`))
    .map((c) => String((c.props as { accessibilityLabel?: string }).accessibilityLabel));

const recognized = (vision: FakeVision) =>
  vision.calls.filter((c) => c.method === 'recognizeLines');
const runsLeft = (files: FakeFiles) =>
  [...files.disk.keys()].filter((k) => k.startsWith('runs/prefill-'));

async function save() {
  await fireEvent.press(screen.getByTestId('editor-save'));
  await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
  expect(await screen.findByTestId('share-screen')).toBeTruthy();
}

describe('新记录表单的候选值', () => {
  it('新用户、没装文字识别：只显示一行提示，不识别、不下载；点了先问，同意以后才识别', async () => {
    const { files, vision, fs, install } = await render([]);
    await shareInto(files, [{ name: 'IMG_0001.HEIC', mime: 'image/heic' }]);
    expect(await screen.findByTestId('suggestions-notice')).toHaveTextContent(/需要先下载一次/);
    expect(recognized(vision)).toHaveLength(0);
    expect(chipTexts('amount')).toEqual([]);

    // 点了先弹确认框；取消就什么都不做。
    await fireEvent.press(screen.getByTestId('suggestions-download'));
    expect(await screen.findByTestId('pack-gate')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pack-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pack-gate')).toBeNull());
    expect(fs.downloads).toEqual([]);
    expect(recognized(vision)).toHaveLength(0);

    // 同意下载（下载本身由 PackStore 负责，这里当作已经下好），然后在后台识别，出现候选。
    vision.layers.push(layer(RECEIPT));
    await fireEvent.press(screen.getByTestId('suggestions-download'));
    await install('ppocr');
    await fireEvent.press(await screen.findByTestId('pack-download'));
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('suggestions-notice')).toBeNull();
    // HEIC 先转成 JPG 再识别；中间文件已经删掉。
    expect(recognized(vision)[0]!.uri).toMatch(/^runs\/prefill-.+\/page-1\.jpg$/);
    expect(runsLeft(files)).toEqual([]);
  });

  it('装了文字识别：自动识别，空字段下面有候选，没有自动填；点了才填，候选留在原地、点中的那个标出来', async () => {
    const { files, vision, repo } = await render();
    vision.layers.push(layer(RECEIPT));
    await shareInto(files, [{ name: 'receipt.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('suggestions-notice')).toBeNull();
    // 实付排第一，不是小计；日期、商家也有。
    expect(chipTexts('amount')[0]).toMatch(/178\.23/);
    expect(chipTexts('date')[0]).toMatch(/「日期」/);
    // 日期写出月份（日月分不清时两个候选才分得开），不是 2026-10-12 这种只有数字的写法。
    expect(chipTexts('date')[0]).toMatch(/\d{4}年\d{1,2}月\d{1,2}日/);
    expect(chipTexts('merchant')[0]).toBe('把 Maple Corner 填进「商家」');
    // 一个都没有自动填。
    for (const id of ['merchant', 'date', 'amount'])
      expect(screen.getByTestId(`editor-${id}`).props.value ?? '').toBe('');

    const before = chipTexts('amount');
    await fireEvent.press(screen.getByTestId('editor-amount-suggestion-0'));
    expect(screen.getByTestId('editor-amount').props.value).toBe('178.23');
    // 候选不消失（下面的字段不会往上跳，iOS 模拟器 2026-10-31），点中的那个标成已选。
    expect(chipTexts('amount')).toEqual(before);
    const selected = (id: string) =>
      screen
        .queryAllByTestId(new RegExp(`^editor-${id}-suggestion-\\d$`))
        .map((c) =>
          Boolean(
            (c.props as { accessibilityState?: { selected?: boolean } }).accessibilityState
              ?.selected,
          ),
        );
    expect(selected('amount')).toEqual(before.map((_, i) => i === 0));
    // 手动输入的字段：候选还在，一个都不标；不学。
    await fireEvent.changeText(screen.getByTestId('editor-merchant'), '枫叶小店');
    expect(chipTexts('merchant').length).toBeGreaterThan(0);
    expect(selected('merchant').some(Boolean)).toBe(false);
    await save();
    const [record] = await repo.listRecords('purchases');
    expect(record!.values).toMatchObject({ amount: 178.23, merchant: '枫叶小店' });
    // 只记下点过的那个字段：标签和位置，不记值。
    const picks = JSON.parse((await repo.getMeta(PICK_STORE_KEY))!);
    expect(Object.keys(picks.purchases)).toEqual(['amount']);
    expect(JSON.stringify(picks)).not.toContain('178');
    // 点过的标签学到这个字段下面（D-445）。
    expect(picks.purchases.amount.labels[0].label).toBe('total');
  });

  it('收据模版的分类（D-405）：票面上看得出来就在分类下面给候选，没有自动选；点了才选中，看不出来就没有', async () => {
    const { files, vision, repo } = await render();
    vision.layers.push(layer(['大众药房', 'Date 2026-10-20', '感冒灵 12.00', 'Total 12.00']));
    await shareInto(files, [{ name: 'receipt.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('category')).toEqual(['把 药妆 填进「分类」']));
    // 没有自动选：六个选项都没选中。
    const optionOn = (id: string) =>
      (screen.getByTestId(`editor-category-${id}`).props as { style?: unknown }).style;
    const before = optionOn('pharmacy');
    await fireEvent.press(screen.getByTestId('editor-category-suggestion-0'));
    expect(optionOn('pharmacy')).not.toEqual(before);
    expect(
      screen.getByTestId('editor-category-suggestion-0').props.accessibilityState.selected,
    ).toBe(true);
    await save();
    const [record] = await repo.listRecords('purchases');
    expect(record!.values.category).toBe('pharmacy');
    // 分类的候选不是文字里的某个位置：不记点选。
    expect(await repo.getMeta(PICK_STORE_KEY)).toBeNull();
  });

  it('收据模版的分类：票面上看不出是哪一类就不给候选，不报错（没装本机模型）', async () => {
    const { files, vision } = await render();
    vision.layers.push(layer(RECEIPT));
    await shareInto(files, [{ name: 'receipt.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(chipTexts('category')).toEqual([]);
    expect(screen.getByTestId('editor-category-dining')).toBeTruthy();
  });

  it('有数据：上次点的标签，下次同样的单据排第一', async () => {
    const { files, vision } = await render();
    const shipped = ['Order date 2026-09-03', 'Ship date 2026-09-08', 'Total 5.00'];
    vision.layers.push(layer(shipped));
    await shareInto(files, [{ name: 'a.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('date')).toHaveLength(2));
    const second = chipTexts('date')[1]!;
    const learned = second.includes('9月8日') || second.includes('09-08') ? 'ship' : 'order';
    await fireEvent.press(screen.getByTestId('editor-date-suggestion-1'));
    await save();

    vision.layers.push(layer(['Order date 2026-10-01', 'Ship date 2026-10-06', 'Total 7.00']));
    await act(() => useIncoming.getState().clear());
    await shareInto(files, [{ name: 'b.jpg', mime: 'image/jpeg' }], 'table-purchases');
    await waitFor(() => expect(chipTexts('date')).toHaveLength(2));
    expect(chipTexts('date')[0]).toMatch(learned === 'ship' ? /10月6日|10-06/ : /10月1日|10-01/);
  });

  it('法语：提示跟着语言走', async () => {
    const fr = await render([], 'fr');
    await shareInto(fr.files, [{ name: 'recu.jpg', mime: 'image/jpeg' }]);
    expect(await screen.findByTestId('suggestions-notice')).toHaveTextContent(
      /téléchargement unique/,
    );
  });

  it('英语：候选的无障碍说明跟着语言走', async () => {
    const en = await render(['ppocr'], 'en');
    en.vision.layers.push(layer(RECEIPT));
    await shareInto(en.files, [{ name: 'receipt.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(chipTexts('amount')[0]).toMatch(/^Fill “Amount” with .*178\.23/);
  });

  it('边界：读不出文字时没有候选，也不报错', async () => {
    const { files, vision } = await render();
    vision.layers.push({ width: 100, height: 100, lines: [] });
    await shareInto(files, [{ name: 'blank.png', mime: 'image/png' }]);
    await waitFor(() => expect(recognized(vision)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('suggestions-working')).toBeNull());
    expect(screen.queryAllByTestId(/-suggestion-\d$/)).toHaveLength(0);
    expect(screen.getByTestId('editor-save')).toBeTruthy();
  });

  it('边界：照片和 PDF 混着时都读（PDF 用文字层，扫描的 PDF 画成图再识别），超过 3 个只读前 3 个', async () => {
    const { files, vision, pdf } = await render();
    pdf.textPages = [layer(['Facture', 'Montant TTC 42,50 €'])];
    vision.layers.push(layer(['Date 2026-10-20']), layer(['x']), layer(['y']));
    await shareInto(files, [
      { name: 'photo.jpg', mime: 'image/jpeg' },
      { name: 'invoice.pdf', mime: 'application/pdf' },
      { name: 'photo2.jpg', mime: 'image/jpeg' },
      { name: 'photo3.jpg', mime: 'image/jpeg' },
      { name: 'photo4.jpg', mime: 'image/jpeg' },
    ]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(chipTexts('amount')[0]).toMatch(/42\.50/);
    expect(chipTexts('date')[0]).toMatch(/10月20日|2026/);
    // 前 3 个：两张照片识别，PDF 读文字层（有文字，不画图）。
    expect(recognized(vision)).toHaveLength(2);
    expect(pdf.calls).toEqual(['lines']);
    expect(runsLeft(files)).toEqual([]);
  });

  it('边界：扫描的 PDF 没有文字层，画成图再识别', async () => {
    const { files, vision, pdf } = await render();
    pdf.textPages = [{ width: 600, height: 800, lines: [] }];
    vision.layers.push(layer(['合计 ¥88.00']));
    await shareInto(files, [{ name: 'scan.pdf', mime: 'application/pdf' }]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    expect(pdf.calls).toEqual(['lines', 'render']);
    expect(recognized(vision)[0]!.uri).toMatch(/^runs\/prefill-.+\/pdf-1-1\.jpg$/);
    expect(runsLeft(files)).toEqual([]);
  });

  it('编辑已有的记录不给候选', async () => {
    const { files, vision, repo } = await render();
    vision.layers.push(layer(RECEIPT));
    await shareInto(files, [{ name: 'receipt.jpg', mime: 'image/jpeg' }]);
    await waitFor(() => expect(chipTexts('amount').length).toBeGreaterThan(0));
    await save();
    const [record] = await repo.listRecords('purchases');
    const before = recognized(vision).length;
    await act(() => router.push(`/record/purchases?recordId=${record!.id}`));
    expect(await screen.findByTestId('editor-delete')).toBeTruthy();
    expect(screen.queryAllByTestId(/-suggestion-\d$/)).toHaveLength(0);
    expect(screen.queryByTestId('suggestions-notice')).toBeNull();
    expect(recognized(vision)).toHaveLength(before);
  });

  it('没读完就离开：读取结束（不悬着），中间文件删掉，不再显示', async () => {
    const { files, pdf } = await render();
    let release!: () => void;
    pdf.hold = new Promise((r) => (release = r));
    pdf.textPages = [layer(['Total 9.00'])];
    await shareInto(files, [{ name: 'doc.pdf', mime: 'application/pdf' }]);
    await waitFor(() => expect(pdf.calls).toEqual(['lines']));
    expect(screen.getByTestId('suggestions-working')).toBeTruthy();
    await act(() => router.back());
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(runsLeft(files)).toEqual([]));
    expect(screen.queryAllByTestId(/-suggestion-\d$/)).toHaveLength(0);
  });
});

// 扫描按钮（D-397）：快捷操作把文件交给表单，读取是表单自己的事，步骤里没有识别。
describe('快捷操作「记一笔」的表单（D-397）', () => {
  const receipts = (extra: Partial<Collection> = {}): Collection => ({
    id: 'receipts',
    name: '小票',
    fields: [
      { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
      { id: 'photo', name: '附件', type: 'file' },
    ],
    ...extra,
  });
  const scanButton: Workflow = {
    kind: 'quickAction',
    id: 'scan-receipt',
    name: '扫小票',
    steps: [
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
      { id: 'log', action: 'out.addRecord', params: { collectionId: 'receipts' } },
    ],
  };
  const seed = (table: Collection) => (locale: Locale, registry: Registry) => {
    const config = createStarterWorkspace(locale, registry);
    config.data.tables.push(table);
    config.tools.push(scanButton);
    return config;
  };
  const entryChips = () => screen.queryAllByTestId(/^entry-amount-suggestion-\d$/);

  it('文件进了表单就自动识别、给候选，点了才填', async () => {
    const { files, vision } = await render(undefined, 'zh', seed(receipts()));
    vision.layers.push(layer(RECEIPT));
    files.nextPhotos = [files.offerImage('receipt.jpg', 600, 240)];
    await act(() => router.push('/run/scan-receipt'));
    expect(await screen.findByTestId('entry-photo-file-0')).toBeTruthy();
    await waitFor(() => expect(entryChips().length).toBeGreaterThan(0));
    expect(screen.getByTestId('entry-amount').props.value ?? '').toBe('');
    await fireEvent.press(screen.getByTestId('entry-amount-suggestion-0'));
    expect(screen.getByTestId('entry-amount').props.value).toBe('178.23');
    expect(recognized(vision)).toHaveLength(1);
  });

  it('没装文字识别：和别的表单一样只显示一行提示，不下载', async () => {
    const { files, vision } = await render([], 'zh', seed(receipts()));
    files.nextPhotos = [files.offerImage('receipt.jpg', 600, 240)];
    await act(() => router.push('/run/scan-receipt'));
    expect(await screen.findByTestId('suggestions-notice')).toBeTruthy();
    expect(recognized(vision)).toHaveLength(0);
  });

  it('表关掉了「自动读取附件」：不识别、没有候选，也没有下载提示', async () => {
    const { files, vision } = await render(
      undefined,
      'zh',
      seed(receipts({ readAttachments: false })),
    );
    vision.layers.push(layer(RECEIPT));
    files.nextPhotos = [files.offerImage('receipt.jpg', 600, 240)];
    await act(() => router.push('/run/scan-receipt'));
    expect(await screen.findByTestId('entry-photo-file-0')).toBeTruthy();
    await act(async () => undefined);
    expect(recognized(vision)).toHaveLength(0);
    expect(entryChips()).toHaveLength(0);
    expect(screen.queryByTestId('suggestions-notice')).toBeNull();
  });

  it('设置 → 数据：有附件字段的表才有开关，默认打开，关了就不读', async () => {
    const plain: Collection = {
      id: 'plain',
      name: '备忘',
      fields: [{ id: 'note', name: '内容', type: 'note' }],
    };
    const both = (locale: Locale, registry: Registry) => {
      const config = seed(receipts())(locale, registry);
      config.data.tables.push(plain);
      return config;
    };
    const { files, vision } = await render(undefined, 'zh', both);
    await act(() => router.push('/data'));
    const toggle = await screen.findByTestId('read-attachments-receipts');
    expect(toggle.props.value).toBe(true);
    expect(screen.queryByTestId('read-attachments-plain')).toBeNull();
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(screen.getByTestId('read-attachments-receipts').props.value).toBe(false),
    );
    vision.layers.push(layer(RECEIPT));
    files.nextPhotos = [files.offerImage('receipt.jpg', 600, 240)];
    await act(() => router.push('/run/scan-receipt'));
    expect(await screen.findByTestId('entry-photo-file-0')).toBeTruthy();
    await act(async () => undefined);
    expect(recognized(vision)).toHaveLength(0);
  });

  it('设置 → 数据：选「附件是」写到表上（D-421），有附件字段的表才有，默认是其他', async () => {
    const plain: Collection = {
      id: 'plain',
      name: '备忘',
      fields: [{ id: 'note', name: '内容', type: 'note' }],
    };
    const both = (locale: Locale, registry: Registry) => {
      const config = seed(receipts())(locale, registry);
      config.data.tables.push(plain);
      return config;
    };
    await render(undefined, 'zh', both);
    await act(() => router.push('/data'));
    const selected = (id: string) => screen.getByTestId(id).props.accessibilityState.selected;
    await screen.findByTestId('prefill-rules-receipts-general');
    expect(selected('prefill-rules-receipts-general')).toBe(true);
    expect(screen.queryByTestId('prefill-rules-plain-general')).toBeNull();
    await fireEvent.press(screen.getByTestId('prefill-rules-receipts-card'));
    await waitFor(() => expect(selected('prefill-rules-receipts-card')).toBe(true));
    expect(selected('prefill-rules-receipts-general')).toBe(false);
    await fireEvent.press(screen.getByTestId('prefill-rules-receipts-general'));
    await waitFor(() => expect(selected('prefill-rules-receipts-general')).toBe(true));
  });
});

// 名片表的表单还找二维码（D-423）：vCard、MeCard 的值排第一，网址只给网站；别的不管，文字照常读；点了才填。
describe('名片表的二维码', () => {
  const cards: Collection = {
    id: 'people',
    name: '联系人',
    prefillRules: 'card',
    fields: [
      { id: 'name', name: '姓名', type: 'text' },
      { id: 'tel', name: '电话', type: 'text', format: 'phone' },
      { id: 'site', name: '网站', type: 'text', format: 'url' },
      { id: 'attachments', name: '附件', type: 'file' },
    ],
  };
  const seed = (table: Collection) => (locale: Locale, registry: Registry) => {
    const config = createStarterWorkspace(locale, registry);
    config.data.tables.push(table);
    return config;
  };
  const qr = (text: string) => qrToRgba(qrMatrix(text), { scale: 4 });
  const VCARD = 'BEGIN:VCARD\nFN:Maria Garcia\nTEL:+33 6 12 34 56 78\nEND:VCARD';

  /** 表单收到一张照片，照片的像素是 pixels（不给时是白图）。 */
  async function scan(
    pixels: ReturnType<typeof qr> | null,
    rows: string[] = [],
    table: Collection = cards,
    installed: string[] = ['ppocr', 'pdfview'],
  ) {
    const app = await render(installed, 'zh', seed(table));
    app.vision.layers.push(layer(rows));
    const read = jest.spyOn(app.files, 'imagePixels');
    if (pixels) read.mockResolvedValue(pixels);
    await shareInto(app.files, [{ name: 'card.jpg', mime: 'image/jpeg' }], `table-${table.id}`);
    return { ...app, read };
  }

  it('只有二维码、文字一个都没读出来：也有候选，没有自动填；点了才填', async () => {
    const { repo } = await scan(qr(VCARD));
    await waitFor(() => expect(chipTexts('name').length).toBeGreaterThan(0));
    expect(chipTexts('name')[0]).toContain('Maria Garcia');
    expect(chipTexts('tel')[0]).toContain('+33 6 12 34 56 78');
    expect(screen.getByTestId('editor-name').props.value ?? '').toBe('');
    await fireEvent.press(screen.getByTestId('editor-name-suggestion-0'));
    expect(screen.getByTestId('editor-name').props.value).toBe('Maria Garcia');
    await save();
    const [record] = await repo.listRecords('people');
    expect(record!.values.name).toBe('Maria Garcia');
    expect(record!.values.tel).toBeUndefined();
    // 二维码的值不记位置（没有版面可记）。
    expect(await repo.getMeta(PICK_STORE_KEY)).toBeNull();
  });

  it('二维码的值排在文字读出的值前面', async () => {
    await scan(qr(VCARD), ['Tel +33 1 11 11 11 11']);
    await waitFor(() => expect(chipTexts('tel').length).toBeGreaterThan(1));
    expect(chipTexts('tel')[0]).toContain('+33 6 12 34 56 78');
    expect(chipTexts('tel')[1]).toContain('+33 1 11 11 11 11');
  });

  it('网址只给网站', async () => {
    await scan(qr('https://example.com/me'));
    await waitFor(() => expect(chipTexts('site').length).toBeGreaterThan(0));
    expect(chipTexts('site')[0]).toContain('https://example.com/me');
    expect(chipTexts('name')).toEqual([]);
    expect(chipTexts('tel')).toEqual([]);
  });

  it('别的二维码不管，名片照常按文字读', async () => {
    await scan(qr('WIFI:T:WPA;S:cafe;P:12345678;;'), ['Tel +33 1 11 11 11 11']);
    await waitFor(() => expect(chipTexts('tel').length).toBeGreaterThan(0));
    expect(chipTexts('tel')[0]).toContain('+33 1 11 11 11 11');
    expect(chipTexts('name').join()).not.toContain('cafe');
  });

  it('解不出来（读像素失败、没有码）都不说话，文字照常', async () => {
    const app = await render(['ppocr', 'pdfview'], 'zh', seed(cards));
    app.vision.layers.push(layer(['Tel +33 1 11 11 11 11']));
    jest.spyOn(app.files, 'imagePixels').mockRejectedValue(new Error('broken'));
    await shareInto(app.files, [{ name: 'card.jpg', mime: 'image/jpeg' }], 'table-people');
    await waitFor(() => expect(chipTexts('tel').length).toBeGreaterThan(0));
    expect(chipTexts('tel')[0]).toContain('+33 1 11 11 11 11');
  });

  it('文字识别没装时二维码也能用，不下载', async () => {
    const { fs } = await scan(qr(VCARD), [], cards, []);
    await waitFor(() => expect(chipTexts('name').length).toBeGreaterThan(0));
    expect(chipTexts('name')[0]).toContain('Maria Garcia');
    expect(fs.downloads).toEqual([]);
  });

  it('照片和 PDF 混着：只读照片的二维码', async () => {
    const app = await render(['ppocr', 'pdfview'], 'zh', seed(cards));
    app.vision.layers.push(layer([]));
    const read = jest.spyOn(app.files, 'imagePixels').mockResolvedValue(qr(VCARD));
    await shareInto(
      app.files,
      [
        { name: 'a.pdf', mime: 'application/pdf' },
        { name: 'card.jpg', mime: 'image/jpeg' },
      ],
      'table-people',
    );
    await waitFor(() => expect(chipTexts('name').length).toBeGreaterThan(0));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('不是名片表：不找二维码', async () => {
    const { prefillRules: _unused, ...plain } = cards;
    const { read, vision } = await scan(qr(VCARD), ['Tel +33 1 11 11 11 11'], plain as Collection);
    await waitFor(() => expect(recognized(vision).length).toBeGreaterThan(0));
    await act(async () => {});
    expect(read).not.toHaveBeenCalled();
    expect(chipTexts('name').join()).not.toContain('Maria');
  });
});
