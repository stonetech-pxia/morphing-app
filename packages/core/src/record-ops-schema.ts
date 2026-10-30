import { z } from 'zod';

import { ConditionSchema, IdSchema, boundedText } from './schema-primitives';

// 一键记录操作（D-300，方案 P6）的写法。只放结构：按钮和记录列表的定义引用它；
// 检查和执行在 record-ops.ts（会用到数据和筛选，组件定义不能引用，否则加载会绕圈）。

/**
 * 操作里能写的值（D-301，待创始人确认）：单选项 ID、数字、勾选（true / false）、
 * "today"（日期字段）、"now"（时间、日期时间字段）、null（清空）；"row" 只在列表每一行的 create 里，
 * 表示「这一行」（引用字段）。按字段类型解释，不能写文字：文字是用户的内容（D-042）。
 */
export const RecordActionValueSchema = z.union([
  IdSchema,
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type RecordActionValue = z.infer<typeof RecordActionValueSchema>;

const presets = z
  .record(IdSchema, RecordActionValueSchema)
  .refine((v) => Object.keys(v).length <= 20, 'at most 20 preset values');

const create = {
  do: z.literal('create'),
  collectionId: IdSchema,
  /** 字段 ID → 预设值；其余字段按表单的默认值。 */
  values: presets.optional(),
};
/** 按钮和列表每一行的 create 还可以打开表单（D-328）：预设值先填好，用户补完再保存（例如金额要自己填）。 */
const createInApp = { ...create, form: z.literal(true).optional() };
const set = { do: z.literal('set'), fieldId: IdSchema, value: RecordActionValueSchema };
const toggle = { do: z.literal('toggle'), fieldId: IdSchema };
const increment = {
  do: z.literal('increment'),
  fieldId: IdSchema,
  by: z
    .number()
    .finite()
    .refine((n) => n !== 0 && Math.abs(n) <= 1e6, 'by must be a non-zero number up to 1000000'),
};
const setAll = {
  do: z.literal('setAll'),
  collectionId: IdSchema,
  filter: z.array(ConditionSchema).max(5).optional(),
  fieldId: IdSchema,
  value: RecordActionValueSchema,
};

/** 按钮上的操作：新建一条、筛出来的一起设、打开新记录的表单。 */
export const ButtonActionSchema = z.discriminatedUnion('do', [
  z.strictObject(createInApp),
  z.strictObject(setAll),
  z.strictObject({ do: z.literal('open'), collectionId: IdSchema }),
]);
export type ButtonAction = z.infer<typeof ButtonActionSchema>;

/** 列表每一行的按钮：文字、显示条件（不写就总是显示）。 */
const rowItem = {
  label: boundedText(1, 20),
  /** 这一行满足这些条件时才显示这个按钮（例如结束时间为空时显示「下班」）。 */
  when: z.array(ConditionSchema).max(3).optional(),
};

/** 记录列表每一行的操作：改这一行（set / toggle / increment）、以这一行新建（create）、打开它。 */
export const RowActionSchema = z.discriminatedUnion('do', [
  z.strictObject({ ...rowItem, ...createInApp }),
  z.strictObject({ ...rowItem, ...set }),
  z.strictObject({ ...rowItem, ...toggle }),
  z.strictObject({ ...rowItem, ...increment }),
  z.strictObject({ ...rowItem, do: z.literal('open') }),
]);
export type RowAction = z.infer<typeof RowActionSchema>;

export type RecordAction = ButtonAction | RowAction | ReminderDone;

/** setAll 一次最多改几条（D-303）。 */
export const MAX_SET_ALL = 200;

/**
 * 提醒通知上的「完成」按钮（D-318）：对通知说的那条记录做一个操作，和列表每一行的写法一样，只是没有文字和
 * 显示条件（按钮文字是固定的「完成」）。只写记录，不运行快捷操作、不打开 AI。
 */
export const ReminderDoneSchema = z.discriminatedUnion('do', [
  z.strictObject(create),
  z.strictObject(set),
  z.strictObject(increment),
]);
export type ReminderDone = z.infer<typeof ReminderDoneSchema>;
