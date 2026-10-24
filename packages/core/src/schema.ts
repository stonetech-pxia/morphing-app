import { z } from 'zod';

import { MAX_FORMULA_LENGTH } from './formula';
import { isEmoji, unsafeLinks } from './richtext';

// 可变层（交接文档 §5.2）的唯一定义。渲染器只认识这里列出的组件和属性。
// 修改本文件中会影响已存储数据的部分时，必须提升 CURRENT_SCHEMA_VERSION 并在 migrate.ts 中添加迁移。

export const CURRENT_SCHEMA_VERSION = 10;

export type Locale = 'en' | 'zh';
export type Localized = Record<Locale, string>;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const IdSchema = z.string().regex(ID_PATTERN, 'id must be lowercase letters, digits or -');

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be #RRGGBB');

// ---- 图标白名单 ----

/** 组件、页面和导航可用的图标。渲染器把每个名字映射到 iOS / Android 的系统图标。 */
export const ICON_NAMES = [
  'home',
  'apps',
  'sparkles',
  'history',
  'settings',
  'document',
  'folder',
  'star',
  'heart',
  'bolt',
  'calendar',
  'bookmark',
  'inbox',
  'chart',
  'check',
  'info',
  'lightbulb',
  'merge',
  'link',
  'person',
  'plus',
  'search',
  'photo',
  'scan',
  'text',
  'qrcode',
  'archive',
  'printer',
  'signature',
  'workflow',
  'video',
  'audio',
  'translate',
  'note',
] as const;
export const IconSchema = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconSchema>;

/** 图标：白名单里的名字，或者一个 emoji（D-046）。 */
export const IconValueSchema = z.union([
  IconSchema,
  z.string().refine(isEmoji, { message: 'icon must be a listed icon name or a single emoji' }),
]);
export type IconValue = IconName | (string & {});

/** 用户文件的 ID（图片组件引用用户选择的照片）。 */
export const AssetIdSchema = z.string().regex(/^[a-z0-9]{6,40}$/, 'invalid asset id');

/** 富文本（richtext.ts）：链接只能是 https 或 mailto。 */
const richText = (max: number) =>
  text(1, max).refine((s) => unsafeLinks(s).length === 0, {
    message: 'links must be https:// or mailto: addresses',
  });

// ---- 主题：白名单样式 token ----

export const FONT_CHOICES = ['clay', 'system', 'serif', 'mono'] as const;

export const ThemeColorsSchema = z.strictObject({
  background: HexColorSchema.optional(),
  surface: HexColorSchema.optional(),
  text: HexColorSchema.optional(),
  secondary: HexColorSchema.optional(),
  tertiary: HexColorSchema.optional(),
});
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;

export const ThemeSchema = z.strictObject({
  primaryColor: HexColorSchema,
  mode: z.enum(['light', 'dark', 'system']),
  /** 覆盖默认配色；未设置的颜色使用默认风格（Clay）的值。 */
  colors: ThemeColorsSchema,
  /** 深色模式下的颜色覆盖；没设置的颜色依次使用 colors、默认风格的深色值。 */
  darkColors: ThemeColorsSchema.optional(),
  /** 字体组合：clay = 标题 Sora + 正文 Karla。 */
  font: z.enum(FONT_CHOICES),
  fontScale: z.number().min(0.85).max(1.3),
  /** 卡片圆角（pt）；按钮等控件的圆角随之缩放。 */
  radius: z.number().int().min(0).max(28),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  /**
   * brutal = 粗边 + 硬阴影（新粗野），soft = 双向柔和阴影（新拟物），puffy = 内高光 + 柔和阴影（黏土），
   * glass = 半透明毛玻璃，glow = 主色外发光（霓虹），chrome = 金属渐变 + 高光（Y2K）。
   */
  cardStyle: z.enum([
    'shadow',
    'outline',
    'flat',
    'brutal',
    'soft',
    'puffy',
    'glass',
    'glow',
    'chrome',
  ]),
  /** 页面背景：纯色（默认）、主色到辅助色的渐变、三色极光。颜色都从主题配色算出，深色模式自动跟着变。 */
  backdrop: z.enum(['plain', 'gradient', 'aurora']).optional(),
  navStyle: z.enum(['iconLabel', 'label', 'icon']),
});
export type Theme = z.infer<typeof ThemeSchema>;

// ---- 用户数据：数据表结构（在配置里，随版本）。记录本身不在配置里，见 docs/DATA_DESIGN.md ----

const fieldBase = {
  id: IdSchema,
  name: text(1, 40),
  required: z.boolean().optional(),
};

export const ChoiceOptionSchema = z.strictObject({ id: IdSchema, label: text(1, 40) });

