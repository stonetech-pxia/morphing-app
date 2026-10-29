import { z } from 'zod';

import { ComponentSchema, componentRefs, type Component, type ComponentOf } from './components';
import {
  BackdropSchema,
  CollectionSchema,
  IconValueSchema,
  IdSchema,
  ShellSchema,
  ThemeSchema,
  boundedText,
  openTargetSchema,
  type OpenTarget,
} from './schema-base';

// 可变层（交接文档 §5.2）的唯一定义。渲染器只认识这里列出的组件和属性。
// 组件的定义在 components/（每种一个文件，见 docs/COMPONENTS.md），其余部分在 schema-base.ts。
// 修改已有结构（包括给已有组件加属性）时，必须提升 CURRENT_SCHEMA_VERSION 并在 migrate.ts 中添加迁移；
// 只新增一种组件不提升（D-254：老配置照样能读，旧 App 读到新组件时原样保留）。

export const CURRENT_SCHEMA_VERSION = 20;

export * from './schema-base';
export {
  BACKDROP_TYPES,
  COMPONENTS,
  ComponentSchema,
  ComponentStyleSchema,
  EntryLookSchema,
  GROUP_MAX_CHILDREN,
  componentDefinition,
  componentRefs,
  isKnownComponent,
  type Component,
  type ComponentAI,
  type ComponentDefinition,
  type ComponentEdit,
  type ComponentOf,
  type ComponentRef,
  type ComponentStyle,
  type ComponentType,
  type EditableText,
  type EntryLook,
  type GroupComponent,
  type KnownComponent,
  type LeafComponent,
  type NewComponent,
  type StyleKey,
  type UnknownComponent,
} from './components';
export type QuickActionListComponent = ComponentOf<'quickActionList'>;

// ---- 页面、工具、工作流 ----

export const PageSchema = z.strictObject({
  id: IdSchema,
  title: boundedText(1, 40),
  /** 导航栏里显示的图标。 */
  icon: IconValueSchema.optional(),
  /** 由某个工具创建的页面；卸载该工具时一并移除。 */
  toolId: IdSchema.optional(),
  /** 整个页面的背景图片（D-258，schemaVersion 18），组件浮在上面。 */
  backdrop: BackdropSchema.optional(),
  components: z.array(ComponentSchema).max(30),
});
/** 页面；组件里可能有这个版本不认识的（D-254，见 UnknownComponent）。 */
export type Page = Omit<z.infer<typeof PageSchema>, 'components'> & { components: Component[] };

export const InstalledToolSchema = z.strictObject({
  toolId: IdSchema,
  version: z.string().min(1),
  pageId: IdSchema,
});
export type InstalledTool = z.infer<typeof InstalledToolSchema>;

export const ActionIdSchema = z.string().regex(/^[a-z]+\.[a-zA-Z0-9]+$/, 'invalid action id');

