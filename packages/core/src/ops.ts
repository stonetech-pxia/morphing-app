import { z } from 'zod';

import type { Registry } from './registry';
import {
  CollectionSchema,
  ComponentSchema,
  FieldSchema,
  ComponentStyleSchema,
  FONT_CHOICES,
  HOME_PAGE_ID,
  HexColorSchema,
  IconValueSchema,
  IdSchema,
  NavTargetSchema,
  PROTECTED_TARGETS,
  PageSchema,
  ThemeSchema,
  componentCollection,
  componentTarget,
  pageTarget,
  type Collection,
  type Component,
  type GroupComponent,
  type Locale,
  type NavTarget,
  type Page,
  type ThemeColors,
  type WorkspaceConfig,
} from './schema';
import { DEFAULT_THEME } from './theme';

// 语义化修改操作（§7D）。AI 只能输出这些操作；applyOps 是纯函数，不修改输入。
// apply 只负责执行和引用检查，完整合法性由 validateWorkspace 判定。

const pageId = IdSchema;
const componentId = IdSchema;
/** null 表示恢复默认值。 */
const resettable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const ColorOverridesSchema = z.strictObject({
  background: resettable(HexColorSchema),
  surface: resettable(HexColorSchema),
  text: resettable(HexColorSchema),
  secondary: resettable(HexColorSchema),
  tertiary: resettable(HexColorSchema),
});

export const OpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('setTheme'),
    primaryColor: HexColorSchema.optional(),
    mode: ThemeSchema.shape.mode.optional(),
    colors: ColorOverridesSchema.optional(),
    darkColors: ColorOverridesSchema.optional(),
    font: z.enum(FONT_CHOICES).optional(),
    fontScale: ThemeSchema.shape.fontScale.optional(),
    radius: ThemeSchema.shape.radius.optional(),
    density: ThemeSchema.shape.density.optional(),
    cardStyle: ThemeSchema.shape.cardStyle.optional(),
    navStyle: ThemeSchema.shape.navStyle.optional(),
    backdrop: ThemeSchema.shape.backdrop,
  }),
  z.strictObject({ op: z.literal('resetTheme') }),
  z.strictObject({ op: z.literal('setNavItems'), items: z.array(NavTargetSchema).min(1).max(5) }),
  z.strictObject({ op: z.literal('setFloatingItems'), items: z.array(NavTargetSchema).max(3) }),
  z.strictObject({ op: z.literal('setPageTitle'), pageId, title: z.string() }),
  z.strictObject({ op: z.literal('setPageIcon'), pageId, icon: IconValueSchema.nullable() }),
  z.strictObject({ op: z.literal('addPage'), page: PageSchema.omit({ toolId: true }) }),
  z.strictObject({ op: z.literal('removePage'), pageId }),
  z.strictObject({
    op: z.literal('moveComponent'),
    pageId,
    componentId,
    toIndex: z.number().int().min(0),
    /** 移入某个分组；省略时移到页面顶层。 */
    parentId: componentId.optional(),
  }),
  z.strictObject({
    op: z.literal('setComponentProps'),
    pageId,
    componentId,
    props: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    op: z.literal('setComponentStyle'),
    pageId,
    componentId,
    style: z.strictObject({
      align: resettable(ComponentStyleSchema.shape.align.unwrap()),
      tone: resettable(ComponentStyleSchema.shape.tone.unwrap()),
      size: resettable(ComponentStyleSchema.shape.size.unwrap()),
    }),
  }),
  z.strictObject({ op: z.literal('setComponentHidden'), pageId, componentId, hidden: z.boolean() }),
  z.strictObject({
    op: z.literal('addComponent'),
    pageId,
    component: ComponentSchema,
    index: z.number().int().min(0).optional(),
    /** 加入某个分组；省略时加在页面顶层。 */
    parentId: componentId.optional(),
  }),
  z.strictObject({ op: z.literal('removeComponent'), pageId, componentId }),
  z.strictObject({ op: z.literal('installTool'), toolId: IdSchema }),
  z.strictObject({ op: z.literal('uninstallTool'), toolId: IdSchema }),
  z.strictObject({
    op: z.literal('setStepParams'),
    workflowId: IdSchema,
    stepId: IdSchema,
    params: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ op: z.literal('removeWorkflowStep'), workflowId: IdSchema, stepId: IdSchema }),
  // ---- 数据表结构（只改结构，从不碰记录内容）----
  z.strictObject({ op: z.literal('addCollection'), collection: CollectionSchema }),
  z.strictObject({
    op: z.literal('updateCollection'),
    collectionId: IdSchema,
    name: z.string().optional(),
    icon: IconValueSchema.nullable().optional(),
  }),
  z.strictObject({
    op: z.literal('addField'),
    collectionId: IdSchema,
    field: FieldSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    op: z.literal('updateField'),
    collectionId: IdSchema,
    fieldId: IdSchema,
    /** 合并进字段定义；null 表示去掉该属性。type 只能在兼容的类型之间转换。 */
    changes: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    op: z.literal('moveField'),
    collectionId: IdSchema,
    fieldId: IdSchema,
    toIndex: z.number().int().min(0),
  }),
  /** 从结构里去掉字段：记录里的旧值保留，恢复旧版本时会回来。 */
  z.strictObject({ op: z.literal('removeField'), collectionId: IdSchema, fieldId: IdSchema }),
  /** 把数据表移出界面：记录保留，可在「设置 → 数据」里导出或由用户永久删除。 */
  z.strictObject({ op: z.literal('removeCollection'), collectionId: IdSchema }),
]);
export type Op = z.infer<typeof OpSchema>;
/** 一次修改（一个版本）最多包含的操作数。 */
export const MAX_OPS_PER_CHANGE = 30;
export const OpListSchema = z.array(OpSchema).min(1).max(MAX_OPS_PER_CHANGE);

