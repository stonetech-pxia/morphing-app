import { describe, expect, it } from 'vitest';

import { coalesceOps, dropOp, dropSlots, moveStepOp } from './arrange';
import type { BlockChanges, Op } from './ops';
import { childrenOf, type KnownComponent, type Page, type WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

/** 首页：标题、分组（a、b）、添加工具、最近文件。 */
function arranged(): WorkspaceConfig {
  return apply(workspace(), [
    {
      op: 'addContainer',
      page: 'home',
      index: 1,
      block: {
        id: 'grid',
        look: 'group',
        show: { layout: 'grid', columns: 2 },
        children: [
          { id: 'a', look: 'divider' },
          { id: 'b', look: 'spacer', show: { size: 'small' } },
        ],
      },
    },
  ]);
}

const home = (c: WorkspaceConfig) => c.containers.pages.find((p) => p.id === 'home')!;
const orderOf = (list: readonly Page['blocks'][number][]): string[] =>
  list.map((c) =>
    (c as KnownComponent).look === 'group' ? `${c.id}[${orderOf(childrenOf(c))}]` : c.id,
  );
const order = (page: Page) => orderOf(page.blocks);

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
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'full',
          look: 'group',
          show: { layout: 'stack' },
          children: Array.from({ length: 12 }, (_, i) => ({
            id: `d${i}`,
            look: 'divider' as const,
          })),
        },
      },
    ]);
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    c = run(c, moveStepOp(home(c), 'full', 'up'));
    expect(home(c).blocks.map((x) => x.id)).toEqual([
      'welcome',
      'full',
      'grid',
      'catalog',
      'recent-files',
    ]);
    c = run(c, moveStepOp(home(c), 'welcome', 'down'));
    expect(home(c).blocks.map((x) => x.id)).toEqual([
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

describe('updateContainer show', () => {
  it('null removes an optional key', () => {
    const c = apply(workspace(), [
      {
        op: 'updateContainer',
        page: 'home',
        block: 'welcome',
        changes: { show: { title: '新标题', subtitle: null } },
      },
    ]);
    expect((home(c).blocks[0] as { show: unknown }).show).toEqual({ title: '新标题' });
    expect(validateWorkspace(c, registry).ok).toBe(true);
  });
});

describe('coalesceOps', () => {
  it('merges consecutive changes of one component without changing the result', () => {
    let c = arranged();
    const ops: Op[] = [];
    const step = (op: Op | null) => {
      ops.push(op!);
      c = run(c, op);
    };
    step(moveStepOp(home(c), 'catalog', 'up'));
    step(moveStepOp(home(c), 'catalog', 'up'));
    step(moveStepOp(home(c), 'catalog', 'up'));
    const change = (block: string, changes: BlockChanges): Op => ({
      op: 'updateContainer',
      page: 'home',
      block,
      changes,
    });
    step(change('catalog', { style: { tone: 'primary' } }));
    step(change('catalog', { style: { size: 'large' } }));
    step(change('catalog', { style: { tone: null } }));
    step(change('welcome', { show: { title: 'A' } }));
    step(change('welcome', { show: { subtitle: null } }));
    step(change('a', { hidden: true }));
    step(change('a', { hidden: false }));
    step(moveStepOp(home(c), 'b', 'down'));
    step(moveStepOp(home(c), 'recent-files', 'up'));

    const merged = coalesceOps(ops);
    expect(merged.map((o) => ('block' in o ? `${o.op} ${o.block}` : o.op))).toEqual([
      'moveContainer catalog',
      'updateContainer catalog',
      'updateContainer welcome',
      'updateContainer a',
      'moveContainer b',
      'moveContainer recent-files',
    ]);
    expect(apply(arranged(), merged)).toEqual(c);
  });

  it('picture background changes merge field by field (D-258)', () => {
    const style = (backdrop: unknown): Op =>
      ({
        op: 'updateContainer',
        page: 'home',
        block: 'catalog',
        changes: { style: { backdrop } },
      }) as Op;
    for (const ops of [
      // 选了图片再调遮罩：图片要留着。
      [style({ assetId: 'abc123def' }), style({ overlay: 'strong' })],
      // 关掉以后再打开：不能把关掉之前的图片带回来。
      [style({ assetId: 'abc123def' }), style(null), style({ overlay: 'light' })],
      [style({ overlay: 'light' }), style({ assetId: null }), style({ overlay: 'medium' })],
    ]) {
      const sequential = ops.reduce((c, op) => run(c, op), arranged());
      expect(apply(arranged(), coalesceOps(ops)), JSON.stringify(ops)).toEqual(sequential);
    }
  });
});

describe('two levels of groups (Q3)', () => {
  /** 首页：标题、外层分组 grid（a、内层分组 inner（x）、b）、添加工具、最近文件。 */
  function nested(): WorkspaceConfig {
    return apply(arranged(), [
      {
        op: 'addContainer',
        page: 'home',
        parent: 'grid',
        index: 1,
        block: {
          id: 'inner',
          look: 'group',
          show: { layout: 'row' },
          children: [{ id: 'x', look: 'divider' }],
        },
      },
    ]);
  }

  it('arrows step into an inner group and out to the outer group', () => {
    let c = nested();
    expect(order(home(c))).toEqual(['welcome', 'grid[a,inner[x],b]', 'catalog', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'a', 'down'));
    expect(order(home(c))).toEqual(['welcome', 'grid[inner[a,x],b]', 'catalog', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'x', 'down'));
    expect(order(home(c))).toEqual(['welcome', 'grid[inner[a],x,b]', 'catalog', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'a', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'grid[a,inner[],x,b]', 'catalog', 'recent-files']);
  });

  it('an inner group moves past blocks inside its group but never into another group', () => {
    let c = nested();
    c = run(c, moveStepOp(home(c), 'inner', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'grid[inner[x],a,b]', 'catalog', 'recent-files']);
    c = run(c, moveStepOp(home(c), 'inner', 'up'));
    expect(order(home(c))).toEqual(['welcome', 'inner[x]', 'grid[a,b]', 'catalog', 'recent-files']);
  });

  it('a group without groups inside can be dropped into a top-level group, not into an inner one', () => {
    const page = home(nested());
    const c = apply(nested(), [
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'loose', look: 'group', show: { layout: 'stack' }, children: [] },
      },
    ]);
    const slots = dropSlots(home(c), 'loose');
    expect(slots.filter((s) => s.parentId === 'grid')).toHaveLength(4);
    expect(slots.some((s) => s.parentId === 'inner')).toBe(false);
    // 放着分组的分组只能在页面顶层。
    expect(dropSlots(page, 'grid').every((s) => s.parentId === undefined)).toBe(true);
    // 普通块两层都能放。
    expect(dropSlots(page, 'catalog').filter((s) => s.parentId === 'inner')).toHaveLength(2);
    run(c, dropOp(home(c), 'loose', { parentId: 'grid', index: 0 }));
  });
});
