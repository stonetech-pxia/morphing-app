import { packById, PICK_STORE_KEY, type TextPage } from '@morph/core';
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
  } as unknown as PackBridge;
  return { packs: { store, bridge } as Packs, fs, pdf, install };
}

async function render(
  installed: string[] = ['ppocr', 'pdfview'],
  locale: 'zh' | 'en' | 'fr' = 'zh',
) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  vision.ocrModel = { pack: 'ppocr', languages: ['zh', 'ja', 'en', 'fr', 'de', 'es', 'pt', 'it'] };
  files.vision = vision;
  const p = await fakePacks(installed);
  const app = await renderToolsApp(repo, files, { packs: p.packs, locale });
  return { ...app, vision, ...p };
}

/** 收件页面收到这些文件（真实的扩展名和类型，选择器给的是 picker:// 的地址），存成「购物凭证」。 */
async function shareInto(
  files: FakeFiles,
  items: { name: string; mime: string }[],
  choice = 'preset-purchase',
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
