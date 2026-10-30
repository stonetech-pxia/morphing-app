import { entryKind } from './components';
import { addMissingEntryForms } from './entry-forms';
import type { BlockChanges, Op, OpOf } from './ops-schema';
import { THEME_PRESETS } from './presets';
import {
  isRecordToolUse,
  isToolRefUse,
  type RecordToolUse,
  type ToolUse,
} from './record-ops-schema';
import type { Registry } from './registry';
import { reminderProblems } from './reminders';
import {
  FIELDS,
  HOME_PAGE_ID,
  MAX_RECORD_REMINDERS,
  MAX_REMINDERS,
  PROTECTED_TARGETS,
  allComponents,
  childrenOf,
  componentCollection,
  componentTarget,
  isKnownComponent,
  isRecordReminder,
  packageTarget,
  packageTargetId,
  pageTarget,
  patchBackdrop,
  quickActionsOf,
  toolGridToolIds,
  toolTarget,
  type BackdropPatch,
  type Collection,
  type Component,
  type KnownComponent,
  type Locale,
  type NavTarget,
  type Page,
  type QuickAction,
  type Reminder,
  type ThemeColors,
  type Tool,
  type WorkflowStep,
  type WorkspaceConfig,
} from './schema';
import { DEFAULT_THEME } from './theme';
import { REDACTED_TEXT } from './workflow/redact';
import { presetById } from './workflows/presets';

export * from './ops-schema';

// 语义化修改操作的执行（§7D，v34 一共 14 个，结构在 ops-schema.ts）。applyOps 是纯函数，不修改输入；
// 只负责执行和引用检查，完整合法性由 validateWorkspace 判定。删除时的连带清理（NEW_FORMAT §7.2）在这里做，
// 并写成 ApplyNote 在预览里告诉用户。

/** apply 过程中系统自动做出的调整，需要在预览中告知用户。 */
export type ApplyNote =
  | { kind: 'movedToFloating'; target: NavTarget }
  /** 移除页面时，打开它的按钮、入口跟着移除。 */
  | { kind: 'removedLinks'; pageId: string; count: number }
  /** 移出表时，读它的块（列表、表单、数字、图表，减它的合计的数字）跟着移除。 */
  | { kind: 'removedDataComponents'; table: string; count: number }
  /** 移除快捷操作时，运行它的块（action）跟着移除。 */
  | { kind: 'removedRunners'; tool: string; count: number }
  /** 打开这个快捷操作的按钮、入口（D-256），以及文件房间工具栏上的这一项。 */
  | { kind: 'removedWorkflowLinks'; tool: string; count: number }
  /** 提醒要打开的快捷操作 / 页面、要看的表或字段被移除了，提醒跟着移除（D-251）。 */
  | { kind: 'removedReminders'; titles: string[] }
  /**
   * 删字段、删表时，用到它的就地一键记录工具（D-304）：按钮移除，记录块上的工具去掉；
   * 勾的工具没了清单退成列表，拖动的工具没了看板只能看。
   */
  | { kind: 'removedRecordActions'; count: number }
  /** 新加的记录块所属的表没有添加的地方，在它上方补了一个「添加」按钮（D-310）。 */
  | { kind: 'addedEntryForm'; table: string }
  /** 工具包升级到当前版本，新增了这些快捷操作。 */
  | { kind: 'updatedTool'; package: string; tools: string[] };

/** 字段类型只能在这些类型之间互相转换，已有的值仍然能读出来（字段定义的 convertGroup）。 */
export const COMPATIBLE_FIELD_TYPES: readonly (readonly string[])[] = [
  ...new Set(FIELDS.flatMap((d) => (d.convertGroup ? [d.convertGroup] : []))),
].map((group) => FIELDS.filter((d) => d.convertGroup === group).map((d) => d.type));

export type ApplyResult =
  { ok: true; config: WorkspaceConfig; notes: ApplyNote[] } | { ok: false; error: string };

export interface ApplyContext {
  registry: Registry;
  /** 添加工具包时，工具包页面和快捷操作使用的语言。 */
  locale: Locale;
}

class OpError extends Error {}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 合并补丁：null 去掉这个键，undefined 不动。 */
function merge(target: Record<string, unknown>, changes: Record<string, unknown>) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete target[key];
    else if (value !== undefined) target[key] = value;
  }
  return target;
}

/** changes 里只能有这些键。 */
function onlyKeys(changes: object, allowed: readonly string[], what: string): void {
  const extra = Object.keys(changes).filter((k) => !allowed.includes(k));
  if (extra.length > 0)
    throw new OpError(`${what} can change ${allowed.join(', ')}; not ${extra.join(', ')}`);
}

// ---- 容器：页面和块 ----

function getPage(config: WorkspaceConfig, id: string): Page {
  const page = config.containers.pages.find((p) => p.id === id);
  if (!page) throw new OpError(`page ${id} not found`);
  return page;
}

interface Located {
  list: Component[];
  index: number;
  block: Component;
  /** 所在的分组；顶层是 null。 */
  parent: Component | null;
}

/** 在一串块（连同分组里的两层）里查找。 */
function findIn(list: Component[], id: string, parent: Component | null = null): Located | null {
  const index = list.findIndex((c) => c.id === id);
  if (index >= 0) return { list, index, block: list[index]!, parent };
  for (const c of list) {
    const found = findIn(childrenOf(c), id, c);
    if (found) return found;
  }
  return null;
}

