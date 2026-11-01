import { localize } from './localization';
import { t } from './messages';
import type { Op, OpOf } from './ops-schema';
import {
  HOME_PAGE_ID,
  MAX_PAGE_BLOCKS,
  MAX_RECORD_REMINDERS,
  MAX_REMINDERS,
  MAX_WORKFLOWS,
  allComponents,
  quickActionsOf,
  remindersOf,
  type IconValue,
  type Locale,
  type Localized,
  type QuickAction,
  type Reminder,
  type WorkspaceConfig,
} from './schema';
import { entryOps } from './templates';
import { newWorkflowId, presetById, presetWorkflow } from './workflows/presets';
import babyGrowth from './samples/baby-growth.json';
import expenseHelper from './samples/expense-helper.json';
import shopOrders from './samples/shop-orders.json';
import studyHelper from './samples/study-helper.json';
import visaDocs from './samples/visa-docs.json';

// 样板 App（D-260）：新手引导最后一步让用户整套套用一个，看到 Morph 能变成什么样的 App，再在上面改。
// 一个样板是 samples/<id>.json（v34 写法），比页面模版（D-255）多：几张数据表、几个页面、快捷操作、首页入口、提醒。
//
// - ids：占位符 → 基本 ID。占位符写成 $table.<名字>、$page.<名字>、$tool.<名字>（快捷操作和提醒都在 tools[]，
//   一套 ID）；配置里已经有同名的就加 -2、-3……（预设快捷操作的 ID 和用户自己添加时一样，见下面）。
//   引用写占位符本身（source.table、就地工具的 table、{tool}），或者 page:$page.x、tool:$tool.x（opens）。
// - tables、pages：addData {table}、addContainer {page} 的内容；表之间的引用字段（D-250）也写占位符。
//   表要按引用的顺序排：被引用的表在前面。
// - tools：快捷操作和提醒。{id, preset, params?} 按 D-259 展开成预设的副本，和用户自己添加时完全一样；
//   预设里没有的快捷操作写完整的 {id, kind: "quickAction", name, icon?, steps}；提醒写完整的 {kind: "reminder", …}。
// - main：样板的主页面。entry: nav = 主页面放进导航栏，满了在首页加快捷入口（和模版一样，entryOps）。
// - home：另外放到首页的块（排在首页最后）。
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
  tools: SampleToolJson[];
  pages: unknown[];
  main: string;
  entry: 'nav';
  home?: unknown[];
}

type SampleToolJson =
  | { id: string; preset: string; params?: Record<string, Record<string, unknown>> }
  | { id: string; kind: 'quickAction'; name: Localized; icon?: string; steps: unknown[] }
  | { id: string; kind: 'reminder'; when: object; [key: string]: unknown };

const isPreset = (tool: SampleToolJson): tool is Extract<SampleToolJson, { preset: string }> =>
  'preset' in tool;
const isReminderJson = (tool: SampleToolJson) => 'kind' in tool && tool.kind === 'reminder';

const SAMPLES: Record<SampleApp, SampleJson> = {
  'expense-helper': expenseHelper as SampleJson,
  'visa-docs': visaDocs as SampleJson,
  'study-helper': studyHelper as SampleJson,
  'shop-orders': shopOrders as SampleJson,
  'baby-growth': babyGrowth as SampleJson,
};

/** 配置的上限（schema.ts 的 WorkspaceConfigSchema；页面的块 PageSchema）。 */
const LIMITS = { tables: 20, pages: 20, workflows: MAX_WORKFLOWS, reminders: MAX_REMINDERS };

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

const PLACEHOLDER = /^(page:|tool:)?(\$(?:table|page|tool)\.[a-zA-Z0-9]+)$/;

const isLocalized = (v: object) => {
  const keys = Object.keys(v).sort();
  return keys.length === 3 && keys.join() === 'en,fr,zh';
};

