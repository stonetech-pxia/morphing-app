import { z } from 'zod';

// 可变层（交接文档 §5.2）的唯一定义。渲染器只认识这里列出的组件和属性。
// 修改本文件中会影响已存储数据的部分时，必须提升 CURRENT_SCHEMA_VERSION 并在 migrate.ts 中添加迁移。

export const CURRENT_SCHEMA_VERSION = 1;

export type Locale = 'en' | 'zh';
export type Localized = Record<Locale, string>;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const IdSchema = z.string().regex(ID_PATTERN, 'id must be lowercase letters, digits or -');

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be #RRGGBB');

export const ThemeSchema = z.strictObject({
  primaryColor: HexColorSchema,
  mode: z.enum(['light', 'dark', 'system']),
});
export type Theme = z.infer<typeof ThemeSchema>;

// ---- 导航 ----

export const SYSTEM_TARGETS = ['tools', 'ai', 'history', 'settings'] as const;
export type SystemTarget = (typeof SYSTEM_TARGETS)[number];

/** 受保护元素（§5.1）：必须始终出现在导航或浮动入口中。 */
export const PROTECTED_TARGETS: readonly SystemTarget[] = ['ai', 'history'];

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

const componentBase = {
  id: IdSchema,
  hidden: z.boolean().optional(),
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

export const ComponentSchema = z.discriminatedUnion('type', [
  HeaderComponentSchema,
  TextComponentSchema,
  ToolCardComponentSchema,
  CatalogLinkComponentSchema,
  FileListComponentSchema,
  WorkflowRunnerComponentSchema,
]);
export type Component = z.infer<typeof ComponentSchema>;
export type ComponentType = Component['type'];

// ---- 页面、工具、工作流 ----

export const PageSchema = z.strictObject({
  id: IdSchema,
  title: text(1, 40),
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
