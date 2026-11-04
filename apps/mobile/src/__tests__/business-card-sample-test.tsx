import {
  applyOps,
  createStarterWorkspace,
  sampleOps,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 名片样板（D-423，创始人 2026-11-04 改）在 App 里走一遍：新用户、有数据、边界。

const seed = (locale: Locale, registry: Registry) => {
  const base = createStarterWorkspace(locale, registry);
  const sample = sampleOps('business-cards', base, locale);
  if (!sample.ok) throw new Error(sample.message);
  const r = applyOps(base, sample.ops, { registry, locale });
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });

async function open(
  pageId: string,
  records: { table: string; values: Record<string, unknown> }[] = [],
  locale: Locale = 'zh',
  withFiles = false,
) {
  const repo = new MemoryWorkspaceRepo();
  const files = withFiles ? new FakeFiles() : undefined;
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const [i, r] of records.entries())
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: r.table,
      values: r.values,
      createdAt: 100 + i,
      updatedAt: 100 + i,
    });
  const app = await renderToolsApp(repo, files, { locale, seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId } }));
  await settle();
  return { ...app, repo, files };
}

afterEach(() => {
  jest.restoreAllMocks();
  useGuide.setState({ stage: null, repo: null });
});

describe('new user', () => {
  it.each([
    ['zh', '还没有联系人。扫一张名片就有了。', '扫描', '我的名片', '手动添加', '导出联系人'],
    [
      'en',
      'No contacts yet. Scan a card to add one.',
      'Scan',
      'My card',
      'Add by hand',
      'Export contacts',
    ],
    [
      'fr',
      'Aucun contact pour l’instant. Scannez une carte pour en ajouter un.',
      'Scanner',
      'Ma carte',
      'Ajouter à la main',
      'Exporter',
    ],
  ] as const)(
    'entering it is the empty list with My card and the dial (%s)',
    async (locale, empty, scan, mine, byHand, exportLabel) => {
      await open('contacts', [], locale);
      expect(await screen.findByText(empty)).toBeTruthy();
      // 没有记录时没有搜索框，也没有导出（一条都没有，交不出去）。
      expect(screen.queryByTestId('browse-search')).toBeNull();
      expect(within(screen.getByTestId('page-bottom-zone')).getByText(mine)).toBeTruthy();
      expect(within(screen.getByTestId('dial-main')).getByText(scan)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('dial-toggle'));
      expect(screen.getByText(byHand)).toBeTruthy();
      expect(screen.queryByText(exportLabel)).toBeNull();
    },
  );

  it('my card offers by hand and scan, and by hand opens the form of that table', async () => {
    await open('my-card');
    expect(await screen.findByText('还没有名片。可以手动填，也可以扫一张。')).toBeTruthy();
    expect(screen.getByText('扫我的名片')).toBeTruthy();
    expect(screen.queryByTestId('single-qr')).toBeNull();
    await fireEvent.press(screen.getByText('手动填写'));
    expect(await screen.findByTestId('editor-save')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('editor-name'), '张三');
    await fireEvent.press(screen.getByTestId('editor-save'));
    // 存好回来，页面换成名片和二维码，两个按钮不见了。
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    expect(await screen.findByTestId('single-qr')).toBeTruthy();
    expect(screen.queryByText('手动填写')).toBeNull();
  });

  it('the main part runs the scan, nothing runs on entry', async () => {
    const { repo } = await open('contacts');
    const run = jest.spyOn(repo, 'startToolRun');
    await settle();
    expect(run).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId('dial-main'));
    await settle();
    expect(await screen.findByTestId(/^(run|ready)-screen$/)).toBeTruthy();
  });

  it('adding by hand opens the form, a new tag is typed there, and it is saved on the record only', async () => {
    const { repo } = await open('contacts');
    await fireEvent.press(await screen.findByTestId('dial-toggle'));
    // 真机上看到的：不认识的图标名会显示成文字（图标名是 plus，不是 add）。
    expect(screen.queryByText('add')).toBeNull();
    await fireEvent.press(screen.getByTestId('dial-item-0'));
    expect(screen.queryByTestId('dial-backdrop')).toBeNull();
    await fireEvent.changeText(await screen.findByTestId('editor-name'), 'Ann');
    // 逗号变成一个标签；后面没按「完成」的也算。
    await fireEvent.changeText(screen.getByTestId('editor-tags'), '客户,');
    await fireEvent.changeText(screen.getByTestId('editor-tags'), '北京');
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    const [saved] = await repo.listRecords('contacts');
    expect(saved!.values.tags).toEqual(['客户', '北京']);
    expect(await screen.findByTestId('browse-filter-tags-客户')).toBeTruthy();
    const head = (await repo.getMeta('head')) ?? '';
    expect(head).not.toContain('客户');
  });
});