export const FieldSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...fieldBase, type: z.literal('text'), default: text(1, 200).optional() }),
  z.strictObject({ ...fieldBase, type: z.literal('note') }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('number'),
    decimals: z.number().int().min(0).max(4).optional(),
    unit: text(1, 10).optional(),
    default: z.number().finite().optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('money'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO code like CNY'),
    default: z.number().finite().optional(),
  }),
  z.strictObject({ ...fieldBase, type: z.literal('checkbox'), default: z.boolean().optional() }),
  z.strictObject({ ...fieldBase, type: z.literal('date'), default: z.literal('today').optional() }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('choice'),
    options: z.array(ChoiceOptionSchema).min(1).max(50),
    default: IdSchema.optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('rating'),
    default: z.number().int().min(1).max(5).optional(),
  }),
  // D-187：附件，值是 Morph 里一个文件的 ID（快捷操作「记一笔」存进来的收据、照片等）。
  z.strictObject({ ...fieldBase, type: z.literal('file') }),
  // D-188：公式，由同一张表的数字、金额、评分字段算出来（只有四则运算），不存进记录、不能填。
  z.strictObject({
    id: IdSchema,
    name: text(1, 40),
    type: z.literal('formula'),
    expression: text(1, MAX_FORMULA_LENGTH),
    decimals: z.number().int().min(0).max(4).optional(),
    unit: text(1, 10).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'currency must be an ISO code like CNY')
      .optional(),
  }),
]);
export type Field = z.infer<typeof FieldSchema>;
export type FieldType = Field['type'];

export const CollectionSchema = z.strictObject({
  id: IdSchema,
  name: text(1, 40),
  icon: IconValueSchema.optional(),
  fields: z.array(FieldSchema).min(1).max(30),
});
export type Collection = z.infer<typeof CollectionSchema>;

/** 每条记录都有的系统字段。 */
export const SYSTEM_FIELDS = ['createdAt', 'updatedAt'] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];
export const FieldRefSchema = z.union([IdSchema, z.enum(SYSTEM_FIELDS)]);

export const PERIODS = [
  'today',
  'thisWeek',
  'thisMonth',
  'thisYear',
  'last7days',
  'last30days',
] as const;
export type Period = (typeof PERIODS)[number];

/** 筛选条件：白名单比较，多个条件之间是“并且”，没有表达式。 */
export const ConditionSchema = z.strictObject({
  field: FieldRefSchema,
  op: z.enum(['is', 'isNot', 'contains', 'gt', 'lt', 'isEmpty', 'isNotEmpty', 'inPeriod']),
  value: z.union([z.string().max(200), z.number().finite(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const SortSchema = z.strictObject({
  field: FieldRefSchema,
  direction: z.enum(['asc', 'desc']),
});

// ---- 导航 ----

export const SYSTEM_TARGETS = ['tools', 'ai', 'history', 'settings'] as const;
export type SystemTarget = (typeof SYSTEM_TARGETS)[number];

/**
 * 受保护元素（§5.1）：必须始终出现在导航栏或浮动入口中。
 * 只有「设置」受保护：设置页由内核固定提供「AI 修改」和「历史」入口，保证随时能修改和撤销。
 */
export const PROTECTED_TARGETS: readonly SystemTarget[] = ['settings'];

export type PageTarget = `page:${string}`;
export type NavTarget = SystemTarget | PageTarget;

const PAGE_TARGET_PATTERN = /^page:[a-z][a-z0-9-]{0,47}$/;
export const NavTargetSchema = z.custom<NavTarget>(
  (v) =>
    typeof v === 'string' &&
    ((SYSTEM_TARGETS as readonly string[]).includes(v) || PAGE_TARGET_PATTERN.test(v)),
  { message: 'nav target must be a system target or page:<id>' },
);

export const pageTarget = (pageId: string): PageTarget => `page:${pageId}`;
export const pageIdOf = (target: NavTarget): string | null =>
  target.startsWith('page:') ? target.slice('page:'.length) : null;

export const ShellSchema = z.strictObject({
  nav: z.array(NavTargetSchema).min(1).max(5),
  floating: z.array(NavTargetSchema).max(3),
});
export type Shell = z.infer<typeof ShellSchema>;

// ---- 组件白名单 ----

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

/** 内核固定行为：只能选择来源，AI 不提供可执行内容。 */
export const FilePickComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('filePick'),
  props: z.strictObject({ source: z.enum(['media', 'files']) }),
});

export const HeaderComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('header'),
  props: z.strictObject({ title: text(1, 60), subtitle: text(1, 120).optional() }),
});

export const TextComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('text'),
  /** 支持粗体、斜体、链接和列表（richtext.ts）。 */
  props: z.strictObject({ text: richText(1500) }),
});

export const ToolCardComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('toolCard'),
  props: z.strictObject({ toolId: IdSchema }),
});