const findBlock = (page: Page, id: string) => findIn(page.blocks, id);

function getBlock(page: Page, id: string): Located {
  const found = findBlock(page, id);
  if (!found) throw new OpError(`block ${id} not found on page ${page.id}`);
  return found;
}

/** 要改的块：这个版本不认识的块（D-254）只能移动和删除。 */
function known(block: Component): KnownComponent {
  if (!isKnownComponent(block)) {
    throw new OpError(
      `block ${block.id} needs a newer version of the app; it can only be moved or removed`,
    );
  }
  return block;
}

const isGroup = (c: Component) => isKnownComponent(c) && c.look === 'group';

/**
 * 块要放入的列表：页面顶层，或某个分组的子块。分组最多两层（Q3）：里面那层不能再放分组，
 * 放着分组的分组只能在页面顶层。
 */
function targetList(page: Page, parentId: string | undefined, moving: Component): Component[] {
  if (parentId === undefined) return page.blocks;
  if (parentId === moving.id) throw new OpError('a group cannot contain itself');
  if (findIn(childrenOf(moving), parentId)) throw new OpError('a group cannot contain itself');
  const { block: parent, parent: outer } = getBlock(page, parentId);
  if (!isGroup(parent)) throw new OpError(`block ${parentId} is not a group`);
  if (isGroup(moving)) {
    if (outer !== null)
      throw new OpError(
        `block ${parentId} is already inside a group; groups nest two levels at most`,
      );
    if (childrenOf(moving).some(isGroup))
      throw new OpError(
        `group ${moving.id} holds a group; it can only sit at the top of the page (groups nest two levels at most)`,
      );
  }
  return childrenOf(parent);
}

/** 文件房间预览上下的块（D-358）。 */
function deskBlocks(config: WorkspaceConfig): Component[] {
  const desk = config.containers.desk;
  return [...(desk?.above ?? []), ...(desk?.below ?? [])] as Component[];
}

/** 配置里所有的块：每个页面（连同分组里的），加上文件房间预览上下的。 */
function everyBlock(config: WorkspaceConfig): Component[] {
  return [...config.containers.pages.flatMap(allComponents), ...deskBlocks(config)];
}

/** 从所有页面（包括分组内）和文件房间预览上下删除满足条件的块，返回删除的数量。 */
function removeEverywhere(config: WorkspaceConfig, pred: (c: Component) => boolean): number {
  let count = 0;
  const prune = (list: Component[]): Component[] =>
    list.filter((c) => {
      if (pred(c)) {
        count++;
        return false;
      }
      if (isGroup(c)) (c as { children: Component[] }).children = prune(childrenOf(c));
      return true;
    });
  for (const page of config.containers.pages) page.blocks = prune(page.blocks);
  const desk = config.containers.desk;
  if (desk) {
    for (const slot of ['above', 'below'] as const) {
      if (!desk[slot]) continue;
      const kept = prune(desk[slot] as Component[]);
      if (kept.length > 0) desk[slot] = kept as never;
      else delete desk[slot];
    }
  }
  return count;
}

/** 第一个非 header 块的位置；“放到最上面”时放在页面标题之后。 */
export function topIndex(page: Page): number {
  const i = page.blocks.findIndex((c) => !isKnownComponent(c) || c.look !== 'header');
  return i < 0 ? page.blocks.length : i;
}

/** 首页上放工具包入口的位置：最后一个工具包入口之后；没有时放在「添加工具」入口之前，再没有就放在标题之后。 */
function packageEntryIndex(home: Page): number {
  const isEntry = (c: Component, kind: string) =>
    isKnownComponent(c) &&
    c.look === 'entry' &&
    entryKind(c as Parameters<typeof entryKind>[0]) === kind;
  let last = -1;
  home.blocks.forEach((c, i) => {
    if (isEntry(c, 'package')) last = i;
  });
  if (last >= 0) return last + 1;
  const catalog = home.blocks.findIndex((c) => isEntry(c, 'link'));
  return catalog >= 0 ? catalog : topIndex(home);
}

/** 某个页面上的工具宫格（look packages）已经显示这个工具包（D-181）：添加时不用再往首页放入口。 */
export function shownInToolGrid(
  config: WorkspaceConfig,
  packageId: string,
  catalog: readonly string[],
): boolean {
  return config.containers.pages.some((page) =>
    allComponents(page).some(
      (c) =>
        isKnownComponent(c) &&
        c.look === 'packages' &&
        toolGridToolIds(c, page, catalog).includes(packageId),
    ),
  );
}

/** 受保护元素不在导航栏也不在浮动入口时，自动改为浮动入口（§5.1）。 */
function keepProtectedReachable(config: WorkspaceConfig, notes: ApplyNote[]): void {
  for (const target of PROTECTED_TARGETS) {
    if (!config.nav.bar.includes(target) && !config.nav.floating.includes(target)) {
      config.nav.floating.push(target);
      notes.push({ kind: 'movedToFloating', target });
    }
  }
}

