import { dropOp, type Page } from '@morph/core';
import { findDropTarget, type ItemBox } from '../editing/drop-target';

const text = (id: string) => ({ id, type: 'text' as const, props: { text: id } });
const page: Page = { id: 'home', title: 'Home', components: [text('a'), text('b'), text('c')] };
const box = (x: number, y: number, inCell = false): ItemBox => ({
  x,
  y,
  width: 100,
  height: 80,
  inCell,
});

describe('single-component drop geometry', () => {
  it('uses x within a grid row so either cell can move to the other side', () => {
    const boxes = new Map([
      ['a', box(0, 0, true)],
      ['b', box(120, 0, true)],
      ['c', box(0, 100, true)],
    ]);
    const right = findDropTarget(page, 'a', boxes, { x: 205, y: 40 })!;
    expect(dropOp(page, 'a', right.slot)).toMatchObject({ toIndex: 1 });
    const left = findDropTarget(page, 'b', boxes, { x: 15, y: 40 })!;
    expect(dropOp(page, 'b', left.slot)).toMatchObject({ toIndex: 0 });
    expect(dropOp(page, 'a', findDropTarget(page, 'a', boxes, { x: 45, y: 40 })!.slot)).toBeNull();
  });
  it('uses y for full-width rows and keeps indices around hidden components', () => {
    const hidden = { ...text('hidden'), hidden: true };
    const p = { ...page, components: [text('a'), hidden, text('b')] };
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(0, 100)],
    ]);
    expect(findDropTarget(p, 'a', boxes, { x: 90, y: 110 })!.slot).toEqual({ index: 2 });
    expect(dropOp(p, 'a', findDropTarget(p, 'a', boxes, { x: 5, y: 175 })!.slot)).toMatchObject({
      toIndex: 2,
    });
  });
  it('enters and leaves groups, including empty groups, and excludes full groups', () => {
    const group = {
      id: 'g',
      type: 'group' as const,
      props: { layout: 'stack' as const },
      children: [text('b')],
    };
    const p = { ...page, components: [text('a'), group, text('c')] };
    const boxes = new Map([
      ['a', box(0, 0)],
      ['g', { ...box(0, 100), height: 120 }],
      ['b', box(10, 120)],
      ['c', box(0, 240)],
    ]);
    expect(findDropTarget(p, 'a', boxes, { x: 50, y: 180 })!.slot).toEqual({
      parentId: 'g',
      index: 1,
    });
    expect(dropOp(p, 'b', findDropTarget(p, 'b', boxes, { x: 50, y: 300 })!.slot)).toMatchObject({
      toIndex: 3,
    });
    const empty = { ...p, components: [text('a'), { ...group, children: [] }] };
    expect(findDropTarget(empty, 'a', boxes, { x: 50, y: 160 })!.slot).toEqual({
      parentId: 'g',
      index: 0,
    });
    const full = {
      ...p,
      components: [
        text('a'),
        { ...group, children: Array.from({ length: 12 }, (_, i) => text(`child-${i}`)) },
      ],
    };
    expect(findDropTarget(full, 'a', boxes, { x: 50, y: 160 })!.slot.parentId).toBeUndefined();
    // 分组不可拖进另一个分组，也不可拖进自己。
    expect(findDropTarget(p, 'g', boxes, { x: 50, y: 180 })!.slot.parentId).toBeUndefined();
  });
});
