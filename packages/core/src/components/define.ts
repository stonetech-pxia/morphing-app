import { z } from 'zod';

import type { DescribeContext } from '../describe';
import type { Registry } from '../registry';
import type { Page, WorkspaceConfig } from '../schema';
import { IdSchema, type Collection, type FieldType } from '../schema-base';

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

/** 求和、平均等要用的字段类型。 */
export const NUMERIC_FIELD_TYPES: readonly string[] = ['number', 'money', 'rating', 'formula'];

/** 每条记录都有的系统字段，当作日期。 */
export const isSystemField = (id: string) => id === 'createdAt' || id === 'updatedAt';

export interface CheckContext {
  config: WorkspaceConfig;
  registry: Registry;
  page: Page;
  /** 组件引用的数据表。只有引用了数据表的组件有；表不存在时不会调用 check。 */
  collection?: Collection;
}

/** 长按编辑（D-052）里能直接改的一个文字属性。 */
export interface EditableText {
  prop: string;
  /** 与结构里的长度上限一致（components.test.ts 会检查）；超出时校验器也会拦截。 */
  max: number;
  optional?: boolean;
  multiline?: boolean;
  /** 支持粗体、斜体、链接和列表（richtext.ts）。 */
  rich?: boolean;
}

export type StyleKey = 'tone' | 'align' | 'size';

/**
 * 长按编辑里能改什么（D-052）。只列渲染器真正会显示出来的外观；
 * 数据组件不能改文字（只调整位置、颜色、隐藏和删除）。
 */
export interface ComponentEdit {
  text: EditableText[];
  style: StyleKey[];
}

/** 发给 AI 的说明（packages/planner/src/prompt.ts 读它，英文）。改了要跑受影响的评测。 */
export interface ComponentAI {
  /**
   * 提示词组件列表里的一行，类型名后面的部分：属性（? 表示可以不写，列出可选值和范围）和用法。
   * 引用了数据表的组件列在「Data components」下，其余列在「Components」下。
   */
  doc: string;
  /** 在提示词里排在哪个组件后面；不写就按登记顺序（filePick 是后加的，说明一直写在 button 后面）。 */
  docAfter?: string;
  /** 和这个组件有关的规则；n 是规则编号，新组件的规则接在最后一条后面。 */
  rule?: { n: number; text: string };
}

export const ALL_STYLES: StyleKey[] = ['tone', 'align', 'size'];

/** 组件自己的检查发现的问题。只写文字时是数据问题（code data，前面加组件 ID）。 */
export type CheckProblem = string | { code: string; message: string };

type Instance<T extends string, P extends z.ZodObject, E extends z.ZodRawShape> = z.infer<
  ReturnType<typeof componentSchema<T, P, E>>
>;

export interface ComponentSpec<T extends string, P extends z.ZodObject, E extends z.ZodRawShape> {
  type: T;
  props: P;
  /** 除了 props 以外的结构，只有分组用（children）。 */
  extra?: E;
  /**
   * 通用引用检查会查的属性（validate.ts）：数据表存在，字段存在、类型对，筛选条件合法，
   * 页面、工具、快捷操作存在。要看别的属性才知道该不该查的引用，写在 check 里。
   */
  refs?: { readonly [K in keyof z.infer<P>]?: ComponentRef };
  /**
   * 通用检查以外的规则。引用了数据表的组件在字段引用之后、筛选条件之前检查，其余组件在页面、工具引用之后。
   * 问题文字会发给 AI 让它改正，改文字要想清楚。
   */
  check?: (c: Instance<T, P, E>, ctx: CheckContext) => CheckProblem[];
  /** 修改说明里怎么称呼这个组件（例如「标题“记账”」）。 */
  describe: (c: Instance<T, P, E>, config: WorkspaceConfig, ctx: DescribeContext) => string;
  edit: ComponentEdit;
  ai: ComponentAI;
  /**
   * 一个能用的例子（不含 id 和 type）：components.test.ts 拿它在三种语言下校验、生成说明，
   * App 的 registry-test 拿它渲染。只引用样例配置里有的：数据表 expenses（记账模版的
   * amount、category、date、note），已添加的工具 pdf，它的快捷操作 pdf-merge。
   */
  example: Omit<Instance<T, P, E>, 'id' | 'type'>;
}

/**
 * 一份组件定义，加上由它生成的完整结构 schema。
 * 定义文件里要写明这个类型（回调用到了配置的类型，而配置的类型又由组件定义生成，不写 TypeScript 推不出来）。
 */
export type ComponentDefinitionOf<
  T extends string,
  P extends z.ZodObject,
  E extends z.ZodRawShape = Record<never, never>,
> = ComponentSpec<T, P, E> & { schema: ReturnType<typeof componentSchema<T, P, E>> };

export function defineComponent<
  const T extends string,
  P extends z.ZodObject,
  E extends z.ZodRawShape = Record<never, never>,
>(spec: ComponentSpec<T, P, E>): ComponentDefinitionOf<T, P, E> {
  return { ...spec, schema: componentSchema(spec.type, spec.props, spec.extra ?? ({} as E)) };
}

/** 列表里出现了不止一次的值。 */
export function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** 数据表的名字；表不在了就用 ID。 */
export function collectionName(id: string, config: WorkspaceConfig): string {
  return config.collections.find((c) => c.id === id)?.name ?? id;
}
