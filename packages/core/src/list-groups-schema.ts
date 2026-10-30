// 记录列表分段（D-347）的写法。只放常量：组件定义引用它；分段的计算在 list-groups.ts（会用到数据，
// 组件定义不能引用，否则加载会绕圈）。

export const GROUP_UNITS = ['day', 'week', 'month'] as const;
export type GroupUnit = (typeof GROUP_UNITS)[number];

/** 分段字段能用的类型（检查和提示词用）；系统字段 createdAt / updatedAt 也可以。 */
export const GROUP_BY_TYPES: readonly string[] = ['choice', 'link', 'date', 'datetime', 'schedule'];