/** apply 过程中系统自动做出的调整，需要在预览中告知用户。 */
export type ApplyNote =
  | { kind: 'movedToFloating'; target: NavTarget }
  | { kind: 'removedLinks'; pageId: string; count: number }
  | { kind: 'removedDataComponents'; collectionId: string; count: number };

/** 字段类型只能在这些类型之间互相转换，已有的值仍然能读出来。 */
export const COMPATIBLE_FIELD_TYPES: readonly (readonly string[])[] = [
  ['text', 'note'],
  ['number', 'money'],
];

export type ApplyResult =
  { ok: true; config: WorkspaceConfig; notes: ApplyNote[] } | { ok: false; error: string };

export interface ApplyContext {
  registry: Registry;
  /** 安装工具时，工具页面使用的语言。 */
  locale: Locale;
}

class OpError extends Error {}

function getPage(config: WorkspaceConfig, id: string): Page {
  const page = config.pages.find((p) => p.id === id);
  if (!page) throw new OpError(`page ${id} not found`);
  return page;
}

interface Located {
  list: Component[];
  index: number;
  component: Component;
}

/** 在页面顶层或分组里查找组件。 */
function findComponent(page: Page, id: string): Located | null {
  const lists: Component[][] = [
    page.components,
    ...page.components
      .filter((c): c is GroupComponent => c.type === 'group')
      .map((g) => g.children),
  ];
  for (const list of lists) {
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) return { list, index, component: list[index]! };
  }
  return null;
}

function getComponent(page: Page, id: string): Located {
  const found = findComponent(page, id);
  if (!found) throw new OpError(`component ${id} not found on page ${page.id}`);
  return found;
}

/** 组件要放入的列表：页面顶层，或某个分组的子组件。 */
function targetList(page: Page, parentId: string | undefined, moving: Component): Component[] {
  if (parentId === undefined) return page.components;
  const parent = getComponent(page, parentId).component;
  if (parent.type !== 'group') throw new OpError(`component ${parentId} is not a group`);
  if (moving.type === 'group') throw new OpError('a group cannot be placed inside another group');
  return parent.children as Component[];
}

