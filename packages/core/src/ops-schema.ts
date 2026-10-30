import { z } from 'zod';

import { THEME_PRESET_IDS } from './presets';
import {
  BackdropPatchSchema,
  CollectionSchema,
  ComponentSchema,
  ComponentStyleSchema,
  FieldSchema,
  FONT_CHOICES,
  HexColorSchema,
  IconValueSchema,
  IdSchema,
  NavTargetSchema,
  PageSchema,
  QuickActionSchema,
  ReminderSchema,
  ThemeSchema,
  WorkflowStepSchema,
} from './schema';

// 语义化修改操作（§7D），v34 一共 14 个（NEW_FORMAT_DRAFT §7）：数据 4 个、容器 4 个、工具 4 个、主题、工具包。
// AI 只能输出这些操作；applyOps（ops.ts）是纯函数，不修改输入，只负责执行和引用检查，完整合法性由
// validateWorkspace 判定。每个操作一个结构（按 op 区分），同一个操作的几种写法在 refine 里说清楚，
// 问题文字会发给 AI。

/** null 表示恢复默认值 / 去掉。 */
const resettable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const index = z.number().int().min(0);
/** 合并的补丁：值是 null 的键去掉。 */
const patch = z.record(z.string(), z.unknown());

const ColorOverridesSchema = z.strictObject({
  background: resettable(HexColorSchema),
  surface: resettable(HexColorSchema),
  text: resettable(HexColorSchema),
  secondary: resettable(HexColorSchema),
  tertiary: resettable(HexColorSchema),
});

/** 块的修改（updateContainer 的 changes）：style、show、source 合并（null 去掉一项），tools、opens 整个换。 */
export const BlockChangesSchema = z.strictObject({
  style: z
    .strictObject({
      align: resettable(ComponentStyleSchema.shape.align.unwrap()),
      tone: resettable(ComponentStyleSchema.shape.tone.unwrap()),
      size: resettable(ComponentStyleSchema.shape.size.unwrap()),
      /** 图片背景（D-258）：只写要改的，合进已有的；null 关掉。 */
      backdrop: resettable(BackdropPatchSchema),
    })
    .optional(),
  hidden: z.boolean().optional(),
  show: patch.optional(),
  source: patch.optional(),
  /** 整个换；null 去掉块上的全部工具。 */
  tools: z.array(z.unknown()).nullable().optional(),
  /** 整个换；null 去掉。 */
  opens: z.unknown().optional(),
});
export type BlockChanges = z.infer<typeof BlockChangesSchema>;

/** 页面的修改：名字、图标（null 去掉）、背景图片（合进已有的；null 关掉）。 */
export const PageChangesSchema = z.strictObject({
  title: z.string().optional(),
  icon: IconValueSchema.nullable().optional(),
  backdrop: BackdropPatchSchema.nullable().optional(),
});

export const NavChangesSchema = z.strictObject({
  bar: z.array(NavTargetSchema).min(1).max(5).optional(),
  floating: z.array(NavTargetSchema).max(3).optional(),
  /** 整个列表（≤4，D-271）；[] 是一个都不放。 */
  phoneHomeScreen: z.array(IdSchema).optional(),
});

const deskSlot = z.enum(['above', 'below']);

