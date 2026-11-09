import {
  applyOps,
  createDefaultWorkspace,
  packById,
  type Locale,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
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

// 导入文件后新建表单（D-444）：文件里的字段名能点、规则给预设排序、本机模型只显示一行推荐。
// 三种状态：没有模型（只有规则）、有模型（推荐）、边界（读不出文字、推荐的表已经有了、点到的是值）。

const mockAnswer = { current: 'insurance' };
const mockGenerate = jest.fn(async () => mockAnswer.current);
const mockRelease = jest.fn(async () => undefined);
jest.mock('../runtime/local-model', () => ({
  deviceFitsLocalModel: () => true,
  openLocalModel: () => async () => ({ generate: mockGenerate, release: mockRelease }),
}));

afterEach(() => {
  useIncoming.getState().clear();
  useGuide.setState({ stage: null, repo: null, introOpen: false });
  mockGenerate.mockClear();
  mockRelease.mockClear();
  mockAnswer.current = 'insurance';
});

const POLICY: RecognizedLayer = {
  width: 600,
  height: 400,
  lines: [
    { text: 'Policy schedule', x: 20, y: 20, width: 150, height: 20 },
    { text: 'Insurer: Bluecrest Mutual', x: 20, y: 80, width: 250, height: 20 },
    { text: 'Policy number: PL-22817', x: 20, y: 130, width: 230, height: 20 },
    { text: 'Date of', x: 20, y: 180, width: 70, height: 20 },
    { text: 'expiry', x: 20, y: 202, width: 60, height: 20 },
    { text: '02/03/2026', x: 300, y: 202, width: 100, height: 20 },
    { text: 'PL-22817', x: 20, y: 260, width: 80, height: 20 },
  ],
};

const NO_PAGES: string[] = [];

async function setup(
  installed: string[],
  seed?: (locale: Locale, registry: Registry) => WorkspaceConfig,
  layers: RecognizedLayer[] = [POLICY],
) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  const files = new FakeFiles();
  const vision = new FakeVision(files);
  vision.ocrModel = { pack: 'ppocr', languages: ['zh', 'ja', 'en', 'fr', 'de', 'es', 'pt', 'it'] };
  vision.layers = layers;
  files.vision = vision;
  const fs = new MemoryPackFs();
  const store = new PackStore(fs, sha256);
  for (const id of installed)
    await fs.writeText(`${id}/${packById(id)!.version}/ready.json`, '{"bytes":1,"installedAt":1}');
  const bridge = {
    subscribe: () => () => undefined,
    activePages: () => NO_PAGES,
    close: () => undefined,
  } as unknown as PackBridge;
  const app = await renderToolsApp(repo, files, {
    packs: { store, bridge } as Packs,
    locale: 'en',
    ...(seed ? { seed } : {}),
  });
  const picked = files.offer('policy.jpg', TINY_JPEG, 'image/jpeg');
  await act(async () => useIncoming.getState().receive([picked], [], 'picker'));
  await act(() => router.push('/share'));
  await fireEvent.press(await screen.findByTestId(/^(preview-record|share-record-choose)$/));
  await fireEvent.press(await screen.findByTestId('share-record-new'));
  return { ...app, vision };
}

