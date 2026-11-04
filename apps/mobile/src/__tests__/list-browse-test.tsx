import { applyOps, createDefaultWorkspace, type Locale, type Registry } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 列表上的搜索、能换的排序和分组（show.browse，D-424）：只在块里，离开页面就回到配置里的样子。
// 三种状态：还没有记录、有记录、边界（搜不到、超过 limit、没填的字段）。

const LIMIT = 3;

const seed = (locale: Locale, registry: Registry) => {
  const r = applyOps(
    createDefaultWorkspace(locale),
    [
      {
        op: 'addData',
        table: {
          id: 'people',
          name: '联系人',
          fields: [
            { id: 'name', name: '姓名', type: 'text' },
            { id: 'co', name: '公司', type: 'text' },
            { id: 'phone', name: '电话', type: 'text', format: 'phone' },
            {
              id: 'tag',
              name: '分组',
              type: 'choice',
              options: [{ id: 'client', label: '客户' }],
            },
          ],
        },
      },
      {
        op: 'addContainer',
        page: {
          id: 'people-page',
          title: '联系人',
          blocks: [
            {
              id: 'list',
              look: 'list',
              source: {
                table: 'people',
                sort: { field: 'name', direction: 'asc' },
                limit: LIMIT,
              },
              show: {
                title: 'name',
                subtitles: ['co'],
                emptyText: '还没有人',
                browse: { search: true, sort: ['name', 'createdAt'], group: ['co', 'tag'] },
              },
            },
          ],
        },
      },
    ],
    { registry, locale },
  );
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });

async function open(people: Record<string, unknown>[] = []) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const [i, values] of people.entries())
    await repo.insertRecord({
      id: `p${i}`,
      collectionId: 'people',
      values,
      createdAt: 100 + i,
      updatedAt: 100 + i,
    });
  const app = await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId: 'people-page' } }));
  await settle();
  return app;
}

const rows = () =>
  screen.queryAllByTestId(/^record-p\d+$/).map((r) => String(r.props.testID).slice(7));

const PEOPLE = [
  { name: 'Bob', co: 'Zed', tag: 'client' },
  { name: '张三', co: '北京公司' },
  { name: 'alice', co: 'Zed' },
];

afterEach(() => useGuide.setState({ stage: null, repo: null }));

describe('no entries yet', () => {
  it('shows the empty text and no search box', async () => {
    await open();
    expect(await screen.findByText('还没有人')).toBeTruthy();
    expect(screen.queryByTestId('browse-search')).toBeNull();
    expect(screen.queryByTestId('browse-sort-name')).toBeNull();
  });
});

describe('with entries', () => {
  it('starts as configured: sorted by name, no groups', async () => {
    await open(PEOPLE);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByTestId('browse-sort-name').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('browse-group-none').props.accessibilityState.selected).toBe(true);
  });

  it('search ignores case, also finds Chinese, and looks at what the row shows', async () => {
    await open(PEOPLE);
    const box = await screen.findByTestId('browse-search');
    await fireEvent.changeText(box, 'ALICE');
    expect(rows()).toEqual(['p2']);
    await fireEvent.changeText(box, '北京');
    expect(rows()).toEqual(['p1']);
    await fireEvent.changeText(box, 'zed');
    expect(rows().sort()).toEqual(['p0', 'p2']);
    await fireEvent.changeText(box, '');
    expect(rows()).toHaveLength(3);
  });

  it('sort switches to newest first', async () => {
    await open(PEOPLE);
    await fireEvent.press(await screen.findByTestId('browse-sort-createdAt'));
    expect(rows()).toEqual(['p2', 'p1', 'p0']);
    expect(screen.getByTestId('browse-sort-createdAt').props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('group switches by a text field and a choice field, and back', async () => {
    await open(PEOPLE);
    await fireEvent.press(await screen.findByTestId('browse-group-co'));
    expect(screen.getByTestId('group-text-Zed')).toBeTruthy();
    expect(screen.getByTestId('group-text-北京公司')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('browse-group-tag'));
    expect(screen.getByTestId('group-client')).toBeTruthy();
    expect(screen.getByTestId('group-none')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('browse-group-none'));
    expect(screen.queryByTestId('group-client')).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it('search works inside groups', async () => {
    await open(PEOPLE);
    await fireEvent.press(await screen.findByTestId('browse-group-co'));
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'alice');
    expect(rows()).toEqual(['p2']);
    expect(screen.queryByTestId('group-text-北京公司')).toBeNull();
  });

  it('leaving the page and coming back goes back to the defaults', async () => {
    await open(PEOPLE);
    await fireEvent.changeText(await screen.findByTestId('browse-search'), 'alice');
    await fireEvent.press(screen.getByTestId('browse-group-co'));
    await act(() => router.back());
    await settle();
    await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId: 'people-page' } }));
    await settle();
    expect((await screen.findByTestId('browse-search')).props.value).toBe('');
    expect(screen.getByTestId('browse-group-none').props.accessibilityState.selected).toBe(true);
    expect(rows()).toHaveLength(3);
  });
});

describe('edge cases', () => {
  it('an empty search result keeps the box and says so', async () => {
    await open(PEOPLE);
    await fireEvent.changeText(await screen.findByTestId('browse-search'), 'nobody');
    expect(rows()).toEqual([]);
    expect(screen.getByTestId('browse-no-match')).toHaveTextContent('没有找到');
    expect(screen.queryByText('还没有人')).toBeNull();
    expect(screen.getByTestId('browse-search').props.value).toBe('nobody');
  });

  it('search finds entries beyond the limit, and the list says how many it left out', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `Person ${i}`, co: 'Same' }));
    await open(many);
    await waitFor(() => expect(rows()).toHaveLength(LIMIT));
    expect(screen.getByTestId('browse-more')).toHaveTextContent(
      '显示 3 / 8 条，搜索能找到其他的。',
    );
    expect(rows()).not.toContain('p7');
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'person 7');
    expect(rows()).toEqual(['p7']);
    expect(screen.queryByTestId('browse-more')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'person');
    expect(screen.getByTestId('browse-more')).toHaveTextContent(
      '找到 8 条，显示 3 条，再多写几个字。',
    );
  });

  it('grouping by a field nobody filled in puts everyone in one section', async () => {
    await open([{ name: 'A' }, { name: 'B' }]);
    await fireEvent.press(await screen.findByTestId('browse-group-co'));
    expect(screen.getByTestId('group-none')).toHaveTextContent(/未填/);
  });
});