/** 导航栏和浮动入口里去掉这个页面；导航栏空了就放回首页。 */
function removeFromNav(config: WorkspaceConfig, target: NavTarget): void {
  config.nav.bar = config.nav.bar.filter((t) => t !== target);
  config.nav.floating = config.nav.floating.filter((t) => t !== target);
  if (config.nav.bar.length === 0) config.nav.bar = [pageTarget(HOME_PAGE_ID)];
}

// ---- 工具 ----

function getTool(config: WorkspaceConfig, id: string): Tool {
  const tool = config.tools.find((t) => t.id === id);
  if (!tool) throw new OpError(`tool ${id} not found`);
  return tool;
}

function getQuickAction(config: WorkspaceConfig, id: string): QuickAction {
  const tool = getTool(config, id);
  if (tool.kind !== 'quickAction')
    throw new OpError(`tool ${id} is a reminder, not a quick action`);
  return tool;
}

function getStepIndex(wf: QuickAction, stepId: string): number {
  const index = wf.steps.findIndex((s) => s.id === stepId);
  if (index < 0) throw new OpError(`step ${stepId} not found in ${wf.id}`);
  return index;
}

/**
 * 快捷操作移除后，用到它的地方跟着清掉：运行它的块（action）、打开它的按钮和入口（D-256）、文件房间工具栏上的这一项。
 * 同 ID 的内设快捷操作还在时（移除的是预设的副本）这些块仍然有效，不移除。手机桌面菜单里的总是拿掉。
 */
function removeQuickActionUses(
  config: WorkspaceConfig,
  ids: readonly string[],
): Map<string, { runners: number; links: number }> {
  const counts = new Map(ids.map((id) => [id, { runners: 0, links: 0 }]));
  const home = config.nav.phoneHomeScreen?.filter((id) => !ids.includes(id));
  if (home && home.length > 0) config.nav.phoneHomeScreen = home;
  else delete config.nav.phoneHomeScreen;
  const gone = ids.filter((id) => !presetById(id));
  if (gone.length === 0) return counts;
  const runs = (c: Component) => {
    if (!isKnownComponent(c) || c.look !== 'action') return undefined;
    const use = c.tools[0];
    return use && isToolRefUse(use) && gone.includes(use.tool) ? use.tool : undefined;
  };
  const opens = (c: Component) => {
    const target = componentTarget(c);
    return gone.find((id) => target === toolTarget(id));
  };
  removeEverywhere(config, (c) => {
    const ran = runs(c);
    if (ran) counts.get(ran)!.runners++;
    const opened = ran ? undefined : opens(c);
    if (opened) counts.get(opened)!.links++;
    return ran !== undefined || opened !== undefined;
  });
  const tools = config.containers.desk?.tools;
  if (tools) {
    for (const kind of Object.keys(tools) as (keyof typeof tools)[]) {
      const groups = (tools[kind] ?? [])
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => {
            if (typeof item !== 'string' || !gone.includes(item)) return true;
            counts.get(item)!.links++;
            return false;
          }),
        }))
        .filter((g) => g.items.length > 0);
      if (groups.length > 0) tools[kind] = groups;
      else delete tools[kind];
    }
    if (Object.keys(tools).length === 0) delete config.containers.desk!.tools;
  }
  return counts;
}

// ---- 数据 ----

function getTable(config: WorkspaceConfig, id: string): Collection {
  const table = config.data.tables.find((c) => c.id === id);
  if (!table) throw new OpError(`table ${id} not found`);
  return table;
}

function getFieldIndex(table: Collection, id: string): number {
  const index = table.fields.findIndex((f) => f.id === id);
  if (index < 0) throw new OpError(`field ${id} not found in ${table.id}`);
  return index;
}

/** 被删掉的表（field 不写）或字段。 */
interface Gone {
  table: string;
  field?: string;
}

const hasKey = (o: object | undefined, key: string) =>
  o !== undefined && Object.prototype.hasOwnProperty.call(o, key);

/** 就地的一键记录工具用到了被删掉的表或字段。 */
function recordToolUses(use: RecordToolUse, gone: Gone): boolean {
  if (use.table !== gone.table) return false;
  const id = gone.field;
  if (id === undefined) return true;
  switch (use.do) {
    case 'create':
      return (
        (typeof use.values === 'object' && hasKey(use.values, id)) ||
        (Array.isArray(use.ask) && use.ask.includes(id)) ||
        use.smartDate?.from === id ||
        use.smartDate?.to === id
      );
    case 'setAll':
      return use.field === id || (use.filter ?? []).some((c) => c.field === id);
    default:
      return use.field === id;
  }
}

/** 块（读 table 这张表）上的一个工具用到了被删掉的表或字段：工具自己的，或者 when 里的条件（读这一条）。 */
function toolUses(use: ToolUse, table: string | null, gone: Gone): boolean {
  if (
    gone.field !== undefined &&
    table === gone.table &&
    (use.when ?? []).some((c) => c.field === gone.field)
  )
    return true;
  return isRecordToolUse(use) && recordToolUses(use, gone);
}

/**
 * 删字段、删表后，用到它的就地一键记录工具（D-304）：按钮跟着移除；记录块上的工具去掉（块留着），
 * 勾的工具没了清单退成列表，拖动的工具没了看板变成只能看。添加表单不动：它问的字段由校验器指出来，
 * 让 AI 一起改（和 v33 一样）。
 */
