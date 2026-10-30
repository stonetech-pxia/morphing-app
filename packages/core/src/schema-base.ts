import { z } from 'zod';

import { isValidDate } from './field-values';
import { FieldSchema } from './fields';
import { isEmoji, unsafeLinks } from './richtext';
import { FieldRefSchema, IdSchema, boundedText } from './schema-primitives';

// 配置结构里组件以外的部分（图标、主题、数据表、筛选、导航）。组件定义（components/）要用到这些，
// 所以单独放一个文件，避免 schema.ts 和组件定义互相引用。对外仍从 schema.ts 导出。

export * from './schema-primitives';

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

/** 图片背景（D-258）的遮罩深浅（不透明度见 theme.ts 的 OVERLAY_OPACITY）。 */
export const OverlayLevelSchema = z.enum(['light', 'medium', 'strong']);

/**
 * 图片背景（D-258）：卡片类组件的 style.backdrop 和页面的 backdrop。AI 只能打开（写 overlay）、关掉、调遮罩深浅；
 * 用哪张图片由用户在长按编辑里选，assetId 和图片组件一样只指向用户文件。没有图片时照常显示底色。
 */
export const BackdropSchema = z.strictObject({
  overlay: OverlayLevelSchema,
  assetId: AssetIdSchema.optional(),
});
export type Backdrop = z.infer<typeof BackdropSchema>;

/** 修改操作里的图片背景：只写要改的；assetId 为 null 时去掉图片（图片背景仍开着）。 */
export const BackdropPatchSchema = z.strictObject({
  overlay: OverlayLevelSchema.optional(),
  assetId: AssetIdSchema.nullable().optional(),
});
export type BackdropPatch = z.infer<typeof BackdropPatchSchema>;

/** 套用一次修改：没开时按「中」打开。 */
export function patchBackdrop(current: Backdrop | undefined, patch: BackdropPatch): Backdrop {
  const next: Backdrop = { ...(current ?? { overlay: 'medium' }) };
  if (patch.overlay) next.overlay = patch.overlay;
  if (patch.assetId === null) delete next.assetId;
  else if (patch.assetId !== undefined) next.assetId = patch.assetId;
  return next;
}

/** 富文本（richtext.ts）：链接只能是 https 或 mailto。 */
export const richText = (max: number) =>
  boundedText(1, max).refine((s) => unsafeLinks(s).length === 0, {
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
  /** 图标底色：solid = 实色底白图标，tint = 浅色底彩色图标；不写时各组件用自己的默认（D-230）。 */
  iconStyle: z.enum(['solid', 'tint']).optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

// ---- 用户数据：数据表结构（在配置里，随版本）。记录本身不在配置里，见 docs/DATA_DESIGN.md ----

export {
  ChoiceOptionSchema,
  FIELDS,
  FieldSchema,
  NUMERIC_FIELD_TYPES,
  fieldDefinition,
  type Field,
  type FieldDefinition,
  type FieldOf,
  type FieldType,
} from './fields';

/** 数据表（v34 data.tables，原 collections）。 */
export const CollectionSchema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  icon: IconValueSchema.optional(),
  fields: z.array(FieldSchema).min(1).max(30),
});
export type Collection = z.infer<typeof CollectionSchema>;
export const TableSchema = CollectionSchema;
export type Table = Collection;

/**
 * 一天、一周从什么时候开始（D-286，schemaVersion 20）：dayStartHour 0–6 点，weekStart 周一或周日，
 * twoWeekStart 是两周一段的锚定日。都不写就是 0 点、周一。
 */
export const CalendarSchema = z.strictObject({
  dayStartHour: z.number().int().min(0).max(6).optional(),
  weekStart: z.enum(['monday', 'sunday']).optional(),
  twoWeekStart: z
    .string()
    .refine(isValidDate, { message: 'twoWeekStart must be a date like 2026-10-12' })
    .optional(),
});
export type CalendarSettings = z.infer<typeof CalendarSchema>;

export const SortSchema = z.strictObject({
  field: FieldRefSchema,
  direction: z.enum(['asc', 'desc']),
});

// ---- 导航 ----

export const SYSTEM_TARGETS = ['tools', 'ai', 'history', 'settings', 'quickActions'] as const;
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

/**
 * 打开哪里（v34 opens，导航，不写东西）：页面或系统入口；tool:<id> 把快捷操作摆出来，用户点「开始」才运行
 * （提醒 D-251、P-043；按钮和快捷入口 D-256，id 是配置里的快捷操作，按钮还可以是内设快捷操作的预设 ID）；
 * package:<id> 是一个工具包的页面（原 toolCard，标题、图标按工具包现取）；{file} 是一个用户文件（原 fileSlot，
 * null = 空位，用户点了自己选，AI 不写，D-257）。
 */
export type ToolTarget = `tool:${string}`;
export type PackageTarget = `package:${string}`;
export type FileTarget = { file: string | null };
export type OpenTarget = NavTarget | ToolTarget | PackageTarget | FileTarget;
const TOOL_TARGET = /^tool:[a-z][a-z0-9-]{0,47}$/;
const PACKAGE_TARGET = /^package:[a-z][a-z0-9-]{0,47}$/;
export const FileTargetSchema = z.strictObject({ file: AssetIdSchema.nullable() });

/** 打开的目标；kinds 限定能写哪几种（提醒不能打开工具包、文件）。 */
export const openTargetSchema = (
  message: string,
  kinds: readonly ('tool' | 'package' | 'file')[] = ['tool', 'package', 'file'],
) =>
  z.custom<OpenTarget>(
    (v) =>
      NavTargetSchema.safeParse(v).success ||
      (kinds.includes('tool') && typeof v === 'string' && TOOL_TARGET.test(v)) ||
      (kinds.includes('package') && typeof v === 'string' && PACKAGE_TARGET.test(v)) ||
      (kinds.includes('file') && FileTargetSchema.safeParse(v).success),
    { message },
  );

/** tool:<id> → id；不是快捷操作时为 null。 */
export const toolTargetId = (target: OpenTarget): string | null =>
  typeof target === 'string' && target.startsWith('tool:') ? target.slice('tool:'.length) : null;
/** package:<id> → id。 */
export const packageTargetId = (target: OpenTarget): string | null =>
  typeof target === 'string' && target.startsWith('package:')
    ? target.slice('package:'.length)
    : null;
export const pageIdOf = (target: OpenTarget): string | null =>
  typeof target === 'string' && target.startsWith('page:') ? target.slice('page:'.length) : null;
export const toolTarget = (id: string): ToolTarget => `tool:${id}`;
export const packageTarget = (id: string): PackageTarget => `package:${id}`;
export const isFileTarget = (target: OpenTarget): target is FileTarget =>
  typeof target === 'object' && target !== null;

/**
 * 导航（v34 也是容器，NEW_FORMAT §3.6）：bar 导航栏（1–5，原 shell.nav）、floating 浮动入口（≤3）、
 * phoneHomeScreen 长按 Morph 图标的菜单里的快捷操作（≤4，D-271，原 workflow.homeScreen）。
 */
export const NavSchema = z.strictObject({
  bar: z.array(NavTargetSchema).min(1).max(5),
  floating: z.array(NavTargetSchema).max(3),
  /** 上限 MAX_HOME_SCREEN 在 validate.ts 里查（给 AI 一句能照着改的话）。 */
  phoneHomeScreen: z.array(IdSchema).max(100).optional(),
});
export type Nav = z.infer<typeof NavSchema>;
