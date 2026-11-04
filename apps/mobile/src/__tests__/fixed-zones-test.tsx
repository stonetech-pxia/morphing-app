import { applyOps, createDefaultWorkspace, type Locale, type Op, type Registry } from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 页面的固定区、分组列表的加载更多、引用字段选择器的搜索、已有标签（创始人 2026-11-04 定）。

const TEAMS: Op = {
  op: 'addData',
  table: {
    id: 'teams',
    name: 'Teams',
    fields: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'city', name: 'City', type: 'text' },
      { id: 'kind', name: 'Kind', type: 'choice', options: [{ id: 'a', label: 'Alpha' }] },
    ],
  },
};
const PEOPLE: Op = {
  op: 'addData',
  table: {
    id: 'people',
    name: 'People',
    fields: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'co', name: 'Company', type: 'text' },
      { id: 'labels', name: 'Labels', type: 'tags' },
      { id: 'team', name: 'Team', type: 'link', table: 'teams' },
    ],
  },
};

const page = (blocks: object[]): Op =>
  ({ op: 'addContainer', page: { id: 'p', title: 'P', blocks } }) as Op;

const list = (browse: object | undefined, limit = 2) => ({
  id: 'list',
  look: 'list',
  source: { table: 'people', sort: { field: 'name', direction: 'asc' }, limit },
  show: { title: 'name', emptyText: 'Nobody', ...(browse ? { browse } : {}) },
});

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });

async function open(
  blocks: object[],
  records: { id: string; table?: string; values: Record<string, unknown> }[] = [],
) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const [i, r] of records.entries())
    await repo.insertRecord({
      id: r.id,
      collectionId: r.table ?? 'people',
      values: r.values,
      createdAt: 100 + i,
      updatedAt: 100 + i,
    });
  const seed = (locale: Locale, registry: Registry) => {
    const r = applyOps(createDefaultWorkspace(locale), [TEAMS, PEOPLE, page(blocks)], {
      registry,
      locale,
    });
    if (!r.ok) throw new Error(r.error);
    return r.config;
  };
  await renderToolsApp(repo, undefined, { locale: 'en', seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId: 'p' } }));
  await settle();
  return repo;
}

const end = (y: number, content: number) =>
  fireEvent.scroll(screen.getByTestId('editable-scroll'), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 100, height: content },
      layoutMeasurement: { width: 100, height: 600 },
    },
  });
const rows = () => screen.queryAllByTestId(/^record-r\d+$/).length;
const someone = (n: number, co = 'Same') =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, values: { name: `P${i}`, co } }));

