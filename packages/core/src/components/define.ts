import { z } from 'zod';

import type { DescribeContext } from '../describe';
import type { RecordToolKind, ToolUseAs } from '../record-ops-schema';
import type { Registry } from '../registry';
import type { Page, WorkspaceConfig } from '../schema';
import { BackdropSchema, IdSchema, type Collection, type FieldType } from '../schema-base';

// 块的登记表（v34：容器）：每种外观（look）一份定义（新增外观的步骤见 docs/COMPONENTS.md），
// 结构校验、引用检查、草稿说明、长按编辑、提示词都从这里读，不再各写一份按类型的 switch。
// 每个块都是同样的几个键（NEW_FORMAT §3.1）：look 怎么画、show 这种外观自己的选项、source 读什么（只读）、
// tools 引用哪些工具（会写的都在这里）、opens 点了去哪（导航，不写东西）、children（只有 group）。

/** 每个块都可以有的外观设置。tone 对文字块是文字颜色，对卡片类块是底色。 */
export const ComponentStyleSchema = z.strictObject({
  align: z.enum(['start', 'center']).optional(),
  tone: z.enum(['default', 'primary', 'secondary', 'tertiary', 'muted']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  /** 用一张图片代替底色（D-258，schemaVersion 18）；只有定义里 edit.backdrop 为 true 的卡片类块可以用。 */
  backdrop: BackdropSchema.optional(),
});
export type ComponentStyle = z.infer<typeof ComponentStyleSchema>;

export const blockBase = {
  id: IdSchema,
  hidden: z.boolean().optional(),
  style: ComponentStyleSchema.optional(),
};

/** 入口类卡片的样子（D-230）：row = 设置页那种一行、右边有箭头；tile = 大图标块。 */
export const EntryLookSchema = z.enum(['row', 'tile']);
export type EntryLook = z.infer<typeof EntryLookSchema>;

/**
 * 块的键引用了配置里的什么（通用引用检查和 blockTable 这类辅助函数读它）。键是路径（"source.table"、
 * "show.title"、"source.group.by"）：
 * - table：数据表 ID；同一个块里的 field、filter 都指这张表（"$files" 是系统表，见 files-table.ts）。
 * - field：这张表的字段（也可以是 createdAt / updatedAt），值可以是一个或一组；
 *   types 限定字段类型（系统字段算日期），role 是问题文字里的名字，不写就用键名。
 * - filter：这张表的筛选条件。
 * - target：页面、系统入口、tool:<id>、package:<id> 或 {file}（opens）。
 * - package：installed = 已添加的工具包（一个），catalog = 目录里的工具包（一组）。
 */
export type ComponentRef =
  | { to: 'table' }
  | { to: 'field'; role?: string; types?: readonly FieldType[] }
  | { to: 'filter' }
  | { to: 'target' }
  | { to: 'package'; in: 'installed' | 'catalog' };

/** 求和、平均等要用的字段类型（字段定义里的 numeric）。 */
export { NUMERIC_FIELD_TYPES } from '../fields';

/** 每条记录都有的系统字段，当作日期。 */
export const isSystemField = (id: string) => id === 'createdAt' || id === 'updatedAt';

export interface CheckContext {
  config: WorkspaceConfig;
  registry: Registry;
  page: Page;
  /** 块读的数据表（查找、汇总换成它们显示的那种字段）。只有读表的块有；表不存在时不会调用 check。 */
  collection?: Collection;
  /** 外层的分组（块在分组里时）。 */
  parent?: { id: string; look: 'group' };
}

/** 长按编辑（D-052）里能直接改的一个文字（show 里的键）。 */
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
 * 数据块不能改文字（只调整位置、颜色、隐藏和删除）。
 */
export interface ComponentEdit {
  text: EditableText[];
  style: StyleKey[];
  /** 长按编辑里能选、换、移除的用户文件（文件位的 opens.file，D-257）：file = 照片或「文件」里的任意文件。 */
  asset?: 'file';
  /** 是有底色的卡片，可以用图片代替底色（style.backdrop，D-258）；渲染器要真的画出来。 */
  backdrop?: true;
}

/** 发给 AI 的说明（packages/planner/src/prompt.ts 读它，英文）。改了要跑受影响的评测。 */
export interface ComponentAI {
  /** 提示词外观列表里的一行，look 名后面的部分：键（? 表示可以不写，列出可选值和范围）和用法。 */
  doc: string;
  /** 在提示词里排在哪个外观后面；不写就按登记顺序。 */
  docAfter?: string;
  /** 和这个外观有关的规则；n 是规则编号。 */
  rule?: { n: number; text: string };
}

export const ALL_STYLES: StyleKey[] = ['tone', 'align', 'size'];

/** 块自己的检查发现的问题。只写文字时是数据问题（code data，前面加块 ID）。 */
export type CheckProblem = string | { code: string; message: string };

/**
 * 登记表的归类（v34「数据 · 容器 · 工具」，关系规则 1–6）：块都是容器，只读；
 * reads 是 source 读什么，writes 是块上能不能挂会写的工具（就地的一键记录工具）。
 * tools 列出这种外观能挂的工具：as 是出现方式（"self" = 不写 as，块本身被点时做），do 是一键记录的种类，
 * ref 是能引用的独立工具（quickAction = 快捷操作，pick = 内核的打开相册 / 文件），open = 行上的「打开」。
 */
export interface LookMeta {
  kind: 'container';
  /** 作用在哪层：记录列表、表单作用在记录上，数字、图表作用在表上（汇总），文件读 $files。 */
  layer?: 'value' | 'record' | 'table' | 'file' | 'config';
  reads: 'none' | 'table' | 'files' | 'catalog';
  writes: boolean;
  tools?: {
    as: readonly (ToolUseAs | 'self')[];
    do?: readonly RecordToolKind[];
    ref?: readonly ('quickAction' | 'pick')[];
    open?: true;
    /** 最多几个（一共）。 */
    max: number;
  };
}

type Instance<L extends string, X extends z.ZodRawShape> = z.infer<
  ReturnType<typeof lookSchema<L, X>>
>;

export function lookSchema<L extends string, X extends z.ZodRawShape>(look: L, shape: X) {
  return z.strictObject({ ...blockBase, look: z.literal(look), ...shape });
}

export interface LookSpec<L extends string, X extends z.ZodRawShape> extends LookMeta {
  look: L;
  /** 除了 id / hidden / style / look 以外的键（show、source、tools、opens、children）。 */
  shape: X;
  /**
   * 通用引用检查会查的键（validate.ts），路径写法见 ComponentRef。要看别的键才知道该不该查的引用，写在 check 里。
   */
  refs?: Readonly<Record<string, ComponentRef>>;
  /**
   * 通用检查以外的规则。读表的块在字段引用之后、筛选条件之前检查，其余块在页面、工具引用之后。
   * 问题文字会发给 AI 让它改正，改文字要想清楚。
   */
  check?: (c: Instance<L, X>, ctx: CheckContext) => CheckProblem[];
  /** 修改说明里怎么称呼这个块（例如「标题“记账”」）。 */
  describe: (c: Instance<L, X>, config: WorkspaceConfig, ctx: DescribeContext) => string;
  edit: ComponentEdit;
  ai: ComponentAI;
  /**
   * 一个能用的例子（不含 id 和 look）：components.test.ts 拿它在三种语言下校验、生成说明，
   * App 的 registry-test 拿它渲染。只引用样例配置里有的：数据表 expenses（记账模版的
   * amount、category、date、note），已添加的工具包 pdf，它的快捷操作 pdf-merge。
   */
  example: Omit<Instance<L, X>, 'id' | 'look'>;
}

/**
 * 一份外观定义，加上由它生成的完整结构 schema。
 * 定义文件里要写明这个类型（回调用到了配置的类型，而配置的类型又由块定义生成，不写 TypeScript 推不出来）。
 */
export type LookDefinitionOf<L extends string, X extends z.ZodRawShape> = LookSpec<L, X> & {
  schema: ReturnType<typeof lookSchema<L, X>>;
};

export function defineLook<const L extends string, X extends z.ZodRawShape>(
  spec: LookSpec<L, X>,
): LookDefinitionOf<L, X> {
  return { ...spec, schema: lookSchema(spec.look, spec.shape) };
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
  return config.data.tables.find((c) => c.id === id)?.name ?? id;
}

/** 按路径（"source.group.by"）取块里的值。 */
export function valueAt(block: unknown, path: string): unknown {
  let v: unknown = block;
  for (const key of path.split('.')) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}
