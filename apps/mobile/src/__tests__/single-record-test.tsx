import {
  applyOps,
  createDefaultWorkspace,
  type Field,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 一张表的一条记录（single，D-424）和按表有没有记录显示（showIf）：没有记录、有记录、内容太多放不进二维码。

const FIELDS: Field[] = [
  { id: 'name', name: '姓名', type: 'text' },
  { id: 'phone', name: '电话', type: 'text', format: 'phone' },
  { id: 'addr', name: '地址', type: 'text' },
];

const seed = (locale: Locale, registry: Registry) => {
  const r = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: { id: 'mine', name: '我的名片', fields: FIELDS } },
      {
        op: 'addContainer',
        page: {
          id: 'mine-page',
          title: '我的名片',
          blocks: [
            {
              id: 'one',
              look: 'single',
              source: { table: 'mine' },
              show: { fields: ['name', 'phone'], qr: true },
              showIf: { table: 'mine', has: 'some' },
            },
            {
              id: 'none',
              look: 'text',
              show: { text: '还没有名片' },
              showIf: { table: 'mine', has: 'none' },
            },
            { id: 'always', look: 'text', show: { text: '一直都在' } },
          ],
        },
      },
      {
        op: 'addContainer',
        page: {
          id: 'plain-page',
          title: '没有条件',
          blocks: [
            {
              id: 'one',
              look: 'single',
              source: { table: 'mine' },
              show: { fields: ['name'] },
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

async function open(records: Record<string, unknown>[] = [], pageId = 'mine-page') {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const [i, values] of records.entries())
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: 'mine',
      values,
      createdAt: 100 + i,
      updatedAt: 100 + i,
    });
  const app = await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId } }));
  await settle();
  return { ...app, repo };
}

afterEach(() => useGuide.setState({ stage: null, repo: null }));

describe('no entry yet', () => {
  it('shows what is for no entries, and not the card', async () => {
    await open();
    expect(await screen.findByText('还没有名片')).toBeTruthy();
    expect(screen.getByText('一直都在')).toBeTruthy();
    expect(screen.queryByTestId('single-r0')).toBeNull();
    expect(screen.queryByTestId('single-qr')).toBeNull();
  });

  it('without a condition, the block says there is nothing', async () => {
    await open([], 'plain-page');
    expect(await screen.findByText('还没有记录')).toBeTruthy();
    expect(screen.queryByTestId('single-edit')).toBeNull();
  });
});

describe('with an entry', () => {
  it('shows the fields and a QR code; the no-entry block is gone', async () => {
    await open([{ name: '张三', phone: '138 0000 0000' }]);
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.getByText('138 0000 0000')).toBeTruthy();
    const image = screen.getByTestId('single-qr');
    expect(image.props.source.uri).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText('还没有名片')).toBeNull();
  });

  it('uses the oldest entry', async () => {
    await open([{ name: '先加的' }, { name: '后加的' }]);
    expect(await screen.findByText('先加的')).toBeTruthy();
    expect(screen.queryByText('后加的')).toBeNull();
  });

  it('edit opens the entry form of that entry', async () => {
    await open([{ name: '张三' }]);
    await fireEvent.press(await screen.findByTestId('single-edit'));
    await waitFor(() => expect(screen.getByTestId('editor-name').props.value).toBe('张三'));
  });

  it('skips empty fields, and asks for no QR code when the block has none', async () => {
    await open([{ name: '张三' }], 'plain-page');
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.queryByTestId('single-qr')).toBeNull();
    expect(screen.queryByTestId('single-qr-note')).toBeNull();
  });
});

describe('edge cases', () => {
  it('too much for a QR code: the info stays, with a short note instead', async () => {
    await open([{ name: '张三', addr: '很长的地址'.repeat(300) }]);
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.queryByTestId('single-qr')).toBeNull();
    expect(screen.getByTestId('single-qr-note')).toHaveTextContent('内容太多，放不进二维码。');
  });

  it('an entry with nothing for a card shows no code and no note', async () => {
    await open([{ phone: '分机' }]);
    await screen.findByTestId('single-edit');
    expect(screen.queryByTestId('single-qr')).toBeNull();
    expect(screen.queryByTestId('single-qr-note')).toBeNull();
  });

  it('adding the first entry switches the page without leaving it', async () => {
    const { store, repo } = await open();
    await screen.findByText('还没有名片');
    await repo.insertRecord({
      id: 'r0',
      collectionId: 'mine',
      values: { name: '张三' },
      createdAt: 1,
      updatedAt: 1,
    });
    await act(async () => store.getState().bumpRecords());
    await settle();
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.queryByText('还没有名片')).toBeNull();
    expect(screen.getByText('一直都在')).toBeTruthy();
  });
});
