import { describe, expect, it } from 'vitest';

import { dropOp, dropSlots, moveStepOp } from './arrange';
import type { Op } from './ops';
import type { Page, WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

/** 首页：标题、分组（a、b）、添加工具、最近文件。 */
function arranged(): WorkspaceConfig {
  return apply(workspace(), [
    {
      op: 'addComponent',
      pageId: 'home',
      index: 1,
      component: {
        id: 'grid',
        type: 'group',
        props: { layout: 'grid', columns: 2 },
        children: [
          { id: 'a', type: 'divider', props: {} },
          { id: 'b', type: 'spacer', props: { size: 'small' } },
        ],
      },
    },
  ]);
}

const home = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'home')!;
const order = (page: Page) =>
  page.components.map((c) =>
    c.type === 'group' ? `${c.id}[${c.children.map((x) => x.id)}]` : c.id,
  );

function run(config: WorkspaceConfig, op: Op | null): WorkspaceConfig {
  expect(op).not.toBeNull();
  const after = apply(config, [op!]);
  expect(validateWorkspace(after, registry).ok).toBe(true);
  return after;
}

describe('moveStepOp', () => {
  it('swaps neighbours and stops at the ends', () => {
    let c = arranged();
    c = run(c, moveStepOp(home(c), 'recent-files', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'grid[a,b]', 'recent-files', 'catalog']);
    expect(moveStepOp(home(c), 'welcome', 'up')).toBeNull();
    expect(moveStepOp(home(c), 'catalog', 'down')).toBeNull();
  });

  it('steps into a group and out of the other end', () => {
    let c = arranged();
    c = run(c, moveStepOp(home(c), 'catalog', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'grid[a,b,catalog]', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'catalog', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'grid[a,catalog,b]', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'catalog', 'up'));
    c = run(c, moveStepOp(home(c), 'catalog', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'catalog', 'grid[a,b]', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'welcome', 'down'));
    expect(order(home(c))).toEqual(['catalog', 'welcome', 'grid[a,b]', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'welcome', 'down'));
    expect(order(home(c))).toEqual(['catalog', 'grid[welcome,a,b]', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'b', 'down'));
    expect(order(home(c))).toEqual(['catalog', 'grid[welcome,a]', 'b', 'recent-files']);
  });

  it('moves a group past another group without nesting it, and skips full groups', () => {
    let c = apply(arranged(), [
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'full',
          type: 'group',
          props: { layout: 'stack' },
          children: Array.from({ length: 12 }, (_, i) => ({
            id: `d${i}`,
            type: 'divider' as const,
            props: {},
          })),
        },
      },
    ]);
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    expect(home(c).components.map((x) => x.id)).toEqual([
      'welcome',
      'full',
      'grid',
      'catalog',
      'recent-files',
    ]);
    c = run(c, moveStepOp(home(c), 'welcome', 'down'));
    expect(home(c).components.map((x) => x.id)).toEqual([
      'full',
      'welcome',
      'grid',
      'catalog',
      'recent-files',
    ]);
  });
});

describe('dropOp', () => {
  it('drops before or after other components on the page', () => {
    let c = arranged();
    c = run(c, dropOp(home(c), 'welcome', { index: 4 }));
    expect(order(home(c))).toEqual(['grid[a,b]', 'catalog', 'recent-files', 'welcome']);
    c = run(c, dropOp(home(c), 'welcome', { index: 1 }));
    expect(order(home(c))).toEqual(['grid[a,b]', 'welcome', 'catalog', 'recent-files']);
  });

  it('moves into and out of groups', () => {
    let c = arranged();
    c = run(c, dropOp(home(c), 'recent-files', { parentId: 'grid', index: 1 }));
    expect(order(home(c))).toEqual(['welcome', 'grid[a,recent-files,b]', 'catalog']);
    c = run(c, dropOp(home(c), 'a', { index: 0 }));
    expect(order(home(c))).toEqual(['a', 'welcome', 'grid[recent-files,b]', 'catalog']);
    c = run(c, dropOp(home(c), 'recent-files', { parentId: 'grid', index: 2 }));
    expect(order(home(c))).toEqual(['a', 'welcome', 'grid[b,recent-files]', 'catalog']);
  });

  it('ignores drops that change nothing or are not allowed', () => {
    const page = home(arranged());
    expect(dropOp(page, 'catalog', { index: 2 })).toBeNull();
    expect(dropOp(page, 'catalog', { index: 3 })).toBeNull();
    expect(dropOp(page, 'grid', { parentId: 'grid', index: 0 })).toBeNull();
    expect(dropOp(page, 'missing', { index: 0 })).toBeNull();
    expect(dropSlots(page, 'grid')).toEqual([0, 1, 2, 3, 4].map((index) => ({ index })));
    expect(dropSlots(page, 'catalog')).toHaveLength(5 + 3);
  });
});

describe('setComponentProps', () => {
  it('null removes an optional prop', () => {
    const c = apply(workspace(), [
      {
        op: 'setComponentProps',
        pageId: 'home',
        componentId: 'welcome',
        props: { title: '新标题', subtitle: null },
      },
    ]);
    expect(home(c).components[0]!.props).toEqual({ title: '新标题' });
    expect(validateWorkspace(c, registry).ok).toBe(true);
  });
});
