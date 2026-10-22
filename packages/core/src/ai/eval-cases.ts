import { createDefaultWorkspace } from '../defaults';
import { applyOps, type Op } from '../ops';
import type { Registry } from '../registry';
import type { Locale, WorkspaceConfig } from '../schema';
import type { Plan, RejectReason } from './types';

// AI 评测集（§7F、§14）：mock AI 与真实模型用同一组用例衡量。
// ID 与 docs/MOCK_AI_PHRASES.md 对应；P* 是只有真实模型才需要理解的改写说法。

export type EvalSetup = 'default' | 'pdf' | 'pdfBelowFiles';

export type EvalExpectation =
  | { kind: 'ops'; check: (after: WorkspaceConfig) => string | null }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason?: RejectReason };

export interface EvalCase {
  id: string;
  input: string;
  locale: Locale;
  setup: EvalSetup;
  expect: EvalExpectation;
  /** mock AI 是否应当通过（改写说法只要求真实模型通过）。 */
  mock: boolean;
}

export function buildSetup(setup: EvalSetup, locale: Locale, registry: Registry): WorkspaceConfig {
  const ops: Op[] = [];
  if (setup !== 'default') ops.push({ op: 'installTool', toolId: 'pdf' });
  if (setup === 'pdfBelowFiles') {
    ops.push({ op: 'moveComponent', pageId: 'home', componentId: 'card-pdf', toIndex: 3 });
  }
  const base = createDefaultWorkspace(locale);
  if (ops.length === 0) return base;
  const result = applyOps(base, ops, { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

const home = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'home')!;
const homeIds = (c: WorkspaceConfig) => home(c).components.map((x) => x.id);
const mergeSteps = (c: WorkspaceConfig) =>
  c.workflows.find((w) => w.id === 'pdf-merge')?.steps ?? [];

/** 每个检查返回 null 表示通过，否则返回失败原因。 */
const all =
  (...checks: ((c: WorkspaceConfig) => string | null)[]) =>
  (c: WorkspaceConfig) =>
    checks.reduce<string | null>((err, check) => err ?? check(c), null);

const pdfFirst = (c: WorkspaceConfig) =>
  homeIds(c)[1] === 'card-pdf'
    ? null
    : `PDF card should be right after the header, got ${homeIds(c).join(',')}`;
const navHomeToolsSettings = (c: WorkspaceConfig) =>
  JSON.stringify(c.shell.nav) === JSON.stringify(['page:home', 'tools', 'settings'])
    ? null
    : `nav should be home/tools/settings, got ${c.shell.nav.join(',')}`;
const titled = (title: string) => (c: WorkspaceConfig) =>
  home(c).title === title ? null : `home title should be ${title}, got ${home(c).title}`;
const color = (hex: string) => (c: WorkspaceConfig) =>
  c.theme.primaryColor.toLowerCase() === hex.toLowerCase()
    ? null
    : `color should be ${hex}, got ${c.theme.primaryColor}`;
const singlePdfTool = (c: WorkspaceConfig) =>
  c.tools.length === 1 && c.workflows.length === 1
    ? null
    : 'must keep exactly one PDF tool and workflow';
const simplifiedMerge = (c: WorkspaceConfig) => {
  const actions = mergeSteps(c).map((s) => s.action);
  return JSON.stringify(actions) === JSON.stringify(['pdf.selectFiles', 'pdf.merge', 'file.save'])
    ? null
    : `steps should be select/merge/save, got ${actions.join(',')}`;
};
const savesAs = (template: string) => (c: WorkspaceConfig) => {
  const save = mergeSteps(c).find((s) => s.action === 'file.save');
  return save?.params.nameTemplate === template
    ? null
    : `nameTemplate should be ${template}, got ${String(save?.params.nameTemplate)}`;
};

export const EVAL_CASES: readonly EvalCase[] = [
  // 旅程 A
  {
    id: 'A1',
    input: '把首页改成文件工作台，把 PDF 放到最上面，导航栏只保留首页、工具、设置。',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: all(titled('文件工作台'), pdfFirst, navHomeToolsSettings) },
  },
  {
    id: 'A2',
    input: 'PDF 放第一个',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A3',
    input: '导航只要首页、工具和设置',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'A4',
    input: '首页改成文件工作台',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: titled('文件工作台') },
  },
  {
    id: 'A5',
    input: 'Put PDF at the top',
    locale: 'en',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A6',
    input: 'Only keep Home, Tools and Settings in the navigation',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  // 单项修改
  {
    id: 'B1',
    input: '主题换成绿色',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'B2',
    input: '切换到深色模式',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.mode === 'dark' ? null : `mode should be dark, got ${c.theme.mode}`),
    },
  },
  {
    id: 'B3',
    input: '隐藏欢迎卡片',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (home(c).components[0]?.hidden ? null : 'welcome header should be hidden'),
    },
  },
  {
    id: 'B4',
    input: '把最近文件放到 PDF 前面',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        homeIds(c).indexOf('recent-files') < homeIds(c).indexOf('card-pdf')
          ? null
          : `recent files should come before PDF, got ${homeIds(c).join(',')}`,
    },
  },
  // 旅程 C
  {
    id: 'C1',
    input: '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: all(simplifiedMerge, savesAs('合并-{date:YYYY-MM-DD}'), singlePdfTool),
    },
  },
  {
    id: 'C2',
    input: '合并后的文件按日期命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: all(savesAs('{date:YYYY-MM-DD}'), singlePdfTool) },
  },
  // 旅程 D
  {
    id: 'D1',
    input: '恢复上一次修改前的界面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D2',
    input: '撤销刚才的修改',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D3',
    input: 'Undo the last change',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  // 必须拒绝
  {
    id: 'X1',
    input: '帮我订一张机票',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'X2',
    input: '把 AI 入口删掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'protected' },
  },
  {
    id: 'X3',
    input: '删除我所有的 PDF 文件',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject', reason: 'deleteFiles' },
  },
  // 改写说法：只要求真实模型理解
  {
    id: 'P1',
    input: '能不能把合并 PDF 的入口挪到最前面？',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: false,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'P2',
    input: '底部只留三个：首页、工具、设置',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'P3',
    input: '我想要一个绿色的界面',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'P4',
    input: 'Make the PDF tool skip asking for a file name and just save it as merged-date',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: { kind: 'ops', check: all(savesAs('merged-{date:YYYY-MM-DD}'), singlePdfTool) },
  },
];

