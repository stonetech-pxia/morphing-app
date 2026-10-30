import { z } from 'zod';

import { THEME_PRESETS, THEME_PRESET_IDS } from './presets';
import type { Registry } from './registry';
import {
  BackdropPatchSchema,
  CollectionSchema,
  ComponentSchema,
  FIELDS,
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
  ReminderSchema,
  MAX_REMINDERS,
  MAX_RECORD_REMINDERS,
  ThemeSchema,
  WorkflowSchema,
  WorkflowStepSchema,
  allComponents,
  componentCollection,
  componentTarget,
  isKnownComponent,
  pageTarget,
  patchBackdrop,
  toolGridToolIds,
  type BackdropPatch,
  type Collection,
  type Component,
  type GroupComponent,
  type KnownComponent,
  type Locale,
  type NavTarget,
  type Page,
  type Workflow,
  type WorkflowStep,
  type ThemeColors,
  type WorkspaceConfig,
} from './schema';
import { DEFAULT_THEME } from './theme';
import { addMissingEntryForms } from './entry-forms';
import { presetById } from './workflows/presets';
import { buttonActionUses, rowActionUses, type Gone } from './record-ops';
import { reminderProblems } from './reminders';
import { REDACTED_TEXT } from './workflow/redact';

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
    iconStyle: ThemeSchema.shape.iconStyle,
  }),
  z.strictObject({ op: z.literal('resetTheme') }),
  z.strictObject({ op: z.literal('applyThemePreset'), preset: z.enum(THEME_PRESET_IDS) }),
  z.strictObject({ op: z.literal('setNavItems'), items: z.array(NavTargetSchema).min(1).max(5) }),
  z.strictObject({ op: z.literal('setFloatingItems'), items: z.array(NavTargetSchema).max(3) }),
  z.strictObject({ op: z.literal('setPageTitle'), pageId, title: z.string() }),
  z.strictObject({ op: z.literal('setPageIcon'), pageId, icon: IconValueSchema.nullable() }),
  /** 页面的背景图片（D-258）：只写要改的，合进已有的；null 关掉。 */
  z.strictObject({
    op: z.literal('setPageBackdrop'),
    pageId,
    backdrop: BackdropPatchSchema.nullable(),
  }),
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
      /** 图片背景（D-258）：只写要改的，合进已有的；null 关掉。 */
      backdrop: resettable(BackdropPatchSchema),
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
  /** 已安装的工具升级到当前版本：补上新的工作流和工具页上的入口，保留用户的修改。 */
  z.strictObject({ op: z.literal('updateTool'), toolId: IdSchema }),
  z.strictObject({
    op: z.literal('setStepParams'),
    workflowId: IdSchema,
    stepId: IdSchema,
    /** 合并进已有参数。 */
    params: z.record(z.string(), z.unknown()).optional(),
    /** 每次运行时问的参数（完整列表，[] 表示都不问）。 */
    ask: z.array(z.string().min(1).max(40)).max(10).optional(),
  }),
  z.strictObject({ op: z.literal('removeWorkflowStep'), workflowId: IdSchema, stepId: IdSchema }),
  /**
   * 新建用户自己的工作流（从预设复制、复制已有的，或 AI 新建）。不能属于工具；
   * 放到手机桌面只能用 setWorkflowHomeScreen（D-271），这样每次放到桌面都是单独一行说明。
   */
  z.strictObject({
    op: z.literal('addWorkflow'),
    workflow: WorkflowSchema.omit({ toolId: true, homeScreen: true }),
  }),
  /** 删除用户自己的工作流，连同运行它的组件；工具自带的不能删。 */
  z.strictObject({ op: z.literal('removeWorkflow'), workflowId: IdSchema }),
  z.strictObject({
    op: z.literal('renameWorkflow'),
    workflowId: IdSchema,
    name: z.string(),
    icon: IconValueSchema.nullable().optional(),
  }),
  z.strictObject({
    op: z.literal('addWorkflowStep'),
    workflowId: IdSchema,
    step: WorkflowStepSchema,
    /** 插在第几步之前；省略 = 最后。 */
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    op: z.literal('moveWorkflowStep'),
    workflowId: IdSchema,
    stepId: IdSchema,
    toIndex: z.number().int().min(0),
  }),
  /** 放到手机桌面（长按 Morph 图标的菜单）或从桌面拿掉（D-271）。工具自带的快捷操作也可以。 */
  z.strictObject({
    op: z.literal('setWorkflowHomeScreen'),
    workflowId: IdSchema,
    homeScreen: z.boolean(),
  }),
  /** 整体替换名称和步骤（工作流编辑页保存、恢复预设）。不改 toolId / presetId。 */
  z.strictObject({
    op: z.literal('updateWorkflow'),
    workflowId: IdSchema,
    name: z.string().optional(),
    steps: z.array(WorkflowStepSchema).min(1).optional(),
  }),
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
  // 提醒（D-251）：只改设置，看不到记录。
  z.strictObject({ op: z.literal('addReminder'), reminder: ReminderSchema }),
  z.strictObject({
    op: z.literal('updateReminder'),
    reminderId: IdSchema,
    /** 合并进提醒；null 表示去掉可选的属性（weekdays、collectionId、fieldId、daysBefore）。 */
    changes: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ op: z.literal('removeReminder'), reminderId: IdSchema }),
  // 一天、一周从什么时候开始（D-286）：只写要改的，null 恢复默认；范围由 validateWorkspace 检查。
  z.strictObject({
    op: z.literal('setCalendar'),
    dayStartHour: resettable(z.number().int()),
    weekStart: resettable(z.enum(['monday', 'sunday'])),
    twoWeekStart: resettable(z.string()),
  }),
]);
export type Op = z.infer<typeof OpSchema>;
/** 一次修改（一个版本）最多包含的操作数。 */
export const MAX_OPS_PER_CHANGE = 30;
export const OpListSchema = z.array(OpSchema).min(1).max(MAX_OPS_PER_CHANGE);

