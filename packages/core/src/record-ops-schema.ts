import { z } from 'zod';

import {
  ConditionSchema,
  GROUP_REF,
  HERE_REF,
  IdSchema,
  RECORD_REF,
  ROW_REF,
  boundedText,
  filterSchema,
} from './schema-primitives';

// 一键记录工具（D-300，v34 NEW_FORMAT §5.2）的写法。只放结构：块、提醒的定义引用它；
// 检查和执行在 record-ops.ts（会用到数据和筛选，块的定义不能引用，否则加载会绕圈）。
// v34：就地的工具（Q1）写在块的 tools[] 里，跟着块加、改、删；提醒的 done 也是一个一键记录工具。

/**
 * 工具里能写的值（D-301）：单选项 ID、数字、勾选（true / false）、"today"（日期字段）、"now"（时间、
 * 日期时间字段）、null（清空）；"$row" 是工具作用的那一条，"$record" 是记录页打开的那一条（D-342），
 * 都只给引用字段；"$group" 是拖到的那一栏（只给 drag）。按字段类型解释，不能写文字：文字是用户的内容（D-042）。
 */
export const RecordToolValueSchema = z.union([
  IdSchema,
  z.literal(RECORD_REF),
  z.literal(ROW_REF),
  z.literal(GROUP_REF),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type RecordToolValue = z.infer<typeof RecordToolValueSchema>;
/** v33 的名字（同一个东西）。 */
export type RecordActionValue = RecordToolValue;
export const RecordActionValueSchema = RecordToolValueSchema;

/** 字段 ID → 预设值（≤20；表单 ≤10，检查在 record-ops.ts）。 */
export const RecordToolValuesSchema = z
  .record(IdSchema, RecordToolValueSchema)
  .refine((v) => Object.keys(v).length <= 20, 'at most 20 preset values');
export type RecordToolValues = z.infer<typeof RecordToolValuesSchema>;

/** 表单里问几个字段（原 recordForm.fieldIds），或者 "all" = 打开新记录的完整表单（原 create form:true、open）。 */
export const AskSchema = z.union([z.literal('all'), z.array(IdSchema).min(1).max(10)]);
export type Ask = z.infer<typeof AskSchema>;

const create = {
  do: z.literal('create'),
  table: IdSchema,
  /** 预设值；"$here" = 就地添加（这一段的值 + 列表筛选里的等于条件，原 addHere）。 */
  values: z.union([RecordToolValuesSchema, z.literal(HERE_REF)]).optional(),
  /** 不写：直接存（原 create）；"all"：完整表单、预设值先填好；[字段]：表单块里问这几个（只给 look form）。 */
  ask: AskSchema.optional(),
  /** 在本机认出文字里说的日期（D-344）：from 是 ask 里的一个文字字段，to 是日期、日期时间或日程字段。 */
  smartDate: z.strictObject({ from: IdSchema, to: IdSchema }).optional(),
};
const set = {
  do: z.literal('set'),
  table: IdSchema,
  field: IdSchema,
  value: RecordToolValueSchema,
};
const toggle = { do: z.literal('toggle'), table: IdSchema, field: IdSchema };
const increment = {
  do: z.literal('increment'),
  table: IdSchema,
  field: IdSchema,
  by: z
    .number()
    .finite()
    .refine((n) => n !== 0 && Math.abs(n) <= 1e6, 'by must be a non-zero number up to 1000000'),
};
const setAll = {
  do: z.literal('setAll'),
  table: IdSchema,
  filter: filterSchema().optional(),
  field: IdSchema,
  value: RecordToolValueSchema,
};

/** 一键记录的 5 种（关系规则 7）。 */
export const RECORD_TOOL_KINDS = ['create', 'set', 'toggle', 'increment', 'setAll'] as const;
export type RecordToolKind = (typeof RECORD_TOOL_KINDS)[number];

export const RecordToolSchema = z.discriminatedUnion('do', [
  z.strictObject(create),
  z.strictObject(set),
  z.strictObject(toggle),
  z.strictObject(increment),
  z.strictObject(setAll),
]);
export type RecordTool = z.infer<typeof RecordToolSchema>;

/** setAll 一次最多改几条（D-303）。 */
export const MAX_SET_ALL = 200;

/**
 * 块上的工具出现在哪（关系规则 4）：submit 表单的提交、button 每一条右边的按钮（≤3，显示第一个 when 满足的）、
 * check 清单的勾、tap 点一下（大圆块）、drag 拖到另一栏、addHere 每段 / 选中那天 / 每栏下面的「添加」。
 * 不写 as：块本身被点时做（button、action、picker）。
 */
export const TOOL_USE_AS = ['submit', 'button', 'check', 'tap', 'drag', 'addHere'] as const;
export type ToolUseAs = (typeof TOOL_USE_AS)[number];

/** 内核的「打开相册 / 打开文件」（原 filePick），选完进收件页面，绝不自动运行。 */
export const PICK_TOOLS = ['$pick.media', '$pick.files'] as const;
export type PickTool = (typeof PICK_TOOLS)[number];

const useBase = {
  as: z.enum(TOOL_USE_AS).optional(),
  /** 按钮上的字（submit ≤30，其余 ≤20，检查在 record-ops.ts）。 */
  label: boundedText(1, 30).optional(),
  /** 这一条满足这些条件时才显示（例如结束时间为空时显示「下班」）；条件只读数据（关系规则 5）。 */
  when: z.array(ConditionSchema).max(3).optional(),
};

/**
 * 块怎么引用工具（NEW_FORMAT §3.4）：
 * - 引用一个独立的工具：tools[] 里的快捷操作（找不到时按内设快捷操作的 ID 找）、或者内核的 $pick.*；
 * - 就地的一键记录工具（Q1）；
 * - 行上的「打开」：导航到这一条的编辑页（"record"）或记录页（页面 ID），不是工具。
 */
export const ToolUseSchema = z.union([
  z.strictObject({ ...useBase, tool: z.union([IdSchema, z.enum(PICK_TOOLS)]) }),
  z.strictObject({ ...useBase, ...create }),
  z.strictObject({ ...useBase, ...set }),
  z.strictObject({ ...useBase, ...toggle }),
  z.strictObject({ ...useBase, ...increment }),
  z.strictObject({ ...useBase, ...setAll }),
  z.strictObject({ ...useBase, opens: z.union([z.literal('record'), IdSchema]) }),
]);
export type ToolUse = z.infer<typeof ToolUseSchema>;
/** 就地的一键记录工具（带出现方式）。 */
export type RecordToolUse = Extract<ToolUse, { do: string }>;
export type ToolRefUse = Extract<ToolUse, { tool: string }>;
export type OpenUse = Extract<ToolUse, { opens: string }>;

export const isRecordToolUse = (u: ToolUse): u is RecordToolUse => 'do' in u;
export const isToolRefUse = (u: ToolUse): u is ToolRefUse => 'tool' in u;
export const isOpenUse = (u: ToolUse): u is OpenUse => 'opens' in u;

/** 一个就地工具去掉出现方式，剩下的一键记录工具本身。 */
export function recordToolOf(use: RecordToolUse): RecordTool {
  const { as: _as, label: _label, when: _when, ...tool } = use;
  return tool as RecordTool;
}