/**
 * 工具宫格（D-181）：一组工具的小图标，每行三个；点一下打开工具，还没添加的先添加再打开。
 * toolIds 按顺序列出工具；不写 toolIds 时显示目录里同一页面上其他工具宫格没列出的全部工具（「更多工具」，没有就不显示）。
 */
export const ToolGridComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('toolGrid'),
  props: z.strictObject({
    title: text(1, 60).optional(),
    toolIds: z.array(IdSchema).min(1).max(30).optional(),
  }),
});

export const CatalogLinkComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('catalogLink'),
  props: z.strictObject({ title: text(1, 60) }),
});

export const FileListComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('fileList'),
  props: z.strictObject({
    title: text(1, 60),
    limit: z.number().int().min(1).max(50),
    /** 只列出这一类文件：PDF，或者某一大类（image/*、video/*、audio/*，D-140）。 */
    mimeType: z.enum(['application/pdf', 'image/*', 'video/*', 'audio/*']).optional(),
  }),
});

export const WorkflowRunnerComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('workflowRunner'),
  props: z.strictObject({ workflowId: IdSchema }),
});

/** 按钮：点击后打开一个页面或系统入口。 */
export const ButtonComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('button'),
  props: z.strictObject({
    label: text(1, 40),
    target: NavTargetSchema,
    variant: z.enum(['filled', 'outline', 'text']),
  }),
});

/** 快捷入口卡片：图标 + 标题，点击后打开一个页面或系统入口。 */
export const ShortcutComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('shortcut'),
  props: z.strictObject({
    title: text(1, 40),
    subtitle: text(1, 80).optional(),
    icon: IconValueSchema,
    target: NavTargetSchema,
  }),
});

/** 提示框：带底色的说明。 */
export const NoticeComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('notice'),
  props: z.strictObject({
    title: text(1, 60).optional(),
    text: richText(600),
    icon: IconValueSchema.optional(),
  }),
});

/**
 * 图片：AI 只能放一个图片位并设置版式；用哪张照片由用户在页面上选择（D-045）。
 * assetId 指向用户文件，AI 看不到图片内容和文件名。
 */
export const ImageComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('image'),
  props: z.strictObject({
    assetId: AssetIdSchema.nullable().optional(),
    aspect: z.enum(['wide', 'landscape', 'square', 'portrait']),
    fit: z.enum(['cover', 'contain']),
    caption: text(1, 120).optional(),
    /** 还没选照片时显示的提示。 */
    placeholder: text(1, 60).optional(),
  }),
});

export const DividerComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('divider'),
  props: z.strictObject({}),
});

export const SpacerComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('spacer'),
  props: z.strictObject({ size: z.enum(['small', 'medium', 'large']) }),
});

/** 记录列表：展示某张数据表的记录；checklist 用一个 checkbox 字段直接打勾。 */
export const RecordListComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('recordList'),
  props: z.strictObject({
    collectionId: IdSchema,
    display: z.enum(['list', 'cards', 'checklist']),
    titleField: FieldRefSchema,
    subtitleFields: z.array(FieldRefSchema).max(2).optional(),
    /** 显示在右侧的字段，例如金额。 */
    trailingField: FieldRefSchema.optional(),
    checkField: IdSchema.optional(),
    filter: z.array(ConditionSchema).max(5).optional(),
    sort: SortSchema.optional(),
    limit: z.number().int().min(1).max(100),
    emptyText: text(1, 80).optional(),
  }),
});

/** 快速添加表单：inline 直接在页面上填，button 打开完整的记录编辑页。 */
export const RecordFormComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('recordForm'),
  props: z.strictObject({
    collectionId: IdSchema,
    fieldIds: z.array(IdSchema).min(1).max(10),
    submitLabel: text(1, 30),
    mode: z.enum(['inline', 'button']),
  }),
});

/** 统计：对一张表（可筛选）计数或求和、平均、最小、最大。 */
export const StatComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('stat'),
  props: z.strictObject({
    collectionId: IdSchema,
    aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    fieldId: IdSchema.optional(),
    filter: z.array(ConditionSchema).max(5).optional(),
    label: text(1, 40),
  }),
});

const LeafComponentSchema = z.discriminatedUnion('type', [
  FilePickComponentSchema,
  HeaderComponentSchema,
  TextComponentSchema,
  ToolCardComponentSchema,
  ToolGridComponentSchema,
  CatalogLinkComponentSchema,
  FileListComponentSchema,
  WorkflowRunnerComponentSchema,
  ButtonComponentSchema,
  ShortcutComponentSchema,
  NoticeComponentSchema,
  ImageComponentSchema,
  DividerComponentSchema,
  SpacerComponentSchema,
  RecordListComponentSchema,
  RecordFormComponentSchema,
  StatComponentSchema,
]);
export type LeafComponent = z.infer<typeof LeafComponentSchema>;