export const OpSchema = z.discriminatedUnion('op', [
  // ---- 数据（功能）：只改结构，从不碰记录内容 ----
  /** {table: 一张新表} 或 {table: 表 ID, field: 新字段, index?}。 */
  z
    .strictObject({
      op: z.literal('addData'),
      table: z.union([IdSchema, CollectionSchema]),
      field: FieldSchema.optional(),
      index: index.optional(),
    })
    .refine((o) => (typeof o.table === 'string') === (o.field !== undefined), {
      message:
        'addData takes {table: {id, name, fields}} for a new table, or {table: "<table id>", field} for a new field',
    }),
  /**
   * {table, changes: {name?, icon?}}、{table, field, changes}（合并进字段定义；null 去掉；type 只能在兼容的
   * 类型之间换）或 {calendar: {dayStartHour?, weekStart?, twoWeekStart?}}（null 恢复默认）。
   */
  z
    .strictObject({
      op: z.literal('updateData'),
      table: IdSchema.optional(),
      field: IdSchema.optional(),
      changes: patch.optional(),
      calendar: z
        .strictObject({
          dayStartHour: resettable(z.number().int()),
          weekStart: resettable(z.enum(['monday', 'sunday'])),
          twoWeekStart: resettable(z.string()),
        })
        .optional(),
    })
    .refine(
      (o) =>
        o.calendar !== undefined
          ? o.table === undefined && o.field === undefined && o.changes === undefined
          : o.table !== undefined && o.changes !== undefined,
      { message: 'updateData takes {table, field?, changes} or {calendar: {…}}' },
    ),
  /** 去掉字段：记录里的旧值保留；移出表：记录保留，可在「设置 → 数据」里导出或由用户永久删除。 */
  z.strictObject({ op: z.literal('removeData'), table: IdSchema, field: IdSchema.optional() }),
  z.strictObject({ op: z.literal('moveData'), table: IdSchema, field: IdSchema, toIndex: index }),

  // ---- 容器（外观；就地的一键记录工具跟着块一起加、改、删）----
  /** {page: 一个新页面}、{page: 页面 ID, block, parent?, index?} 或 {desk: "above"|"below", block, index?}。 */
  z
    .strictObject({
      op: z.literal('addContainer'),
      page: z.union([IdSchema, PageSchema.omit({ package: true })]).optional(),
      desk: deskSlot.optional(),
      block: ComponentSchema.optional(),
      /** 加入某个分组；省略时加在页面顶层。 */
      parent: IdSchema.optional(),
      index: index.optional(),
    })
    .refine(
      (o) =>
        o.desk !== undefined
          ? o.page === undefined && o.block !== undefined && o.parent === undefined
          : typeof o.page === 'string'
            ? o.block !== undefined
            : o.page !== undefined &&
              o.block === undefined &&
              o.parent === undefined &&
              o.index === undefined,
      {
        message:
          'addContainer takes {page: {id, title, blocks}} for a new page, {page: "<page id>", block, parent?, index?} or {desk: "above"|"below", block}',
      },
    ),
  /**
   * {page, changes: {title?, icon?, backdrop?}}、{page, block, changes: {style?, hidden?, show?, source?, tools?,
   * opens?}}、{nav: {bar?, floating?, phoneHomeScreen?}} 或 {desk: {toolbar?, preview?, strip?, tools?}}。
   */
  z
    .strictObject({
      op: z.literal('updateContainer'),
      page: IdSchema.optional(),
      block: IdSchema.optional(),
      changes: z.union([BlockChangesSchema, PageChangesSchema]).optional(),
      nav: NavChangesSchema.optional(),
      desk: patch.optional(),
    })
    .refine(
      (o) =>
        o.nav !== undefined
          ? o.page === undefined && o.desk === undefined && o.changes === undefined
          : o.desk !== undefined
            ? o.page === undefined && o.changes === undefined
            : o.page !== undefined && o.changes !== undefined,
      {
        message:
          'updateContainer takes {page, block?, changes}, {nav: {bar?, floating?, phoneHomeScreen?}} or {desk: {…}}',
      },
    ),
  z
    .strictObject({
      op: z.literal('removeContainer'),
      page: IdSchema.optional(),
      desk: deskSlot.optional(),
      block: IdSchema.optional(),
    })
    .refine((o) => (o.desk !== undefined ? o.page === undefined && !!o.block : !!o.page), {
      message: 'removeContainer takes {page, block?} or {desk: "above"|"below", block}',
    }),
  z.strictObject({
    op: z.literal('moveContainer'),
    page: IdSchema,
    block: IdSchema,
    toIndex: index,
    /** 移入某个分组；省略时移到页面顶层。 */
    parent: IdSchema.optional(),
  }),

  // ---- 工具（功能）：快捷操作、提醒 ----
  /**
   * {tool: 一个新的快捷操作或提醒}（快捷操作不能属于工具包；放到手机桌面用 updateContainer {nav}），
   * 或 {tool: 快捷操作 ID, step, index?}（插在第几步之前；省略 = 最后）。
   */
  z
    .strictObject({
      op: z.literal('addTool'),
      tool: z.union([IdSchema, QuickActionSchema.omit({ package: true }), ReminderSchema]),
      step: WorkflowStepSchema.optional(),
      index: index.optional(),
    })
    .refine((o) => (typeof o.tool === 'string') === (o.step !== undefined), {
      message:
        'addTool takes {tool: {kind: "quickAction"|"reminder", …}} for a new tool, or {tool: "<quick action id>", step, index?}',
    }),
  /**
   * {tool, changes}：快捷操作 {name?, icon?, steps?}（整体替换步骤：快捷操作编辑页保存、恢复预设），
   * 提醒合并（null 去掉可选的键）；{tool, step, changes: {params?（合并）, ask?（整个换，[] 都不问）}}。
   */
  z.strictObject({
    op: z.literal('updateTool'),
    tool: IdSchema,
    step: IdSchema.optional(),
    changes: patch,
  }),
  /** 删除用户自己的快捷操作（连同运行它、打开它的块）或提醒；或者快捷操作的一步。工具包自带的不能删。 */
  z.strictObject({ op: z.literal('removeTool'), tool: IdSchema, step: IdSchema.optional() }),
  z.strictObject({ op: z.literal('moveTool'), tool: IdSchema, step: IdSchema, toIndex: index }),

  // ---- 主题（外观）----
  /** {preset}、{reset: true} 或一个补丁（只写要改的）。 */
  z
    .strictObject({
      op: z.literal('setTheme'),
      preset: z.enum(THEME_PRESET_IDS).optional(),
      reset: z.literal(true).optional(),
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
    })
    .refine(
      (o) => {
        const keys = Object.keys(o).filter((k) => k !== 'op');
        return o.preset !== undefined || o.reset ? keys.length === 1 : keys.length > 0;
      },
      { message: 'setTheme takes {preset}, {reset: true} or the theme keys to change' },
    ),

  // ---- 工具包（功能；界面上叫「工具」）----
  /** add 建工具包页面和它的快捷操作；remove 一起移除；update 升级到当前版本，保留用户的修改。 */
  z.strictObject({
    op: z.literal('setPackage'),
    package: IdSchema,
    do: z.enum(['add', 'remove', 'update']),
  }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpOf<K extends Op['op']> = Extract<Op, { op: K }>;
/** 一次修改（一个版本）最多包含的操作数。 */
export const MAX_OPS_PER_CHANGE = 30;
export const OpListSchema = z.array(OpSchema).min(1).max(MAX_OPS_PER_CHANGE);

/** 功能（数据、独立工具、工具包、手机桌面）和外观（容器、就地工具、主题、导航栏）分两轮（规则 26）。 */
export function isFunctionOp(op: Op): boolean {
  switch (op.op) {
    case 'addData':
    case 'updateData':
    case 'removeData':
    case 'moveData':
    case 'addTool':
    case 'updateTool':
    case 'removeTool':
    case 'moveTool':
    case 'setPackage':
      return true;
    case 'updateContainer':
      return op.nav?.phoneHomeScreen !== undefined;
    default:
      return false;
  }
}
