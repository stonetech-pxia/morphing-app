import { z } from 'zod';

import type { DescribeContext } from '../describe';
import type { WorkspaceConfig } from '../schema';
import type { CheckContext, CheckProblem, ComponentRef } from './define';
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
export type Component = z.infer<typeof ComponentSchema>;
export type ComponentType = Component['type'];
export type LeafComponent = z.infer<typeof LeafComponentSchema>;
export type GroupComponent = Extract<Component, { type: 'group' }>;
export type ComponentOf<T extends ComponentType> = Extract<Component, { type: T }>;

/** 登记表里的一份定义，回调的参数统一成 Component（按类型取出来以后用）。 */
export interface ComponentDefinition {
  type: ComponentType;
  refs?: Readonly<Record<string, ComponentRef | undefined>>;
  check?(c: Component, ctx: CheckContext): CheckProblem[];
  describe(c: Component, config: WorkspaceConfig, ctx: DescribeContext): string;
}

const BY_TYPE = new Map<string, ComponentDefinition>(
  COMPONENTS.map((d) => [d.type, d as unknown as ComponentDefinition]),
);

/** 这种组件的定义。 */
export function componentDefinition(type: ComponentType): ComponentDefinition {
  return BY_TYPE.get(type)!;
}

/** 组件里引用某一类东西的属性值（例如 collection → 数据表 ID）。 */
export function componentRefs(c: Component, to: ComponentRef['to']): unknown[] {
  const refs = componentDefinition(c.type).refs ?? {};
  const props = c.props as Record<string, unknown>;
  return Object.entries(refs).flatMap(([prop, ref]) =>
    ref?.to === to && props[prop] !== undefined ? [props[prop]] : [],
  );
}
