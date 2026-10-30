import type { Registry } from '../registry';
import type { Locale, Workflow, WorkflowStep } from '../schema';
import { shareFit, type SharedFileInfo } from '../share';
import { MAX_PICK } from '../tools/io';
import { MEDIA_LIMITS } from '../limits';
import { initialParams, workflowProblems } from '../workflow/check';
import { isSourceAction, outputTypeOf, type ActionDefinition } from '../workflow/contract';
import type { FileValueType } from '../workflow/engine';
import { builtInWorkflows, sharePresetOrder } from '../workflows/presets';
import type { DeskTool, DeskToolsConfig } from './layout';
import { deskKindOf, type DeskFile, type DeskKind } from './model';

// 房间的工具栏（file-room DESIGN §4、§5，D-359）：没有配置时按桌上文件的种类从动作注册表生成，不写死。
// 用一个工具 = 一个两步的工作流（输入 + 这个工具），桌上的文件当作分享进来的文件交给第一步（D-115），
// 执行照用现有的执行器；快捷操作按钮也一样，把整个快捷操作作用到桌上的文件。

/** 默认工具栏的组：编辑（要用户亲手操作的）、处理（类型不变）、转换（类型变了，或者只出文字）、快捷操作。 */
export type DeskGroupId = 'edit' | 'adjust' | 'convert' | 'quick';

export interface DeskDefaultGroup {
  id: DeskGroupId;
  items: DeskTool[];
}

/** 种类 → 动作的输入类型。办公文档、别的文件是 files。 */
const VALUE_TYPE: Record<DeskKind, FileValueType> = {
  image: 'images',
  pdf: 'pdf',
  sheet: 'files',
  doc: 'files',
  video: 'video',
  audio: 'audio',
  other: 'files',
};

/** 默认工具栏里最多几个快捷操作。 */
const MAX_QUICK = 8;

/**
 * 这个动作能不能当桌上的一个工具：选输入、输出（分享、保存、打印、记一笔）和整理文件（命名、筛选、排序、
 * 加上已有文件）是房间自己的事（「完成」、桌上的名字），不放进工具栏。
 */
function isDeskAction(action: ActionDefinition): boolean {
  if (isSourceAction(action)) return false;
  return !/^(in|out|file)\./.test(action.id);
}

/**
 * 这种文件能用这个动作吗：动作的输入里明确写了这种类型（images、pdf、video、audio）。
 * 办公文档只接受「收文件、但不收图片和 PDF」的动作（文档转 PDF）：收任何文件的（合并、打包）对它们没有意义。
 */
function fitsKind(action: ActionDefinition, kind: DeskKind): boolean {
  const type = VALUE_TYPE[kind];
  if (kind === 'other') return false;
  if (type !== 'files') return action.input.includes(type);
  return (
    action.input.includes('files') &&
    !!action.rejects?.includes('images') &&
    !!action.rejects.includes('pdf')
  );
}

function groupOf(action: ActionDefinition, kind: DeskKind): DeskGroupId {
  if (action.local) return 'edit';
  const type = VALUE_TYPE[kind];
  const out = outputTypeOf(action, initialParams(action), type);
  return out === type ? 'adjust' : 'convert';
}

/**
 * 默认工具栏：注册表里这种文件能用的工具，按「编辑、处理、转换」分组（注册表的顺序），
 * 最后是接得上这种文件的快捷操作（自己的在前，内设的按这类文件最常用的排，D-237）。空的组不出现。
 */
export function defaultDeskTools(
  kind: DeskKind,
  registry: Registry,
  workflows: readonly Workflow[],
  locale: Locale,
): DeskDefaultGroup[] {
  const groups: Record<DeskGroupId, DeskTool[]> = { edit: [], adjust: [], convert: [], quick: [] };
  for (const action of registry.actions.values()) {
    if (!isDeskAction(action) || !fitsKind(action, kind)) continue;
    groups[groupOf(action, kind)].push({ action: action.id });
  }
  const sample = SAMPLE_FILE[kind];
  if (sample) {
    const builtIns = builtInWorkflows(workflows, locale);
    const order = sharePresetOrder([sample]);
    const rank = (wf: Workflow) => {
      const i = order.indexOf(wf.id);
      return i < 0 ? order.length : i;
    };
    const own = workflows.filter((wf) => !wf.toolId);
    const quick = [...own, ...[...builtIns].sort((a, b) => rank(a) - rank(b))].filter(
      (wf) => shareFit(wf, [sample]).ok,
    );
    groups.quick = quick.slice(0, MAX_QUICK).map((wf) => ({ workflowId: wf.id }));
  }
  return (['edit', 'adjust', 'convert', 'quick'] as const)
    .filter((id) => groups[id].length > 0)
    .map((id) => ({ id, items: groups[id] }));
}

/** 判断快捷操作接不接得上这种文件时用的样本（只看类型）。 */
const SAMPLE_FILE: Record<DeskKind, SharedFileInfo | null> = {
  image: { name: 'a.jpg', mimeType: 'image/jpeg', size: 1 },
  pdf: { name: 'a.pdf', mimeType: 'application/pdf', size: 1 },
  sheet: {
    name: 'a.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1,
  },
  doc: {
    name: 'a.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1,
  },
  video: { name: 'a.mp4', mimeType: 'video/mp4', size: 1 },
  audio: { name: 'a.m4a', mimeType: 'audio/mp4', size: 1 },
  other: null,
};