function pruneRecordTools(config: WorkspaceConfig, gone: Gone, notes: ApplyNote[]): void {
  let count = removeEverywhere(config, (c) => {
    if (!isKnownComponent(c) || c.look !== 'button' || !c.tools) return false;
    return c.tools.some((u) => toolUses(u, null, gone));
  });
  for (const c of everyBlock(config)) {
    if (!isKnownComponent(c) || c.look === 'button' || c.look === 'form') continue;
    const block = c as { look: string; tools?: ToolUse[] };
    if (!block.tools) continue;
    const table = componentCollection(c);
    const removed = block.tools.filter((u) => toolUses(u, table, gone));
    if (removed.length === 0) continue;
    count += removed.length;
    block.tools = block.tools.filter((u) => !removed.includes(u));
    if (block.look === 'checklist' && removed.some((u) => u.as === 'check')) block.look = 'list';
    if (block.tools.length === 0) delete block.tools;
  }
  if (count > 0) notes.push({ kind: 'removedRecordActions', count });
}

// ---- 每个操作 ----

function addData(config: WorkspaceConfig, op: OpOf<'addData'>): void {
  if (typeof op.table !== 'string') {
    if (config.data.tables.some((c) => c.id === (op.table as Collection).id))
      throw new OpError(`table ${op.table.id} already exists`);
    config.data.tables.push(clone(op.table));
    return;
  }
  const table = getTable(config, op.table);
  const field = op.field!;
  if (table.fields.some((f) => f.id === field.id))
    throw new OpError(`field ${field.id} already exists in ${table.id}`);
  const index = Math.min(op.index ?? table.fields.length, table.fields.length);
  table.fields.splice(index, 0, clone(field));
}

function updateData(config: WorkspaceConfig, op: OpOf<'updateData'>): void {
  if (op.calendar !== undefined) {
    const next = merge({ ...config.data.calendar }, op.calendar);
    if (Object.keys(next).length > 0) config.data.calendar = next as never;
    else delete config.data.calendar;
    return;
  }
  const table = getTable(config, op.table!);
  const changes = op.changes!;
  if (op.field === undefined) {
    onlyKeys(changes, ['name', 'icon'], `table ${table.id}`);
    if (changes.name === null) throw new OpError(`table ${table.id} needs a name`);
    merge(table as unknown as Record<string, unknown>, changes);
    return;
  }
  const index = getFieldIndex(table, op.field);
  const old = table.fields[index]!;
  if ('id' in changes) throw new OpError('a field id cannot change');
  const newType = changes.type;
  let next: Record<string, unknown>;
  if (newType !== undefined && newType !== old.type) {
    const compatible = COMPATIBLE_FIELD_TYPES.some(
      (pair) => pair.includes(old.type) && pair.includes(String(newType)),
    );
    if (!compatible) {
      throw new OpError(
        `field ${old.id} cannot change from ${old.type} to ${String(newType)}; add a new field instead`,
      );
    }
    // 换类型时只保留通用属性，类型专属的属性由 changes 提供（例如 money 的 currency）。
    next = {
      id: old.id,
      name: old.name,
      ...('required' in old && old.required ? { required: true } : {}),
    };
  } else {
    next = { ...old };
  }
  // 合法性（例如选项 ID 唯一、默认值存在）由 validateWorkspace 检查。
  table.fields[index] = merge(next, changes) as never;
}

function removeData(config: WorkspaceConfig, op: OpOf<'removeData'>, notes: ApplyNote[]): void {
  const table = getTable(config, op.table);
  if (op.field !== undefined) {
    // 从结构里去掉字段：记录里的旧值保留，恢复旧版本时会回来。
    table.fields.splice(getFieldIndex(table, op.field), 1);
    pruneRecordTools(config, { table: op.table, field: op.field }, notes);
    return;
  }
  // D-250：别的表还引用它时不能移除，先移除那些引用字段（避免引用字段指向不存在的表）。
  const linking = config.data.tables.flatMap((c) =>
    c.id === op.table
      ? []
      : c.fields
          .filter((f) => f.type === 'link' && f.table === op.table)
          .map((f) => `${c.id}.${f.id}`),
  );
  if (linking.length > 0) {
    throw new OpError(
      `table ${op.table} is linked from ${linking.join(', ')}; remove those fields (and the blocks that show them) first`,
    );
  }
  // D-342：给这张表的一条记录用的页面要先移除。
  const recordPages = config.containers.pages.filter((p) => p.of === op.table);
  if (recordPages.length > 0) {
    throw new OpError(
      `pages ${recordPages.map((p) => p.id).join(', ')} show one entry of ${op.table}; remove them first`,
    );
  }
  // 把数据表移出界面：记录保留，可在「设置 → 数据」里导出或由用户永久删除。
  config.data.tables = config.data.tables.filter((c) => c.id !== op.table);
  // 减去这张表合计的数字（D-337）也一起移除：只留前一半会显示错的数。
  const count = removeEverywhere(
    config,
    (c) =>
      componentCollection(c) === op.table ||
      (isKnownComponent(c) && c.look === 'number' && c.source.minus?.table === op.table),
  );
  if (count > 0) notes.push({ kind: 'removedDataComponents', table: op.table, count });
  pruneRecordTools(config, { table: op.table }, notes);
}