/** 从所有页面（包括分组内）删除满足条件的组件，返回删除的数量。 */
function removeEverywhere(config: WorkspaceConfig, pred: (c: Component) => boolean): number {
  let count = 0;
  const keep = (c: Component) => {
    if (!pred(c)) return true;
    count++;
    return false;
  };
  for (const page of config.pages) {
    page.components = page.components.filter(keep);
    for (const c of page.components) {
      if (c.type === 'group') c.children = c.children.filter(keep);
    }
  }
  return count;
}

/** 第一个非 header 组件的位置；“放到最上面”时放在页面标题之后。 */
export function topIndex(page: Page): number {
  const i = page.components.findIndex((c) => c.type !== 'header');
  return i < 0 ? page.components.length : i;
}

function toolCardIndex(home: Page): number {
  let last = -1;
  home.components.forEach((c, i) => {
    if (c.type === 'toolCard') last = i;
  });
  if (last >= 0) return last + 1;
  const catalog = home.components.findIndex((c) => c.type === 'catalogLink');
  return catalog >= 0 ? catalog : topIndex(home);
}

/** 受保护元素不在导航栏也不在浮动入口时，自动改为浮动入口（§5.1）。 */
function keepProtectedReachable(config: WorkspaceConfig, notes: ApplyNote[]): void {
  for (const target of PROTECTED_TARGETS) {
    if (!config.shell.nav.includes(target) && !config.shell.floating.includes(target)) {
      config.shell.floating.push(target);
      notes.push({ kind: 'movedToFloating', target });
    }
  }
}