/** 桌上的几份文件当作分享进来的文件时的样子（快捷操作接不接得上按它判断）。 */
export const deskShareInfos = (files: readonly DeskFile[]): SharedFileInfo[] =>
  files.map((f) => ({ name: `${f.name}.${f.ext}`, mimeType: f.mimeType, size: f.size }));

/** 收桌上这几份文件的输入步骤：按种类选，个数正好是这几份。 */
export function deskInputStep(files: readonly DeskFile[]): WorkflowStep {
  const kinds = new Set(files.map(deskKindOf));
  const n = Math.max(1, files.length);
  const only = kinds.size === 1 ? [...kinds][0]! : null;
  if (only === 'image') {
    return {
      id: 'desk-input',
      action: 'in.photos',
      params: { source: 'files', min: 1, max: Math.min(n, MAX_PICK) },
    };
  }
  if (only === 'video' || only === 'audio') {
    return {
      id: 'desk-input',
      action: only === 'video' ? 'in.videos' : 'in.audio',
      params: { source: 'files', min: 1, max: Math.min(n, MEDIA_LIMITS.maxCount) },
    };
  }
  const accept =
    only === 'pdf'
      ? 'pdf'
      : only === 'sheet' || only === 'doc'
        ? 'documents'
        : [...kinds].every((k) => k === 'image' || k === 'pdf')
          ? 'pdfOrImages'
          : 'any';
  return {
    id: 'desk-input',
    action: 'in.files',
    params: { accept, min: 1, max: Math.min(n, MAX_PICK) },
  };
}

/**
 * 用一个工具时跑的工作流：输入 + 这个工具。params 是用户在参数面板里定的（不写时用工具的默认参数）。
 * 接不上这些文件（类型不对、参数不对）时返回 null，工具栏上这一项变灰。
 */
export function deskToolWorkflow(
  actionId: string,
  files: readonly DeskFile[],
  registry: Registry,
  params?: Record<string, unknown>,
): Workflow | null {
  const action = registry.actions.get(actionId);
  if (!action || !isDeskAction(action) || files.length === 0) return null;
  const workflow: Workflow = {
    id: 'desk-tool',
    name: actionId,
    steps: [
      deskInputStep(files),
      { id: 'desk-step', action: actionId, params: params ?? initialParams(action) },
    ],
  };
  // 默认参数可能还不完整（例如文字戳要写字）：先只检查类型接不接得上，参数在面板里填好再检查。
  const problems = workflowProblems(workflow, registry).filter(
    (p) => params !== undefined || p.code !== 'params' || p.stepId !== 'desk-step',
  );
  return problems.length === 0 ? workflow : null;
}

/**
 * 房间里单用一个工具时，先弹出参数面板问哪些参数（D-363）。规则只有一条：
 * 参数写了 `ask: false`（默认值就是对的，例如识别语言「自动」，D-278）的不问；密码不在面板里（执行器跑的时候问）；
 * 剩下的都问。一个都不用问、而且默认参数能用时返回 []：直接跑，不弹面板。
 * 默认参数不能用（例如文字戳要写字）时，就算都写了 ask: false 也问全部，免得跑一个必然失败的工具。
 */
export function deskToolAsks(action: ActionDefinition): string[] {
  const shown = action.fields.filter((f) => f.kind !== 'secret');
  const asked = shown.filter((f) => f.ask !== false).map((f) => f.key);
  if (asked.length > 0) return asked;
  return action.params.safeParse(initialParams(action)).success ? [] : shown.map((f) => f.key);
}

/** 快捷操作能不能作用到桌上这几份文件（看它的第一步，和收件页面一样）。 */
export const deskWorkflowFits = (workflow: Workflow, files: readonly DeskFile[]) =>
  files.length > 0 && shareFit(workflow, deskShareInfos(files)).ok;

/** 配置里写的组 → 和默认的一样的写法（标题是配置里的文字）。 */
export type DeskGroup = { title?: string; id?: DeskGroupId; items: DeskTool[] };

/**
 * 这种文件的工具栏：配置里写了就用配置的（DeskLayout.tools），否则用默认的。
 * 配置里指向已经没有的动作、快捷操作的项不显示。
 */
export function deskToolbar(
  kind: DeskKind,
  configured: DeskToolsConfig,
  registry: Registry,
  workflows: readonly Workflow[],
  locale: Locale,
): DeskGroup[] {
  const custom = configured[kind];
  if (!custom) return defaultDeskTools(kind, registry, workflows, locale);
  const known = new Set([...workflows, ...builtInWorkflows(workflows, locale)].map((w) => w.id));
  return custom
    .map((g) => ({
      ...(g.title ? { title: g.title } : {}),
      items: g.items.filter((item) =>
        'action' in item ? registry.actions.has(item.action) : known.has(item.workflowId),
      ),
    }))
    .filter((g) => g.items.length > 0);
}
