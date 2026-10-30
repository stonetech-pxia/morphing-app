import { z } from 'zod';

import {
  ComponentSchema,
  componentRefs,
  isKnownComponent,
  type Component,
  type ComponentOf,
} from './components';
import { DeskLayoutSchema } from './desk/layout';
import { RecordToolSchema } from './record-ops-schema';
import {
  BackdropSchema,
  CalendarSchema,
  CollectionSchema,
  IconValueSchema,
  IdSchema,
  NavSchema,
  ThemeSchema,
  boundedText,
  openTargetSchema,
  type OpenTarget,
} from './schema-base';
import { ConditionSchema, FieldRefSchema } from './schema-primitives';

// 可变层（交接文档 §5.2）的唯一定义：v34「数据 · 容器 · 工具」（NEW_FORMAT_DRAFT，创始人 2026-10-30 定）。
// 数据 data（表结构、日期设置），容器 containers（页面 → 块、文件房间的布局）和 nav（导航栏、浮动入口、
// 手机桌面菜单），工具 tools（快捷操作、提醒），工具包 packages（界面上叫「工具」），主题 theme。
// 块的外观定义在 components/（每种一个文件，见 docs/COMPONENTS.md），字段在 fields/，其余部分在 schema-base.ts。
// 修改已有结构（包括给已有外观加键）时，必须提升 CURRENT_SCHEMA_VERSION 并在 migrate.ts 中添加迁移；
// 只新增一种外观不提升（D-254：老配置照样能读，旧 App 读到新外观时原样保留）。

export const CURRENT_SCHEMA_VERSION = 34;

export * from './schema-base';
export {
  BACKDROP_TYPES,
  COMPONENTS,
  ComponentSchema,
  ComponentStyleSchema,
  EntryLookSchema,
  GROUP_MAX_CHILDREN,
  RECORD_LOOKS,
  UNKNOWN_LOOK,
  componentDefinition,
  componentRefs,
  entryEditableText,
  entryKind,
  isKnownComponent,
  type BlockOf,
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
  type InnerGroupComponent,
  type KnownComponent,
  type LeafComponent,
  type Look,
  type NewComponent,
  type RecordLook,
  type StyleKey,
  type UnknownComponent,
} from './components';
export type QuickActionListComponent = ComponentOf<'library'>;

// ---- 容器：页面 ----

/** 页面最多几个顶层块。 */
export const MAX_PAGE_BLOCKS = 30;

export const PageSchema = z.strictObject({
  id: IdSchema,
  title: boundedText(1, 40),
  /** 导航栏里显示的图标。 */
  icon: IconValueSchema.optional(),
  /** 由某个工具包创建的页面（原 toolId）；移除工具包时一并移除。 */
  package: IdSchema.optional(),
  /** 整个页面的背景图片（D-258，schemaVersion 18），块浮在上面。 */
  backdrop: BackdropSchema.optional(),
  /**
   * 给某张表的一条记录用的页面（D-342，原 recordOf）：从这张表的记录块（opens）点一条打开，块里的
   * "$record" 指那条记录。不能放进导航栏，也不能从按钮、入口、提醒直接打开。
   */
  of: IdSchema.optional(),
  blocks: z.array(ComponentSchema).max(MAX_PAGE_BLOCKS),
});
/** 页面；块里可能有这个版本不认识的（D-254，见 UnknownComponent）。 */
export type Page = Omit<z.infer<typeof PageSchema>, 'blocks'> & { blocks: Component[] };

export const ContainersSchema = z.strictObject({
  pages: z.array(PageSchema).min(1).max(20),
  /** 文件房间的布局（D-358）；没有时是默认布局（预览居中、工具栏在底部）。AI 修改等 R3（Q7）。 */
  desk: DeskLayoutSchema.optional(),
});

// ---- 工具包（界面上叫「工具」）----

/** 已添加的工具包（原 InstalledTool {toolId, version, pageId}）。 */
export const PackageSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
  page: IdSchema,
});
export type InstalledPackage = z.infer<typeof PackageSchema>;
/** v33 的名字。 */
export type InstalledTool = InstalledPackage;

// ---- 工具：快捷操作、提醒 ----

export const ActionIdSchema = z.string().regex(/^[a-z]+\.[a-zA-Z0-9]+$/, 'invalid action id');