function moveData(config: WorkspaceConfig, op: OpOf<'moveData'>): void {
  const table = getTable(config, op.table);
  const [field] = table.fields.splice(getFieldIndex(table, op.field), 1);
  table.fields.splice(Math.min(op.toIndex, table.fields.length), 0, field!);
}

function addContainer(config: WorkspaceConfig, op: OpOf<'addContainer'>): void {
  if (op.desk !== undefined) {
    const block = clone(op.block!) as Component;
    const desk = (config.containers.desk ??= {});
    if (deskBlocks(config).some((c) => c.id === block.id))
      throw new OpError(`block ${block.id} already exists in the file room`);
    const list = (desk[op.desk] ??= []) as Component[];
    list.splice(Math.min(op.index ?? list.length, list.length), 0, block);
    return;
  }
  if (typeof op.page !== 'string') {
    const page = op.page!;
    if (config.containers.pages.some((p) => p.id === page.id))
      throw new OpError(`page ${page.id} already exists`);
    config.containers.pages.push(clone(page) as Page);
    return;
  }
  const page = getPage(config, op.page);
  const block = clone(op.block!) as Component;
  if (findBlock(page, block.id))
    throw new OpError(`block ${block.id} already exists on page ${page.id}`);
  for (const child of allComponents({ ...page, blocks: childrenOf(block) }))
    if (findBlock(page, child.id))
      throw new OpError(`block ${child.id} already exists on page ${page.id}`);
  const list = targetList(page, op.parent, block);
  list.splice(Math.min(op.index ?? list.length, list.length), 0, block);
}

const PAGE_CHANGES = ['title', 'icon', 'backdrop'] as const;
const BLOCK_CHANGES = ['style', 'hidden', 'show', 'source', 'tools', 'opens'] as const;
const DESK_CHANGES = ['toolbar', 'preview', 'strip', 'tools'] as const;

function updateBlock(block: KnownComponent, changes: BlockChanges): void {
  const b = block as unknown as Record<string, unknown>;
  if (changes.style !== undefined) {
    const style: Record<string, unknown> = { ...block.style };
    for (const [key, value] of Object.entries(changes.style)) {
      if (value === null) delete style[key];
      else if (key === 'backdrop')
        style.backdrop = patchBackdrop(block.style?.backdrop, value as BackdropPatch);
      else if (value !== undefined) style[key] = value;
    }
    if (Object.keys(style).length === 0) delete block.style;
    else block.style = style;
  }
  if (changes.hidden === true) block.hidden = true;
  else if (changes.hidden === false) delete block.hidden;
  // show、source 只合并（null 去掉一项），外观不能通过这个操作改变；合法性由 validateWorkspace 检查。
  for (const key of ['show', 'source'] as const) {
    const patch = changes[key];
    if (patch === undefined) continue;
    const next = merge({ ...(b[key] as Record<string, unknown> | undefined) }, patch);
    if (Object.keys(next).length > 0) b[key] = next;
    else delete b[key];
  }
  for (const key of ['tools', 'opens'] as const) {
    const value = changes[key];
    if (value === null) delete b[key];
    else if (value !== undefined) b[key] = clone(value);
  }
}

function updateContainer(
  config: WorkspaceConfig,
  op: OpOf<'updateContainer'>,
  notes: ApplyNote[],
): void {
  if (op.nav !== undefined) {
    const { bar, floating, phoneHomeScreen } = op.nav;
    if (bar !== undefined) {
      const items = [...new Set(bar)];
      config.nav.bar = items;
      config.nav.floating = config.nav.floating.filter((t) => !items.includes(t));
    }
    if (floating !== undefined) {
      const items = [...new Set(floating)];
      config.nav.floating = items;
      config.nav.bar = config.nav.bar.filter((t) => !items.includes(t));
    }
    if (bar !== undefined) keepProtectedReachable(config, notes);
    if (phoneHomeScreen !== undefined) {
      // 放到手机桌面（长按 Morph 图标的菜单，D-271）：工具包自带的快捷操作也可以。
      const ids = [...new Set(phoneHomeScreen)];
      for (const id of ids) getQuickAction(config, id);
      if (ids.length > 0) config.nav.phoneHomeScreen = ids;
      else delete config.nav.phoneHomeScreen;
    }
    return;
  }
  if (op.desk !== undefined) {
    // 房间布局（D-358，Q7）：预览上下的块用 addContainer / removeContainer {desk}。
    onlyKeys(op.desk, DESK_CHANGES, 'the file room');
    const next = merge({ ...config.containers.desk }, op.desk);
    if (Object.keys(next).length > 0) config.containers.desk = next;
    else delete config.containers.desk;
    return;
  }
  const page = getPage(config, op.page!);
  const changes = op.changes!;
  if (op.block === undefined) {
    onlyKeys(changes, PAGE_CHANGES, `page ${page.id}`);
    const c = changes as { title?: string; icon?: string | null; backdrop?: BackdropPatch | null };
    if (c.title !== undefined) page.title = c.title;
    if (c.icon === null) delete page.icon;
    else if (c.icon !== undefined) page.icon = c.icon;
    if (c.backdrop === null) delete page.backdrop;
    else if (c.backdrop !== undefined) page.backdrop = patchBackdrop(page.backdrop, c.backdrop);
    return;
  }
  onlyKeys(changes, BLOCK_CHANGES, `block ${op.block}`);
  updateBlock(known(getBlock(page, op.block).block), changes as BlockChanges);
}