describe('新建表单页', () => {
  it('没有模型：文件里的字段名能点，换行的合成一个；点了加字段，候选点了才填', async () => {
    await setup(['ppocr']);
    expect(await screen.findByTestId('new-table-in-file')).toBeTruthy();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-table-working')).toBeNull();
    expect(screen.getByText('+ Insurer')).toBeTruthy();
    expect(screen.getByText('+ Policy number')).toBeTruthy();
    expect(screen.getByText('+ Date of expiry')).toBeTruthy();
    expect(screen.queryByText('+ Date of')).toBeNull();
    await fireEvent.press(screen.getByText('+ Policy number'));
    expect(await screen.findByTestId('draft-field-3')).toBeTruthy();
    // 加过的不再列出。
    expect(screen.queryByText('+ Policy number')).toBeNull();
    // 不自动填（D-394）。
    expect(screen.getByTestId('draft-field-3').props.value).toBe('');
  });

  it('有模型：只显示一行推荐，点了才换；AI 请求为零（底线 1、2）', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { store } = await setup(['ppocr', 'prefill-model']);
    expect(await screen.findByTestId('new-table-recommend')).toBeTruthy();
    expect(screen.getByText('This looks like “Insurance policies”')).toBeTruthy();
    expect(mockRelease).toHaveBeenCalled();
    // 还没换。
    expect(screen.getByTestId('new-table-name').props.value).toBe('My entries');
    await fireEvent.press(screen.getByTestId('new-table-use'));
    expect(screen.getByTestId('new-table-name').props.value).toBe('Insurance policies');
    expect(screen.queryByTestId('new-table-recommend')).toBeNull();
    expect(store.getState().config!.data.tables).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // R16：推荐是读出的文字的派生值；本机模型还在想时用户自己选了类型，答案回来也不能把推荐弹回来。
  it('模型还在想时用户自己选了类型：答案回来后推荐不再出现', async () => {
    let answer!: (text: string) => void;
    mockGenerate.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    await setup(['ppocr', 'prefill-model']);
    expect(await screen.findByTestId('new-table-working')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-table-change-type'));
    await fireEvent.press(screen.getByTestId('new-table-type-blank'));
    await act(async () => answer('insurance'));
    await waitFor(() => expect(screen.queryByTestId('new-table-working')).toBeNull());
    expect(screen.queryByTestId('new-table-recommend')).toBeNull();
    expect(screen.getByTestId('new-table-name').props.value).toBe('My entries');
  });

  // 2026-11-09 用户测试：规则已经说「This looks like “Receipts”」，点「Use this」后
  // 又冒出「下载本机模型来判断这是什么文件」。类型定了，这句就不再出现。
  describe('模型没下载、可以下载', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_MORPH_PACKS_URL = 'https://packs.test';
    });
    afterEach(() => {
      delete process.env.EXPO_PUBLIC_MORPH_PACKS_URL;
    });
    const receipt = () => [
      {
        width: 600,
        height: 300,
        lines: ['Maple Corner', 'Subtotal 165.03', 'Tax 13.20', 'Total 178.23'].map((text, i) => ({
          text,
          x: 20,
          y: 20 + i * 40,
          width: 200,
          height: 20,
        })),
      },
    ];

    it('没有推荐时提议下载模型', async () => {
      await setup(['ppocr']);
      expect(await screen.findByTestId('new-table-model-need')).toBeTruthy();
    });

    it('点了规则推荐的类型：不再提议下载模型', async () => {
      await setup(['ppocr'], undefined, receipt());
      expect(await screen.findByTestId('new-table-recommend')).toBeTruthy();
      expect(screen.queryByTestId('new-table-model-need')).toBeNull();
      await fireEvent.press(screen.getByTestId('new-table-use'));
      expect(screen.queryByTestId('new-table-recommend')).toBeNull();
      expect(screen.queryByTestId('new-table-model-need')).toBeNull();
    });

    it('自己选了类型：不再提议下载模型', async () => {
      await setup(['ppocr']);
      expect(await screen.findByTestId('new-table-model-need')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('new-table-change-type'));
      await fireEvent.press(screen.getByTestId('new-table-type-insurance'));
      expect(screen.queryByTestId('new-table-model-need')).toBeNull();
    });
  });

  it('文件里的字段名多：先显示前四个，「展开」看全部，「收起」回去', async () => {
    const labels = ['Insurer', 'Policy number', 'Holder', 'Premium', 'Agent', 'Broker'];
    const lines = labels.map((name, i) => ({
      text: `${name}: value ${i}`,
      x: 20,
      y: 20 + i * 50,
      width: 250,
      height: 20,
    }));
    await setup(['ppocr'], undefined, [{ width: 600, height: 400, lines }]);
    expect(await screen.findByTestId('new-table-in-file')).toBeTruthy();
    expect(screen.queryAllByTestId(/^new-table-chip-\d+$/)).toHaveLength(4);
    expect(screen.getByTestId('new-table-in-file-toggle')).toHaveTextContent('Show all');
    await fireEvent.press(screen.getByTestId('new-table-in-file-toggle'));
    expect(screen.queryAllByTestId(/^new-table-chip-\d+$/)).toHaveLength(6);
    expect(screen.getByTestId('new-table-in-file-toggle')).toHaveTextContent('Show fewer');
    await fireEvent.press(screen.getByTestId('new-table-in-file-toggle'));
    expect(screen.queryAllByTestId(/^new-table-chip-\d+$/)).toHaveLength(4);
  });

  it('文件里的字段名不超过四个：没有展开链接', async () => {
    await setup(['ppocr']);
    expect(await screen.findByTestId('new-table-in-file')).toBeTruthy();
    expect(screen.queryByTestId('new-table-in-file-toggle')).toBeNull();
  });

  it('已经有带收据规则的表（样板「收据」）：有合计金额的文件推荐放进去，不建第二张（D-477）', async () => {
    const withReceipts = (locale: Locale, registry: Registry) => {
      const r = applyOps(
        createDefaultWorkspace(locale),
        [
          {
            op: 'addData',
            table: {
              id: 'receipts',
              name: 'Receipts sample',
              prefillRules: 'receipt',
              fields: [
                { id: 'merchant', name: 'Merchant', type: 'text' },
                { id: 'photo', name: 'Photo', type: 'file' },
              ],
            },
          },
        ],
        { registry, locale },
      );
      if (!r.ok) throw new Error(r.error);
      return r.config;
    };
    const lines = ['Maple Corner', 'Subtotal 165.03', 'Tax 13.20', 'Total 178.23'].map(
      (text, i) => ({
        text,
        x: 20,
        y: 20 + i * 40,
        width: 200,
        height: 20,
      }),
    );
    // 没有本机模型：规则认出是收据。
    await setup(['ppocr'], withReceipts, [{ width: 600, height: 300, lines }]);
    expect(await screen.findByTestId('new-table-use-existing')).toBeTruthy();
    expect(screen.getByText('You already have “Receipts sample”. Put it there')).toBeTruthy();
    expect(screen.queryByTestId('new-table-recommend')).toBeNull();
  });

  it('模型说都不是：没有推荐，字段名照样能点', async () => {
    mockAnswer.current = 'none';
    await setup(['ppocr', 'prefill-model']);
    expect(await screen.findByTestId('new-table-in-file')).toBeTruthy();
    await waitFor(() => expect(mockRelease).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('new-table-working')).toBeNull());
    expect(screen.queryByTestId('new-table-recommend')).toBeNull();
  });

  it('规则排序：没有金额的文件，收据排到「其他」', async () => {
    await setup(['ppocr']);
    await screen.findByTestId('new-table-in-file');
    await fireEvent.press(screen.getByTestId('new-table-change-type'));
    expect(screen.getByText('Others (no amount seen in this file)')).toBeTruthy();
    expect(screen.getByTestId('new-table-type-insurance')).toBeTruthy();
    expect(screen.getByTestId('new-table-type-purchase')).toBeTruthy();
    expect(screen.getByTestId('new-table-type-blank')).toBeTruthy();
  });

  it('看原文选：两行合成一个字段；点到值时要用户起名，不把值写进配置（底线 14）', async () => {
    await setup(['ppocr']);
    await screen.findByTestId('new-table-in-file');
    await fireEvent.press(screen.getByTestId('new-table-original'));
    await fireEvent.press(screen.getByText('Date of'));
    await fireEvent.press(screen.getByText('expiry'));
    await fireEvent.press(screen.getByTestId('new-table-row-add'));
    expect(await screen.findByTestId('draft-field-3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-table-edit'));
    expect(screen.getByTestId('new-table-field-name-field-3').props.defaultValue).toBe(
      'Date of expiry',
    );
    await fireEvent.press(screen.getByTestId('new-table-edit'));
    await fireEvent.press(screen.getByText('02/03/2026'));
    await fireEvent.press(screen.getByTestId('new-table-row-add'));
    expect(await screen.findByTestId('new-table-value-hint')).toBeTruthy();
    expect(screen.queryByTestId('draft-field-4')).toBeNull();
  });
});
