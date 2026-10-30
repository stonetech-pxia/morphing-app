import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import type { Collection, Component, NewComponent, WorkspaceConfig } from './schema';
import { allComponents } from './schema';
import { apply, registry, workspace } from './test-helpers';

// D-310：AI 新加了一个列表，而这张表在整个 App 里没有任何添加入口时，
// 在列表上方补一个「添加」按钮（打开完整的添加页），并在草稿说明里写出来。

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
    { id: 'habit', name: '习惯', type: 'link', collectionId: 'habits' },
    { id: 'day', name: '日期', type: 'date', default: 'today' },
  ],
};

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 30) };

const base = (): WorkspaceConfig =>
  apply(workspace('zh'), [
    { op: 'addCollection', collection: habits },
    { op: 'addCollection', collection: checkins },
    { op: 'addPage', page: { id: 'habits-page', title: '习惯', components: [] } },
  ]);

const list = (collectionId: string, extra: Record<string, unknown> = {}, id = 'list') =>
  ({
    id,
    type: 'recordList',
    props: { collectionId, display: 'list', titleField: 'name', limit: 50, ...extra },
  }) as NewComponent;
const form = (collectionId: string, fieldIds: string[]): NewComponent =>
  ({
    id: 'form',
    type: 'recordForm',
    props: { collectionId, fieldIds, submitLabel: '添加', mode: 'inline' },
  }) as NewComponent;

const addTo = (pageId: string, ...components: NewComponent[]): Op[] =>
  components.map((component) => ({ op: 'addComponent', pageId, component }));

function prepare(config: WorkspaceConfig, ops: Op[]) {
  const result = prepareOps(config, ops, ctx);
  if (!result.ok) throw new Error(result.issues.join('; '));
  const page = (id: string) => result.after.pages.find((p) => p.id === id)!;
  return { ...result, page };
}
const types = (components: readonly Component[]) => components.map((c) => c.type);

describe('a new list of a table that has no way to add entries (D-310)', () => {
  it('gets an Add button right above it that opens the full form', () => {
    const { page, lines } = prepare(base(), addTo('habits-page', list('habits')));
    const components = page('habits-page').components;
    expect(types(components)).toEqual(['recordForm', 'recordList']);
    expect(components[0]).toMatchObject({
      type: 'recordForm',
      // 公式算出来的，不放进表单。
      props: {
        collectionId: 'habits',
        fieldIds: ['name', 'goal'],
        mode: 'button',
        submitLabel: '添加',
      },
    });
    expect(lines).toContain('「习惯」还没有添加的地方，同时在列表上方加一个「添加」按钮');
  });

  it('uses the interface language for the button and the note', () => {
    const config = base();
    const en = prepareOps(config, addTo('habits-page', list('habits')), { ...ctx, locale: 'en' });
    expect(
      en.ok && en.after.pages.find((p) => p.id === 'habits-page')!.components[0],
    ).toMatchObject({ props: { submitLabel: 'Add' } });
    expect(en.ok && en.lines).toContain(
      '“习惯” had no way to add entries, so this also adds an “Add” button above the list',
    );
  });

  it('goes above the row group when the list sits in one', () => {
    const group = {
      id: 'row',
      type: 'group',
      props: { layout: 'stack' },
      children: [list('habits')],
    } as unknown as NewComponent;
    const { page } = prepare(base(), addTo('habits-page', group));
    expect(types(page('habits-page').components)).toEqual(['recordForm', 'group']);
  });

  it('is not added when the table already has a way to add entries anywhere', () => {
    const withForm = apply(base(), addTo('home', form('habits', ['name'])));
    expect(
      types(prepare(withForm, addTo('habits-page', list('habits'))).page('habits-page').components),
    ).toEqual(['recordList']);

    const openButton = {
      id: 'new',
      type: 'button',
      props: { label: '新习惯', variant: 'filled', action: { do: 'open', collectionId: 'habits' } },
    } as NewComponent;
    const withButton = apply(base(), addTo('home', openButton));
    expect(
      types(
        prepare(withButton, addTo('habits-page', list('habits'))).page('habits-page').components,
      ),
    ).toEqual(['recordList']);
  });

  it('counts a form or a row button added in the same change', () => {
    const { page } = prepare(
      base(),
      addTo('habits-page', list('habits'), form('habits', ['name'])),
    );
    expect(types(page('habits-page').components)).toEqual(['recordList', 'recordForm']);

    // 打卡表靠习惯列表每一行的「打卡」按钮添加；习惯表本身仍然需要添加的地方。
    const doneButton = {
      label: '打卡',
      do: 'create',
      collectionId: 'checkins',
      values: { habit: 'row' },
    };
    const both = prepare(
      base(),
      addTo(
        'habits-page',
        list('habits', { rowActions: [doneButton] }),
        list('checkins', { titleField: 'habit' }, 'history'),
      ),
    );
    expect(types(both.page('habits-page').components)).toEqual([
      'recordForm',
      'recordList',
      'recordList',
    ]);
    expect(both.page('habits-page').components[0]).toMatchObject({
      props: { collectionId: 'habits' },
    });
  });

  it('a list that adds right where it is (addHere, D-349) is already a way to add', () => {
    const { page } = prepare(base(), addTo('habits-page', list('habits', { addHere: true })));
    expect(types(page('habits-page').components)).toEqual(['recordList']);
  });

  it('leaves lists that were already there alone, so a form the user removed stays removed', () => {
    const withList = apply(base(), addTo('habits-page', list('habits'), form('habits', ['name'])));
    const { page } = prepare(withList, [
      { op: 'removeComponent', pageId: 'habits-page', componentId: 'form' },
    ]);
    expect(types(page('habits-page').components)).toEqual(['recordList']);
  });

  it('adds one button per table even when the change adds two lists of it', () => {
    const { page } = prepare(
      base(),
      addTo('habits-page', list('habits'), list('habits', { display: 'cards' }, 'cards')),
    );
    const all = allComponents(page('habits-page'));
    expect(all.filter((c) => c.type === 'recordForm')).toHaveLength(1);
    expect(types(page('habits-page').components)).toEqual([
      'recordForm',
      'recordList',
      'recordList',
    ]);
  });
});