function removePage(config: WorkspaceConfig, pageId: string, notes: ApplyNote[]): void {
  if (pageId === HOME_PAGE_ID) throw new OpError('the home page cannot be removed');
  const page = getPage(config, pageId);
  if (page.package !== undefined)
    throw new OpError(`page ${pageId} belongs to tool ${page.package}; remove the tool`);
  config.containers.pages = config.containers.pages.filter((p) => p.id !== pageId);
  const target = pageTarget(pageId);
  removeFromNav(config, target);
  const count = removeEverywhere(config, (c) => componentTarget(c) === target);
  if (count > 0) notes.push({ kind: 'removedLinks', pageId, count });
  // D-342：点一条打开这一页的记录块、行上打开这一页的按钮改回打开编辑页。
  for (const c of everyBlock(config)) {
    if (!isKnownComponent(c)) continue;
    const block = c as { opens?: unknown; tools?: ToolUse[] };
    if (componentCollection(c) !== null && block.opens === pageId) delete block.opens;
    block.tools?.forEach((u) => {
      if ('opens' in u && u.opens === pageId) u.opens = 'record';
    });
  }
}

function removeContainer(
  config: WorkspaceConfig,
  op: OpOf<'removeContainer'>,
  notes: ApplyNote[],
): void {
  if (op.desk !== undefined) {
    const desk = config.containers.desk;
    const list = desk?.[op.desk] as Component[] | undefined;
    const index = list?.findIndex((c) => c.id === op.block) ?? -1;
    if (!desk || !list || index < 0)
      throw new OpError(`block ${op.block} not found ${op.desk} the preview in the file room`);
    list.splice(index, 1);
    if (list.length === 0) delete desk[op.desk];
    if (Object.keys(desk).length === 0) delete config.containers.desk;
    return;
  }
  if (op.block === undefined) return removePage(config, op.page!, notes);
  const { list, index } = getBlock(getPage(config, op.page!), op.block);
  list.splice(index, 1);
}

function moveContainer(config: WorkspaceConfig, op: OpOf<'moveContainer'>): void {
  const page = getPage(config, op.page);
  const from = getBlock(page, op.block);
  const to = targetList(page, op.parent, from.block);
  from.list.splice(from.index, 1);
  to.splice(Math.min(op.toIndex, to.length), 0, from.block);
}

function addTool(config: WorkspaceConfig, op: OpOf<'addTool'>): void {
  if (typeof op.tool === 'string') {
    const wf = getQuickAction(config, op.tool);
    const step = op.step!;
    if (wf.steps.some((s) => s.id === step.id))
      throw new OpError(`step ${step.id} already exists in ${wf.id}`);
    const at = Math.min(op.index ?? wf.steps.length, wf.steps.length);
    wf.steps.splice(at, 0, clone(step));
    return;
  }
  const tool = clone(op.tool) as Tool;
  if (config.tools.some((t) => t.id === tool.id))
    throw new OpError(`tool ${tool.id} already exists`);
  if (tool.kind === 'reminder') {
    // 按记录排的提醒另算，不占 20 个的名额（D-316）。
    const perRecord = isRecordReminder(tool);
    const max = perRecord ? MAX_RECORD_REMINDERS : MAX_REMINDERS;
    const same = config.tools.filter(
      (t) => t.kind === 'reminder' && isRecordReminder(t) === perRecord,
    );
    if (same.length >= max)
      throw new OpError(
        perRecord
          ? `at most ${MAX_RECORD_REMINDERS} reminders for each entry (when.each)`
          : `at most ${MAX_REMINDERS} reminders`,
      );
    config.tools.push(tool);
    return;
  }
  addQuickActions(config, [tool]);
}

/** 快捷操作排在提醒前面（和迁移出来的顺序一样：先 workflows，后 reminders）。 */
function addQuickActions(config: WorkspaceConfig, list: readonly QuickAction[]): void {
  config.tools.splice(quickActionsOf(config).length, 0, ...list);
}

/** 整体替换步骤（快捷操作编辑页保存、恢复预设）。AI 看到的是占位符（D-065）：同一步原样写回占位符表示保留原来的文字。 */
function replaceSteps(wf: QuickAction, steps: unknown): WorkflowStep[] {
  if (!Array.isArray(steps) || steps.length === 0)
    throw new OpError(`steps of ${wf.id} must be a list of at least one step`);
  const ids = new Set<string>();
  const old = new Map(wf.steps.map((s) => [s.id, s]));
  return (steps as WorkflowStep[]).map((s) => {
    if (typeof s !== 'object' || s === null || typeof s.params !== 'object' || s.params === null)
      throw new OpError(`each step of ${wf.id} needs {id, action, params}`);
    if (ids.has(s.id)) throw new OpError(`step ${s.id} appears twice in ${wf.id}`);
    ids.add(s.id);
    const params = Object.fromEntries(
      Object.entries(s.params)
        .map(([k, v]) => [k, v === REDACTED_TEXT ? old.get(s.id)?.params[k] : v] as const)
        .filter(([, v]) => v !== undefined),
    );
    return clone({ ...s, params });
  });
}

