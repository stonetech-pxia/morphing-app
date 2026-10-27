import { describe, expect, it } from 'vitest';

import { prepareOps, prepareSnapshot } from './change';
import { componentLabel, describeChange } from './describe';
import type { Op } from './ops';
import type { Locale, WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// D-254：更新的 App 加的组件，这个版本不认识。读取时原样保留、保存时写回；AI 不能新加或改动它们。

const calendar = {
  id: 'cal',
  type: 'calendar',
  props: { collectionId: 'events', view: 'month', future: { nested: [1, 2, 3] } },
  style: { tone: 'primary' },
};
const inGroup = { id: 'map', type: 'map', props: { zoom: 3 }, hidden: true };

/** 一份更新的 App 存下来的配置：首页上有一个不认识的组件，分组里还有一个。 */
function stored(locale: Locale = 'en'): unknown {
  const config = JSON.parse(JSON.stringify(workspace(locale))) as {
    pages: { components: unknown[] }[];
  };
  config.pages[0]!.components.push(calendar, {
    id: 'box',
    type: 'group',
    props: { layout: 'row' },
    children: [{ id: 'hi', type: 'header', props: { title: 'Hi' } }, inGroup],
  });
  return config;
}

function load(raw: unknown = stored()): WorkspaceConfig {
  const prepared = prepareSnapshot(raw, registry);
  if (!prepared.ok) throw new Error(prepared.issues.join('\n'));
  return prepared.after;
}

const ctx = { registry, locale: 'en' as const, now: new Date(2026, 9, 27) };

function change(config: WorkspaceConfig, ops: unknown[]) {
  return prepareOps(config, ops, ctx);
}

describe('components from a newer app (D-254)', () => {
  it('loads a stored config that has them, top level and inside a group', () => {
    const config = load();
    const home = config.pages[0]!;
    expect(home.components.at(-2)).toEqual(calendar);
    expect(home.components.at(-1)).toMatchObject({ children: [{ id: 'hi' }, inGroup] });
  });

  it('saves them back exactly as they were', () => {
    const raw = stored();
    expect(JSON.parse(JSON.stringify(load(raw)))).toEqual(raw);
  });

  it('is still strict when nothing says to keep them', () => {
    const result = validateWorkspace(stored(), registry);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toContain('schema');
  });

  it('still checks the parts it can read: id and hidden', () => {
    const raw = stored() as { pages: { components: Record<string, unknown>[] }[] };
    raw.pages[0]!.components.push({ id: 'Bad Id', type: 'calendar', props: {} });
    expect(prepareSnapshot(raw, registry).ok).toBe(false);
  });

  it('keeps them through other changes', () => {
    const result = change(load(), [{ op: 'setTheme', primaryColor: '#2F9E44' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.pages[0]!.components).toContainEqual(calendar);
    expect(JSON.parse(JSON.stringify(result.after))).toMatchObject({
      pages: [{ components: expect.arrayContaining([calendar]) }],
    });
  });

  it('can be moved, also into a group, and removed', () => {
    const config = load();
    const moved = change(config, [
      { op: 'moveComponent', pageId: 'home', componentId: 'cal', toIndex: 0 },
    ]);
    expect(moved.ok && moved.after.pages[0]!.components[0]).toEqual(calendar);
    const grouped = change(config, [
      { op: 'moveComponent', pageId: 'home', componentId: 'cal', toIndex: 0, parentId: 'box' },
    ]);
    expect(grouped.ok).toBe(true);
    const removed = change(config, [
      { op: 'removeComponent', pageId: 'home', componentId: 'cal' },
      { op: 'removeComponent', pageId: 'home', componentId: 'map' },
    ]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(JSON.stringify(removed.after)).not.toContain('calendar');
    expect(removed.lines).toEqual([
      'Remove content from a newer version of this app from “Home”',
      'Remove content from a newer version of this app from “Home”',
    ]);
  });

  it('can not be changed', () => {
    const config = load();
    for (const op of [
      { op: 'setComponentProps', pageId: 'home', componentId: 'cal', props: { view: 'week' } },
      { op: 'setComponentStyle', pageId: 'home', componentId: 'cal', style: { tone: null } },
      { op: 'setComponentHidden', pageId: 'home', componentId: 'cal', hidden: true },
    ]) {
      const result = change(config, [op]);
      expect(result).toEqual({
        ok: false,
        stage: 'apply',
        issues: ['component cal needs a newer version of the app; it can only be moved or removed'],
      });
    }
  });

  it('can not be added by the AI', () => {
    const config = load();
    const add = change(config, [
      { op: 'addComponent', pageId: 'home', component: { ...calendar, id: 'cal2' } },
    ]);
    expect(add.ok ? null : add.stage).toBe('parse');
    const page = change(config, [
      {
        op: 'addPage',
        page: { id: 'p', title: 'P', components: [{ ...calendar, id: 'cal2' }] },
      },
    ]);
    expect(page.ok ? null : page.stage).toBe('parse');
  });

  it('a modified or new one is rejected by validation even if an op let it through', () => {
    const before = load();
    const changed = JSON.parse(JSON.stringify(before)) as WorkspaceConfig;
    (changed.pages[0]!.components.at(-2) as unknown as typeof calendar).props.view = 'week';
    expect(validateWorkspace(changed, registry, { unknownComponents: before }).ok).toBe(false);
    const added = JSON.parse(JSON.stringify(before)) as { pages: { components: unknown[] }[] };
    added.pages[0]!.components.push({ ...calendar, id: 'cal2' });
    expect(validateWorkspace(added, registry, { unknownComponents: before }).ok).toBe(false);
    expect(validateWorkspace(before, registry, { unknownComponents: before }).ok).toBe(true);
  });

  it('describes them in every language', () => {
    for (const locale of ['en', 'zh', 'fr'] as Locale[]) {
      const config = load(stored(locale));
      const label = componentLabel(config.pages[0]!.components.at(-2)!, config, {
        ...ctx,
        locale,
      });
      expect(label).toBe(
        {
          en: 'content from a newer version of this app',
          zh: '新版本 App 才能显示的内容',
          fr: 'contenu d’une version plus récente de cette app',
        }[locale],
      );
      const ops: Op[] = [{ op: 'removeComponent', pageId: 'home', componentId: 'cal' }];
      expect(describeChange(ops, config, [], { ...ctx, locale })[0]).toContain(label);
    }
  });
});
