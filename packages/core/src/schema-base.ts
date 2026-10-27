import { z } from 'zod';

import { FieldSchema } from './fields';
import { isEmoji, unsafeLinks } from './richtext';
import { IdSchema, boundedText } from './schema-primitives';

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

export const CollectionSchema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
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
export const pageIdOf = (target: NavTarget): string | null =>
  target.startsWith('page:') ? target.slice('page:'.length) : null;

export const ShellSchema = z.strictObject({
  nav: z.array(NavTargetSchema).min(1).max(5),
  floating: z.array(NavTargetSchema).max(3),
});
export type Shell = z.infer<typeof ShellSchema>;
