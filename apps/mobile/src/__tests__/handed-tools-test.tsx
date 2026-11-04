import {
  applyOps,
  createStarterWorkspace,
  sampleOps,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert, Linking } from 'react-native';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 容器把数据交给工具（D-428）：记录页、列表、单条记录块上的按钮点了才运行，把值、这一条、列表选出的记录交给第一步。
// 三种状态都走：没有数据、有数据、边界情况（空的和不对的电话、两个电话字段、删字段、删快捷操作、搜索、没有匹配）。

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(700);
    await Promise.resolve();
  });

const sample = (registry: Registry, extra: Op[] = []): WorkspaceConfig => {
  const base = createStarterWorkspace('en', registry);
  const ops = sampleOps('business-cards', base, 'en');
  if (!ops.ok) throw new Error(ops.message);
  // 样板的导出在下面的浮动按钮上（创始人 2026-11-04 定）；这里测列表上方的按钮（as: "list"，D-428），能力还在。
  const onList: Op = {
    op: 'updateContainer',
    page: 'contacts',
    block: 'contacts',
    changes: { tools: [{ as: 'list', tool: 'export-contacts' }] },
  };
  const r = applyOps(base, [...ops.ops, onList, ...extra], { registry, locale: 'en' });
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

const contact = (id: string, values: Record<string, string>, table = 'contacts') => ({
  id,
  collectionId: table,
  values,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
  updatedAt: 1,
});

async function start(
  records: ReturnType<typeof contact>[] = [],
  extra: Op[] = [],
  path?: Parameters<typeof router.push>[0],
) {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const r of records) await repo.insertRecord(r);
  const files = new FakeFiles();
  await renderToolsApp(repo, files, {
    locale: 'en',
    seed: (_locale, registry) => sample(registry, extra),
  });
  await settle();
  if (path) {
    await act(() => router.push(path));
    await settle();
  }
  return { repo, files };
}

const contactsPage = { pathname: '/page/[pageId]', params: { pageId: 'contacts' } } as const;
const myCardPage = { pathname: '/page/[pageId]', params: { pageId: 'my-card' } } as const;
const entry = (recordId: string, collectionId = 'contacts') =>
  ({ pathname: '/record/[collectionId]', params: { collectionId, recordId } }) as const;

const sharedText = (files: FakeFiles) =>
  new TextDecoder().decode(files.disk.get(files.shared[files.shared.length - 1]!)!);