function updateTool(config: WorkspaceConfig, op: OpOf<'updateTool'>): void {
  const tool = getTool(config, op.tool);
  const changes = op.changes;
  if (op.step !== undefined) {
    const wf = getQuickAction(config, op.tool);
    const step = wf.steps[getStepIndex(wf, op.step)]!;
    onlyKeys(changes, ['params', 'ask'], `step ${op.step}`);
    if (changes.params !== undefined) {
      if (typeof changes.params !== 'object' || changes.params === null)
        throw new OpError(`params of step ${op.step} must be an object`);
      // AI 看到的是占位符（D-065）：原样写回占位符表示不改这个参数。
      const params = Object.entries(changes.params).filter(([, v]) => v !== REDACTED_TEXT);
      step.params = { ...step.params, ...Object.fromEntries(params) };
    }
    if (changes.ask !== undefined) {
      if (!Array.isArray(changes.ask) || changes.ask.some((k) => typeof k !== 'string'))
        throw new OpError(`ask of step ${op.step} must be a list of parameter names`);
      if (changes.ask.length === 0) delete step.ask;
      else step.ask = [...new Set(changes.ask as string[])];
    }
    return;
  }
  if (tool.kind === 'quickAction') {
    onlyKeys(changes, ['name', 'icon', 'steps'], `quick action ${tool.id}`);
    if (changes.name === null) throw new OpError(`quick action ${tool.id} needs a name`);
    if (typeof changes.name === 'string') tool.name = changes.name;
    if (changes.icon === null) delete tool.icon;
    else if (changes.icon !== undefined) tool.icon = changes.icon as string;
    if (changes.steps !== undefined) tool.steps = replaceSteps(tool, changes.steps);
    return;
  }
  for (const key of ['id', 'kind', 'package', 'preset'])
    if (key in changes) throw new OpError(`a reminder's ${key} cannot change`);
  // 合并进提醒；null 去掉可选的键。合法性由 validateWorkspace 检查。
  const next = merge({ ...tool }, changes) as unknown as Reminder;
  config.tools = config.tools.map((t) => (t.id === tool.id ? next : t));
}

function removeTool(config: WorkspaceConfig, op: OpOf<'removeTool'>, notes: ApplyNote[]): void {
  const tool = getTool(config, op.tool);
  if (op.step !== undefined) {
    const wf = getQuickAction(config, op.tool);
    wf.steps.splice(getStepIndex(wf, op.step), 1);
    return;
  }
  if (tool.package !== undefined) {
    throw new OpError(
      `${tool.id} belongs to tool ${tool.package}; remove the tool${tool.kind === 'quickAction' ? ' or remove steps instead' : ''}`,
    );
  }
  config.tools = config.tools.filter((t) => t.id !== op.tool);
  if (tool.kind !== 'quickAction') return;
  const { runners, links } = removeQuickActionUses(config, [op.tool]).get(op.tool)!;
  if (runners > 0) notes.push({ kind: 'removedRunners', tool: op.tool, count: runners });
  if (links > 0) notes.push({ kind: 'removedWorkflowLinks', tool: op.tool, count: links });
}

function moveTool(config: WorkspaceConfig, op: OpOf<'moveTool'>): void {
  const wf = getQuickAction(config, op.tool);
  const [step] = wf.steps.splice(getStepIndex(wf, op.step), 1);
  wf.steps.splice(Math.min(op.toIndex, wf.steps.length), 0, step!);
}

function setTheme(config: WorkspaceConfig, op: OpOf<'setTheme'>): void {
  if (op.reset) {
    config.theme = clone(DEFAULT_THEME);
    return;
  }
  if (op.preset !== undefined) {
    config.theme = clone(THEME_PRESETS[op.preset].theme);
    return;
  }
  const { op: _, preset: _p, reset: _r, colors, darkColors, ...tokens } = op;
  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) (config.theme as Record<string, unknown>)[key] = value;
  }
  const setColors = (target: ThemeColors, changes: typeof colors) => {
    for (const [key, value] of Object.entries(changes ?? {})) {
      const k = key as keyof ThemeColors;
      if (value === null) delete target[k];
      else if (value !== undefined) target[k] = value;
    }
  };
  setColors(config.theme.colors, colors);
  if (darkColors) {
    const dark = (config.theme.darkColors ??= {});
    setColors(dark, darkColors);
    if (Object.keys(dark).length === 0) delete config.theme.darkColors;
  }
}

function addPackage(config: WorkspaceConfig, id: string, ctx: ApplyContext): void {
  if (config.packages.some((t) => t.id === id)) throw new OpError(`tool ${id} is already added`);
  const def = ctx.registry.tools.get(id);
  if (!def) throw new OpError(`tool ${id} is not in the catalog`);
  const page = def.createPage(ctx.locale);
  if (config.containers.pages.some((p) => p.id === page.id))
    throw new OpError(`page ${page.id} exists`);
  const tools = def.createWorkflows(ctx.locale);
  for (const wf of tools)
    if (config.tools.some((w) => w.id === wf.id)) throw new OpError(`tool ${wf.id} exists`);
  config.containers.pages.push(page);
  addQuickActions(config, tools);
  config.packages.push({ id: def.id, version: def.version, page: page.id });
  if (shownInToolGrid(config, def.id, [...ctx.registry.tools.keys()])) return;
  const home = getPage(config, HOME_PAGE_ID);
  // 和 v33 的 toolCard 一样：标题、图标按工具包现取，默认是大块。
  home.blocks.splice(packageEntryIndex(home), 0, {
    id: `card-${def.id}`,
    look: 'entry',
    show: { shape: 'tile' },
    opens: packageTarget(def.id),
  });
}

