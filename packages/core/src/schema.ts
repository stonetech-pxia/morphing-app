import { z } from 'zod';

// 可变层（交接文档 §5.2）的唯一定义。渲染器只认识这里列出的组件和属性。
// 修改本文件中会影响已存储数据的部分时，必须提升 CURRENT_SCHEMA_VERSION 并在 migrate.ts 中添加迁移。

export const CURRENT_SCHEMA_VERSION = 2;

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
] as const;
export const IconSchema = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconSchema>;

// ---- 主题：白名单样式 token ----

export const FONT_CHOICES = ['clay', 'system', 'serif', 'mono'] as const;

export const ThemeColorsSchema = z.strictObject({
  background: HexColorSchema.optional(),
  surface: HexColorSchema.optional(),
  text: HexColorSchema.optional(),
  secondary: HexColorSchema.optional(),
});
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;

export const ThemeSchema = z.strictObject({
  primaryColor: HexColorSchema,
  mode: z.enum(['light', 'dark', 'system']),
  /** 覆盖默认配色；未设置的颜色使用默认风格（Clay）的值。 */
  colors: ThemeColorsSchema,
  /** 字体组合：clay = 标题 Sora + 正文 Karla。 */
  font: z.enum(FONT_CHOICES),
  fontScale: z.number().min(0.85).max(1.3),
  /** 卡片圆角（pt）；按钮等控件的圆角随之缩放。 */
  radius: z.number().int().min(0).max(28),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  cardStyle: z.enum(['shadow', 'outline', 'flat']),
  navStyle: z.enum(['iconLabel', 'label', 'icon']),
});
export type Theme = z.infer<typeof ThemeSchema>;

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

export const HeaderComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('header'),
  props: z.strictObject({ title: text(1, 60), subtitle: text(1, 120).optional() }),
});

export const TextComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('text'),
  props: z.strictObject({ text: text(1, 500) }),
});

export const ToolCardComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('toolCard'),
  props: z.strictObject({ toolId: IdSchema }),
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
    mimeType: z.enum(['application/pdf']).optional(),
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
    icon: IconSchema,
    target: NavTargetSchema,
  }),
});

/** 提示框：带底色的说明。 */
export const NoticeComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('notice'),
  props: z.strictObject({
    title: text(1, 60).optional(),
    text: text(1, 300),
    icon: IconSchema.optional(),
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

const LeafComponentSchema = z.discriminatedUnion('type', [
  HeaderComponentSchema,
  TextComponentSchema,
  ToolCardComponentSchema,
  CatalogLinkComponentSchema,
  FileListComponentSchema,
  WorkflowRunnerComponentSchema,
  ButtonComponentSchema,
  ShortcutComponentSchema,
  NoticeComponentSchema,
  DividerComponentSchema,
  SpacerComponentSchema,
]);
export type LeafComponent = z.infer<typeof LeafComponentSchema>;

/** 分组：把若干组件排成竖排、横排或网格。分组不能再嵌套分组。 */
export const GroupComponentSchema = z.strictObject({
  ...componentBase,
  type: z.literal('group'),
  props: z.strictObject({
    title: text(1, 60).optional(),
    layout: z.enum(['stack', 'row', 'grid']),
    columns: z.union([z.literal(2), z.literal(3)]).optional(),
  }),
  children: z.array(LeafComponentSchema).max(12),
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
  icon: IconSchema.optional(),
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

export const ActionIdSchema = z.string().regex(/^[a-z]+\.[a-zA-Z]+$/, 'invalid action id');

export const WorkflowStepSchema = z.strictObject({
  id: IdSchema,
  action: ActionIdSchema,
  params: z.record(z.string(), z.unknown()),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** 工作流：线性步骤序列，步骤之间通过固定的数据槽传递数据（§7C，非图灵完备）。 */
export const WorkflowSchema = z.strictObject({
  id: IdSchema,
  toolId: IdSchema,
  name: text(1, 40),
  steps: z.array(WorkflowStepSchema).min(1).max(10),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const HOME_PAGE_ID = 'home';

export const WorkspaceConfigSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  theme: ThemeSchema,
  shell: ShellSchema,
  pages: z.array(PageSchema).min(1).max(20),
  tools: z.array(InstalledToolSchema),
  workflows: z.array(WorkflowSchema),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/** 页面上的所有组件，包括分组里的子组件（深度优先，按显示顺序）。 */
export function allComponents(page: Page): Component[] {
  return page.components.flatMap((c) => (c.type === 'group' ? [c, ...c.children] : [c]));
}

/** 按钮和快捷入口指向的目标。 */
export function componentTarget(c: Component): NavTarget | null {
  return c.type === 'button' || c.type === 'shortcut' ? c.props.target : null;
}