let open: jest.SpiedFunction<typeof Linking.openURL>;
beforeEach(() => {
  open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  open.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('new user, no data', () => {
  it('the list has no tool button: there is nothing to hand over', async () => {
    await start([], [], contactsPage);
    expect(screen.queryByTestId('list-tool-export-contacts')).toBeNull();
    expect(screen.queryByTestId('list-tool-count')).toBeNull();
  });

  it('my card has no card, so no QR button', async () => {
    await start([], [], myCardPage);
    expect(screen.queryByTestId('single-tool-record-qr')).toBeNull();
  });
});

describe('with data: the entry page', () => {
  const full = {
    name: 'Maria',
    phone: '+33 6 12',
    email: 'a@example.com',
    website: 'example.com',
  };

  it('shows the configured row, and dials what the box says now, even if unsaved', async () => {
    const { repo } = await start([contact('c1', full)], [], entry('c1'));
    expect(screen.getByTestId('record-action-record-vcard')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('editor-phone'), '555 0100');
    await fireEvent.press(screen.getByTestId('record-action-record-call-phone'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('tel:5550100'));
    // 点按钮不保存：框里改的只交给这次运行。
    expect((await repo.getRecord('c1'))!.values.phone).toBe('+33 6 12');
  });

  it('share vCard runs records.toVCard → out.share with this one entry', async () => {
    const { files } = await start(
      [contact('c1', full), contact('c2', { name: 'Other', phone: '999' })],
      [],
      entry('c1'),
    );
    await fireEvent.press(screen.getByTestId('record-action-record-vcard'));
    await waitFor(() => expect(files.shared).toHaveLength(1));
    const text = sharedText(files);
    expect(text).toContain('FN:Maria');
    expect(text).not.toContain('Other');
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(1);
  });

  it('an invalid or empty phone has no call or message button; the rest stay', async () => {
    await start(
      [contact('c1', { name: 'Maria', phone: 'ext 12', email: 'a@example.com' })],
      [],
      entry('c1'),
    );
    expect(screen.queryByTestId('record-action-record-call-phone')).toBeNull();
    expect(screen.queryByTestId('record-action-record-message-phone')).toBeNull();
    expect(screen.getByTestId('record-action-record-email-email')).toBeTruthy();
  });

  it('several phone fields: each button dials its own number and names its field', async () => {
    const extra: Op[] = [
      {
        op: 'addData',
        table: 'contacts',
        field: { id: 'office', name: 'Office', type: 'text', format: 'phone' },
      },
      {
        op: 'updateData',
        table: 'contacts',
        changes: {
          recordRow: [
            { tool: 'record-call', field: 'phone' },
            { tool: 'record-call', field: 'office' },
          ],
        },
      },
    ];
    await start(
      [contact('c1', { name: 'M', phone: '111111', office: '222222' })],
      extra,
      entry('c1'),
    );
    expect(screen.getByTestId('record-action-record-call-office')).toHaveTextContent(/Office/);
    await fireEvent.press(screen.getByTestId('record-action-record-call-office'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('tel:222222'));
    open.mockClear();
    await fireEvent.press(screen.getByTestId('record-action-record-call-phone'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('tel:111111'));
  });

  it('a deleted field takes its buttons away', async () => {
    await start(
      [contact('c1', full)],
      [{ op: 'removeData', table: 'contacts', field: 'website' }],
      entry('c1'),
    );
    expect(screen.queryByTestId('record-action-record-website-website')).toBeNull();
    expect(screen.getByTestId('record-action-record-email-email')).toBeTruthy();
  });

  it('a deleted quick action takes its button away; a table without a row shows no row', async () => {
    const own: Op[] = [
      {
        op: 'addTool',
        tool: {
          id: 'own-copy',
          kind: 'quickAction',
          name: 'Own',
          steps: [{ id: 'c', action: 'text.copy', params: {} }],
        },
      },
      {
        op: 'updateData',
        table: 'contacts',
        changes: { recordRow: [{ tool: 'own-copy', field: 'name' }] },
      },
      { op: 'removeTool', tool: 'own-copy' },
    ];
    await start([contact('c1', full)], own, entry('c1'));
    expect(screen.queryByTestId('record-actions')).toBeNull();
  });
});

describe('with data: the list', () => {
  const people = [
    contact('c1', { name: 'Ann', company: 'Acme', phone: '111111' }),
    contact('c2', { name: 'Bob', company: 'Beta', phone: '222222' }),
    contact('c3', { name: 'Anna', company: 'Acme', phone: '333333' }),
  ];

  const press = async () => {
    await fireEvent.press(screen.getByTestId('list-tool-export-contacts'));
    await settle();
  };

  it('says how many it hands over, and exports all of them', async () => {
    const { files } = await start(people, [], contactsPage);
    expect(screen.getByTestId('list-tool-count')).toHaveTextContent('All 3 entries in this list');
    await press();
    await waitFor(() => expect(files.shared).toHaveLength(1));
    expect(sharedText(files).match(/BEGIN:VCARD/g)).toHaveLength(3);
  });

  it('is not cut to the display limit: everything that matches goes', async () => {
    const many = Array.from({ length: 120 }, (_, i) => contact(`c${i + 1}`, { name: `P${i}` }));
    const { files } = await start(many, [], contactsPage);
    expect(screen.getByTestId('list-tool-count')).toHaveTextContent(/All 120 entries/);
    await press();
    await waitFor(() => expect(files.shared).toHaveLength(1));
    expect(sharedText(files).match(/BEGIN:VCARD/g)).toHaveLength(120);
  });

  it('a search narrows what is handed over and says so', async () => {
    const { files } = await start(people, [], contactsPage);
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'ann');
    expect(screen.getByTestId('list-tool-count')).toHaveTextContent('Only the 2 entries found');
    await press();
    await waitFor(() => expect(files.shared).toHaveLength(1));
    const text = sharedText(files);
    expect(text).toContain('FN:Ann');
    expect(text).toContain('FN:Anna');
    expect(text).not.toContain('Bob');
  });

  it('one match: singular text, and it goes straight to the share sheet', async () => {
    const { files } = await start(people, [], contactsPage);
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'bob');
    expect(screen.getByTestId('list-tool-count')).toHaveTextContent('Only the one entry found');
    await fireEvent.press(screen.getByTestId('list-tool-export-contacts'));
    await waitFor(() => expect(files.shared).toHaveLength(1));
    expect(screen.queryByTestId('run-screen')).toBeNull();
  });

  it('zero matches: no button, nothing can run', async () => {
    const { files } = await start(people, [], contactsPage);
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'zzz');
    expect(screen.getByTestId('browse-no-match')).toBeTruthy();
    expect(screen.queryByTestId('list-tool-export-contacts')).toBeNull();
    expect(files.shared).toEqual([]);
  });

  it('the filter of the list counts too', async () => {
    const extra: Op[] = [
      {
        op: 'updateContainer',
        page: 'contacts',
        block: 'contacts',
        changes: {
          source: {
            table: 'contacts',
            limit: 100,
            filter: [{ field: 'company', op: 'is', value: 'Acme' }],
          },
        },
      },
    ];
    const { files } = await start(people, extra, contactsPage);
    expect(screen.getByTestId('list-tool-count')).toHaveTextContent(/All 2 entries/);
    await press();
    await waitFor(() => expect(files.shared).toHaveLength(1));
    expect(sharedText(files)).not.toContain('Bob');
  });
});

describe('my card', () => {
  it('the QR button ends on the result page; the on-page code stays', async () => {
    await start([contact('m1', { name: 'Me', phone: '123456' }, 'my-card')], [], myCardPage);
    expect(screen.getByTestId('single-qr')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('single-tool-record-qr'));
    await settle();
    await settle();
    expect(await screen.findByTestId('run-result')).toBeTruthy();
  });

  it('too much for a code: a clear message, no image', async () => {
    const long = 'x'.repeat(1200);
    await start(
      [contact('m1', { name: 'Me', note: '', address: long }, 'my-card')],
      [],
      myCardPage,
    );
    await fireEvent.press(screen.getByTestId('single-tool-record-qr'));
    await settle();
    await settle();
    expect(await screen.findByTestId('run-error')).toHaveTextContent(/too long/i);
    expect(screen.queryByTestId('run-result')).toBeNull();
  });
});

describe('running it from somewhere that hands nothing over', () => {
  it('from the list of quick actions: says it needs an entry, runs nothing', async () => {
    const { files } = await start([contact('c1', { name: 'A' })]);
    await act(() => router.push({ pathname: '/quick-actions/[kind]', params: { kind: 'other' } }));
    await settle();
    await fireEvent.press(await screen.findByTestId('workflow-run-export-contacts'));
    await settle();
    expect(await screen.findByTestId('run-needs-record')).toHaveTextContent(
      /works on an entry or a value/,
    );
    expect(screen.queryByTestId('run-screen')).toBeNull();
    expect(files.shared).toEqual([]);
  });

  it('a built-in one opened by its id, or a stale link to a run: the same message', async () => {
    await start();
    await act(() =>
      router.push({
        pathname: '/run/[workflowId]',
        params: { workflowId: 'record-call', handed: '999' },
      }),
    );
    await settle();
    expect(await screen.findByTestId('run-needs-record')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });
});