/** 分组最多容纳的子组件数。 */
export const GROUP_MAX_CHILDREN = 12;

/** 分组：把若干组件排成竖排、横排或网格。分组不能再嵌套分组。 */
export const GroupComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('group'),
  props: z.strictObject({
    title: text(1, 60).optional(),
    layout: z.enum(['stack', 'row', 'grid']),
    columns: z.union([z.literal(2), z.literal(3)]).optional(),
  }),
  children: z.array(LeafComponentSchema).max(GROUP_MAX_CHILDREN),
});
export type GroupComponent = z.infer<typeof GroupComponentSchema>;

export const ComponentSchema = z.discriminatedUnion('type', [
  ...LeafComponentSchema.options,
  GroupComponentSchema,
]);
export type Component = z.infer<typeof ComponentSchema>;
export type ComponentType = Component['type'];

// ---- 页面、工具、工作流 ----

export const PageSchema = z.strictObject({
  id: IdSchema,
  title: text(1, 40),
  /** 导航栏里显示的图标。 */
  icon: IconValueSchema.optional(),
  /** 由某个工具创建的页面；卸载该工具时一并移除。 */
  toolId: IdSchema.optional(),
  components: z.array(ComponentSchema).max(30),
});
export type Page = z.infer<typeof PageSchema>;

export const InstalledToolSchema = z.strictObject({
  toolId: IdSchema,
  version: z.string().min(1),
  pageId: IdSchema,
});
export type InstalledTool = z.infer<typeof InstalledToolSchema>;

export const ActionIdSchema = z.string().regex(/^[a-z]+\.[a-zA-Z0-9]+$/, 'invalid action id');

export const WorkflowStepSchema = z.strictObject({
  id: IdSchema,
  action: ActionIdSchema,
  params: z.record(z.string(), z.unknown()),
  /** 这些参数每次运行时问用户（键必须是该动作界面元数据里的参数）。 */
  ask: z.array(z.string().min(1).max(40)).max(10).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** 一个工作流最多的步骤数。 */
export const MAX_WORKFLOW_STEPS = 12;

/** 工作流总数上限：装满全部工具约 40 个单功能工作流，再加用户自己的。 */
export const MAX_WORKFLOWS = 100;

/**
 * 工作流：线性步骤序列，步骤之间传递一个有类型的值（§7C、D-060，非图灵完备）。
 * toolId：安装工具时创建，卸载时一起移除；presetId：从哪个预设复制来的（D-062）。
 */
export const WorkflowSchema = z.strictObject({
  id: IdSchema,
  name: text(1, 40),
  icon: IconValueSchema.optional(),
  toolId: IdSchema.optional(),
  presetId: IdSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const HOME_PAGE_ID = 'home';
/** 新用户的工具箱页面（D-181）。是用户自己的页面，可以改、也可以删；「设置 → 工具」始终列出全部工具。 */
export const TOOLBOX_PAGE_ID = 'toolbox';

export const WorkspaceConfigSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  theme: ThemeSchema,
  shell: ShellSchema,
  pages: z.array(PageSchema).min(1).max(20),
  tools: z.array(InstalledToolSchema),
  workflows: z.array(WorkflowSchema).max(MAX_WORKFLOWS),
  /** 数据表结构。记录内容不在配置里，也从不发给 AI。 */
  collections: z.array(CollectionSchema).max(20),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/** 页面上的所有组件，包括分组里的子组件（深度优先，按显示顺序）。 */
export function allComponents(page: Page): Component[] {
  return page.components.flatMap((c) => (c.type === 'group' ? [c, ...c.children] : [c]));
}

/**
 * 一个工具宫格显示哪些工具（D-181）：写了 toolIds 就按它的顺序；没写就是目录里
 * 同一页面上其他宫格都没列出的工具。目录里没有的工具不显示。
 */
export function toolGridToolIds(
  grid: Extract<Component, { type: 'toolGrid' }>,
  page: Page,
  catalog: readonly string[],
): string[] {
  if (grid.props.toolIds) return grid.props.toolIds.filter((id) => catalog.includes(id));
  const listed = new Set(
    allComponents(page).flatMap((c) => (c.type === 'toolGrid' ? (c.props.toolIds ?? []) : [])),
  );
  return catalog.filter((id) => !listed.has(id));
}

/** 数据组件引用的数据表。 */
export function componentCollection(c: Component): string | null {
  return c.type === 'recordList' || c.type === 'recordForm' || c.type === 'stat'
    ? c.props.collectionId
    : null;
}

/** 按钮和快捷入口指向的目标。 */
export function componentTarget(c: Component): NavTarget | null {
  return c.type === 'button' || c.type === 'shortcut' ? c.props.target : null;
}
