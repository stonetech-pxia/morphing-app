import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import type { Collection, Component, NewComponent, WorkspaceConfig } from './schema';
import { allComponents } from './schema';
import { apply, registry, workspace } from './test-helpers';

// D-310：AI 新加了一个记录块（列表、卡片……），而这张表在整个 App 里没有任何添加的地方时，
// 在它上方补一个「添加」按钮（就地的 {do: "create", ask: "all"}，打开完整的添加页），并在草稿说明里写出来。

const habits: Collection = {
  id: 'habits',
  name: '习惯',
  fields: [
    { id: 'name', name: '名称', type: 'text', required: true },
    { id: 'goal', name: '每周目标', type: 'number' },
    { id: 'score', name: '得分', type: 'formula', expression: '{goal} * 2' },
  ],
};
const checkins: Collection = {
  id: 'checkins',
  name: '打卡',
  fields: [
    { id: 'habit', name: '习惯', type: 'link', table: 'habits' },
    { id: 'day', name: '日期', type: 'date', default: 'today' },
  ],
};

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 30) };

const base = (): WorkspaceConfig =>
  apply(workspace('zh'), [
    { op: 'addData', table: habits },
    { op: 'addData', table: checkins },
    { op: 'addContainer', page: { id: 'habits-page', title: '习惯', blocks: [] } },
  ]);

const list = (table: string, extra: Record<string, unknown> = {}, id = 'list', look = 'list') =>
  ({
    id,
    look,
    source: { table, limit: 50 },
    show: { title: 'name' },
    ...extra,
  }) as NewComponent;
const form = (table: string, ask: string[]): NewComponent => ({
  id: 'form',
  look: 'form',
  show: { mode: 'inline' },
  tools: [{ as: 'submit', label: '添加', do: 'create', table, ask }],
});

const addTo = (page: string, ...blocks: NewComponent[]): Op[] =>
  blocks.map((block) => ({ op: 'addContainer', page, block }));

function prepare(config: WorkspaceConfig, ops: Op[]) {
  const result = prepareOps(config, ops, ctx);
  if (!result.ok) throw new Error(result.issues.join('; '));
  const page = (id: string) => result.after.containers.pages.find((p) => p.id === id)!;
  return { ...result, page };
}
const looks = (blocks: readonly Component[]) => blocks.map((c) => c.look as unknown as string);

