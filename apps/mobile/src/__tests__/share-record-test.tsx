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
/** 一份文件在预览页的「存记录」面板里选；多份文件在收件页面的「存成记录」里选（D-457）。 */
async function openChooser() {
  await fireEvent.press(await screen.findByTestId(/^(preview-record|share-record-choose)$/));
}

async function save() {
  await fireEvent.press(screen.getByTestId('editor-save'));
  await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
  expect(await screen.findByTestId('share-screen')).toBeTruthy();
}

async function choose(id: string) {
  await openChooser();
  await fireEvent.press(await screen.findByTestId(`share-record-${id}`));
}

const listIds = () =>
  within(screen.getByTestId('share-record-list'))
    .queryAllByTestId(/^share-record-(table-.+|new)$/)
    .map((e) => e.props.testID as string);

/** 新建表单页选一种预设。 */
async function pickType(preset: string) {
  await fireEvent.press(await screen.findByTestId('new-table-change-type'));
  await fireEvent.press(await screen.findByTestId(`new-table-type-${preset}`));
}

async function saveNew() {
  await fireEvent.press(screen.getByTestId('new-table-save'));
  await waitFor(() => expect(screen.queryByTestId('new-table-save')).toBeNull());
  expect(await screen.findByTestId('share-screen')).toBeTruthy();
}

describe('recordChoices', () => {
  it('只列有附件字段的表', () => {
    expect(recordChoices(createDefaultWorkspace('zh'))).toEqual([]);
    expect(recordChoices(seeded('fr', createRegistry(BUILTIN_TOOLS)))).toEqual([
      { kind: 'table', tableId: 'receipts', name: '收据' },
    ]);
  });
});

describe('recordChoices：像收据的文件，推荐带收据规则的表', () => {
  const config = () => {
    const base = seeded('zh', createRegistry(BUILTIN_TOOLS));
    const next = applyOps(
      base,
      [
        {
          op: 'addData',
          table: {
            id: 'bills',
            name: '收据（样板）',
            prefillRules: 'receipt',
            fields: [
              { id: 'merchant', name: '商家', type: 'text' },
              { id: 'photo', name: '照片', type: 'file' },
            ],
          },
        },
      ],
      { registry: createRegistry(BUILTIN_TOOLS), locale: 'zh' },
    );
    if (!next.ok) throw new Error(next.error);
    return next.config;
  };
  it('像收据：带收据规则的表排第一并标推荐，别的表照旧在后面', () => {
    expect(recordChoices(config(), true)).toEqual([
      { kind: 'table', tableId: 'bills', name: '收据（样板）', recommended: true },
      { kind: 'table', tableId: 'receipts', name: '收据' },
    ]);
  });
  it('不像收据，或者没有带收据规则的表：不推荐、顺序不变', () => {
    expect(recordChoices(config()).map((c) => c.tableId)).toEqual(['receipts', 'bills']);
    expect(recordChoices(seeded('zh', createRegistry(BUILTIN_TOOLS)), true)).toEqual([
      { kind: 'table', tableId: 'receipts', name: '收据' },
    ]);
  });
});

