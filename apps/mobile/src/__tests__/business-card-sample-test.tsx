import {
  applyOps,
  createStarterWorkspace,
  sampleOps,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 名片样板（D-423）在 App 里走一遍：新用户、有数据、边界。

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
) {
  const repo = new MemoryWorkspaceRepo();
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
  const app = await renderToolsApp(repo, undefined, { locale, seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId } }));
  await settle();
  return { ...app, repo };
}

afterEach(() => {
  jest.restoreAllMocks();
  useGuide.setState({ stage: null, repo: null });
});

describe('new user', () => {
  it.each([
    ['zh', '扫名片', '我的名片', '联系人'],
    ['en', 'Scan a card', 'My card', 'Contacts'],
    ['fr', 'Scanner une carte', 'Ma carte', 'Contacts'],
  ] as const)('the home page has the three ways in (%s)', async (locale, scan, mine, contacts) => {
    await open('cards', [], locale);
    expect((await screen.findAllByText(scan)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(mine).length).toBeGreaterThan(0);
    expect(screen.getAllByText(contacts).length).toBeGreaterThan(0);
  });

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

  it('contacts says how to start, with no search box', async () => {
    await open('contacts');
    expect(await screen.findByText('还没有联系人。扫一张名片就有了。')).toBeTruthy();
    expect(screen.queryByTestId('browse-search')).toBeNull();
    expect(screen.getByText('扫名片')).toBeTruthy();
  });
});

describe('with data', () => {
  const PEOPLE = [
    {
      table: 'contacts',
      values: { name: '张三', company: '北京公司', phone: '138 0000 0000', group: 'client' },
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
  it('a huge card still shows its info, with a note instead of a broken code', async () => {
    await open('my-card', [
      { table: 'my-card', values: { name: '张三', address: '很长的地址'.repeat(300) } },
    ]);
    expect(await screen.findByTestId('single-qr-note')).toBeTruthy();
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.queryByTestId('single-qr')).toBeNull();
  });
});