describe('with data', () => {
  const PEOPLE = [
    {
      table: 'contacts',
      values: { name: '张三', company: '北京公司', phone: '138 0000 0000', tags: ['客户', 'vip'] },
    },
    { table: 'contacts', values: { name: 'Maria', company: 'Acme', email: 'm@acme.example' } },
  ];

  it('contacts searches, and tapping one opens its page with the action row', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await open('contacts', PEOPLE);
    await fireEvent.changeText(await screen.findByTestId('browse-search'), 'acme');
    expect(screen.queryByTestId('record-r0')).toBeNull();
    await fireEvent.press(screen.getByTestId('record-r1'));
    await screen.findByTestId('record-actions');
    expect(screen.queryByTestId('record-action-record-call-phone')).toBeNull();
    await fireEvent.press(screen.getByTestId('record-action-record-email-email'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('mailto:m@acme.example'));
  });

  it('search and the tag filter sit in the top zone, and search finds a field the row does not show', async () => {
    await open('contacts', PEOPLE);
    const top = await screen.findByTestId('page-top-zone');
    expect(within(top).getByTestId('browse-search')).toBeTruthy();
    expect(within(top).getByTestId('browse-filter-tags-all')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('browse-search'), '138');
    expect(screen.getByTestId('record-r0')).toBeTruthy();
    expect(screen.queryByTestId('record-r1')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('browse-search'), '');
    await fireEvent.press(screen.getByTestId('browse-filter-tags-vip'));
    expect(screen.getByTestId('record-r0')).toBeTruthy();
    expect(screen.queryByTestId('record-r1')).toBeNull();
    // 筛选加搜索：两个都要对得上。
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'acme');
    expect(screen.getByTestId('browse-no-match')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('browse-filter-tags-all'));
    expect(screen.getByTestId('record-r1')).toBeTruthy();
  });

  it('no tags: no filter row; the row still shows the name and company', async () => {
    await open('contacts', [PEOPLE[1]!]);
    expect(await screen.findByTestId('record-r0')).toHaveTextContent(/Maria.*Acme/);
    expect(screen.queryByTestId('browse-filter-tags-all')).toBeNull();
  });

  it('the dial hands over what the list selects, filtered and searched, not cut to a page', async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      table: 'contacts',
      values: { name: `P${i}`, tags: [i % 2 ? 'odd' : 'even'] },
    }));
    const { files } = await open('contacts', many, 'en', true);
    await waitFor(() => expect(screen.queryAllByTestId(/^record-r\d+$/).length).toBe(30));
    await fireEvent.press(screen.getByTestId('browse-filter-tags-odd'));
    await fireEvent.press(screen.getByTestId('dial-toggle'));
    expect(screen.getByTestId('dial-item-count')).toHaveTextContent('Only the 35 entries found');
    await fireEvent.press(screen.getByTestId('dial-item-1'));
    await settle();
    await waitFor(() => expect(files!.shared).toHaveLength(1));
    const text = new TextDecoder().decode(files!.disk.get(files!.shared[0]!)!);
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(35);
  });

  it('my card shows the first entry with its code and an edit control', async () => {
    await open('my-card', [{ table: 'my-card', values: { name: '张三', phone: '138 0000 0000' } }]);
    expect(await screen.findByTestId('single-qr')).toBeTruthy();
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.queryByText('手动填写')).toBeNull();
    await fireEvent.press(screen.getByTestId('single-edit'));
    await waitFor(() => expect(screen.getByTestId('editor-name').props.value).toBe('张三'));
  });
});

describe('edge cases', () => {
  const end = (y: number, content: number) =>
    fireEvent.scroll(screen.getByTestId('editable-scroll'), {
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 100, height: content },
        layoutMeasurement: { width: 100, height: 600 },
      },
    });
  const rows = () => screen.queryAllByTestId(/^record-r\d+$/).length;

  it('1000 entries: a page at a time when scrolled to the end, search over all of them', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      table: 'contacts',
      values: { name: `P${i}`, phone: `555${i}` },
    }));
    await open('contacts', many, 'en');
    await waitFor(() => expect(rows()).toBe(30));
    // 还没到底：不加载。
    await end(100, 3000);
    expect(rows()).toBe(30);
    await end(2400, 3000);
    expect(rows()).toBe(60);
    // 同一个高度再滚不重复加载。
    await end(2400, 3000);
    expect(rows()).toBe(60);
    await end(5400, 6000);
    expect(rows()).toBe(90);
    // 搜索读整张表，也搜没显示的字段；换了搜索回到第一页。
    await fireEvent.changeText(screen.getByTestId('browse-search'), '555999');
    expect(rows()).toBe(1);
    await fireEvent.changeText(screen.getByTestId('browse-search'), '');
    expect(rows()).toBe(30);
  });

  it('a huge card still shows its info, with a note instead of a broken code', async () => {
    await open('my-card', [
      { table: 'my-card', values: { name: '张三', address: '很长的地址'.repeat(300) } },
    ]);
    expect(await screen.findByTestId('single-qr-note')).toBeTruthy();
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.queryByTestId('single-qr')).toBeNull();
  });
});
