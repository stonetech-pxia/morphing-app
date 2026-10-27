import { expandPresetWorkflows } from './ai/preset-ops';
import { localize } from './localization';
import { t } from './messages';
import type { Op } from './ops';
import {
  HOME_PAGE_ID,
  MAX_REMINDERS,
  MAX_WORKFLOWS,
  allComponents,
  type IconValue,
  type Locale,
  type Localized,
  type WorkspaceConfig,
} from './schema';
import { entryOps } from './templates';
import { newWorkflowId, presetById } from './workflows/presets';
import babyGrowth from './samples/baby-growth.json';
import expenseHelper from './samples/expense-helper.json';
import shopOrders from './samples/shop-orders.json';
import studyHelper from './samples/study-helper.json';
import visaDocs from './samples/visa-docs.json';

// 样板 App（D-260）：新手引导最后一步让用户整套套用一个，看到 Morph 能变成什么样的 App，再在上面改。
// 一个样板是 samples/<id>.json，比页面模版（D-255）多：几张数据表、几个页面、快捷操作、首页入口、提醒。
//
// - ids：占位符 → 基本 ID。占位符写成 $table.<名字>、$page.<名字>、$workflow.<名字>、$reminder.<名字>；
//   配置里已经有同名的就加 -2、-3……（预设快捷操作的 ID 和用户自己添加时一样，见下面）。
//   引用写占位符本身（collectionId、workflowId），或者 page:$page.x、workflow:$workflow.x（按钮、提醒的目标）。
// - tables、pages：addCollection、addPage 的内容；表之间的引用字段（D-250）也写占位符。
//   表要按引用的顺序排：被引用的表在前面。
// - workflows：{id, presetId, params?} 按 D-259 的 addWorkflow {presetId} 展开，和用户自己添加时完全一样；
//   预设里没有的流程写完整的 {id, name, icon?, steps}。
// - main：样板的主页面。entry: nav = 主页面放进导航栏，满了在首页加快捷入口（和模版一样，entryOps）。
// - home：另外放到首页的组件（排在首页最后）。
// - reminders：提醒（D-251）。
// - 给用户看的文字写成 { en, zh, fr }，按界面语言取一种。不改主题：用户选好的样子保持不变。

export const SAMPLE_APPS = [
  'expense-helper',
  'visa-docs',
  'study-helper',
  'shop-orders',
  'baby-growth',
] as const;
export type SampleApp = (typeof SAMPLE_APPS)[number];

interface SampleJson {
  icon: IconValue;
  name: Localized;
  /** 一句话说明它包含什么（引导第 3 步的列表里显示）。 */
  summary: Localized;
  ids: Record<string, string>;
  tables: unknown[];
  workflows: SampleWorkflowJson[];
  pages: unknown[];
  main: string;
  entry: 'nav';
  home?: unknown[];
  reminders?: unknown[];
}

type SampleWorkflowJson =
  | { id: string; presetId: string; params?: Record<string, Record<string, unknown>> }
  | { id: string; name: Localized; icon?: string; steps: unknown[] };

const SAMPLES: Record<SampleApp, SampleJson> = {
  'expense-helper': expenseHelper as SampleJson,
  'visa-docs': visaDocs as SampleJson,
  'study-helper': studyHelper as SampleJson,
  'shop-orders': shopOrders as SampleJson,
  'baby-growth': babyGrowth as SampleJson,
};

/** 配置的上限（schema.ts 的 WorkspaceConfigSchema；页面的组件 PageSchema）。 */
const LIMITS = { tables: 20, pages: 20, workflows: MAX_WORKFLOWS, reminders: MAX_REMINDERS };
const MAX_PAGE_COMPONENTS = 30;

export type SampleProblem = 'tables' | 'pages' | 'workflows' | 'reminders' | 'home';

export type SampleResult =
  | {
      ok: true;
      ops: Op[];
      /** 套用后样板的主页面：应用后回到这里。 */
      mainPageId: string;
    }
  | { ok: false; problem: SampleProblem; message: string };

/** 引导第 3 步的列表里显示的：图标、名字、一句话说明。 */
export function sampleInfo(
  sample: SampleApp,
  locale: Locale,
): { id: SampleApp; icon: IconValue; name: string; summary: string } {
  const json = SAMPLES[sample];
  return {
    id: sample,
    icon: json.icon,
    name: localize(json.name, locale),
    summary: localize(json.summary, locale),
  };
}

const PLACEHOLDER = /^(page:|workflow:)?(\$(?:table|page|workflow|reminder)\.[a-zA-Z0-9]+)$/;

const isLocalized = (v: object) => {
  const keys = Object.keys(v).sort();
  return keys.length === 3 && keys.join() === 'en,fr,zh';
};

/** 换掉占位符、按语言取文字（模版的 fill 加上 page: / workflow: 前缀）。没有换成 ID 的占位符是样板写错了。 */
function fill(value: unknown, locale: Locale, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    const m = PLACEHOLDER.exec(value);
    if (!m) return value;
    const id = ids.get(m[2]!);
    if (id === undefined) throw new Error(`sample placeholder ${m[2]} has no id`);
    return `${m[1] ?? ''}${id}`;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, locale, ids));
  if (typeof value === 'object' && value !== null) {
    if (isLocalized(value)) return localize(value as Localized, locale);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fill(v, locale, ids)] as const),
    );
  }
  return value;
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * 把一个样板换成一组修改操作：按当前配置换成不重复的 ID、引用跟着换、给主页面一个入口。
 * 表、页面、快捷操作、提醒或首页放不下时不套用，返回原因（给用户看的一句话）。
 */
