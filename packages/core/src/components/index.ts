import { z } from 'zod';

import type { DescribeContext } from '../describe';
import type { WorkspaceConfig } from '../schema';
import type {
  CheckContext,
  CheckProblem,
  ComponentAI,
  ComponentEdit,
  ComponentRef,
} from './define';
import { groupComponent } from './group';
import { LEAF_COMPONENTS, LeafComponentSchema } from './leaves';

export * from './define';
export { GROUP_MAX_CHILDREN } from './group';
export { LEAF_COMPONENTS, LeafComponentSchema } from './leaves';

/** 全部组件：可以放进分组的，加上分组本身。 */
export const COMPONENTS = [...LEAF_COMPONENTS, groupComponent] as const;

export const ComponentSchema = z.discriminatedUnion('type', [
  ...LeafComponentSchema.options,
  groupComponent.schema,
]);

/** 不会和任何组件类型名相等的标记（运行时是原来的字符串）。 */
type UnknownComponentType = symbol & { readonly unknownComponent: never };

/**
 * 这个版本的 App 不认识的组件（D-254）：更新的 App 加的组件。读取已存的配置时原样保留（保存时写回原来的
 * JSON），页面上显示「需要更新 App」的占位，只能移动和删除；AI 不能新加、也不能修改它。
 * 运行时 type 是原来的字符串；类型上是一个独有的标记，按类型判断时必须单独处理它（isKnownComponent）。
 */
export interface UnknownComponent {
  id: string;
  type: UnknownComponentType;
  hidden?: boolean;
}

export type LeafComponent = z.infer<typeof LeafComponentSchema>;
/** 分组里也可能有不认识的组件（D-254）。 */
export type GroupComponent = Omit<z.infer<typeof groupComponent.schema>, 'children'> & {
  children: (LeafComponent | UnknownComponent)[];
};
export type KnownComponent = LeafComponent | GroupComponent;
/** AI 的修改操作和模版能新加的组件：只有这个版本认识的，分组里也是（D-254）。 */
export type NewComponent = z.infer<typeof ComponentSchema>;
/** 页面上的组件：认识的，或者更新的 App 加的（D-254）。 */
export type Component = KnownComponent | UnknownComponent;
export type ComponentType = KnownComponent['type'];
export type ComponentOf<T extends ComponentType> = Extract<KnownComponent, { type: T }>;

/** 登记表里的一份定义，回调的参数统一成 Component（按类型取出来以后用）。 */
export interface ComponentDefinition {
  type: ComponentType;
  refs?: Readonly<Record<string, ComponentRef | undefined>>;
  check?(c: KnownComponent, ctx: CheckContext): CheckProblem[];
  describe(c: KnownComponent, config: WorkspaceConfig, ctx: DescribeContext): string;
  edit: ComponentEdit;
  ai: ComponentAI;
}

const BY_TYPE = new Map<string, ComponentDefinition>(
  COMPONENTS.map((d) => [d.type, d as unknown as ComponentDefinition]),
);

/** 这种组件的定义。 */
export function componentDefinition(type: ComponentType): ComponentDefinition {
  return BY_TYPE.get(type)!;
}

/** 这个版本认识的组件（D-254）。 */
export function isKnownComponent(c: Component): c is KnownComponent {
  return BY_TYPE.has(c.type as unknown as string);
}

/** 组件里引用某一类东西的属性值（例如 collection → 数据表 ID）。不认识的组件没有引用。 */
export function componentRefs(c: Component, to: ComponentRef['to']): unknown[] {
  if (!isKnownComponent(c)) return [];
  const refs = componentDefinition(c.type).refs ?? {};
  const props = c.props as Record<string, unknown>;
  return Object.entries(refs).flatMap(([prop, ref]) =>
    ref?.to === to && props[prop] !== undefined ? [props[prop]] : [],
  );
}
