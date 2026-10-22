import type { Op } from './ops';
import { GROUP_MAX_CHILDREN, type Component, type GroupComponent, type Page } from './schema';

// 直接编辑（D-052）：页面上的「上移 / 下移」和拖放翻译成 moveComponent 操作，
// 和 AI 的修改一样经过校验、生成新版本、可以撤销。

/** 插入位置：某个列表（页面顶层或某个分组）里的第 index 个位置，按移出前的列表计算。 */
export interface DropSlot {
  parentId?: string;
  index: number;
}

interface Location {
  parent?: GroupComponent;
  list: Component[];
  index: number;
  component: Component;
}

function locate(page: Page, id: string): Location | null {
  const top = page.components.findIndex((c) => c.id === id);
  if (top >= 0) return { list: page.components, index: top, component: page.components[top]! };
  for (const c of page.components) {
    if (c.type !== 'group') continue;
    const index = c.children.findIndex((x) => x.id === id);
    if (index >= 0) return { parent: c, list: c.children, index, component: c.children[index]! };
  }
  return null;
}

const hasRoom = (group: GroupComponent) => group.children.length < GROUP_MAX_CHILDREN;

function move(pageId: string, componentId: string, toIndex: number, parentId?: string): Op {
  return parentId === undefined
    ? { op: 'moveComponent', pageId, componentId, toIndex }
    : { op: 'moveComponent', pageId, componentId, toIndex, parentId };
}

/**
 * 上移 / 下移一格。经过分组时会先进入分组，再从另一头出来，所以只用箭头也能把组件移入、移出分组。
 * 已经在最上面或最下面时返回 null。
 */
export function moveStepOp(page: Page, componentId: string, direction: 'up' | 'down'): Op | null {
  const at = locate(page, componentId);
  if (!at) return null;
  const up = direction === 'up';
  if (at.parent) {
    const groupIndex = page.components.indexOf(at.parent);
    const atEdge = up ? at.index === 0 : at.index === at.list.length - 1;
    if (atEdge) return move(page.id, componentId, up ? groupIndex : groupIndex + 1);
    return move(page.id, componentId, at.index + (up ? -1 : 1), at.parent.id);
  }
  const neighbour = page.components[at.index + (up ? -1 : 1)];
  if (!neighbour) return null;
  if (neighbour.type === 'group' && at.component.type !== 'group' && hasRoom(neighbour)) {
    return move(page.id, componentId, up ? neighbour.children.length : 0, neighbour.id);
  }
  return move(page.id, componentId, at.index + (up ? -1 : 1));
}

/** 拖动时可以放下的位置：页面顶层的每个位置，以及（非分组组件）每个未满分组里的每个位置。 */
export function dropSlots(page: Page, componentId: string): DropSlot[] {
  const at = locate(page, componentId);
  if (!at) return [];
  const slots: DropSlot[] = [];
  for (let i = 0; i <= page.components.length; i++) slots.push({ index: i });
  if (at.component.type === 'group') return slots;
  for (const c of page.components) {
    if (c.type !== 'group' || (!hasRoom(c) && at.parent !== c)) continue;
    for (let i = 0; i <= c.children.length; i++) slots.push({ parentId: c.id, index: i });
  }
  return slots;
}

/** 把组件放到某个位置；位置不变或不允许时返回 null。 */
export function dropOp(page: Page, componentId: string, slot: DropSlot): Op | null {
  const at = locate(page, componentId);
  if (!at) return null;
  if (
    !dropSlots(page, componentId).some(
      (s) => s.parentId === slot.parentId && s.index === slot.index,
    )
  )
    return null;
  const sameList = (at.parent?.id ?? undefined) === slot.parentId;
  if (!sameList) return move(page.id, componentId, slot.index, slot.parentId);
  // moveComponent 的 toIndex 是移出之后的位置。
  const toIndex = slot.index > at.index ? slot.index - 1 : slot.index;
  if (toIndex === at.index) return null;
  return move(page.id, componentId, toIndex, slot.parentId);
}

const sameTarget = (a: Op, b: Op) =>
  'componentId' in a &&
  'componentId' in b &&
  a.pageId === b.pageId &&
  a.componentId === b.componentId;

/**
 * 编辑模式结束时把一串操作合并成一个版本之前，先合并相邻的同类操作（D-054）：
 * 连续移动同一个组件只保留最后一次（其他组件的相对顺序不变，结果相同），
 * 连续修改同一个组件的属性、外观或隐藏合并成一个。结果与按顺序执行原列表完全一样。
 */
export function coalesceOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out.at(-1);
    if (last && last.op === op.op && sameTarget(last, op)) {
      if (op.op === 'setComponentProps' && last.op === 'setComponentProps') {
        out[out.length - 1] = { ...op, props: { ...last.props, ...op.props } };
        continue;
      }
      if (op.op === 'setComponentStyle' && last.op === 'setComponentStyle') {
        out[out.length - 1] = { ...op, style: { ...last.style, ...op.style } };
        continue;
      }
      if (op.op === 'moveComponent' || op.op === 'setComponentHidden') {
        out[out.length - 1] = op;
        continue;
      }
    }
    out.push(op);
  }
  return out;
}