function applyOne(config: WorkspaceConfig, op: Op, ctx: ApplyContext, notes: ApplyNote[]): void {
  switch (op.op) {
    case 'setTheme': {
      const { op: _, colors, darkColors, ...tokens } = op;
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
      return;
    }
    case 'resetTheme': {
      config.theme = JSON.parse(JSON.stringify(DEFAULT_THEME));
      return;
    }
    case 'setNavItems': {
      const items = [...new Set(op.items)];
      config.shell.nav = items;
      config.shell.floating = config.shell.floating.filter((t) => !items.includes(t));
      keepProtectedReachable(config, notes);
      return;
    }
    case 'setFloatingItems': {
      const items = [...new Set(op.items)];
      config.shell.floating = items;
      config.shell.nav = config.shell.nav.filter((t) => !items.includes(t));
      return;
    }
    case 'setPageTitle': {
      getPage(config, op.pageId).title = op.title;
      return;
    }
    case 'setPageIcon': {
      const page = getPage(config, op.pageId);
      if (op.icon === null) delete page.icon;
      else page.icon = op.icon;
      return;
    }
    case 'addPage': {
      if (config.pages.some((p) => p.id === op.page.id)) {
        throw new OpError(`page ${op.page.id} already exists`);
      }
      config.pages.push(JSON.parse(JSON.stringify(op.page)) as Page);
      return;
    }
    case 'removePage': {
      if (op.pageId === HOME_PAGE_ID) throw new OpError('the home page cannot be removed');
      const page = getPage(config, op.pageId);
      if (page.toolId !== undefined) {
        throw new OpError(`page ${op.pageId} belongs to tool ${page.toolId}; uninstall the tool`);
      }
      config.pages = config.pages.filter((p) => p.id !== op.pageId);
      const target = pageTarget(op.pageId);
      config.shell.nav = config.shell.nav.filter((t) => t !== target);
      config.shell.floating = config.shell.floating.filter((t) => t !== target);
      if (config.shell.nav.length === 0) config.shell.nav = [pageTarget(HOME_PAGE_ID)];
      const count = removeEverywhere(config, (c) => componentTarget(c) === target);
      if (count > 0) notes.push({ kind: 'removedLinks', pageId: op.pageId, count });
      return;
    }
    case 'moveComponent': {
      const page = getPage(config, op.pageId);
      if (op.parentId === op.componentId) throw new OpError('a group cannot contain itself');
      const from = getComponent(page, op.componentId);
      const to = targetList(page, op.parentId, from.component);
      from.list.splice(from.index, 1);
      to.splice(Math.min(op.toIndex, to.length), 0, from.component);
      return;
    }
    case 'setComponentProps': {
      const { component } = getComponent(getPage(config, op.pageId), op.componentId);
      // 只合并属性，null 表示去掉该属性；类型不能通过此操作改变，合法性由 validateWorkspace 检查。
      const props: Record<string, unknown> = { ...component.props };
      for (const [key, value] of Object.entries(op.props)) {
        if (value === null) delete props[key];
        else props[key] = value;
      }
      (component as { props: Record<string, unknown> }).props = props;
      return;
    }
    case 'setComponentStyle': {
      const { component } = getComponent(getPage(config, op.pageId), op.componentId);
      const style: Record<string, unknown> = { ...component.style };
      for (const [key, value] of Object.entries(op.style)) {
        if (value === null) delete style[key];
        else if (value !== undefined) style[key] = value;
      }
      if (Object.keys(style).length === 0) delete component.style;
      else component.style = style;
      return;
    }
    case 'setComponentHidden': {
      const { component } = getComponent(getPage(config, op.pageId), op.componentId);
      if (op.hidden) component.hidden = true;
      else delete component.hidden;
      return;
    }
    case 'addComponent': {
      const page = getPage(config, op.pageId);
      if (findComponent(page, op.component.id)) {
        throw new OpError(`component ${op.component.id} already exists on page ${page.id}`);
      }
      const component = JSON.parse(JSON.stringify(op.component)) as Component;
      const list = targetList(page, op.parentId, component);
      list.splice(Math.min(op.index ?? list.length, list.length), 0, component);
      return;
    }
    case 'removeComponent': {
      const { list, index } = getComponent(getPage(config, op.pageId), op.componentId);
      list.splice(index, 1);
      return;
    }
    case 'installTool': {
      if (config.tools.some((t) => t.toolId === op.toolId)) {
        throw new OpError(`tool ${op.toolId} is already installed`);
      }
      const def = ctx.registry.tools.get(op.toolId);
      if (!def) throw new OpError(`tool ${op.toolId} is not in the catalog`);
      const page = def.createPage(ctx.locale);
      if (config.pages.some((p) => p.id === page.id)) throw new OpError(`page ${page.id} exists`);
      const workflows = def.createWorkflows(ctx.locale);
      for (const wf of workflows) {
        if (config.workflows.some((w) => w.id === wf.id))
          throw new OpError(`workflow ${wf.id} exists`);
      }
      config.pages.push(page);
      config.workflows.push(...workflows);
      config.tools.push({ toolId: def.id, version: def.version, pageId: page.id });
      const home = getPage(config, HOME_PAGE_ID);
      home.components.splice(toolCardIndex(home), 0, {
        id: `card-${def.id}`,
        type: 'toolCard',
        props: { toolId: def.id },
      });
      return;
    }
    case 'uninstallTool': {
      const tool = config.tools.find((t) => t.toolId === op.toolId);
      if (!tool) throw new OpError(`tool ${op.toolId} is not installed`);
      // 只移除入口、页面和工作流；用户文件不在配置中，不受影响（§7G）。
      const target = pageTarget(tool.pageId);
      config.tools = config.tools.filter((t) => t.toolId !== op.toolId);
      config.pages = config.pages.filter((p) => p.toolId !== op.toolId);
      config.workflows = config.workflows.filter((w) => w.toolId !== op.toolId);
      removeEverywhere(
        config,
        (c) =>
          (c.type === 'toolCard' && c.props.toolId === op.toolId) || componentTarget(c) === target,
      );
      config.shell.nav = config.shell.nav.filter((t) => t !== target);
      config.shell.floating = config.shell.floating.filter((t) => t !== target);
      if (config.shell.nav.length === 0) config.shell.nav = [pageTarget(HOME_PAGE_ID)];
      return;
    }
    case 'setStepParams': {
      const step = getWorkflow(config, op.workflowId).steps.find((s) => s.id === op.stepId);
      if (!step) throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      step.params = { ...step.params, ...op.params };
      return;
    }
    case 'removeWorkflowStep': {
      const wf = getWorkflow(config, op.workflowId);
      if (!wf.steps.some((s) => s.id === op.stepId)) {
        throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      }
      wf.steps = wf.steps.filter((s) => s.id !== op.stepId);
      return;
    }
    case 'addCollection': {
      if (config.collections.some((c) => c.id === op.collection.id)) {
        throw new OpError(`collection ${op.collection.id} already exists`);
      }
      config.collections.push(JSON.parse(JSON.stringify(op.collection)) as Collection);
      return;
    }
    case 'updateCollection': {
      const collection = getCollection(config, op.collectionId);
      if (op.name !== undefined) collection.name = op.name;
      if (op.icon === null) delete collection.icon;
      else if (op.icon !== undefined) collection.icon = op.icon;
      return;
    }
    case 'addField': {
      const collection = getCollection(config, op.collectionId);
      if (collection.fields.some((f) => f.id === op.field.id)) {
        throw new OpError(`field ${op.field.id} already exists in ${collection.id}`);
      }
      const index = Math.min(op.index ?? collection.fields.length, collection.fields.length);
      collection.fields.splice(index, 0, JSON.parse(JSON.stringify(op.field)));
      return;
    }
    case 'updateField': {
      const collection = getCollection(config, op.collectionId);
      const index = getFieldIndex(collection, op.fieldId);
      const old = collection.fields[index]!;
      if ('id' in op.changes) throw new OpError('a field id cannot change');
      const newType = op.changes.type;
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
        next = { id: old.id, name: old.name, ...(old.required ? { required: true } : {}) };
      } else {
        next = { ...old };
      }
      for (const [key, value] of Object.entries(op.changes)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      // 合法性（例如选项 ID 唯一、默认值存在）由 validateWorkspace 检查。
      collection.fields[index] = next as never;
      return;
    }
    case 'moveField': {
      const collection = getCollection(config, op.collectionId);
      const [field] = collection.fields.splice(getFieldIndex(collection, op.fieldId), 1);
      collection.fields.splice(Math.min(op.toIndex, collection.fields.length), 0, field!);
      return;
    }
    case 'removeField': {
      const collection = getCollection(config, op.collectionId);
      collection.fields.splice(getFieldIndex(collection, op.fieldId), 1);
      return;
    }
    case 'removeCollection': {
      getCollection(config, op.collectionId);
      config.collections = config.collections.filter((c) => c.id !== op.collectionId);
      const count = removeEverywhere(config, (c) => componentCollection(c) === op.collectionId);
      if (count > 0) {
        notes.push({ kind: 'removedDataComponents', collectionId: op.collectionId, count });
      }
      return;
    }
  }
}

function getCollection(config: WorkspaceConfig, id: string): Collection {
  const collection = config.collections.find((c) => c.id === id);
  if (!collection) throw new OpError(`collection ${id} not found`);
  return collection;
}

function getFieldIndex(collection: Collection, id: string): number {
  const index = collection.fields.findIndex((f) => f.id === id);
  if (index < 0) throw new OpError(`field ${id} not found in ${collection.id}`);
  return index;
}

function getWorkflow(config: WorkspaceConfig, id: string) {
  const wf = config.workflows.find((w) => w.id === id);
  if (!wf) throw new OpError(`workflow ${id} not found`);
  return wf;
}

export function applyOps(
  config: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ApplyContext,
): ApplyResult {
  const next = JSON.parse(JSON.stringify(config)) as WorkspaceConfig;
  const notes: ApplyNote[] = [];
  try {
    for (const op of ops) applyOne(next, op, ctx, notes);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, config: next, notes };
}
