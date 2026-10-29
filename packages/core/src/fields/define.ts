import { z } from 'zod';

import type { Collection, WorkspaceConfig } from '../schema';
import { formatNumber, round, type FieldValue, type LinkResolver } from '../field-values';
import type { FormulaType } from '../formula';
import { IdSchema, boundedText, type Locale } from '../schema-primitives';

// 字段类型登记表：每种字段一份定义（新增字段的步骤见 docs/FIELDS.md）。结构、写入和读取、显示、
// 导出、打印、公式、筛选和排序、统计、AI 提示词都从这里读，不再各写一份按类型的 switch。

/** 每种字段都有的属性（公式没有 required）。 */
export const fieldBase = {
  id: IdSchema,
  name: boundedText(1, 40),
  required: z.boolean().optional(),
};

/** 表单输入转换成字段值的结果。 */
export type Coerced = { value: FieldValue } | { issue: 'invalid' | 'tooLong' };

/** 筛选条件（validate.ts 的 conditionProblems）对这种字段的支持。 */
export interface FieldFilter<F> {
  /** is / isNot 的值对不对得上这个字段。 */
  is: (field: F, value: unknown) => boolean;
  /** contains（文字包含）。 */
  contains?: true;
  /** gt / lt 比较的是数字、日期（YYYY-MM-DD）还是时间（HH:mm）。不写：不能比较。 */
  compare?: 'number' | 'date' | 'time';
  /** inPeriod（今天、本周……）。 */
  period?: true;
  /** 只能看有没有值（isEmpty / isNotEmpty），例如引用字段（D-250）。 */
  emptyOnly?: true;
  /** due（今天该做、已过期、这周要做，D-294）：日程字段。 */
  schedule?: true;
}

/** 检查这个字段定义本身（validate.ts）。只写文字时是数据问题（code data）。 */
export interface FieldCheckContext {
  config: WorkspaceConfig;
  collection: Collection;
  /** 同一张表，查找、汇总、上一条换成它们显示的那种字段（D-287–D-289）：公式按它检查。 */
  view: Collection;
}

type Instance<S extends z.ZodObject> = z.infer<S>;

export interface FieldSpec<T extends string, S extends z.ZodObject> {
  type: T;
  /** 字段定义的结构（含 id、name、type）。 */
  schema: S;
  /** 修改说明里的类型名：[中文, 英文]（法语用英文那一个的对照表）。 */
  label: [string, string];
  /** 宽容读取：值和当前定义对不上时返回 undefined（只是不显示，绝不报错）。 */
  read: (field: Instance<S>, raw: unknown) => FieldValue | undefined;
  /** 显示时怎么取值；不写就是 read。公式的值是现算的数字，直接显示。 */
  shown?: (field: Instance<S>, raw: unknown) => FieldValue | undefined;
  /** 表单输入 → 字段值（写入时严格校验）。不写：不存进记录（公式，D-188）。 */
  write?: (field: Instance<S>, input: unknown) => Coerced;
  /** 新记录里的默认值；不写就用定义里的 default。today 是按「一天从几点开始」算的今天（D-286）。 */
  initial?: (field: Instance<S>, now: Date, today: string) => FieldValue | undefined;
  /** 新记录里没有值时存这个（没勾选的勾选框是 false）。 */
  emptyNew?: FieldValue;
  /** 显示文字（值已经读过、不为空）。 */
  format: (field: Instance<S>, value: FieldValue, locale: Locale, links?: LinkResolver) => string;
  /** CSV 里的写法；不写就和显示一样。 */
  csv?: (field: Instance<S>, value: FieldValue) => string;
  /** 由这个字段算出来的数字（合计、平均）怎么显示；不写就是普通数字。 */
  formatAmount?: (field: Instance<S>, n: number, locale: Locale) => string;
  /** 打印报表（html.ts）：numeric = 靠右对齐的数字列；total = 收据合计用哪个字段（数字小的优先）。 */
  print?: {
    numeric?: true;
    total?: { rank: number; format: (field: Instance<S>, sum: number, locale: Locale) => string };
  };
  /** 公式里能不能引用它、当作哪一种值（D-188、D-247、D-280）。 */
  formula?: FormulaType;
  /** 统计和图表能不能求和、平均（stat、chart 的 fieldId）。 */
  numeric?: true;
  /** 记录表单里能不能填（公式是算出来的）。 */
  inForm?: false;
  filter: FieldFilter<Instance<S>>;
  /**
   * 这个值落在哪一天（本地日期 YYYY-MM-DD）。日期时间（D-279）写它：筛选（is、gt / lt、inPeriod）和
   * 图表的按时间分组都按这一天算。
   */
  day?: (field: Instance<S>, value: FieldValue) => string;
  /** 排序：false = 不能按它排；不写就按值排。 */
  sort?: false | ((field: Instance<S>, value: FieldValue) => FieldValue);
  /** 被引用时（D-250）显示哪个字段：数字小的优先，不写的不显示。 */
  titleRank?: number;
  /** 改字段类型时，同一组里的类型可以互相转换（已有的值仍能读出来）。 */
  convertGroup?: string;
  /** 这个字段定义本身的检查（引用的表要存在、选项不重复……）。 */
  check?: (field: Instance<S>, ctx: FieldCheckContext) => { code: string; message: string }[];
  /** 发给 AI 的说明：提示词「Field = …」那一行里的一段（类型名后面的部分，英文）。 */
  ai: { doc: string; docAfter?: string };
  /** 一个能用的例子，通用测试拿它校验和显示（引用的表是 expenses，公式用 weight 字段）。 */
  example: Instance<S>;
  /** example 字段的一个值（不存值的字段不写），通用测试拿它写入、读出、显示。 */
  exampleValue?: FieldValue;
}

/**
 * 一份字段定义。定义文件里要写明这个类型（回调用到了数据表的类型，而数据表的类型又由字段定义生成，
 * 不写 TypeScript 推不出来）。
 */
export type FieldDefinitionOf<T extends string, S extends z.ZodObject> = FieldSpec<T, S>;

export function defineField<const T extends string, S extends z.ZodObject>(
  spec: FieldSpec<T, S>,
): FieldDefinitionOf<T, S> {
  return spec;
}

/** is / isNot 的值是文字、数字。 */
export const isText = (_field: unknown, v: unknown) => typeof v === 'string';
export const isNumber = (_field: unknown, v: unknown) => typeof v === 'number';

/** 数字类字段的写入：去掉千位分隔符，超过一万亿算无效，按 decimals 位取整。 */
export function writeNumber(input: unknown, decimals: number): Coerced {
  const n = typeof input === 'number' ? input : Number(String(input).trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { issue: 'invalid' };
  return { value: round(n, decimals) };
}

export const readNumber = (_field: unknown, raw: unknown) =>
  typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;

/** 数字加单位（「2.5 kg」）。 */
export const numberWithUnit = (
  n: number,
  field: { decimals?: number | undefined; unit?: string | undefined },
  locale: Locale,
) => `${formatNumber(n, field.decimals, locale)}${field.unit ? ` ${field.unit}` : ''}`;