export const WorkflowStepSchema = z.strictObject({
  id: IdSchema,
  action: ActionIdSchema,
  params: z.record(z.string(), z.unknown()),
  /** 这些参数每次运行时问用户（键必须是该动作界面元数据里的参数）。 */
  ask: z.array(z.string().min(1).max(40)).max(10).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** 一个快捷操作最多的步骤数。 */
export const MAX_WORKFLOW_STEPS = 12;

/** 快捷操作总数上限：装满全部工具包约 40 个单功能快捷操作，再加用户自己的。 */
export const MAX_WORKFLOWS = 100;

/** 手机桌面上长按 Morph 图标的菜单里最多放几个快捷操作（D-271）：iOS 只显示 4 个，Android 跟着一样。 */
export const MAX_HOME_SCREEN = 4;

/**
 * 快捷操作：线性步骤序列，步骤之间传递一个有类型的值（§7C、D-060，非图灵完备；关系规则 13：
 * 工具不能触发工具，只有这里的线性步骤能串）。package：添加工具包时创建，移除时一起移除（原 toolId）；
 * preset：从哪个预设复制来的（D-062，D-236，原 presetId）。放到手机桌面见 nav.phoneHomeScreen（D-271）。
 */
export const QuickActionSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('quickAction'),
  name: boundedText(1, 40),
  icon: IconValueSchema.optional(),
  package: IdSchema.optional(),
  preset: IdSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
});
export type QuickAction = z.infer<typeof QuickActionSchema>;
/** v33 的名字（同一个东西）。 */
export type Workflow = QuickAction;
export const WorkflowSchema = QuickActionSchema;

/** 一天里的时间 HH:mm（设备本地时间）。 */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time like 09:00');

/** 点提醒打开哪里：一个页面或系统入口，或者一个快捷操作（只打开，不运行，D-251）。 */
export type ReminderTarget = OpenTarget;
export const ReminderTargetSchema = openTargetSchema(
  'opens must be a page, a system entry or tool:<id>',
  ['tool'],
);

const tableField = z.strictObject({ table: IdSchema, field: IdSchema });

/**
 * 提醒什么时候响：every day / week（days：1 = 周一 … 7 = 周日）在 at 提醒；before 在一张表的日期字段
 * 到期前 days 天的 at 提醒（每条记录一次，原 dateField）；each 按一张表的日程字段给每条记录各排各的
 * （D-316，原 scheduleField）。
 */
export const ReminderWhenSchema = z.union([
  z.strictObject({ every: z.literal('day'), at: TimeOfDaySchema }),
  z.strictObject({
    every: z.literal('week'),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    at: TimeOfDaySchema,
  }),
  z.strictObject({
    before: tableField,
    days: z.number().int().min(0).max(30),
    at: TimeOfDaySchema,
  }),
  z.strictObject({ each: tableField, at: TimeOfDaySchema }),
]);
export type ReminderWhen = z.infer<typeof ReminderWhenSchema>;

/**
 * 提醒（D-251）：本地通知，不用推送、不需要服务器。时间触发，点通知只打开 opens，绝不运行任何东西
 * （关系规则 13、14：不能挂会把数据带出 App 的动作）。title 是通知的标题（配置里的文字，AI 能看到）；
 * 按记录的提醒正文在本机按记录生成（记录内容不进配置，不发给 AI）。
 */
export const ReminderSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('reminder'),
  package: IdSchema.optional(),
  preset: IdSchema.optional(),
  title: boundedText(1, 60),
  enabled: z.boolean(),
  when: ReminderWhenSchema,
  opens: ReminderTargetSchema,
  /** 只有 each（D-318）：通知上的「完成」按钮对这条记录（$row）做的一键记录工具（只写记录）。 */
  done: RecordToolSchema.optional(),
  /** 只有 each（D-318）：通知上的「稍后提醒」按钮，过几分钟再提醒一次。 */
  snoozeMinutes: z.number().int().min(5).max(240).optional(),
  /**
   * 只有 each（D-317）：那天所在的这一天 / 这一周 / 这个月里，table 表里已经有符合 filter 的记录就不提醒。
   * 日子按 date（不写是创建时间）；是同一张表时只看这条记录自己，link 是那张表里指向这张表的引用字段时
   * 只看指向这条记录的。
   */
  unless: z
    .strictObject({
      table: IdSchema,
      within: z.enum(['day', 'week', 'month']),
      filter: z.array(ConditionSchema).max(5).optional(),
      date: FieldRefSchema.optional(),
      link: IdSchema.optional(),
    })
    .optional(),
});
export type Reminder = z.infer<typeof ReminderSchema>;

/** 每天、每周、到期提醒最多几个（D-251）。 */
export const MAX_REMINDERS = 20;
/** 按记录排的提醒（each）最多几个，另算，不占上面 20 个的名额（D-316）。 */
export const MAX_RECORD_REMINDERS = 10;

export const isRecordReminder = (r: Reminder) => 'each' in r.when;

/** 独立的工具（tools[]）：快捷操作、提醒。就地的一键记录工具写在块里（Q1）。 */
export const ToolSchema = z.discriminatedUnion('kind', [QuickActionSchema, ReminderSchema]);
export type Tool = z.infer<typeof ToolSchema>;

/**
 * 工具的登记（v34「数据 · 容器 · 工具」）：每种独立工具作用在哪层、读写什么、怎么触发。
 * trigger：tap = 用户点了才做；time = 到点出通知（只打开，关系规则 13、14）。
 */
