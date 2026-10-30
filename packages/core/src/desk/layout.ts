import { z } from 'zod';

import { ComponentSchema, type Component } from '../components';
import { IdSchema, boundedText } from '../schema-primitives';

// 房间的布局（file-room DESIGN §4、§5，D-358）：创始人 2026-10-30 在会话里确认，默认预览居中、工具栏在底部，
// 但这是一份配置，以后 AI 修改能改（R3 接上提示词和评测）。能改的只有下面这几样：
// 工具栏放在上面还是下面、预览占多大、要不要缩略图条、预览上下放几个说明性的组件、每种文件的工具栏放哪些工具。
// 改不了的（结构里根本没有）：预览本身（不能去掉）、桌上的文件（D-113：AI 不碰文件内容）、
// 表格和文档的编辑工具（跟着选中的东西出现，§11.3）、替用户执行任何东西（工具栏上的按钮都要用户自己点）。

/** 预览上下能放的组件：只放说明和入口，不放会改数据的（记录表单、文件格子）。 */
export const DESK_SLOT_TYPES = [
  'header',
  'text',
  'notice',
  'divider',
  'spacer',
  'button',
  'shortcut',
] as const;

/** 和 ActionIdSchema（schema.ts）一样；schema.ts 引用这里，不能反过来引用它。 */
const DeskActionIdSchema = z.string().regex(/^[a-z]+\.[a-zA-Z0-9]+$/, 'invalid action id');

/** 工具栏上的一项：一个工具（可以带一个常用规格），或者一个快捷操作（点一下作用到桌上的文件）。 */
export const DeskToolSchema = z.union([
  z.strictObject({ action: DeskActionIdSchema, preset: IdSchema.optional() }),
  z.strictObject({ workflowId: IdSchema }),
]);
export type DeskTool = z.infer<typeof DeskToolSchema>;

export const DeskToolGroupSchema = z.strictObject({
  /** 组名（配置里的文字）；不写时不显示组名。 */
  title: boundedText(1, 24).optional(),
  items: z.array(DeskToolSchema).min(1).max(20),
});
export type DeskToolGroup = z.infer<typeof DeskToolGroupSchema>;

const groups = z.array(DeskToolGroupSchema).min(1).max(6).optional();

const slot = z
  .array(ComponentSchema)
  .max(2)
  .refine((list) => list.every((c) => (DESK_SLOT_TYPES as readonly string[]).includes(c.type)), {
    message: `only ${DESK_SLOT_TYPES.join(', ')} can go above or below the preview`,
  })
  .optional();

/**
 * 房间的布局（WorkspaceConfig.desk，schemaVersion 29）。每一项都可以不写，不写就是默认（DEFAULT_DESK_LAYOUT）。
 * tools 按文件种类分开写：没写的种类用注册表生成的默认工具栏（defaultDeskTools）。
 */
export const DeskLayoutSchema = z.strictObject({
  /** 工具栏在预览下面（默认）还是上面。 */
  toolbar: z.enum(['bottom', 'top']).optional(),
  /** 预览占多大：fill 占满剩下的地方（默认），large 约三分之二屏，medium 约一半。 */
  preview: z.enum(['fill', 'large', 'medium']).optional(),
  /** 桌上有几份文件时，预览下面的文件条（默认显示）。 */
  strip: z.boolean().optional(),
  above: slot,
  below: slot,
  tools: z
    .strictObject({
      image: groups,
      pdf: groups,
      sheet: groups,
      doc: groups,
      video: groups,
      audio: groups,
      other: groups,
    })
    .optional(),
});
export type DeskLayout = z.infer<typeof DeskLayoutSchema>;
/** 每种文件配置的工具栏（没写的种类用默认的）。 */
export type DeskToolsConfig = NonNullable<DeskLayout['tools']>;

export interface ResolvedDeskLayout {
  toolbar: 'bottom' | 'top';
  preview: 'fill' | 'large' | 'medium';
  strip: boolean;
  above: Component[];
  below: Component[];
  /** 配置里写了的种类；没写的用默认工具栏。 */
  tools: DeskToolsConfig;
}

export const DEFAULT_DESK_LAYOUT: ResolvedDeskLayout = {
  toolbar: 'bottom',
  preview: 'fill',
  strip: true,
  above: [],
  below: [],
  tools: {},
};

/** 配置里的布局（可能没有）补上默认值。 */
export function resolveDeskLayout(layout: DeskLayout | undefined): ResolvedDeskLayout {
  return {
    toolbar: layout?.toolbar ?? DEFAULT_DESK_LAYOUT.toolbar,
    preview: layout?.preview ?? DEFAULT_DESK_LAYOUT.preview,
    strip: layout?.strip ?? DEFAULT_DESK_LAYOUT.strip,
    above: (layout?.above ?? []).filter((c) => !c.hidden),
    below: (layout?.below ?? []).filter((c) => !c.hidden),
    tools: layout?.tools ?? {},
  };
}
