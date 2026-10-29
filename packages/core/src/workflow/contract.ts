import type { z } from 'zod';

import type { Locale, Localized } from '../schema';

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
  'annotate',
  'sign',
  'fillForm',
  'trimMedia',
  'frameMedia',
  'recordEntry',
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
   * secret：密码（D-194、D-199）。不在参数结构里，配置存不进去、AI 看不到；每次运行时都问，
   * 只交给这一次运行（StepContext.secrets），不进运行记录。
   */
  kind:
    | 'number'
    | 'choice'
    | 'toggle'
    | 'text'
    | 'nameTemplate'
    | 'color'
    | 'collection'
    | 'fields'
    | 'secret';
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
  /** secret 要输两遍、一样才行（给 PDF 加密码，D-194）。 */
  confirm?: boolean;
  /** toggle 没写这个参数时显示成打开（动作把「不写」当成打开，例如扫描的展平，D-274）。 */
  defaultOn?: boolean;
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
  packFor?: (params: Record<string, unknown>) => string | undefined;
  requires: readonly Permission[];
  /**
   * 给 AI 的提示（英文，随动作目录发给模型）：用户怎么说时用这个动作、怎么设参数、前后接什么、
   * 要在 notes 里提醒什么。提示词规则 20 只留建工作流的通用规则。改了要跑受影响的评测。
   */
  ai?: string;
  /**
   * 只和这个动作有关、要单独教 AI 的规则（像组件的 ai.rule）：n 是提示词「## Rules」里的编号，
   * 取现在最后一条规则的编号加 1。text 是英文，改了要跑受影响的评测。
   */
  aiRules?: readonly { n: number; text: string }[];
  /**
   * 内置规则（mock AI）认的步骤说法，用在「新建一个快捷操作：选照片，压到 500KB，分享」这类句子里（D-265）。
   * 整个短语匹配；不同动作的说法不能重叠（workflow-phrases.test.ts 检查）。
   */
  phrases?: readonly StepPhraseRule[];
}

/** 一种步骤说法：match 匹配短语，step 给出参数（不写时参数为空）。 */
export interface StepPhraseRule {
  match: RegExp;
  step?: (
    m: RegExpMatchArray,
    locale: Locale,
  ) => {
    params: Record<string, unknown>;
    /** 每次运行时问的参数。 */
    ask?: string[];
    /** 记一笔（D-187）：句子里说的表名；空字符串表示没说。 */
    table?: string;
  };
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