/** apply 过程中系统自动做出的调整，需要在预览中告知用户。 */
export type ApplyNote =
  | { kind: 'movedToFloating'; target: NavTarget }
  | { kind: 'removedLinks'; pageId: string; count: number }
  | { kind: 'removedDataComponents'; collectionId: string; count: number }
  | { kind: 'removedRunners'; workflowId: string; count: number }
  /** 打开这个快捷操作的按钮、快捷入口（D-256）。 */
  | { kind: 'removedWorkflowLinks'; workflowId: string; count: number }
  /** 提醒要打开的快捷操作 / 页面、要看的表或日期字段被移除了，提醒跟着移除（D-251）。 */
  | { kind: 'removedReminders'; titles: string[] }
  /** 删字段、删表时，用到它的一键记录操作（D-304）：按钮移除，列表里的行按钮去掉。 */
  | { kind: 'removedRecordActions'; count: number }
  /** 新加的列表所属的表没有添加入口，在列表上方补了一个「添加」按钮（D-310）。 */
  | { kind: 'addedEntryForm'; collectionId: string }
  | { kind: 'updatedTool'; toolId: string; workflowIds: string[] };

/** 字段类型只能在这些类型之间互相转换，已有的值仍然能读出来（字段定义的 convertGroup）。 */
export const COMPATIBLE_FIELD_TYPES: readonly (readonly string[])[] = [
  ...new Set(FIELDS.flatMap((d) => (d.convertGroup ? [d.convertGroup] : []))),
].map((group) => FIELDS.filter((d) => d.convertGroup === group).map((d) => d.type));

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

/** 要改属性、外观或隐藏的组件：这个版本不认识的组件（D-254）只能移动和删除。 */
function getKnownComponent(page: Page, id: string): KnownComponent {
  const { component } = getComponent(page, id);
  if (!isKnownComponent(component)) {
    throw new OpError(
      `component ${id} needs a newer version of the app; it can only be moved or removed`,
    );
  }
  return component;
}

/**
 * 快捷操作移除后，打开它的按钮、快捷入口跟着移除（和页面移除时一样，D-256）。
 * 同 ID 的内设快捷操作还在时（移除的是预设的副本）按钮仍然有效，不移除。
 */
function removeWorkflowLinks(config: WorkspaceConfig, workflowIds: readonly string[]): number {
  const gone = workflowIds.filter((id) => !presetById(id)).map((id) => `workflow:${id}`);
  if (gone.length === 0) return 0;
  return removeEverywhere(config, (c) => {
    const target = componentTarget(c);
    return target !== null && gone.includes(target);
  });
}