describe('a new record block of a table that has no way to add entries (D-310)', () => {
  it('gets an Add button right above it that opens the full form', () => {
    const { page, lines } = prepare(base(), addTo('habits-page', list('habits')));
    const blocks = page('habits-page').blocks;
    expect(looks(blocks)).toEqual(['button', 'list']);
    expect(blocks[0]).toEqual({
      id: 'add-habits',
      look: 'button',
      show: { label: '添加', variant: 'filled' },
      tools: [{ do: 'create', table: 'habits', ask: 'all' }],
    });
    expect(lines).toContain('「习惯」还没有添加的地方，同时在列表上方加一个「添加」按钮');
  });

  it('every record look counts, not only lists', () => {
    for (const look of ['cards', 'checklist', 'tiles']) {
      const extra =
        look === 'checklist'
          ? { tools: [{ as: 'check', do: 'toggle', table: 'habits', field: 'done' }] }
          : {};
      const config = apply(base(), [
        { op: 'addData', table: 'habits', field: { id: 'done', name: '完成', type: 'checkbox' } },
        ...addTo('habits-page', list('habits', extra, 'l', look)),
      ]);
      expect(looks(config.containers.pages[1]!.blocks), look).toEqual(['button', look]);
    }
  });

  it('uses the interface language for the button and the note', () => {
    const config = base();
    const en = prepareOps(config, addTo('habits-page', list('habits')), { ...ctx, locale: 'en' });
    expect(
      en.ok && en.after.containers.pages.find((p) => p.id === 'habits-page')!.blocks[0],
    ).toMatchObject({ show: { label: 'Add' } });
    expect(en.ok && en.lines).toContain(
      '“习惯” had no way to add entries, so this also adds an “Add” button above the list',
    );
  });

  it('goes above the outermost group when the list sits in one', () => {
    const group = {
      id: 'row',
      look: 'group',
      show: { layout: 'stack' },
      children: [
        {
          id: 'inner',
          look: 'group',
          show: { layout: 'row' },
          children: [list('habits')],
        },
      ],
    } as unknown as NewComponent;
    const { page } = prepare(base(), addTo('habits-page', group));
    expect(looks(page('habits-page').blocks)).toEqual(['button', 'group']);
  });

  it('is not added when the table already has a way to add entries anywhere', () => {
    const withForm = apply(base(), addTo('home', form('habits', ['name'])));
    expect(
      looks(prepare(withForm, addTo('habits-page', list('habits'))).page('habits-page').blocks),
    ).toEqual(['list']);

    const openButton: NewComponent = {
      id: 'new',
      look: 'button',
      show: { label: '新习惯', variant: 'filled' },
      tools: [{ do: 'create', table: 'habits', ask: 'all' }],
    };
    const withButton = apply(base(), addTo('home', openButton));
    expect(
      looks(prepare(withButton, addTo('habits-page', list('habits'))).page('habits-page').blocks),
    ).toEqual(['list']);
  });

  it('a button that changes entries (setAll) is not a way to add', () => {
    const reset: NewComponent = {
      id: 'reset',
      look: 'button',
      show: { label: '清零', variant: 'outline' },
      tools: [{ do: 'setAll', table: 'habits', field: 'goal', value: 0 }],
    };
    const config = apply(base(), addTo('home', reset));
    expect(
      looks(prepare(config, addTo('habits-page', list('habits'))).page('habits-page').blocks),
    ).toEqual(['button', 'list']);
  });

  it('counts a form or a row button added in the same change', () => {
    const { page } = prepare(
      base(),
      addTo('habits-page', list('habits'), form('habits', ['name'])),
    );
    expect(looks(page('habits-page').blocks)).toEqual(['list', 'form']);

    // 打卡表靠习惯列表每一行的「打卡」按钮添加；习惯表本身仍然需要添加的地方。
    const doneButton = {
      as: 'button',
      label: '打卡',
      do: 'create',
      table: 'checkins',
      values: { habit: '$row' },
    };
    const both = prepare(
      base(),
      addTo(
        'habits-page',
        list('habits', { tools: [doneButton] }),
        list('checkins', { show: { title: 'habit' } }, 'history'),
      ),
    );
    expect(looks(both.page('habits-page').blocks)).toEqual(['button', 'list', 'list']);
    expect(both.page('habits-page').blocks[0]).toMatchObject({
      tools: [{ do: 'create', table: 'habits' }],
    });
  });

  it('a list that adds right where it is (addHere, D-349) is already a way to add', () => {
    const tools = [{ as: 'addHere', do: 'create', table: 'habits', ask: 'all', values: '$here' }];
    const config = apply(base(), addTo('habits-page', list('habits', { tools })));
    expect(looks(config.containers.pages[1]!.blocks)).toEqual(['list']);
  });

  it('a quick action that logs into the table is a way to add', () => {
    const config = apply(base(), [
      {
        op: 'addTool',
        tool: {
          id: 'log',
          kind: 'quickAction',
          name: '记一笔',
          steps: [
            { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
            { id: 'add', action: 'out.addRecord', params: { collectionId: 'habits' } },
          ],
        },
      },
      ...addTo('habits-page', list('habits')),
    ]);
    expect(looks(config.containers.pages[1]!.blocks)).toEqual(['list']);
  });

  it('leaves lists that were already there alone, so a button the user removed stays removed', () => {
    const withList = apply(base(), addTo('habits-page', list('habits'), form('habits', ['name'])));
    const { page } = prepare(withList, [
      { op: 'removeContainer', page: 'habits-page', block: 'form' },
    ]);
    expect(looks(page('habits-page').blocks)).toEqual(['list']);
  });

  it('adds one button per table even when the change adds two lists of it', () => {
    const { page } = prepare(
      base(),
      addTo('habits-page', list('habits'), list('habits', {}, 'cards', 'cards')),
    );
    const all = allComponents(page('habits-page'));
    expect(all.filter((c) => (c.look as unknown) === 'button')).toHaveLength(1);
    expect(looks(page('habits-page').blocks)).toEqual(['button', 'list', 'cards']);
  });

  it('is not added for a table with nothing to fill in', () => {
    const computed: Collection = {
      id: 'scores',
      name: '分数',
      fields: [{ id: 's', name: '分', type: 'formula', expression: '1 + 1' }],
    };
    const config = apply(workspace('zh'), [
      { op: 'addData', table: computed },
      {
        op: 'addContainer',
        page: 'home',
        block: { ...list('scores'), show: { title: 's' } } as NewComponent,
      },
    ]);
    expect(config.containers.pages[0]!.blocks.some((c) => c.id === 'add-scores')).toBe(false);
  });
});
