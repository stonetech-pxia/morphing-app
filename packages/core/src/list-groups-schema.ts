// 分组（v34 的 Grouping，schema-primitives.ts）能用的字段类型。只放常量：块的定义引用它；分组的计算在
// list-groups.ts、source.ts（会用到数据，块的定义不能引用，否则加载会绕圈）。

// GROUP_UNITS、GroupUnit 在 schema-primitives.ts（从 schema.ts 导出）。

/** 列表分段字段能用的类型（检查和提示词用）；系统字段 createdAt / updatedAt 也可以。 */
export const GROUP_BY_TYPES: readonly string[] = ['choice', 'link', 'date', 'datetime', 'schedule'];