describe('预览页和收件页面 → 存成记录', () => {
  it('新用户：选「新建表单」，选预设，点「记下」才建表，只存一条记录', async () => {
    const { files, repo, store } = await render();
    const [photo] = await openShare(files, ['IMG_1.jpg']);
    // 一份文件是预览页，「存记录」是底下一排按钮里的一个，点了才弹出面板（D-457）。
    expect(await screen.findByTestId('preview-record')).toBeTruthy();
    expect(screen.queryByTestId('share-record-list')).toBeNull();
    const before = store.getState().head!.id;

    await openChooser();
    expect(listIds()).toEqual(['share-record-new']);
    expect(screen.queryByText('你的表')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-record-new'));
    expect(await screen.findByTestId('draft-attachments-file-0')).toBeTruthy();
    await pickType('purchase');
    // 还什么都没建。
    expect(store.getState().config!.data.tables).toEqual([]);
    expect(store.getState().head!.id).toBe(before);

    await fireEvent.changeText(screen.getByTestId('draft-merchant'), '超市');
    await saveNew();
    const config = store.getState().config!;
    expect(config.data.tables.map((c) => c.id)).toEqual(['receipts']);
    // 选购物凭证、没改字段：建整套「收据」样板（D-479），列表页、开销页和两个快捷操作都在。
    expect(config.containers.pages.map((p) => p.id)).toEqual(
      expect.arrayContaining(['receipts', 'spending']),
    );
    expect(config.data.tables[0]!.name).toBe('收据');
    expect(store.getState().head!.source).toBe('user');
    const [asset] = await repo.listAssets();
    expect(files.disk.get(asset!.path)).toEqual(TINY_JPEG);
    const [record] = await repo.listRecords('receipts');
    expect(record!.values.merchant).toBe('超市');
    expect(attachmentIds(record!.values.attachments)).toEqual([asset!.id]);
    expect(files.disk.has(photo!.uri)).toBe(true);
    expect(recordChoices(store.getState().config!)[0]).toEqual({
      kind: 'table',
      tableId: 'receipts',
      name: '收据',
    });
  });

  it('选了购物凭证又改了表名：不用整套收据，照预设自己的页面建（D-479）', async () => {
    const { files, store } = await render();
    await openShare(files, ['IMG_1.jpg']);
    await choose('new');
    expect(await screen.findByTestId('draft-attachments-file-0')).toBeTruthy();
    await pickType('purchase');
    expect(screen.getByTestId('new-table-name').props.value).toBe('收据');
    await fireEvent.changeText(screen.getByTestId('new-table-name'), '我的小票');
    await fireEvent.changeText(screen.getByTestId('draft-merchant'), '超市');
    await saveNew();
    const config = store.getState().config!;
    expect(config.data.tables.map((c) => c.id)).toEqual(['purchases']);
    expect(config.containers.pages.some((p) => p.id === 'spending')).toBe(false);
  });

  it('不选预设也能建：加字段、改名、去掉字段，表名自己写', async () => {
    const { files, repo, store } = await render();
    await openShare(files, ['IMG_1.jpg']);
    await choose('new');
    expect(await screen.findByTestId('draft-attachments-file-0')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('new-table-name'), '车险');
    await fireEvent.press(screen.getByTestId('new-table-add'));
    await fireEvent.changeText(screen.getByTestId('new-table-add-name'), '保险公司');
    await fireEvent.press(screen.getByTestId('new-table-add-save'));
    const company = await screen.findByTestId('draft-field-3');
    await fireEvent.changeText(company, '平安');
    await fireEvent.press(screen.getByTestId('new-table-edit'));
    await fireEvent(screen.getByTestId('new-table-field-name-field-3'), 'endEditing', {
      nativeEvent: { text: '承保公司' },
    });
    await fireEvent.press(screen.getByTestId('new-table-field-remove-title'));
    await fireEvent.press(screen.getByTestId('new-table-edit'));
    await saveNew();
    const table = store.getState().config!.data.tables[0]!;
    expect(table.name).toBe('车险');
    expect(table.fields.map((f) => f.name)).toEqual(['承保公司', '附件']);
    const [record] = await repo.listRecords(table.id);
    expect(record!.values['field-3']).toBe('平安');
    // 列表显示留下来的文字字段（去掉的字段没有被页面引用，底线 18）。
    expect(store.getState().config!.containers.pages.some((p) => p.title === '车险')).toBe(true);
  });

  it('有数据：只列有附件字段的表和「新建表单」；选表不改配置，文件放进它的附件字段', async () => {
    const { files, repo, store } = await render(seeded);
    await openShare(files, ['IMG_1.jpg']);
    await openChooser();
    expect(listIds()).toEqual(['share-record-new', 'share-record-table-receipts']);
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
    await choose('new');
    expect(await screen.findByTestId('draft-attachments-file-1')).toBeTruthy();
    await saveNew();
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
    await openChooser();
    expect(screen.getByTestId('share-record-too-many').props.children).toBe(
      '一条记录最多放 20 个文件，只放前 20 个。',
    );
    await fireEvent.press(screen.getByTestId('share-record-new'));
    expect(await screen.findByTestId(`draft-attachments-file-${MAX_ATTACHMENTS - 1}`)).toBeTruthy();
    expect(screen.queryByTestId(`draft-attachments-file-${MAX_ATTACHMENTS}`)).toBeNull();
    expect(await repo.listAssets()).toHaveLength(MAX_ATTACHMENTS);
  });

  it('没保存就返回：不建表，不存记录，复制的文件删掉，收件的文件还在', async () => {
    const { files, repo, store } = await render();
    const [photo] = await openShare(files, ['IMG_1.jpg']);
    await choose('new');
    expect(await screen.findByTestId('draft-attachments-file-0')).toBeTruthy();
    await pickType('bill');
    expect(await repo.listAssets()).toHaveLength(1);
    await act(() => router.back());
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(await repo.listAssets()).toEqual([]);
    expect([...files.disk.keys()].filter((k) => k.startsWith('assets/'))).toEqual([]);
    expect(store.getState().config!.data.tables).toEqual([]);
    expect(files.disk.has(photo!.uri)).toBe(true);
  });

  it('新用户还没看完介绍：记下让外壳重新挂载，文件还在，也不再推一次欢迎页', async () => {
    // 真机上（2026-10-31）：首页推了欢迎页，收件页面盖在上面；建表后外壳按新版本重新挂载又推了一次。
    const repo = new MemoryWorkspaceRepo();
    await act(() => useGuide.getState().load(repo));
    expect(useGuide.getState().stage).toBe('intro');
    const { files } = await renderToolsApp(repo, new FakeFiles());
    expect(await screen.findByTestId('welcome')).toBeTruthy();
    await openShare(files, ['IMG_1.jpg']);
    await choose('new');
    await pickType('purchase');
    await saveNew();
    expect(screen.queryByTestId('welcome')).toBeNull();
    const [record] = await repo.listRecords('receipts');
    expect(attachmentIds(record!.values.attachments)).toHaveLength(1);
    expect(await repo.listAssets()).toHaveLength(1);
    await act(() => router.back());
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('让 Tink 改：先建表，换成记录页，AI 页只知道这张表，请求里没有文件内容', async () => {
    const { files, store } = await render();
    await openShare(files, ['IMG_1.jpg']);
    await choose('new');
    await pickType('insurance');
    await fireEvent.press(screen.getByTestId('new-table-tink'));
    await waitFor(() =>
      expect(store.getState().config!.data.tables.map((c) => c.id)).toEqual(['insurance']),
    );
    expect(await screen.findByTestId('change-about')).toBeTruthy();
    await act(() => router.back());
    expect(await screen.findByTestId('editor-attachments-file-0')).toBeTruthy();
  });
});