export type EvalOutcome = { pass: true } | { pass: false; reason: string };

/** 判定一个计划是否符合用例预期。afterOrIssues 来自 prepareOps。 */
export function judgeEval(
  c: EvalCase,
  plan: Plan,
  prepared: { ok: true; after: WorkspaceConfig } | { ok: false; issues: string[] } | null,
): EvalOutcome {
  const fail = (reason: string): EvalOutcome => ({ pass: false, reason });
  if (c.expect.kind === 'restorePrevious') {
    return plan.kind === 'restorePrevious'
      ? { pass: true }
      : fail(`expected restorePrevious, got ${plan.kind}`);
  }
  if (c.expect.kind === 'reject') {
    if (plan.kind !== 'reject') return fail(`expected reject, got ${plan.kind}`);
    if (c.expect.reason && plan.reason !== c.expect.reason) {
      return fail(`expected reject reason ${c.expect.reason}, got ${plan.reason}`);
    }
    return { pass: true };
  }
  if (plan.kind !== 'ops')
    return fail(
      `expected ops, got ${plan.kind}${plan.kind === 'reject' ? `: ${plan.message}` : ''}`,
    );
  if (!prepared) return fail('ops were not prepared');
  if (!prepared.ok) return fail(`invalid ops: ${prepared.issues.join('; ')}`);
  const problem = c.expect.check(prepared.after);
  return problem ? fail(problem) : { pass: true };
}