describe('fixed zones', () => {
  it('a pinned block sits outside the scrolling middle, top and bottom; an unpinned one stays in it', async () => {
    await open([
      { id: 'a', look: 'text', show: { text: 'in the middle' } },
      { id: 'b', look: 'text', pin: 'top', show: { text: 'on top' } },
      { id: 'c', look: 'text', pin: 'bottom', show: { text: 'below' } },
    ]);
    expect(within(await screen.findByTestId('page-top-zone')).getByText('on top')).toBeTruthy();
    expect(within(screen.getByTestId('page-bottom-zone')).getByText('below')).toBeTruthy();
    const middle = screen.getByTestId('editable-scroll');
    expect(within(middle).getByText('in the middle')).toBeTruthy();
    expect(within(middle).queryByText('on top')).toBeNull();
    expect(within(middle).queryByText('below')).toBeNull();
  });

  it('a hidden pinned block is not drawn; a page without pins has no zones', async () => {
    await open([{ id: 'a', look: 'text', pin: 'top', hidden: true, show: { text: 'hidden' } }]);
    expect(screen.queryByTestId('page-top-zone')).toBeNull();
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('showIf still applies to a pinned block', async () => {
    await open([
      {
        id: 'a',
        look: 'text',
        pin: 'bottom',
        showIf: { table: 'people', has: 'some' },
        show: { text: 'has people' },
      },
    ]);
    expect(screen.queryByText('has people')).toBeNull();
  });

  it('with browse.pin the bar goes on top; without records there is no zone at all', async () => {
    await open([list({ search: true, pin: true })]);
    expect(await screen.findByText('Nobody')).toBeTruthy();
    expect(screen.queryByTestId('page-top-zone')).toBeNull();
  });

  it('without browse.pin the search stays in the middle and still works', async () => {
    await open([list({ search: true })], someone(3));
    const middle = await screen.findByTestId('editable-scroll');
    expect(within(middle).getByTestId('browse-search')).toBeTruthy();
    expect(screen.queryByTestId('page-top-zone')).toBeNull();
  });
});

describe('load more', () => {
  it('a list without browse keeps limit as a hard cap, however far you scroll', async () => {
    await open([list(undefined)], someone(5));
    await waitFor(() => expect(rows()).toBe(2));
    await end(2000, 2200);
    await settle();
    expect(rows()).toBe(2);
  });

  it('a grouped list: a page is counted over the whole list, from the first section down', async () => {
    const records = [
      ...['A', 'A', 'A'].map((co, i) => ({ id: `r${i}`, values: { name: `P${i}`, co } })),
      ...['B', 'B'].map((co, i) => ({ id: `r${i + 3}`, values: { name: `Q${i}`, co } })),
    ];
    await open([list({ sort: ['name'], group: ['co'] })], records);
    await fireEvent.press(await screen.findByTestId('browse-group-co'));
    expect(rows()).toBe(2);
    // 第二段还没到，标题也不画（滚到底才接着往下）。
    expect(screen.queryByText('B')).toBeNull();
    await end(1000, 1200);
    expect(rows()).toBe(4);
    expect(screen.getByText('B')).toBeTruthy();
    await end(2000, 2200);
    expect(rows()).toBe(5);
    expect(screen.queryByTestId('browse-more')).toBeNull();
  });
});

describe('the record form', () => {
  const button = {
    id: 'add',
    look: 'button',
    show: { label: 'New', variant: 'filled' },
    tools: [{ do: 'create', table: 'people', ask: 'all' }],
  };

  it('offers the tags the table has: new table none, then the ones in use, tap to add, tap to remove', async () => {
    const repo = await open(
      [button],
      [
        { id: 'r0', values: { name: 'A', labels: ['golf', 'vip'] } },
        { id: 'r1', values: { name: 'B', labels: ['vip'] } },
      ],
    );
    await fireEvent.press(await screen.findByText('New'));
    await fireEvent.changeText(await screen.findByTestId('editor-name'), 'C');
    await fireEvent.press(await screen.findByTestId('editor-labels-choice-golf'));
    expect(screen.queryByTestId('editor-labels-choice-golf')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-labels-choice-vip'));
    await fireEvent.press(screen.getByTestId('editor-labels-tag-golf'));
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    const saved = (await repo.listRecords('people')).find((r) => r.values.name === 'C');
    expect(saved!.values.labels).toEqual(['vip']);
  });

  it('a table with no tags offers none', async () => {
    await open([button]);
    await fireEvent.press(await screen.findByText('New'));
    expect(await screen.findByTestId('editor-labels')).toBeTruthy();
    expect(screen.queryByTestId(/^editor-labels-choice-/)).toBeNull();
  });

  it('the link picker searches every field, not just the title', async () => {
    const teams = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      table: 'teams',
      values: { name: `Team ${i}`, city: i === 7 ? 'Lyon' : 'Paris', kind: 'a' },
    }));
    await open([button], teams);
    await fireEvent.press(await screen.findByText('New'));
    await fireEvent.press(await screen.findByTestId('editor-team'));
    await fireEvent.changeText(await screen.findByTestId('editor-team-search'), 'lyon');
    expect(screen.getByTestId('editor-team-option-t7')).toBeTruthy();
    expect(screen.queryByTestId('editor-team-option-t1')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('editor-team-search'), 'alpha');
    expect(screen.getByTestId('editor-team-option-t1')).toBeTruthy();
  });
});