/** 换掉占位符、按语言取文字（模版的 fill 加上 page: / tool: 前缀）。没有换成 ID 的占位符是样板写错了。 */
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
  const pages = config.containers.pages;
  const home = pages.find((p) => p.id === HOME_PAGE_ID);
  const homeCount = (json.home?.length ?? 0) + (config.nav.bar.length < 5 ? 0 : 1);
  const sampleReminders = json.tools.filter(isReminderJson) as unknown as Reminder[];
  const byEntry = (list: readonly Reminder[]) => list.filter((r) => 'each' in r.when).length;
  const reminders = remindersOf(config);
  const tooMany = (
    [
      ['tables', config.data.tables.length + json.tables.length > LIMITS.tables],
      ['pages', pages.length + json.pages.length > LIMITS.pages],
      [
        'workflows',
        quickActionsOf(config).length + json.tools.length - sampleReminders.length >
          LIMITS.workflows,
      ],
      [
        'reminders',
        reminders.length - byEntry(reminders) + sampleReminders.length - byEntry(sampleReminders) >
          LIMITS.reminders || byEntry(reminders) + byEntry(sampleReminders) > MAX_RECORD_REMINDERS,
      ],
      ['home', homeCount > 0 && (!home || home.blocks.length + homeCount > MAX_PAGE_BLOCKS)],
    ] as const
  ).find(([, over]) => over);
  if (tooMany) {
    const problem = tooMany[0];
    return { ok: false, problem, message: t(locale, SAMPLE_PROBLEM_MESSAGES[problem], { name }) };
  }

  // 先定下所有 ID，再填进内容（按钮、提醒可能引用排在后面的页面和快捷操作）。
  const ids = new Map<string, string>();
  const tables = new Set(config.data.tables.map((c) => c.id));
  const pageIds = new Set(pages.map((p) => p.id));
  for (const [placeholder, base] of Object.entries(json.ids)) {
    if (placeholder.startsWith('$table.')) ids.set(placeholder, uniqueId(base, tables));
    else if (placeholder.startsWith('$page.')) ids.set(placeholder, uniqueId(base, pageIds));
  }
  // 工具（快捷操作和提醒共用一套 ID）：快捷操作先定（它们的 ID 被运行记录引用得更多，M1）。
  // 预设的 ID 和用户自己添加时一样（预设 ID，用过了加 -2，newWorkflowId）；自己写的也不和内设快捷操作的
  // 预设 ID 重名，不然会盖住内设的那个（D-236）。
  const taken: { id: string }[] = [...config.tools];
  for (const tool of json.tools) {
    if (isReminderJson(tool)) continue;
    const base = isPreset(tool) ? tool.preset : (json.ids[tool.id] ?? 'workflow');
    const id = newWorkflowId(
      base,
      isPreset(tool) || !presetById(base) ? taken : [...taken, { id: base }],
    );
    taken.push({ id });
    ids.set(tool.id, id);
  }
  const takenIds = new Set(taken.map((x) => x.id));
  for (const tool of json.tools)
    if (isReminderJson(tool)) ids.set(tool.id, uniqueId(json.ids[tool.id] ?? 'reminder', takenIds));

  const ops: Op[] = [];
  for (const table of json.tables)
    ops.push({ op: 'addData', table: fill(table, locale, ids) as OpOf<'addData'>['table'] });

  // 预设按 D-259 展开：和用户自己添加时同一个函数（presetWorkflow），params 按步骤 ID 合进参数。
  for (const tool of json.tools) {
    if (isReminderJson(tool)) continue;
    let quickAction: QuickAction;
    if (isPreset(tool)) {
      const preset = presetById(tool.preset);
      if (!preset) throw new Error(`sample ${sample}: unknown preset ${tool.preset}`);
      quickAction = presetWorkflow(preset, locale, ids.get(tool.id)!);
      for (const [stepId, params] of Object.entries(tool.params ?? {})) {
        const step = quickAction.steps.find((x) => x.id === stepId);
        if (!step) throw new Error(`sample ${sample}: preset ${tool.preset} has no step ${stepId}`);
        step.params = { ...step.params, ...(fill(params, locale, ids) as object) };
      }
    } else quickAction = fill(tool, locale, ids) as QuickAction;
    ops.push({ op: 'addTool', tool: quickAction });
  }

  for (const page of json.pages)
    ops.push({ op: 'addContainer', page: fill(page, locale, ids) as AddPage['page'] });

  const mainPageId = ids.get(json.main)!;
  const main = ops.find(
    (op): op is AddPage => op.op === 'addContainer' && isNewPage(op) && op.page.id === mainPageId,
  )!;
  ops.push(...entryOps(config, mainPageId, main.page.title, main.page.icon));

  if (json.home?.length && home) {
    const used = new Set([
      ...allComponents(home).map((c) => c.id),
      ...ops.flatMap((op) =>
        op.op === 'addContainer' && op.page === HOME_PAGE_ID && op.block ? [op.block.id] : [],
      ),
    ]);
    for (const block of json.home) {
      const filled = fill(block, locale, ids) as NonNullable<OpOf<'addContainer'>['block']>;
      ops.push({
        op: 'addContainer',
        page: HOME_PAGE_ID,
        block: { ...filled, id: uniqueId(filled.id, used) } as typeof filled,
      });
    }
  }

  for (const tool of json.tools)
    if (isReminderJson(tool))
      ops.push({ op: 'addTool', tool: fill(tool, locale, ids) as Reminder });

  return { ok: true, ops, mainPageId };
}

type AddPage = OpOf<'addContainer'> & {
  page: Exclude<NonNullable<OpOf<'addContainer'>['page']>, string>;
};
const isNewPage = (op: OpOf<'addContainer'>): op is AddPage =>
  typeof op.page === 'object' && op.page !== null;

const SAMPLE_PROBLEM_MESSAGES = {
  tables: 'sampleTooManyTables',
  pages: 'sampleTooManyPages',
  workflows: 'sampleTooManyWorkflows',
  reminders: 'sampleTooManyReminders',
  home: 'sampleHomeFull',
} as const;
