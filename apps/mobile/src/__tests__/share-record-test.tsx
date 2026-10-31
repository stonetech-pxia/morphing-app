import {
  applyOps,
  attachmentIds,
  BUILTIN_TOOLS,
  createRegistry,
  createDefaultWorkspace,
  MAX_ATTACHMENTS,
  templateOps,
  type Locale,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { recordChoices } from '../share/save-as-record';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 收件页面「存成记录」（D-392）：选一张有附件字段的表或一个预设表，打开新记录表单，收到的文件已经在附件里。
// 三种状态：新用户（没有表）、有数据（已经有带附件的表和不带附件的表）、边界（两个文件、超过 20 个、没保存就返回）。

afterEach(() => {
  useIncoming.getState().clear();
  useGuide.setState({ stage: null, repo: null, introOpen: false });
});

/** 有附件字段的「收据」表和没有附件字段的「账目」表（记账模版）。 */
const RECEIPTS: Op = {
  op: 'addData',
  table: {
    id: 'receipts',
    name: '收据',
    fields: [
      { id: 'title', name: '标题', type: 'text' },
      { id: 'photo', name: '照片', type: 'file' },
    ],
  },
};

function seeded(locale: Locale, registry: Registry): WorkspaceConfig {
  const blank = createDefaultWorkspace(locale);
  const budget = applyOps(blank, templateOps('budget', blank, locale), { registry, locale });
  if (!budget.ok) throw new Error(budget.error);
  const r = applyOps(budget.config, [RECEIPTS], { registry, locale });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

/** 引导已经走完（否则欢迎页会盖在收件页面上面）。 */
async function render(seed?: (locale: Locale, registry: Registry) => WorkspaceConfig) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  return renderToolsApp(repo, new FakeFiles(), seed ? { seed } : {});
}

async function openShare(files: FakeFiles, names: string[], mime = 'image/jpeg') {
  const picked = names.map((n) => files.offer(n, TINY_JPEG, mime));
  await act(async () => useIncoming.getState().receive(picked, [], 'picker'));
  await act(() => router.push('/share'));
  return picked;
}

/** 保存，等记录页关掉、回到收件页面（否则 router.back 会落到下一个测试里）。 */
async function save() {
  await fireEvent.press(screen.getByTestId('editor-save'));
  await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
  expect(await screen.findByTestId('share-screen')).toBeTruthy();
}

async function choose(id: string) {
  await fireEvent.press(await screen.findByTestId('share-record-choose'));
  await fireEvent.press(await screen.findByTestId(`share-record-${id}`));
}

const listIds = () =>
  within(screen.getByTestId('share-record-list'))
    .queryAllByTestId(/^share-record-(table|preset)-/)
    .map((e) => e.props.testID as string);

describe('recordChoices', () => {
  it('lists every table with an attachment field, then the presets, blank last', () => {
    expect(recordChoices(createDefaultWorkspace('zh'), 'zh').map((c) => c.name)).toEqual([
      '购物凭证',
      '账单',
      '合同',
      '报销',
      '我的记录',
    ]);
    const config = seeded('fr', createRegistry(BUILTIN_TOOLS));
    expect(recordChoices(config, 'fr')).toEqual([
      { kind: 'table', tableId: 'receipts', name: '收据' },
      { kind: 'preset', preset: 'purchase', name: 'Justificatifs d’achat' },
      { kind: 'preset', preset: 'bill', name: 'Factures' },
      { kind: 'preset', preset: 'contract', name: 'Contrats' },
      { kind: 'preset', preset: 'reimbursement', name: 'Remboursements' },
      { kind: 'preset', preset: 'blank', name: 'Mes entrées' },
    ]);
  });
});

describe('收件页面 → 存成记录', () => {
  it('新用户：列表里只有预设表；选「购物凭证」建表、页面和入口，表单里已经放好这张照片，保存后存成一条记录', async () => {
    const { files, repo, store } = await render();
    const [photo] = await openShare(files, ['IMG_1.jpg']);
    // 放在「放到桌上」下面、快捷操作推荐上面；点之前不展开，也不做任何修改。
    const rows = screen.queryAllByTestId(/^(share-desk|share-record|share-workflow-.+)$/);
    expect(rows.slice(0, 2).map((r) => r.props.testID)).toEqual(['share-desk', 'share-record']);
    expect(screen.queryByTestId('share-record-list')).toBeNull();
    const before = store.getState().head!.id;

    await fireEvent.press(screen.getByTestId('share-record-choose'));
    expect(listIds()).toEqual([
      'share-record-preset-purchase',
      'share-record-preset-bill',
      'share-record-preset-contract',
      'share-record-preset-reimbursement',
      'share-record-preset-blank',
    ]);
    expect(screen.queryByText('你的表')).toBeNull();
    expect(store.getState().head!.id).toBe(before);

    await fireEvent.press(screen.getByTestId('share-record-preset-purchase'));
    expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
    const config = store.getState().config!;
    expect(config.data.tables.map((c) => c.id)).toEqual(['purchases']);
    expect(config.containers.pages.some((p) => p.id === 'purchases')).toBe(true);
    // 用户的一次修改，能撤销（和别的界面按钮一样）。
    expect(store.getState().head!.source).toBe('user');
    // 原件（选择器的副本）没有被移动，复制了一份成用户文件。
    const [asset] = await repo.listAssets();
    expect(files.disk.get(asset!.path)).toEqual(TINY_JPEG);

    await fireEvent.changeText(screen.getByTestId('editor-merchant'), '超市');
    await save();
    expect(await repo.listRecords('purchases')).toHaveLength(1);
    const [record] = await repo.listRecords('purchases');
    expect(record!.values.merchant).toBe('超市');
    expect(attachmentIds(record!.values.attachments)).toEqual([asset!.id]);
    // 回到收件页面，收件的文件还在；刚建的表以后列在「你的表」最前面，再选它不再新建、也不再问入口。
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(files.disk.has(photo!.uri)).toBe(true);
    expect(recordChoices(store.getState().config!, 'zh')[0]).toEqual({
      kind: 'table',
      tableId: 'purchases',
      name: '购物凭证',
    });
  });

  it('建过的预设不再列在「新建一张表」里（只在「你的表」里），「空白」一直在；没填标题的记录显示表名和日子', async () => {
    const { files } = await render();
    await openShare(files, ['IMG_1.jpg']);
    await choose('preset-purchase');
    expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
    // 商家（标题）不填就保存。
    await save();
    await fireEvent.press(screen.getByTestId('share-record-choose'));
    expect(listIds()).toEqual([
      'share-record-table-purchases',
      'share-record-preset-bill',
      'share-record-preset-contract',
      'share-record-preset-reimbursement',
      'share-record-preset-blank',
    ]);
    await act(() => router.push('/page/purchases'));
    expect(await screen.findByText(/^购物凭证 · \d{1,2}月\d{1,2}日$/)).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('有数据：只列出有附件字段的表，在预设表前面；选它不改配置，文件放进它的附件字段', async () => {
    const { files, repo, store } = await render(seeded);
    await openShare(files, ['IMG_1.jpg']);
    await fireEvent.press(await screen.findByTestId('share-record-choose'));
    expect(listIds()).toEqual([
      'share-record-table-receipts',
      'share-record-preset-purchase',
      'share-record-preset-bill',
      'share-record-preset-contract',
      'share-record-preset-reimbursement',
      'share-record-preset-blank',
    ]);
    expect(screen.getByText('你的表')).toBeTruthy();
    const head = store.getState().head!.id;
    await fireEvent.press(screen.getByTestId('share-record-table-receipts'));
    expect(await screen.findByTestId('editor-photo-file-0')).toBeTruthy();
    expect(store.getState().head!.id).toBe(head);
    await save();
    expect(await repo.listRecords('receipts')).toHaveLength(1);
    const [asset] = await repo.listAssets();
    expect((await repo.listRecords('receipts'))[0]!.values.photo).toEqual([asset!.id]);
  });

  it('两个文件存成一条记录，两个附件按顺序', async () => {
    const { files, repo } = await render();
    await openShare(files, ['A.jpg', 'B.jpg']);
    await choose('preset-blank');
    expect(await screen.findByTestId('editor-attachments-file-1')).toBeTruthy();
    await save();
    expect(await repo.listRecords('file-entries')).toHaveLength(1);
    const assets = await repo.listAssets();
    const byName = Object.fromEntries(assets.map((a) => [a.name, a.id]));
    expect((await repo.listRecords('file-entries'))[0]!.values.attachments).toEqual([
      byName['A.jpg'],
      byName['B.jpg'],
    ]);
  });

  it('超过 20 个：先说明只放前 20 个，表单里正好 20 个', async () => {
    const { files, repo } = await render();
    // 照片一次最多收 10 张，PDF 能收 50 个。
    const names = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => `P${i}.pdf`);
    await openShare(files, names, 'application/pdf');
    await fireEvent.press(await screen.findByTestId('share-record-choose'));
    expect(screen.getByTestId('share-record-too-many').props.children).toBe(
      '一条记录最多放 20 个文件，只放前 20 个。',
    );
    await fireEvent.press(screen.getByTestId('share-record-preset-blank'));
    expect(
      await screen.findByTestId(`editor-attachments-file-${MAX_ATTACHMENTS - 1}`),
    ).toBeTruthy();
    expect(screen.queryByTestId(`editor-attachments-file-${MAX_ATTACHMENTS}`)).toBeNull();
    expect(await repo.listAssets()).toHaveLength(MAX_ATTACHMENTS);
  });

  it('没保存就返回：不存记录，复制的文件删掉，建好的表和页面留着，收件的文件还在', async () => {
    const { files, repo, store } = await render();
    const [photo] = await openShare(files, ['IMG_1.jpg']);
    await choose('preset-bill');
    expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
    expect(await repo.listAssets()).toHaveLength(1);
    await act(() => router.back());
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    // 记录页关掉时删副本（异步）：等它做完再读，不在 waitFor 里读（会和别的 act 重叠）。
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(await repo.listAssets()).toEqual([]);
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/'))).toEqual([]);
    expect(await repo.listRecords('bills')).toEqual([]);
    expect(store.getState().config!.data.tables.map((c) => c.id)).toEqual(['bills']);
    expect(files.disk.has(photo!.uri)).toBe(true);
  });

  it('新用户还没看完介绍：建表让外壳重新挂载，也不再推一次欢迎页；关掉表单回到收件页面', async () => {
    // 真机上（2026-10-31）：首页推了欢迎页，收件页面盖在上面；建表后外壳按新版本重新挂载又推了一次，
    // 关掉表单落到第二个欢迎页上。
    const repo = new MemoryWorkspaceRepo();
    await act(() => useGuide.getState().load(repo));
    expect(useGuide.getState().stage).toBe('intro');
    const { files } = await renderToolsApp(repo, new FakeFiles());
    expect(await screen.findByTestId('welcome')).toBeTruthy();
    await openShare(files, ['IMG_1.jpg']);
    await choose('preset-purchase');
    expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
    await act(() => router.back());
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(screen.queryByTestId('welcome')).toBeNull();
    // 再关掉收件页面，才是原来那个欢迎页。
    await act(() => router.back());
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });
});