function removePackage(config: WorkspaceConfig, id: string): void {
  const installed = config.packages.find((t) => t.id === id);
  if (!installed) throw new OpError(`tool ${id} is not added`);
  // 只移除入口、页面和快捷操作、提醒；用户文件不在配置中，不受影响（§7G）。
  const target = pageTarget(installed.page);
  config.packages = config.packages.filter((t) => t.id !== id);
  config.containers.pages = config.containers.pages.filter((p) => p.package !== id);
  const own = config.tools.filter((t) => t.package === id);
  config.tools = config.tools.filter((t) => t.package !== id);
  removeQuickActionUses(
    config,
    own.filter((t) => t.kind === 'quickAction').map((t) => t.id),
  );
  removeEverywhere(config, (c) => {
    const opens = componentTarget(c);
    return opens === target || (opens !== null && packageTargetId(opens) === id);
  });
  removeFromNav(config, target);
}

function updatePackage(
  config: WorkspaceConfig,
  id: string,
  ctx: ApplyContext,
  notes: ApplyNote[],
): void {
  const installed = config.packages.find((t) => t.id === id);
  if (!installed) throw new OpError(`tool ${id} is not added`);
  const def = ctx.registry.tools.get(id);
  if (!def) throw new OpError(`tool ${id} is not in the catalog`);
  if (installed.version === def.version) throw new OpError(`tool ${id} is up to date`);
  const page = getPage(config, installed.page);
  const added = def
    .createWorkflows(ctx.locale)
    .filter((wf) => !config.tools.some((w) => w.id === wf.id));
  addQuickActions(config, added);
  // 新入口放在文件列表之前（没有文件列表时放在最后）。
  const files = page.blocks.findIndex((c) => isKnownComponent(c) && c.look === 'files');
  let at = files >= 0 ? files : page.blocks.length;
  for (const wf of added) {
    let blockId = `${wf.id}-runner`;
    for (let i = 2; findBlock(page, blockId); i++) blockId = `${wf.id}-runner-${i}`;
    page.blocks.splice(at++, 0, { id: blockId, look: 'action', tools: [{ tool: wf.id }] });
  }
  installed.version = def.version;
  notes.push({ kind: 'updatedTool', package: id, tools: added.map((w) => w.id) });
}

function applyOne(config: WorkspaceConfig, op: Op, ctx: ApplyContext, notes: ApplyNote[]): void {
  switch (op.op) {
    case 'addData':
      return addData(config, op);
    case 'updateData':
      return updateData(config, op);
    case 'removeData':
      return removeData(config, op, notes);
    case 'moveData':
      return moveData(config, op);
    case 'addContainer':
      return addContainer(config, op);
    case 'updateContainer':
      return updateContainer(config, op, notes);
    case 'removeContainer':
      return removeContainer(config, op, notes);
    case 'moveContainer':
      return moveContainer(config, op);
    case 'addTool':
      return addTool(config, op);
    case 'updateTool':
      return updateTool(config, op);
    case 'removeTool':
      return removeTool(config, op, notes);
    case 'moveTool':
      return moveTool(config, op);
    case 'setTheme':
      return setTheme(config, op);
    case 'setPackage':
      if (op.do === 'add') return addPackage(config, op.package, ctx);
      if (op.do === 'remove') return removePackage(config, op.package);
      return updatePackage(config, op.package, ctx, notes);
  }
}

export function applyOps(
  config: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ApplyContext,
): ApplyResult {
  const next = clone(config);
  const notes: ApplyNote[] = [];
  try {
    for (const op of ops) applyOne(next, op, ctx, notes);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  for (const table of addMissingEntryForms(config, next, ctx.locale))
    notes.push({ kind: 'addedEntryForm', table });
  pruneReminders(config, next, notes);
  return { ok: true, config: next, notes };
}

/**
 * 原来好好的提醒，因为这批修改移除了它要打开的快捷操作 / 页面、要看的表或字段而失效：跟着移除并在说明里写出来
 * （移除快捷操作、页面、表、字段，移除工具包都会这样）。这批修改里新加或改过的提醒不动，有问题由校验器拒绝。
 */
function pruneReminders(before: WorkspaceConfig, after: WorkspaceConfig, notes: ApplyNote[]) {
  const removed: string[] = [];
  after.tools = after.tools.filter((r) => {
    if (r.kind !== 'reminder') return true;
    const old = before.tools.find((x) => x.id === r.id);
    const unchanged = old !== undefined && JSON.stringify(old) === JSON.stringify(r);
    if (!unchanged || reminderProblems(r, after).length === 0) return true;
    removed.push(r.title);
    return false;
  });
  if (removed.length > 0) notes.push({ kind: 'removedReminders', titles: removed });
}
