import type { z } from 'zod';

import type { Localized } from '../schema';

// 动作契约（docs/TOOLS_DESIGN.md §2）：每个动作声明「输入类型 → 输出类型」、参数结构和参数的界面元数据。
// 只有登记过的动作才能出现在工作流里；实现由 tool-* 包和 App 运行时提供，这里只描述契约。

/**
 * 步骤之间传递的值的类型（D-060）。files 是 images、pdf、zip、video、audio 的父类型。
 * video 和 audio 一起加（D-140）：音频的动作由以后的音频工具提供。
 */
export const VALUE_TYPES = [
  'images',
  'pdf',
  'files',
  'zip',
  'video',
  'audio',
  'text',
  'records',
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

const FILE_SUBTYPES: readonly ValueType[] = ['images', 'pdf', 'zip', 'video', 'audio', 'files'];

/** 动作接受 accepted 中的类型时，值 actual 能不能接上。 */
export function acceptsType(accepted: readonly ValueType[], actual: ValueType): boolean {
  if (accepted.includes(actual)) return true;
  return accepted.includes('files') && FILE_SUBTYPES.includes(actual);
}

/** 动作能不能接上类型为 actual 的值：接受的类型里有它，而且不在 rejects 里。 */
export const actionAccepts = (action: ActionDefinition, actual: ValueType): boolean =>
  acceptsType(action.input, actual) && !action.rejects?.includes(actual);

/** 需要用户在本地亲手操作的步骤（TOOLS_DESIGN §4）。AI 只决定它出现在哪里，看不到操作内容。 */
export const LOCAL_STEP_KINDS = [
  'crop',
  'reorder',
  'pages',
  'corners',
  'redact',
  'sign',
  'fillForm',
  'trimMedia',
] as const;
export type LocalStepKind = (typeof LOCAL_STEP_KINDS)[number];

export const PERMISSIONS = [
  'files.pick',
  'files.write',
  'photos.save',
  'camera',
  'microphone',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type ParamUnit = 'px' | 'KB' | 'MB' | '%' | '°' | 'mm' | 'pt' | 'in';

/** 一个参数的界面元数据：编辑器据此生成表单，运行时询问也用它。 */
export interface ParamField {
  key: string;
  label: Localized;
  /**
   * collection：选一张数据表（选项来自配置）；fields：选这张表的几个字段（编辑页按前面「读取记录」步骤的表列出）。
   */
  kind:
    'number' | 'choice' | 'toggle' | 'text' | 'nameTemplate' | 'color' | 'collection' | 'fields';
  /** 多行文字（文字转 PDF、二维码内容）。 */
  multiline?: boolean;
  unit?: ParamUnit;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string | number; label: Localized }[];
  /** 只在某些参数取某个值时才显示，例如「按长边」时才显示长边像素。 */
  showIf?: { key: string; equals: readonly (string | number | boolean)[] };
  /** 默认「每次运行时问」。 */
  ask?: boolean;
  /** 用户自己写的文字（水印、文字戳）：发给 AI 前替换成占位符（D-065）。 */
  private?: boolean;
}

/** 常用规格：一键填入一组参数，例如「护照 35×45」「4 MB」。 */
export interface ParamPreset {
  id: string;
  label: Localized;
  values: Record<string, unknown>;
}

export type OutputSpec = ValueType | 'same' | ((params: Record<string, unknown>) => ValueType);

export interface ActionDefinition {
  id: string;
  label: Localized;
  /** 一句话说明，显示在动作选择器里，也发给 AI。 */
  description: Localized;
  /** 接受的输入类型；空数组表示输入动作（只能是第一步）。 */
  input: readonly ValueType[];
  /** 虽然接受 files，但处理不了的子类型（例如合并 PDF 不收视频和音频）。 */
  rejects?: readonly ValueType[];
  output: OutputSpec;
  params: z.ZodType<Record<string, unknown>>;
  fields: readonly ParamField[];
  presets?: readonly ParamPreset[];
  /** 需要用户本地操作的步骤。 */
  local?: LocalStepKind;
  /** 需要的扩展包（D-064）。 */
  pack?: string;
  /** 扩展包取决于参数时（文字识别的语言包）：返回本次要确保安装的扩展包，它会连同依赖一起下载。 */
  packFor?: (params: Record<string, unknown>) => string;
  requires: readonly Permission[];
}

/** 动作在给定参数和输入类型下的输出类型。 */
export function outputTypeOf(
  action: ActionDefinition,
  params: Record<string, unknown>,
  input: ValueType | null,
): ValueType | null {
  if (action.output === 'same') return input;
  if (typeof action.output === 'function') return action.output(params);
  return action.output;
}

export const isSourceAction = (action: ActionDefinition) => action.input.length === 0;
