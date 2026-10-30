import type { BlockChanges, Op } from './ops';
import {
  GROUP_MAX_CHILDREN,
  allComponents,
  childrenOf,
  isKnownComponent,
  parentOf,
  type Component,
  type Page,
} from './schema';

// 直接编辑（D-052）：页面上的「上移 / 下移」和拖放翻译成 moveContainer 操作，
// 和 AI 的修改一样经过校验、生成新版本、可以撤销。分组最多两层（Q3）：里面那层不能再放分组。

/** 插入位置：某个列表（页面顶层或某个分组）里的第 index 个位置，按移出前的列表计算。 */
export interface DropSlot {
  parentId?: string;
  index: number;
}

interface Location {
  parent: Component | null;
  list: Component[];
  index: number;
  component: Component;
}

function locate(page: Page, id: string): Location | null {
  const walk = (list: Component[], parent: Component | null): Location | null => {
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) return { parent, list, index, component: list[index]! };
    for (const c of list) {
      const found = walk(childrenOf(c), c);
      if (found) return found;
    }
    return null;
  };
  return walk(page.blocks, null);
}

const isGroup = (c: Component) => isKnownComponent(c) && c.look === 'group';

/** 这个分组能不能放下 moving（不看满没满）：不能放进自己里面；分组只能放进顶层的分组，而且它自己里面不能有分组。 */
function canHold(page: Page, group: Component, moving: Component): boolean {
  if (!isGroup(group) || group.id === moving.id) return false;
  if (allComponents({ ...page, blocks: childrenOf(moving) }).some((c) => c.id === group.id))
    return false;
  if (!isGroup(moving)) return true;
  return parentOf(page, group.id) === null && !childrenOf(moving).some(isGroup);
}

const hasRoom = (group: Component) => childrenOf(group).length < GROUP_MAX_CHILDREN;

function move(page: string, block: string, toIndex: number, parent?: string): Op {
  return parent === undefined
    ? { op: 'moveContainer', page, block, toIndex }
    : { op: 'moveContainer', page, block, toIndex, parent };
}

/**
 * 上移 / 下移一格。经过分组时会先进入分组，再从另一头出来，所以只用箭头也能把块移入、移出分组
 * （分组经过分组时直接越过，不会被放进去）。已经在最上面或最下面时返回 null。
 */
export function moveStepOp(page: Page, componentId: string, direction: 'up' | 'down'): Op | null {
  const at = locate(page, componentId);
  if (!at) return null;
  const up = direction === 'up';
  const atEdge = up ? at.index === 0 : at.index === at.list.length - 1;
  if (at.parent && atEdge) {
    const outer = locate(page, at.parent.id)!;
    return move(page.id, componentId, outer.index + (up ? 0 : 1), outer.parent?.id);
  }
  const neighbour = at.list[at.index + (up ? -1 : 1)];
  if (!neighbour) return null;
  if (!isGroup(at.component) && canHold(page, neighbour, at.component) && hasRoom(neighbour)) {
    return move(page.id, componentId, up ? childrenOf(neighbour).length : 0, neighbour.id);
  }
  return move(page.id, componentId, at.index + (up ? -1 : 1), at.parent?.id);
}

/** 拖动时可以放下的位置：页面顶层的每个位置，以及每个放得下它、还没满的分组里的每个位置。 */
export function dropSlots(page: Page, componentId: string): DropSlot[] {
  const at = locate(page, componentId);
  if (!at) return [];
  const slots: DropSlot[] = [];
  for (let i = 0; i <= page.blocks.length; i++) slots.push({ index: i });
  for (const c of allComponents(page)) {
    if (!canHold(page, c, at.component) || (!hasRoom(c) && at.parent !== c)) continue;
    for (let i = 0; i <= childrenOf(c).length; i++) slots.push({ parentId: c.id, index: i });
  }
  return slots;
}

/** 把块放到某个位置；位置不变或不允许时返回 null。 */
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
  // moveContainer 的 toIndex 是移出之后的位置。
  const toIndex = slot.index > at.index ? slot.index - 1 : slot.index;
  if (toIndex === at.index) return null;
  return move(page.id, componentId, toIndex, slot.parentId);
}

/** 改的是同一个块（updateContainer 改块、moveContainer）。 */
const sameBlock = (a: Op, b: Op) =>
  'block' in a &&
  'block' in b &&
  typeof a.block === 'string' &&
  a.block === b.block &&
  'page' in a &&
  'page' in b &&
  a.page === b.page;

/** 两次块的修改合成一次：show、source 逐项合并，tools、opens、hidden 取后一次，style 见下。不能合时返回 null。 */
function mergeChanges(a: BlockChanges, b: BlockChanges): BlockChanges | null {
  const out: BlockChanges = { ...a, ...b };
  for (const key of ['show', 'source'] as const)
    if (a[key] && b[key]) out[key] = { ...a[key], ...b[key] };
  if (a.style && b.style) {
    // 图片背景（D-258）是逐项合进已有的：两次修改也逐项合并。先关掉再打开不能合：打开时不带关掉前的图片。
    const [x, y] = [a.style.backdrop, b.style.backdrop];
    if (x === null && y) return null;
    const backdrop = x && y ? { backdrop: { ...x, ...y } } : {};
    out.style = { ...a.style, ...b.style, ...backdrop };
  }
  return out;
}

/**
 * 编辑模式结束时把一串操作合并成一个版本之前，先合并相邻的同类操作（D-054）：
 * 连续移动同一个块只保留最后一次（其他块的相对顺序不变，结果相同），
 * 连续修改同一个块合并成一个。结果与按顺序执行原列表完全一样。
 */
export function coalesceOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out.at(-1);
    if (last && last.op === op.op && sameBlock(last, op)) {
      if (op.op === 'moveContainer') {
        out[out.length - 1] = op;
        continue;
      }
      if (op.op === 'updateContainer' && last.op === 'updateContainer') {
        const changes = mergeChanges(last.changes as BlockChanges, op.changes as BlockChanges);
        if (changes) {
          out[out.length - 1] = { ...op, changes };
          continue;
        }
      }
    }
    out.push(op);
  }
  return out;
}