export const WorkflowStepSchema = z.strictObject({
  id: IdSchema,
  action: ActionIdSchema,
  params: z.record(z.string(), z.unknown()),
  /** 这些参数每次运行时问用户（键必须是该动作界面元数据里的参数）。 */
  ask: z.array(z.string().min(1).max(40)).max(10).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** 一个工作流最多的步骤数。 */
export const MAX_WORKFLOW_STEPS = 12;

/** 工作流总数上限：装满全部工具约 40 个单功能工作流，再加用户自己的。 */
export const MAX_WORKFLOWS = 100;

/** 手机桌面上长按 Morph 图标的菜单里最多放几个快捷操作（D-271）：iOS 只显示 4 个，Android 跟着一样。 */
export const MAX_HOME_SCREEN = 4;

/**
 * 工作流：线性步骤序列，步骤之间传递一个有类型的值（§7C、D-060，非图灵完备）。
 * toolId：安装工具时创建，卸载时一起移除；presetId：从哪个预设复制来的（D-062，D-236）。
 * homeScreen：放到手机桌面（D-271，schemaVersion 19）：长按 Morph 图标的菜单里有它；没有就是不放。
 */
export const WorkflowSchema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  icon: IconValueSchema.optional(),
  toolId: IdSchema.optional(),
  presetId: IdSchema.optional(),
  homeScreen: z.literal(true).optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

// ---- 提醒（D-251）：本地通知，不用推送、不需要服务器 ----

/** 一天里的时间 HH:mm（设备本地时间）。 */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time like 09:00');

/** 点提醒打开哪里：一个页面或系统入口，或者一个快捷操作（只打开，不运行）。 */
export type ReminderTarget = OpenTarget;
export const ReminderTargetSchema = openTargetSchema(
  'opens must be a page, a system entry or workflow:<id>',
);

/**
 * 提醒（D-251）：daily 每天、weekly 每周几（weekdays：1 = 周一 … 7 = 周日）在 time 提醒；
 * dateField 在一张表的日期字段到期前 daysBefore 天的 time 提醒（每条记录一次）。
 * 点通知只打开 opens，绝不自动运行任何东西。title 是通知的标题（配置里的文字，AI 能看到）；
 * dateField 提醒的正文在本机按记录生成（记录内容不进配置，不发给 AI）。
 */
export const ReminderSchema = z.strictObject({
  id: IdSchema,
  title: boundedText(1, 60),
  enabled: z.boolean(),
  schedule: z.enum(['daily', 'weekly', 'dateField']),
  time: TimeOfDaySchema,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  collectionId: IdSchema.optional(),
  fieldId: IdSchema.optional(),
  daysBefore: z.number().int().min(0).max(30).optional(),
  opens: ReminderTargetSchema,
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const MAX_REMINDERS = 20;

export const HOME_PAGE_ID = 'home';
/** 新用户的工具箱页面（D-181）。是用户自己的页面，可以改、也可以删；「设置 → 工具」始终列出全部工具。 */
export const TOOLBOX_PAGE_ID = 'toolbox';

export const WorkspaceConfigSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  theme: ThemeSchema,
  shell: ShellSchema,
  pages: z.array(PageSchema).min(1).max(20),
  tools: z.array(InstalledToolSchema),
  workflows: z.array(WorkflowSchema).max(MAX_WORKFLOWS),
  /** 数据表结构。记录内容不在配置里，也从不发给 AI。 */
  collections: z.array(CollectionSchema).max(20),
  /** 提醒（D-251，schemaVersion 16）；没有时就是没有提醒。 */
  reminders: z.array(ReminderSchema).max(MAX_REMINDERS).optional(),
});
export type WorkspaceConfig = Omit<z.infer<typeof WorkspaceConfigSchema>, 'pages'> & {
  pages: Page[];
};

/** 页面上的所有组件，包括分组里的子组件（深度优先，按显示顺序）。 */
export function allComponents(page: Page): Component[] {
  return page.components.flatMap((c) => (c.type === 'group' ? [c, ...c.children] : [c]));
}

/**
 * 一个工具宫格显示哪些工具（D-181）：写了 toolIds 就按它的顺序；没写就是目录里
 * 同一页面上其他宫格都没列出的工具。目录里没有的工具不显示。
 */
export function toolGridToolIds(
  grid: ComponentOf<'toolGrid'>,
  page: Page,
  catalog: readonly string[],
): string[] {
  if (grid.props.toolIds) return grid.props.toolIds.filter((id) => catalog.includes(id));
  const listed = new Set(
    allComponents(page).flatMap((c) => (c.type === 'toolGrid' ? (c.props.toolIds ?? []) : [])),
  );
  return catalog.filter((id) => !listed.has(id));
}

/** 数据组件引用的数据表（定义里 refs 指向 collection 的属性）。 */
export function componentCollection(c: Component): string | null {
  return (componentRefs(c, 'collection')[0] as string | undefined) ?? null;
}

/** 按钮和快捷入口这类组件打开的目标（定义里 refs 指向 target 的属性）。 */
export function componentTarget(c: Component): OpenTarget | null {
  return (componentRefs(c, 'target')[0] as OpenTarget | undefined) ?? null;
}
