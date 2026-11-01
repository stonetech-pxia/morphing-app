import { z } from 'zod';

import type { DescribeContext } from '../describe';
import type { WorkspaceConfig } from '../schema';
import type {
  CheckContext,
  CheckProblem,
  ComponentAI,
  ComponentEdit,
  ComponentRef,
  LookMeta,
} from './define';
import { valueAt } from './define';
import { groupComponent, InnerGroupSchema } from './group';
import { LEAF_COMPONENTS, LeafComponentSchema } from './leaves';

export * from './define';
export { GROUP_MAX_CHILDREN, GroupChildSchema, InnerGroupSchema } from './group';
export { LEAF_COMPONENTS, LeafComponentSchema } from './leaves';
export { entryKind, entryEditableText } from './entry';
export {
  RECORD_LOOKS,
  RECORD_LOOK_DOC,
  RecordSourceSchema,
  TrailingFormatSchema,
  type RecordLook,
  type RecordSource,
} from './records';
export { NumberSourceSchema, type NumberSource } from './number';
export { ChartSourceSchema, type ChartSource } from './chart';
export { SMART_DATE_TYPES } from './form';

/** 全部外观：可以放进分组的，加上分组本身。 */
export const COMPONENTS = [...LEAF_COMPONENTS, groupComponent] as const;

export const ComponentSchema = z.discriminatedUnion('look', [
  ...LeafComponentSchema.options,
  groupComponent.schema,
]);

/** 不会和任何外观名相等的标记（运行时是原来的字符串）。 */
type UnknownLook = symbol & { readonly unknownLook: never };

/**
 * 这个版本的 App 不认识的块（D-254）：更新的 App 加的外观，或者 v33 迁移过来的不认识的组件
 * （look "$unknown"，raw 是原来的 JSON，M8）。读取已存的配置时原样保留（保存时写回原来的 JSON），
 * 页面上显示「需要更新 App」的占位，只能移动和删除；AI 不能新加、也不能修改它。
 * 运行时 look 是原来的字符串；类型上是一个独有的标记，按外观判断时必须单独处理它（isKnownComponent）。
 */
export interface UnknownComponent {
  id: string;
  look: UnknownLook;
  hidden?: boolean;
}

/** v33 不认识的组件迁移成的外观（M8）。 */
export const UNKNOWN_LOOK = '$unknown';

export type LeafComponent = z.infer<typeof LeafComponentSchema>;
export type InnerGroupComponent = Omit<z.infer<typeof InnerGroupSchema>, 'children'> & {
  children: (LeafComponent | UnknownComponent)[];
};
/** 分组里也可能有不认识的块（D-254），还可能有一层分组（Q3）。 */
export type GroupComponent = Omit<z.infer<typeof groupComponent.schema>, 'children'> & {
  children: (LeafComponent | InnerGroupComponent | UnknownComponent)[];
};
export type KnownComponent = LeafComponent | GroupComponent | InnerGroupComponent;
/** AI 的修改操作和模版能新加的块：只有这个版本认识的，分组里也是（D-254）。 */
export type NewComponent = z.infer<typeof ComponentSchema>;
/** 页面上的块：认识的，或者更新的 App 加的（D-254）。 */
export type Component = KnownComponent | UnknownComponent;
export type ComponentType = KnownComponent['look'];
export type ComponentOf<T extends ComponentType> = Extract<KnownComponent, { look: T }>;
/** v34 的名字：块、外观。 */
export type Block = Component;
export type KnownBlock = KnownComponent;
export type Look = ComponentType;
export type BlockOf<T extends Look> = ComponentOf<T>;

/** 登记表里的一份定义，回调的参数统一成块（按外观取出来以后用）。 */
export interface ComponentDefinition extends LookMeta {
  look: ComponentType;
  refs?: Readonly<Record<string, ComponentRef | undefined>>;
  check?(c: KnownComponent, ctx: CheckContext): CheckProblem[];
  describe(c: KnownComponent, config: WorkspaceConfig, ctx: DescribeContext): string;
  edit: ComponentEdit;
  ai: ComponentAI;
  example: Record<string, unknown>;
  shape: z.ZodRawShape;
  schema: z.ZodObject;
}

/** 可以用图片代替底色的卡片类外观（edit.backdrop，D-258）。 */
export const BACKDROP_TYPES: readonly ComponentType[] = COMPONENTS.filter(
  (d) => (d.edit as ComponentEdit).backdrop,
).map((d) => d.look);

const BY_LOOK = new Map<string, ComponentDefinition>(
  COMPONENTS.map((d) => [d.look, d as unknown as ComponentDefinition]),
);

/** 这种外观的定义。 */
export function componentDefinition(look: ComponentType): ComponentDefinition {
  return BY_LOOK.get(look)!;
}

/** 这个版本认识的块（D-254）。 */
export function isKnownComponent(c: Component): c is KnownComponent {
  return BY_LOOK.has(c.look as unknown as string);
}

/** 块里引用某一类东西的值（例如 table → 数据表 ID）。不认识的块没有引用。 */
export function componentRefs(c: Component, to: ComponentRef['to']): unknown[] {
  if (!isKnownComponent(c)) return [];
  const refs = componentDefinition(c.look).refs ?? {};
  return Object.entries(refs).flatMap(([path, ref]) => {
    const value = valueAt(c, path);
    return ref?.to === to && value !== undefined ? [value] : [];
  });
}
