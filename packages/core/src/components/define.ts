import { z } from 'zod';

import { IdSchema, type FieldType } from '../schema-base';

// 组件登记表：每种页面组件一份定义（新增组件的步骤见 docs/COMPONENTS.md），
// 结构校验、引用检查、草稿说明、长按编辑、提示词都从这里读，不再各写一份按类型的 switch。

/** 每个组件都可以有的外观设置。tone 对文字组件是文字颜色，对卡片类组件是底色。 */
export const ComponentStyleSchema = z.strictObject({
  align: z.enum(['start', 'center']).optional(),
  tone: z.enum(['default', 'primary', 'secondary', 'tertiary', 'muted']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
});
export type ComponentStyle = z.infer<typeof ComponentStyleSchema>;

const componentBase = {
  id: IdSchema,
  hidden: z.boolean().optional(),
  style: ComponentStyleSchema.optional(),
};

/** 入口类卡片的样子（D-230）：row = 设置页那种一行、右边有箭头；tile = 大图标块。 */
export const EntryLookSchema = z.enum(['row', 'tile']);
export type EntryLook = z.infer<typeof EntryLookSchema>;

/**
 * 属性引用了配置里的什么（通用引用检查和 componentCollection 这类辅助函数读它）：
 * - collection：数据表 ID；同一个组件里的 field、filter 都指这张表。
 * - field：这张表的字段（也可以是 createdAt / updatedAt），值可以是一个或一组；
 *   types 限定字段类型（系统字段算日期），role 是问题文字里的名字，不写就用属性名。
 * - filter：这张表的筛选条件。
 * - target：页面或系统入口。
 * - tool：installed = 已添加的工具（一个），catalog = 目录里的工具（一组）。
 * - workflow：快捷操作。
 */
export type ComponentRef =
  | { to: 'collection' }
  | { to: 'field'; role?: string; types?: readonly FieldType[] }
  | { to: 'filter' }
  | { to: 'target' }
  | { to: 'tool'; in: 'installed' | 'catalog' }
  | { to: 'workflow' };

function componentSchema<T extends string, P extends z.ZodObject, E extends z.ZodRawShape>(
  type: T,
  props: P,
  extra: E,
) {
  return z.strictObject({ ...componentBase, type: z.literal(type), props, ...extra });
}

export interface ComponentSpec<T extends string, P extends z.ZodObject, E extends z.ZodRawShape> {
  type: T;
  props: P;
  /** 除了 props 以外的结构，只有分组用（children）。 */
  extra?: E;
  refs?: { readonly [K in keyof z.infer<P>]?: ComponentRef };
}

export function defineComponent<
  const T extends string,
  P extends z.ZodObject,
  E extends z.ZodRawShape = Record<never, never>,
>(spec: ComponentSpec<T, P, E>) {
  return { ...spec, schema: componentSchema(spec.type, spec.props, spec.extra ?? ({} as E)) };
}