export function sampleOps(
  sample: SampleApp,
  config: WorkspaceConfig,
  locale: Locale,
): SampleResult {
  const json = SAMPLES[sample];
  const name = localize(json.name, locale);
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID);
  const homeCount = (json.home?.length ?? 0) + (config.shell.nav.length < 5 ? 0 : 1);
  const tooMany = (
    [
      ['tables', config.collections.length + json.tables.length > LIMITS.tables],
      ['pages', config.pages.length + json.pages.length > LIMITS.pages],
      ['workflows', config.workflows.length + json.workflows.length > LIMITS.workflows],
      [
        'reminders',
        (config.reminders?.length ?? 0) + (json.reminders?.length ?? 0) > LIMITS.reminders,
      ],
      [
        'home',
        homeCount > 0 && (!home || home.components.length + homeCount > MAX_PAGE_COMPONENTS),
      ],
    ] as const
  ).find(([, over]) => over);
  if (tooMany) {
    const problem = tooMany[0];
    return { ok: false, problem, message: t(locale, SAMPLE_PROBLEM_MESSAGES[problem], { name }) };
  }

  // 先定下所有 ID，再填进内容（按钮、提醒可能引用排在后面的页面和快捷操作）。
  const ids = new Map<string, string>();
  const tables = new Set(config.collections.map((c) => c.id));
  const pages = new Set(config.pages.map((p) => p.id));
  const reminders = new Set((config.reminders ?? []).map((r) => r.id));
  for (const [placeholder, base] of Object.entries(json.ids)) {
    if (placeholder.startsWith('$table.')) ids.set(placeholder, uniqueId(base, tables));
    else if (placeholder.startsWith('$page.')) ids.set(placeholder, uniqueId(base, pages));
    else if (placeholder.startsWith('$reminder.')) ids.set(placeholder, uniqueId(base, reminders));
  }
  // 快捷操作：预设的 ID 和用户自己添加时一样（预设 ID，用过了加 -2，newWorkflowId）；
  // 自己写的也不和内设快捷操作的预设 ID 重名，不然会盖住内设的那个（D-236）。
  const workflows: { id: string }[] = [...config.workflows];
  for (const wf of json.workflows) {
    const base = 'presetId' in wf ? wf.presetId : (json.ids[wf.id] ?? 'workflow');
    const id = newWorkflowId(
      base,
      'presetId' in wf || !presetById(base) ? workflows : [...workflows, { id: base }],
    );
    workflows.push({ id });
    ids.set(wf.id, id);
  }

  const ops: Op[] = [];
  for (const table of json.tables)
    ops.push({
      op: 'addCollection',
      collection: fill(table, locale, ids) as Extract<Op, { op: 'addCollection' }>['collection'],
    });

  // 预设按 D-259 的简写展开（和 AI 写 addWorkflow {presetId} 时同一个函数）。
  const short = json.workflows.map((wf) =>
    'presetId' in wf
      ? {
          op: 'addWorkflow',
          presetId: wf.presetId,
          id: ids.get(wf.id),
          ...(wf.params ? { params: fill(wf.params, locale, ids) } : {}),
        }
      : { op: 'addWorkflow', workflow: { ...(fill(wf, locale, ids) as object) } },
  );
  const expanded = expandPresetWorkflows({ ops: short }, config, locale);
  if (expanded.issues.length > 0)
    throw new Error(`sample ${sample}: ${expanded.issues.join('; ')}`);
  ops.push(...((expanded.value as { ops: Op[] }).ops ?? []));

  for (const page of json.pages)
    ops.push({
      op: 'addPage',
      page: fill(page, locale, ids) as Extract<Op, { op: 'addPage' }>['page'],
    });

  const mainPageId = ids.get(json.main)!;
  const main = ops.find(
    (op): op is Extract<Op, { op: 'addPage' }> => op.op === 'addPage' && op.page.id === mainPageId,
  )!;
  ops.push(...entryOps(config, mainPageId, main.page.title, main.page.icon));

  if (json.home?.length && home) {
    const used = new Set([
      ...allComponents(home).map((c) => c.id),
      ...ops.flatMap((op) =>
        op.op === 'addComponent' && op.pageId === HOME_PAGE_ID ? [op.component.id] : [],
      ),
    ]);
    for (const component of json.home) {
      const filled = fill(component, locale, ids) as Extract<
        Op,
        { op: 'addComponent' }
      >['component'];
      ops.push({
        op: 'addComponent',
        pageId: HOME_PAGE_ID,
        component: { ...filled, id: uniqueId(filled.id, used) } as typeof filled,
      });
    }
  }

  for (const reminder of json.reminders ?? [])
    ops.push({
      op: 'addReminder',
      reminder: fill(reminder, locale, ids) as Extract<Op, { op: 'addReminder' }>['reminder'],
    });

  return { ok: true, ops, mainPageId };
}

const SAMPLE_PROBLEM_MESSAGES = {
  tables: 'sampleTooManyTables',
  pages: 'sampleTooManyPages',
  workflows: 'sampleTooManyWorkflows',
  reminders: 'sampleTooManyReminders',
  home: 'sampleHomeFull',
} as const;