/**
 * 删字段、删表后，用到它的一键记录操作（D-304）：按钮跟着移除，记录列表里的行按钮去掉（列表留着）。
 */
function pruneRecordActions(config: WorkspaceConfig, gone: Gone, notes: ApplyNote[]): void {
  let count = removeEverywhere(
    config,
    (c) =>
      c.type === 'button' && c.props.action !== undefined && buttonActionUses(c.props.action, gone),
  );
  for (const page of config.pages) {
    for (const c of allComponents(page)) {
      if (c.type !== 'recordList' || !c.props.rowActions) continue;
      const kept = c.props.rowActions.filter((a) => !rowActionUses(a, c.props.collectionId, gone));
      count += c.props.rowActions.length - kept.length;
      if (kept.length > 0) c.props.rowActions = kept;
      else delete c.props.rowActions;
    }
  }
  if (count > 0) notes.push({ kind: 'removedRecordActions', count });
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

/** 某个页面上的工具宫格已经显示这个工具（D-181）：添加工具时不用再往首页放入口。 */
export function shownInToolGrid(
  config: WorkspaceConfig,
  toolId: string,
  catalog: readonly string[],
): boolean {
  return config.pages.some((page) =>
    allComponents(page).some(
      (c) => c.type === 'toolGrid' && toolGridToolIds(c, page, catalog).includes(toolId),
    ),
  );
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
    case 'applyThemePreset': {
      config.theme = JSON.parse(JSON.stringify(THEME_PRESETS[op.preset].theme));
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
    case 'setPageBackdrop': {
      const page = getPage(config, op.pageId);
      if (op.backdrop === null) delete page.backdrop;
      else page.backdrop = patchBackdrop(page.backdrop, op.backdrop);
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
      const component = getKnownComponent(getPage(config, op.pageId), op.componentId);
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
      const component = getKnownComponent(getPage(config, op.pageId), op.componentId);
      const style: Record<string, unknown> = { ...component.style };
      for (const [key, value] of Object.entries(op.style)) {
        if (value === null) delete style[key];
        else if (key === 'backdrop')
          style.backdrop = patchBackdrop(component.style?.backdrop, value as BackdropPatch);
        else if (value !== undefined) style[key] = value;
      }
      if (Object.keys(style).length === 0) delete component.style;
      else component.style = style;
      return;
    }
    case 'setComponentHidden': {
      const component = getKnownComponent(getPage(config, op.pageId), op.componentId);
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
      if (shownInToolGrid(config, def.id, [...ctx.registry.tools.keys()])) return;
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
      const toolWorkflows = config.workflows.filter((w) => w.toolId === op.toolId).map((w) => w.id);
      config.workflows = config.workflows.filter((w) => w.toolId !== op.toolId);
      removeWorkflowLinks(config, toolWorkflows);
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
    case 'updateTool': {
      const tool = config.tools.find((t) => t.toolId === op.toolId);
      if (!tool) throw new OpError(`tool ${op.toolId} is not installed`);
      const def = ctx.registry.tools.get(op.toolId);
      if (!def) throw new OpError(`tool ${op.toolId} is not in the catalog`);
      if (tool.version === def.version) throw new OpError(`tool ${op.toolId} is up to date`);
      const page = getPage(config, tool.pageId);
      const added = def
        .createWorkflows(ctx.locale)
        .filter((wf) => !config.workflows.some((w) => w.id === wf.id));
      config.workflows.push(...added);
      // 新入口放在文件列表之前（没有文件列表时放在最后）。
      const fileList = page.components.findIndex((c) => c.type === 'fileList');
      let at = fileList >= 0 ? fileList : page.components.length;
      for (const wf of added) {
        let id = `${wf.id}-runner`;
        for (let i = 2; findComponent(page, id); i++) id = `${wf.id}-runner-${i}`;
        page.components.splice(at++, 0, {
          id,
          type: 'workflowRunner',
          props: { workflowId: wf.id },
        });
      }
      tool.version = def.version;
      notes.push({ kind: 'updatedTool', toolId: op.toolId, workflowIds: added.map((w) => w.id) });
      return;
    }
    case 'setStepParams': {
      const step = getWorkflow(config, op.workflowId).steps.find((s) => s.id === op.stepId);
      if (!step) throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      // AI 看到的是占位符（D-065）：原样写回占位符表示不改这个参数。
      const params = Object.entries(op.params ?? {}).filter(([, v]) => v !== REDACTED_TEXT);
      step.params = { ...step.params, ...Object.fromEntries(params) };
      if (op.ask !== undefined) {
        if (op.ask.length === 0) delete step.ask;
        else step.ask = [...new Set(op.ask)];
      }
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
    case 'addWorkflow': {
      if (config.workflows.some((w) => w.id === op.workflow.id)) {
        throw new OpError(`workflow ${op.workflow.id} already exists`);
      }
      config.workflows.push(JSON.parse(JSON.stringify(op.workflow)) as Workflow);
      return;
    }
    case 'removeWorkflow': {
      const wf = getWorkflow(config, op.workflowId);
      if (wf.toolId !== undefined) {
        throw new OpError(
          `workflow ${op.workflowId} belongs to tool ${wf.toolId}; uninstall the tool or remove steps instead`,
        );
      }
      config.workflows = config.workflows.filter((w) => w.id !== op.workflowId);
      // 删的是内设快捷操作的同 ID 副本时，卡片和按钮一样继续指向内设的（D-256、D-259），不移除。
      const count = presetById(op.workflowId)
        ? 0
        : removeEverywhere(
            config,
            (c) => c.type === 'workflowRunner' && c.props.workflowId === op.workflowId,
          );
      if (count > 0) notes.push({ kind: 'removedRunners', workflowId: op.workflowId, count });
      const links = removeWorkflowLinks(config, [op.workflowId]);
      if (links > 0)
        notes.push({ kind: 'removedWorkflowLinks', workflowId: op.workflowId, count: links });
      return;
    }
    case 'renameWorkflow': {
      const wf = getWorkflow(config, op.workflowId);
      wf.name = op.name;
      if (op.icon === null) delete wf.icon;
      else if (op.icon !== undefined) wf.icon = op.icon;
      return;
    }
    case 'addWorkflowStep': {
      const wf = getWorkflow(config, op.workflowId);
      if (wf.steps.some((s) => s.id === op.step.id)) {
        throw new OpError(`step ${op.step.id} already exists in ${op.workflowId}`);
      }
      const at = Math.min(op.index ?? wf.steps.length, wf.steps.length);
      wf.steps.splice(at, 0, JSON.parse(JSON.stringify(op.step)) as WorkflowStep);
      return;
    }
    case 'moveWorkflowStep': {
      const wf = getWorkflow(config, op.workflowId);
      const from = wf.steps.findIndex((s) => s.id === op.stepId);
      if (from < 0) throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      const [step] = wf.steps.splice(from, 1);
      wf.steps.splice(Math.min(op.toIndex, wf.steps.length), 0, step!);
      return;
    }
    case 'setWorkflowHomeScreen': {
      const wf = getWorkflow(config, op.workflowId);
      if (op.homeScreen) wf.homeScreen = true;
      else delete wf.homeScreen;
      return;
    }
    case 'updateWorkflow': {
      const wf = getWorkflow(config, op.workflowId);
      if (op.name !== undefined) wf.name = op.name;
      if (op.steps !== undefined) {
        const ids = new Set<string>();
        for (const s of op.steps) {
          if (ids.has(s.id)) throw new OpError(`step ${s.id} appears twice in ${op.workflowId}`);
          ids.add(s.id);
        }
        // AI 看到的是占位符（D-065）：同一步原样写回占位符表示保留原来的文字。
        const old = new Map(wf.steps.map((s) => [s.id, s]));
        wf.steps = op.steps.map((s) => {
          const kept = Object.fromEntries(
            Object.entries(s.params).map(([k, v]) => [
              k,
              v === REDACTED_TEXT ? old.get(s.id)?.params[k] : v,
            ]),
          );
          const params = Object.fromEntries(
            Object.entries(kept).filter(([, v]) => v !== undefined),
          );
          return JSON.parse(JSON.stringify({ ...s, params })) as WorkflowStep;
        });
      }
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
        next = {
          id: old.id,
          name: old.name,
          ...('required' in old && old.required ? { required: true } : {}),
        };
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
      pruneRecordActions(config, { collectionId: op.collectionId, fieldId: op.fieldId }, notes);
      return;
    }
    case 'addReminder': {
      const reminders = (config.reminders ??= []);
      if (reminders.some((r) => r.id === op.reminder.id))
        throw new OpError(`reminder ${op.reminder.id} already exists`);
      // 按记录排的提醒另算，不占 20 个的名额（D-316）。
      const perRecord = op.reminder.schedule === 'scheduleField';
      const max = perRecord ? MAX_RECORD_REMINDERS : MAX_REMINDERS;
      if (reminders.filter((r) => (r.schedule === 'scheduleField') === perRecord).length >= max)
        throw new OpError(
          perRecord
            ? `at most ${MAX_RECORD_REMINDERS} scheduleField reminders`
            : `at most ${MAX_REMINDERS} reminders`,
        );
      reminders.push(op.reminder);
      return;
    }
    case 'updateReminder': {
      const reminder = config.reminders?.find((r) => r.id === op.reminderId);
      if (!reminder) throw new OpError(`reminder ${op.reminderId} not found`);
      if ('id' in op.changes) throw new OpError('a reminder id cannot change');
      const next: Record<string, unknown> = { ...reminder };
      for (const [key, value] of Object.entries(op.changes)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      // 合法性由 validateWorkspace 检查。
      config.reminders = config.reminders!.map((r) =>
        r.id === op.reminderId ? (next as never) : r,
      );
      return;
    }
    case 'setCalendar': {
      const next: Record<string, unknown> = { ...config.calendar };
      for (const key of ['dayStartHour', 'weekStart', 'twoWeekStart'] as const) {
        if (op[key] === null) delete next[key];
        else if (op[key] !== undefined) next[key] = op[key];
      }
      if (Object.keys(next).length > 0) config.calendar = next as never;
      else delete config.calendar;
      return;
    }
    case 'removeReminder': {
      if (!config.reminders?.some((r) => r.id === op.reminderId))
        throw new OpError(`reminder ${op.reminderId} not found`);
      config.reminders = config.reminders.filter((r) => r.id !== op.reminderId);
      return;
    }
    case 'removeCollection': {
      getCollection(config, op.collectionId);
      // D-250：别的表还引用它时不能移除，先移除那些引用字段（避免引用字段指向不存在的表）。
      const linking = config.collections.flatMap((c) =>
        c.id === op.collectionId
          ? []
          : c.fields
              .filter((f) => f.type === 'link' && f.collectionId === op.collectionId)
              .map((f) => `${c.id}.${f.id}`),
      );
      if (linking.length > 0) {
        throw new OpError(
          `table ${op.collectionId} is linked from ${linking.join(', ')}; remove those fields (and the components that show them) first`,
        );
      }
      config.collections = config.collections.filter((c) => c.id !== op.collectionId);
      // 减去这张表合计的统计（D-327）也一起移除：只留前一半会显示错的数。
      const count = removeEverywhere(
        config,
        (c) =>
          componentCollection(c) === op.collectionId ||
          (c.type === 'stat' && c.props.minus?.collectionId === op.collectionId),
      );
      if (count > 0) {
        notes.push({ kind: 'removedDataComponents', collectionId: op.collectionId, count });
      }
      pruneRecordActions(config, { collectionId: op.collectionId }, notes);
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
  for (const collectionId of addMissingEntryForms(config, next, ctx.locale))
    notes.push({ kind: 'addedEntryForm', collectionId });
  pruneReminders(config, next, notes);
  return { ok: true, config: next, notes };
}

/**
 * 原来好好的提醒，因为这批修改移除了它要打开的快捷操作 / 页面、要看的表或日期字段而失效：跟着移除并在说明里写出来
 * （移除快捷操作、页面、表，卸载工具都会这样）。这批修改里新加或改过的提醒不动，有问题由校验器拒绝。
 */
function pruneReminders(before: WorkspaceConfig, after: WorkspaceConfig, notes: ApplyNote[]) {
  if (!after.reminders?.length) return;
  const removed: string[] = [];
  after.reminders = after.reminders.filter((r) => {
    const old = before.reminders?.find((x) => x.id === r.id);
    const unchanged = old !== undefined && JSON.stringify(old) === JSON.stringify(r);
    if (!unchanged || reminderProblems(r, after).length === 0) return true;
    removed.push(r.title);
    return false;
  });
  if (removed.length > 0) notes.push({ kind: 'removedReminders', titles: removed });
}