export const TOOL_KINDS = {
  quickAction: { kind: 'tool', layer: 'file', access: 'write', trigger: 'tap', runs: 'steps' },
  reminder: { kind: 'tool', layer: 'table', access: 'read', trigger: 'time', runs: 'opens' },
} as const;

export const ToolsSchema = z
  .array(ToolSchema)
  .refine((list) => list.filter((t) => t.kind === 'quickAction').length <= MAX_WORKFLOWS, {
    message: `at most ${MAX_WORKFLOWS} quick actions`,
  })
  .refine(
    (list) =>
      list.filter((t) => t.kind === 'reminder' && !isRecordReminder(t)).length <= MAX_REMINDERS,
    { message: `at most ${MAX_REMINDERS} daily, weekly or date reminders` },
  )
  .refine(
    (list) =>
      list.filter((t) => t.kind === 'reminder' && isRecordReminder(t)).length <=
      MAX_RECORD_REMINDERS,
    { message: `at most ${MAX_RECORD_REMINDERS} reminders for each entry (when.each)` },
  );

// ---- 数据 ----

export const DataSchema = z.strictObject({
  /** 数据表结构（原 collections）。记录内容不在配置里，也从不发给 AI。 */
  tables: z.array(CollectionSchema).max(20),
  /** 一天、一周从什么时候开始（D-286）；没有时是 0 点、周一。 */
  calendar: CalendarSchema.optional(),
});

export const HOME_PAGE_ID = 'home';
/** 新用户的工具箱页面（D-181）。是用户自己的页面，可以改、也可以删；「设置 → 工具」始终列出全部工具。 */
export const TOOLBOX_PAGE_ID = 'toolbox';

export const WorkspaceConfigSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  theme: ThemeSchema,
  nav: NavSchema,
  data: DataSchema,
  containers: ContainersSchema,
  tools: ToolsSchema,
  packages: z.array(PackageSchema),
});
type ParsedConfig = z.infer<typeof WorkspaceConfigSchema>;
export type WorkspaceConfig = Omit<ParsedConfig, 'containers'> & {
  containers: Omit<ParsedConfig['containers'], 'pages'> & { pages: Page[] };
};

// ---- 读配置的辅助函数 ----

/** 快捷操作（tools[] 里 kind 是 quickAction 的，按原顺序）。 */
export const quickActionsOf = (config: Pick<WorkspaceConfig, 'tools'>): QuickAction[] =>
  config.tools.filter((t): t is QuickAction => t.kind === 'quickAction');
/** 提醒（tools[] 里 kind 是 reminder 的，按原顺序）。 */
export const remindersOf = (config: Pick<WorkspaceConfig, 'tools'>): Reminder[] =>
  config.tools.filter((t): t is Reminder => t.kind === 'reminder');
export const pagesOf = (config: WorkspaceConfig): Page[] => config.containers.pages;
export const tablesOf = (config: Pick<WorkspaceConfig, 'data'>) => config.data.tables;

/** 块的子块（分组的 children；别的块没有）。 */
export const childrenOf = (c: Component): Component[] =>
  isKnownComponent(c) && c.look === 'group' ? (c.children as Component[]) : [];

/** 页面上的所有块，包括分组里的子块（两层，深度优先，按显示顺序）。 */
export function allComponents(page: Page): Component[] {
  const walk = (list: readonly Component[]): Component[] =>
    list.flatMap((c) => [c, ...walk(childrenOf(c))]);
  return walk(page.blocks);
}
export const allBlocks = allComponents;

/** 块所在的分组（顶层块是 null）。 */
export function parentOf(page: Page, blockId: string): Component | null {
  for (const c of allComponents(page)) if (childrenOf(c).some((x) => x.id === blockId)) return c;
  return null;
}

/**
 * 一个工具宫格显示哪些工具包（D-181）：写了 ids 就按它的顺序；没写就是目录里
 * 同一页面上其他宫格都没列出的。目录里没有的不显示。
 */
export function toolGridToolIds(
  grid: ComponentOf<'packages'>,
  page: Page,
  catalog: readonly string[],
): string[] {
  if (grid.source.ids) return grid.source.ids.filter((id) => catalog.includes(id));
  const listed = new Set(
    allComponents(page).flatMap((c) =>
      isKnownComponent(c) && c.look === 'packages' ? (c.source.ids ?? []) : [],
    ),
  );
  return catalog.filter((id) => !listed.has(id));
}

/** 读表的块读的数据表（定义里 refs 指向 table 的键；$files 不算）。 */
export function componentCollection(c: Component): string | null {
  const id = componentRefs(c, 'table')[0] as string | undefined;
  return id === undefined || id.startsWith('$') ? null : id;
}

/** 按钮和入口这类块打开的目标（opens）。 */
export function componentTarget(c: Component): OpenTarget | null {
  return (componentRefs(c, 'target')[0] as OpenTarget | undefined) ?? null;
}
