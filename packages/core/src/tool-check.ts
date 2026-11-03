import { isSystemField } from './components/define';
import { parseFormula } from './formula';
import { workflowKinds } from './quick-actions';
import {
  isOpenUse,
  isRecordToolUse,
  isToolRefUse,
  type RecordTool,
  type ToolUse,
} from './record-ops-schema';
import { createRegistry, type Registry } from './registry';
import { reminderTable } from './reminders';
import { dateFieldOf } from './sequence';
import {
  RECORD_LOOKS,
  TOOLBOX_PAGE_ID,
  childrenOf,
  componentTarget,
  fieldDefinition,
  isKnownComponent,
  pageIdOf,
  quickActionsOf,
  remindersOf,
  toolTargetId,
  type Collection,
  type Component,
  type Condition,
  type Field,
  type KnownComponent,
  type Locale,
  type Page,
  type QuickAction,
  type Reminder,
  type WorkspaceConfig,
} from './schema';
import { BUILTIN_TOOLS } from './tools';
import { workflowProblems } from './workflow/check';
import { missingPlace, stepRefs } from './workflow/refs';

// 工具检查（AGENT_PLAN §3.1–§3.4、§3.8）：用代码判断 App 里的工具能不能用。校验（validate.ts）只管配置合法，
// 这里管「用户点得到、填得完、看得见」。纯函数，只读配置；只提醒，不拒绝，不改配置（底线 15、19）。
// 工具分三种：文件工具（快捷操作）、记录工具（以表为单位）、文件进记录（含 out.addRecord 的快捷操作）。
// blocker = 这个工具现在用不了；warning = 可能有问题。message 用英文，将来发给模型。
//
// 入口按 App 的实际代码算，不是猜的：
// - 「设置 → 快捷操作」（WorkflowsScreen）列出配置里全部快捷操作，所以快捷操作永远到得了：没摆出来只是 warning。
// - 「设置 → 数据」（app/data.tsx）只能导出和恢复，不能添加，所以不算记录的入口。
// - AI 刚建好表时的「数据表做好了」（TableReadyScreen）只出现一次，不算。
// - 收件页面「存成记录」（ShareScreen，D-392）列出有附件字段的表，算入口，但要先有文件。
// - 工具包的页面在「设置 → 工具」里到得了；页面没有总列表，别的页面只能靠导航、入口、提醒。

export type ToolKind = 'file' | 'record' | 'fileToRecord';

/** 表刚建好、页面还在下一步（next 或计划的后面几步）时，这些问题是预期的，不算没做好。 */
export const FIXED_BY_A_LATER_STEP: ReadonlySet<string> = new Set([
  'add-missing',
  'view-missing',
  'page-unreachable',
  'add-unreachable',
  'view-unreachable',
  'stat-input-missing',
]);
export type ToolIssueSeverity = 'blocker' | 'warning';

export interface ToolIssue {
  severity: ToolIssueSeverity;
  code: string;
  /** quickAction:<id>、table:<id>、page:<id>、reminder:<id>、block:<页面>/<块>、field:<表>.<字段>。 */
  target: string;
  message: string;
}

export interface FileToolChecks {
  /** 第一步是输入动作。 */
  firstStepIsInput: boolean;
  /** 相邻步骤类型接得上。 */
  chain: boolean;
  /** 动作都登记过，每步参数齐。 */
  params: boolean;
  /** 摆在哪里：placed = 页面、手机桌面、工具包或预设库里摸得到；settings = 只在「设置 → 快捷操作」。 */
  entry: 'placed' | 'settings';
  entryVia: string[];
}

export interface RecordToolChecks {
  /** 记在哪：表有名字，有能填的字段。 */
  where: boolean;
  /** 怎么记：有添加入口，而且填得完必填字段。 */
  add: boolean;
  addVia: string[];
  /** 怎么看：有读这张表的块，而且页面进得去。 */
  view: boolean;
  viewVia: string[];
  /** 怎么提醒：没有提醒时是 null。 */
  remind: boolean | null;
}

export interface FileToRecordChecks extends FileToolChecks {
  /** 目标表存在。 */
  target: boolean;
  /** 表里有放这个值的字段（文件 → 附件，文字 → 文字）。 */
  place: boolean;
  /** 目标表这个记录工具本身能用（用户确认保存后看得到）。 */
  recordSide: boolean;
  tables: string[];
}

export type ToolChecks = FileToolChecks | RecordToolChecks | FileToRecordChecks;

export interface CheckedTool {
  kind: ToolKind;
  id: string;
  name: string;
  ok: boolean;
  checks: ToolChecks;
}

export interface ToolCheckResult {
  tools: CheckedTool[];
  issues: ToolIssue[];
}

// ---- 读写关系 ----

/** 能给一张表添加记录的一个地方。 */
interface AddPath {
  via: string;
  reachable: boolean;
  /** 只有 source 表已经有记录时才出现（每一条上的按钮、大圆块）。 */
  needsRowOf?: string;
}

interface TableUse {
  /** 读这张表的块（页面上的），和 App 里到不到得了。 */
  readers: { via: string; reachable: boolean }[];
  /** 别的表用引用、查找、汇总读它；快捷操作读它（打印）。 */
  indirect: { via: string; host?: string }[];
  adds: AddPath[];
  /** 显示、筛选、排序、分组、汇总、公式读到的字段。 */
  read: Set<string>;
  /** 表单问的字段。 */
  asked: Set<string>;
  /** 有完整表单（ask "all"、out.addRecord）：每个字段都问。 */
  askedAll: boolean;
  /** 工具写的字段（预设值、set、toggle、increment、setAll、smartDate）。 */
  written: Set<string>;
  /** 点一条打开内置编辑页的块（在进得去的页面上）。 */
  editor: boolean;
  /** 有提醒看着这张表。 */
  watched: boolean;
  /** 进得去的页面上读这张表的统计和图表，和它们依赖的字段。 */
  stats: StatUse[];
}

/** 统计或图表依赖的一个字段。soft：没有值时只是少一块（分组全在「未设置」、减数是 0），不是空的。 */
interface StatInput {
  table: string;
  field: string;
  soft?: true;
}

interface StatUse {
  via: string;
  target: string;
  inputs: StatInput[];
}

const newUse = (): TableUse => ({
  readers: [],
  indirect: [],
  adds: [],
  read: new Set(),
  asked: new Set(),
  askedAll: false,
  written: new Set(),
  editor: false,
  watched: false,
  stats: [],
});

/** 页面上真正显示的块（藏起来的和它的子块都不算）。 */
function visibleBlocks(page: Page): Component[] {
  const walk = (list: readonly Component[]): Component[] =>
    list.flatMap((c) => (c.hidden ? [] : [c, ...walk(childrenOf(c))]));
  return walk(page.blocks);
}

const usesOf = (c: KnownComponent): ToolUse[] => (c as { tools?: ToolUse[] }).tools ?? [];

const isRecordLook = (c: KnownComponent) => (RECORD_LOOKS as readonly string[]).includes(c.look);

/** 这个块点了能到的页面。 */
function pagesOpenedBy(c: Component): string[] {
  if (!isKnownComponent(c)) return [];
  const out: string[] = [];
  const target = componentTarget(c);
  const page = target === null ? null : pageIdOf(target);
  if (page !== null) out.push(page);
  if (isRecordLook(c)) {
    const opens = (c as { opens?: string }).opens;
    if (opens !== undefined) out.push(opens);
  }
  for (const u of usesOf(c)) if (isOpenUse(u) && u.opens !== 'record') out.push(u.opens);
  return out;
}

/** 从导航、提醒和工具包页面走得到的页面（别的页面上的入口要它自己到得了才算）。 */
function reachablePages(config: WorkspaceConfig): Set<string> {
  const pages = config.containers.pages;
  const seen = new Set<string>();
  const queue: string[] = [];
  const visit = (id: string | null) => {
    if (id === null || seen.has(id) || !pages.some((p) => p.id === id)) return;
    seen.add(id);
    queue.push(id);
  };
  for (const target of [...config.nav.bar, ...config.nav.floating]) visit(pageIdOf(target));
  for (const r of remindersOf(config)) visit(pageIdOf(r.opens));
  // 工具包的页面在「设置 → 工具」里；工具箱是内核的系统入口（和 page-entries.ts 一样不算孤立页面）。
  for (const p of pages) if (p.package || p.id === TOOLBOX_PAGE_ID) visit(p.id);
  while (queue.length > 0) {
    const id = queue.pop();
    const page = pages.find((p) => p.id === id)!;
    for (const c of visibleBlocks(page)) for (const next of pagesOpenedBy(c)) visit(next);
  }
  return seen;
}

/** 这个字段没有值也能存（有默认值，或者新记录自带）。 */
function hasDefault(f: Field): boolean {
  return (
    ('default' in f && f.default !== undefined) || fieldDefinition(f.type).emptyNew !== undefined
  );
}

const isComputed = (f: Field) => fieldDefinition(f.type).inForm === false;

const requiredFields = (table: Collection) =>
  table.fields.filter(
    (f) => 'required' in f && f.required && !isComputed(f) && fieldDefinition(f.type).write,
  );

class Analysis {
  readonly reachable: Set<string>;
  private readonly uses = new Map<string, TableUse>();
  readonly issues: { key: string | null; issue: ToolIssue }[] = [];
  /** 快捷操作摆在哪（块、提醒、手机桌面、文件桌面）。 */
  readonly placed = new Map<string, Set<string>>();
  /** 只摆在进不去的页面上的快捷操作。 */
  readonly placedUnreachable = new Map<string, string>();
  /** 每个页面读写的表（提醒对照用）。 */
  readonly pageTables = new Map<string, Set<string>>();
  /** 有快捷操作库块或导航入口：kind 是 null 时是全部。 */
  readonly libraries: (string | null)[] = [];

  constructor(
    readonly config: WorkspaceConfig,
    readonly registry: Registry,
  ) {
    this.reachable = reachablePages(config);
    for (const table of config.data.tables) this.uses.set(table.id, newUse());
    for (const page of config.containers.pages) this.readPage(page);
    this.readNav();
    for (const wf of quickActionsOf(config)) this.readSteps(wf);
    for (const r of remindersOf(config)) this.readReminder(r);
    for (const table of config.data.tables) this.readFields(table);
  }

  use(table: string): TableUse | undefined {
    return this.uses.get(table);
  }

  table(id: string): Collection | undefined {
    return this.config.data.tables.find((t) => t.id === id);
  }

  report(
    key: string | null,
    severity: ToolIssueSeverity,
    code: string,
    target: string,
    message: string,
  ) {
    this.issues.push({ key, issue: { severity, code, target, message } });
  }

  private place(id: string, via: string) {
    const set = this.placed.get(id) ?? new Set<string>();
    set.add(via);
    this.placed.set(id, set);
  }

  private readNav() {
    const { nav, containers } = this.config;
    if ([...nav.bar, ...nav.floating].includes('quickActions')) this.libraries.push(null);
    for (const id of nav.phoneHomeScreen ?? []) this.place(id, 'phone home screen');
    for (const r of remindersOf(this.config)) {
      const id = toolTargetId(r.opens);
      if (id !== null) this.place(id, `reminder ${r.id}`);
    }
    for (const groups of Object.values(containers.desk?.tools ?? {}))
      for (const group of groups ?? [])
        for (const item of group.items)
          if (typeof item === 'string') this.place(item, 'file desk toolbar');
  }

  private readPage(page: Page) {
    const reachable = this.reachable.has(page.id);
    const tables = new Set<string>();
    this.pageTables.set(page.id, tables);
    for (const c of visibleBlocks(page)) {
      if (!isKnownComponent(c)) continue;
      const where = `${c.look} ${c.id} on page ${page.id}`;
      this.readBlock(c, page, where, reachable, tables);
      const target = componentTarget(c);
      const toolId = target === null ? null : toolTargetId(target);
      if (toolId !== null) this.placeTool(toolId, where, reachable, page.id);
      for (const u of usesOf(c))
        if (isToolRefUse(u)) this.placeTool(u.tool, where, reachable, page.id);
    }
  }

  private placeTool(id: string, where: string, reachable: boolean, page: string) {
    if (reachable) this.place(id, where);
    else this.placedUnreachable.set(id, page);
  }

  private readBlock(
    c: KnownComponent,
    page: Page,
    where: string,
    reachable: boolean,
    tables: Set<string>,
  ) {
    if (c.look === 'library' && reachable) this.libraries.push(c.source.kind ?? null);
    if (isRecordLook(c)) {
      const block = c as Extract<KnownComponent, { look: 'list' }>;
      const { source, show } = block;
      const look: string = c.look;
      const use = this.uses.get(source.table);
      tables.add(source.table);
      if (use) {
        use.readers.push({ via: where, reachable });
        for (const id of [show.title, ...(show.subtitles ?? []), show.trailing, show.color])
          if (id !== undefined) use.read.add(id);
        const format = show.format;
        if (format?.kind === 'elapsed' && format.until) use.read.add(format.until);
        if (format?.kind === 'progress' && typeof format.goal === 'string')
          use.read.add(format.goal);
        this.readFilter(use, source.filter);
        if (source.sort) use.read.add(source.sort.field);
        if (source.group?.by) use.read.add(source.group.by);
        const tapped = block.tools?.some((u) => u.as === 'tap');
        if (reachable && block.opens === undefined && !(look === 'tiles' && tapped))
          use.editor = true;
        if (reachable && block.tools?.some((u) => isOpenUse(u) && u.opens === 'record'))
          use.editor = true;
      }
    } else if (c.look === 'number' || c.look === 'chart') {
      const { source } = c;
      const use = this.uses.get(source.table);
      tables.add(source.table);
      if (use) {
        use.readers.push({ via: where, reachable });
        if (source.field) use.read.add(source.field);
        this.readFilter(use, source.filter);
        if (source.group?.by) use.read.add(source.group.by);
        if (source.days?.date) use.read.add(source.days.date);
        const skip = (source.days as { skip?: { field: string } } | undefined)?.skip;
        if (skip) use.read.add(skip.field);
        if (reachable)
          use.stats.push({
            via: where,
            target: `block:${page.id}/${c.id}`,
            inputs: this.statInputs(c),
          });
      }
      const minus = c.look === 'number' ? c.source.minus : undefined;
      if (minus) {
        const other = this.uses.get(minus.table);
        tables.add(minus.table);
        if (other) {
          other.readers.push({ via: `${where} (minus)`, reachable });
          if (minus.field) other.read.add(minus.field);
          this.readFilter(other, minus.filter);
        }
      }
    }
    const sourceTable = isRecordLook(c) ? (c as { source: { table: string } }).source.table : null;
    for (const u of usesOf(c)) {
      if (u.when && sourceTable) {
        const use = this.uses.get(sourceTable);
        if (use) this.readFilter(use, u.when);
      }
      if (isToolRefUse(u) && reachable) {
        const wf = quickActionsOf(this.config).find((x) => x.id === u.tool);
        if (wf) for (const ref of stepRefs(wf, this.registry)) tables.add(ref.table);
      }
      if (!isRecordToolUse(u)) continue;
      tables.add(u.table);
      this.readTool(u, {
        via: u.as ? `${u.as} tool of ${where}` : where,
        reachable,
        target: `block:${page.id}/${c.id}`,
        ...(sourceTable !== null && u.as !== 'addHere' ? { needsRowOf: sourceTable } : {}),
        herePresets: this.herePresets(c),
      });
    }
  }

  /** 统计或图表要算出东西，哪些字段要有值：算的值、按日子的日子、要有值才成立的筛选、分组。 */
  private statInputs(c: Extract<KnownComponent, { look: 'number' | 'chart' }>): StatInput[] {
    const { table: id, aggregate, field, filter, group, days } = c.source;
    const table = this.table(id);
    if (!table) return [];
    const of = (fieldId: string, soft?: true): StatInput => ({
      table: id,
      field: fieldId,
      ...(soft ? { soft } : {}),
    });
    const inputs: StatInput[] = [];
    if (field && aggregate !== 'count' && aggregate !== 'distinctDays') inputs.push(of(field));
    for (const x of filter ?? [])
      if (x.op !== 'isEmpty' && x.op !== 'isNot') inputs.push(of(x.field));
    if (group?.unit) inputs.push(of(dateFieldOf(table, group.by)));
    else if (group?.by) inputs.push(of(group.by, true));
    if (['streak', 'daysSince', 'avgInterval', 'distinctDays'].includes(aggregate))
      inputs.push(of(dateFieldOf(table, days?.date)));
    const minus = c.look === 'number' ? c.source.minus : undefined;
    if (minus?.field) inputs.push({ table: minus.table, field: minus.field, soft: true });
    return inputs;
  }

  /** 就地添加（"$here"）会带上的字段：这一段的值和列表筛选里的等于条件。 */
  private herePresets(c: KnownComponent): string[] {
    if (!isRecordLook(c)) return [];
    const { source } = c as Extract<KnownComponent, { look: 'list' }>;
    return [
      ...(source.group?.by ? [source.group.by] : []),
      ...(source.filter ?? []).filter((x) => x.op === 'is').map((x) => x.field),
    ];
  }

  private readFilter(use: TableUse, filter: readonly Condition[] | undefined) {
    for (const x of filter ?? []) use.read.add(x.field);
  }

  private readTool(
    tool: RecordTool,
    at: {
      via: string;
      reachable: boolean;
      target: string;
      needsRowOf?: string;
      herePresets?: string[];
    },
  ) {
    const use = this.uses.get(tool.table);
    const table = this.table(tool.table);
    if (!use || !table) return;
    if (tool.do !== 'create') {
      use.written.add(tool.field);
      if (tool.do === 'setAll') this.readFilter(use, tool.filter);
      return;
    }
    use.adds.push({
      via: at.via,
      reachable: at.reachable,
      ...(at.needsRowOf ? { needsRowOf: at.needsRowOf } : {}),
    });
    const presets =
      tool.values === '$here' ? (at.herePresets ?? []) : Object.keys(tool.values ?? {});
    for (const id of presets) use.written.add(id);
    if (tool.smartDate) use.written.add(tool.smartDate.to);
    if (tool.ask === 'all') {
      use.askedAll = true;
      return;
    }
    for (const id of tool.ask ?? []) use.asked.add(id);
    // 必填又没有默认值、表单没问也没预设的字段：这个表单（按钮）永远存不进去。
    const covered = new Set([...presets, ...(tool.ask ?? [])]);
    if (tool.smartDate) covered.add(tool.smartDate.to);
    const missing = requiredFields(table).filter((f) => !covered.has(f.id) && !hasDefault(f));
    for (const f of missing)
      this.report(
        `table:${table.id}`,
        'blocker',
        'add-missing-required',
        at.target,
        `${at.via} adds to ${table.id} but never fills required field ${f.id}, so saving always fails; add ${f.id} to ask, or use ask: "all"`,
      );
  }

  private readSteps(wf: QuickAction) {
    for (const ref of stepRefs(wf, this.registry)) {
      const use = this.uses.get(ref.table);
      if (!use) continue;
      if (ref.field !== undefined) use.read.add(ref.field);
      else if ('receives' in ref) {
        // out.addRecord 打开完整的新记录表单：每个字段都问。
        use.adds.push({ via: `quick action ${wf.id}`, reachable: true });
        use.askedAll = true;
      } else use.indirect.push({ via: `quick action ${wf.id}` });
    }
  }

  private readReminder(r: Reminder) {
    const watched = reminderTable(r);
    const use = watched && this.uses.get(watched.table);
    if (use && watched) {
      use.watched = true;
      use.read.add(watched.field);
    }
    const unless = r.unless;
    const other = unless && this.uses.get(unless.table);
    if (unless && other) {
      this.readFilter(other, unless.filter);
      if (unless.date) other.read.add(unless.date);
      if (unless.link) other.read.add(unless.link);
    }
    if (r.done)
      this.readTool(r.done, {
        via: `"done" of reminder ${r.id}`,
        reachable: true,
        target: `reminder:${r.id}`,
        ...(watched ? { needsRowOf: watched.table } : {}),
      });
  }

  /** 公式、汇总、查找、上一条和引用字段：算在读写关系里。 */
  private readFields(table: Collection) {
    const use = this.uses.get(table.id)!;
    for (const f of table.fields) {
      if (f.type === 'formula') {
        const parsed = parseFormula(f.expression);
        if (parsed.ok) for (const id of parsed.refs) use.read.add(id);
      } else if (f.type === 'rollup') {
        const other = this.uses.get(f.table);
        if (other) {
          other.indirect.push({ via: `summary field ${table.id}.${f.id}`, host: table.id });
          other.read.add(f.via);
          if (f.field) other.read.add(f.field);
          this.readFilter(other, f.filter);
          if (f.days?.date) other.read.add(f.days.date);
          if (f.days?.skip) other.read.add(f.days.skip.field);
        }
      } else if (f.type === 'lookup') {
        use.read.add(f.via);
        const via = table.fields.find((x) => x.id === f.via);
        const other = via?.type === 'link' ? this.uses.get(via.table) : undefined;
        if (other) other.read.add(f.field);
      } else if (f.type === 'previous') {
        use.read.add(f.field);
        if (f.date) use.read.add(f.date);
        if (f.within) use.read.add(f.within);
      } else if (f.type === 'schedule') {
        if (f.lastDone) use.read.add(f.lastDone);
      } else if (f.type === 'link') {
        const other = this.uses.get(f.table);
        if (other && f.table !== table.id)
          other.indirect.push({ via: `link field ${table.id}.${f.id}`, host: table.id });
      }
    }
  }

  /** 一跳之内的相关表（引用、查找、汇总，两个方向）。 */
  relatedTables(id: string): Set<string> {
    const out = new Set([id]);
    for (const t of this.config.data.tables)
      for (const f of t.fields)
        if ((f.type === 'link' || f.type === 'rollup') && (t.id === id || f.table === id)) {
          out.add(t.id);
          out.add(f.table);
        }
    return out;
  }
}

// ---- 记录工具 ----

/**
 * 还有工具或块在用的表。什么都没在用的表可能是刚建好还没接上，也可能是用户不要了、数据留着（底线 5：
 * 「不要记账了」之后记录还在「设置 → 数据」里）。单看配置分不出来，所以只给 warning，绝不逼着把它接回去。
 */
function liveTables(a: Analysis): Set<string> {
  const live = new Set<string>();
  for (const t of a.config.data.tables) {
    const use = a.use(t.id)!;
    if (
      use.adds.length > 0 ||
      use.readers.length > 0 ||
      use.watched ||
      use.indirect.some((x) => x.host === undefined)
    )
      live.add(t.id);
  }
  // 在用的表引用、汇总的表也算在用。
  for (let grew = true; grew;) {
    grew = false;
    for (const t of a.config.data.tables) {
      if (live.has(t.id) || !a.use(t.id)!.indirect.some((x) => x.host && live.has(x.host)))
        continue;
      live.add(t.id);
      grew = true;
    }
  }
  return live;
}

const FUNCTIONLESS = new Set(['header', 'text', 'notice', 'divider', 'spacer', 'image']);

/** 进不去的页面。工具包的页面、工具箱不算（有别的入口）。 */
function checkPages(a: Analysis) {
  for (const page of a.config.containers.pages) {
    if (a.reachable.has(page.id)) continue;
    const useful = page.blocks.some(
      (c) => isKnownComponent(c) && !c.hidden && !FUNCTIONLESS.has(c.look),
    );
    const how = page.of
      ? `a list of ${page.of} with opens: "${page.id}"`
      : 'a nav item, or an entry or button on a page that can be reached';
    a.report(
      null,
      useful ? 'blocker' : 'warning',
      'page-unreachable',
      `page:${page.id}`,
      `page ${page.id} ("${page.title}") can't be opened from anywhere; add ${how}`,
    );
  }
}

function checkTable(a: Analysis, table: Collection, live: Set<string>): RecordToolChecks {
  const key = `table:${table.id}`;
  const use = a.use(table.id)!;
  const fillable = table.fields.filter((f) => !isComputed(f));
  const where = table.name.trim().length > 0 && fillable.length > 0;
  if (!where)
    a.report(
      key,
      'blocker',
      'table-no-fields',
      key,
      `table ${table.id} has no field the user can fill in; add at least one`,
    );
  if (!live.has(table.id)) {
    a.report(
      key,
      'warning',
      'table-unused',
      key,
      `nothing uses table ${table.id}: no form or button adds to it and no block shows it. If the user still wants it, add a page for it; if they gave it up, its entries stay in Settings > Data`,
    );
    return { where, add: false, addVia: [], view: false, viewVia: [], remind: null };
  }

  // 怎么记。每一条上的按钮要先有记录：写自己这张表的（复制一条）开不了头。
  const starters = use.adds.filter((p) => p.needsRowOf !== table.id);
  const reachableAdds = starters.filter((p) => p.reachable);
  const hasFileField = table.fields.some((f) => f.type === 'file');
  const addVia = reachableAdds.map((p) => p.via);
  // 每一条上的「新建这张表」：一条都没有时按钮不出现，第一条永远加不进去（S2 里真实发生过）。
  const selfRow = use.adds.find((p) => p.needsRowOf === table.id);
  if (reachableAdds.length === 0 && selfRow) {
    a.report(
      key,
      'blocker',
      'add-needs-existing-row',
      key,
      `the only button that adds to ${table.id} is ${selfRow.via}, which sits on each entry, so with no entries it never appears; use a form, a button block with {do: "create", table: "${table.id}", ask: "all"}, or as: "addHere"`,
    );
    if (hasFileField) addVia.push('inbox "save as record"');
  } else if (reachableAdds.length === 0 && hasFileField) {
    addVia.push('inbox "save as record"');
    a.report(
      key,
      'warning',
      'add-only-from-inbox',
      key,
      `entries of ${table.id} can only be added by sharing files into Morph; add a form or a button that creates an entry`,
    );
  } else if (reachableAdds.length === 0 && starters.length > 0) {
    a.report(
      key,
      'blocker',
      'add-unreachable',
      key,
      `the only way to add to ${table.id} is ${starters[0]!.via}, and that page can't be opened; give the page an entry`,
    );
  } else if (reachableAdds.length === 0) {
    a.report(
      key,
      'blocker',
      'add-missing',
      key,
      `nothing adds entries to ${table.id}; add a form, a button with {do: "create", table: "${table.id}", ask: "all"}, or a quick action ending in out.addRecord`,
    );
  }

  // 怎么看。
  const shown = use.readers.filter((r) => r.reachable);
  const hosted = use.indirect.filter(
    (x) => x.host === undefined || a.use(x.host)?.readers.some((r) => r.reachable),
  );
  const viewVia = [...shown.map((r) => r.via), ...hosted.map((x) => x.via)];
  if (viewVia.length === 0) {
    if (use.readers.length > 0)
      a.report(
        key,
        'blocker',
        'view-unreachable',
        key,
        `${use.readers[0]!.via} shows ${table.id}, but that page can't be opened; give the page an entry`,
      );
    else
      a.report(
        key,
        'blocker',
        'view-missing',
        key,
        `no block reads ${table.id}, so its entries are never shown; add a list, calendar, board, number or chart with source.table "${table.id}"`,
      );
  }

  const blockers = a.issues.some(
    (x) =>
      x.key === key && x.issue.severity === 'blocker' && x.issue.code !== 'add-missing-required',
  );
  // 表都没人写、没人读时，字段的提醒只是噪音。
  if (!blockers) checkFields(a, table);
  return {
    where,
    add:
      addVia.length > 0 &&
      !a.issues.some(
        (x) =>
          x.key === key &&
          (x.issue.code === 'add-missing-required' || x.issue.code === 'add-needs-existing-row'),
      ),
    addVia,
    view: viewVia.length > 0,
    viewVia,
    remind: null,
  };
}

function checkFields(a: Analysis, table: Collection) {
  const use = a.use(table.id)!;
  for (const f of table.fields) {
    const target = `field:${table.id}.${f.id}`;
    const seen = use.read.has(f.id) || use.asked.has(f.id) || use.written.has(f.id);
    const shownInForm = use.askedAll && !isComputed(f);
    if (!seen && !shownInForm)
      a.report(
        `table:${table.id}`,
        'warning',
        'field-unused',
        target,
        `field ${table.id}.${f.id} is not shown, not asked in any form and not used by a computed field; show it, add it to the form, or remove it`,
      );
  }
  for (const f of table.fields) {
    for (const dep of computedInputs(a, table, f)) {
      if (fieldHasInput(a, dep.table, dep.field)) continue;
      a.report(
        `table:${table.id}`,
        'warning',
        'computed-input-missing',
        `field:${table.id}.${f.id}`,
        `computed field ${table.id}.${f.id} needs ${dep.table}.${dep.field}, but nothing fills that field in, so it stays empty; add it to a form`,
      );
    }
  }
  checkStatInputs(a, table);
}

/**
 * 统计、图表依赖的字段有没有地方填（REPORT3「读书图表按完成日期统计，表单却不问完成日期」）。
 * 哪里都填不到又没有默认值：统计永远是空的，blocker。只能打开一条的编辑页（或收件页面的表单）填：能填，
 * 但用户记的时候不会填到，warning。只影响分组或减数的（soft）：不是空的，warning。
 */
function checkStatInputs(a: Analysis, table: Collection) {
  const key = `table:${table.id}`;
  for (const stat of a.use(table.id)!.stats)
    for (const { table: tableId, field, soft } of stat.inputs) {
      const input = statInputLevel(a, tableId, field);
      if (input === 'entry') continue;
      const name = `${tableId}.${field}`;
      if (input === 'edit')
        a.report(
          key,
          'warning',
          'stat-input-only-in-editor',
          stat.target,
          `${stat.via} needs ${name}, which can only be filled by opening an entry later, so it stays empty until then; add ${field} to the form, preset it or give it a default`,
        );
      else
        a.report(
          key,
          soft ? 'warning' : 'blocker',
          soft ? 'stat-input-unfilled' : 'stat-input-missing',
          stat.target,
          soft
            ? `${stat.via} uses ${name}, but nothing fills it in; add ${field} to the form or a button`
            : `${stat.via} needs ${name}, but nothing fills it in and it has no default, so it always stays empty; add ${field} to the form, preset it in a button, or give it a default`,
        );
    }
}

/** entry = 记的时候就有值（默认值、表单、工具写的）；edit = 只能之后打开编辑；none = 哪里都填不到。 */
function statInputLevel(a: Analysis, tableId: string, fieldId: string): 'entry' | 'edit' | 'none' {
  const table = a.table(tableId);
  const use = a.use(tableId);
  if (!table || !use || isSystemField(fieldId)) return 'entry';
  const f = table.fields.find((x) => x.id === fieldId);
  if (!f || isComputed(f) || hasDefault(f)) return 'entry';
  if (use.askedAll || use.asked.has(fieldId) || use.written.has(fieldId)) return 'entry';
  return use.editor || table.fields.some((x) => x.type === 'file') ? 'edit' : 'none';
}

/** 算出来的字段依赖的、要有人填的字段。 */
function computedInputs(a: Analysis, table: Collection, f: Field) {
  const here = (field: string) => ({ table: table.id, field });
  if (f.type === 'formula') {
    const parsed = parseFormula(f.expression);
    return parsed.ok ? parsed.refs.map(here) : [];
  }
  if (f.type === 'previous') return [here(f.field)];
  if (f.type === 'lookup') {
    const via = table.fields.find((x) => x.id === f.via);
    return [here(f.via), ...(via?.type === 'link' ? [{ table: via.table, field: f.field }] : [])];
  }
  if (f.type === 'rollup')
    return [f.via, ...(f.field ? [f.field] : [])].map((field) => ({ table: f.table, field }));
  return [];
}

function fieldHasInput(a: Analysis, tableId: string, fieldId: string): boolean {
  const table = a.table(tableId);
  const use = a.use(tableId);
  if (!table || !use || isSystemField(fieldId)) return true;
  const f = table.fields.find((x) => x.id === fieldId);
  if (!f || isComputed(f) || hasDefault(f)) return true;
  return use.askedAll || use.editor || use.asked.has(fieldId) || use.written.has(fieldId);
}

// App 跑在 Hermes 上：这个文件不用 Unicode 属性类和后行断言（同 route.ts）。
/** 名字里不算数的空白和标点（ASCII、通用标点、中文标点、全角标点）。 */
const NAME_PUNCTUATION = /[\s!-/:-@[-`{-~¡-¿‐-‧‰-⁞　-〿！-／：-＠［-｀｛-･]/g;

/** 名字或字段高度相近，就是同一个用途的两张表。 */
function similarTables(a: Collection, b: Collection): boolean {
  const norm = (s: string) => s.toLowerCase().replace(NAME_PUNCTUATION, '');
  const [x, y] = [norm(a.name), norm(b.name)];
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))) return true;
  const names = (t: Collection) => new Set(t.fields.map((f) => norm(f.name)));
  const [p, q] = [names(a), names(b)];
  if (Math.min(p.size, q.size) < 2) return false;
  const shared = [...p].filter((n) => q.has(n)).length;
  return shared / new Set([...p, ...q]).size >= 0.6;
}

/** 同用途的两张表，一张只被写、一张只被读：写进去的看不到，看到的是空的。 */
function checkDuplicates(a: Analysis) {
  const tables = a.config.data.tables;
  const written = (t: Collection) => a.use(t.id)!.adds.length > 0;
  const read = (t: Collection) => a.use(t.id)!.readers.length > 0;
  for (const [i, x] of tables.entries())
    for (const y of tables.slice(i + 1)) {
      const [writer, reader] =
        written(x) && !read(x) && read(y) && !written(y)
          ? [x, y]
          : written(y) && !read(y) && read(x) && !written(x)
            ? [y, x]
            : [null, null];
      if (writer && reader && similarTables(x, y))
        a.report(
          null,
          'warning',
          'duplicate-table',
          `table:${writer.id}`,
          `tables ${writer.id} and ${reader.id} look like the same thing: tools write to ${writer.id} but blocks read ${reader.id}; use one table`,
        );
    }
}

// ---- 提醒 ----

/** 这个页面的入口再走一跳能到的页面。 */
function nextPages(a: Analysis, pageId: string): string[] {
  const page = a.config.containers.pages.find((p) => p.id === pageId);
  return page ? visibleBlocks(page).flatMap(pagesOpenedBy) : [];
}

function checkReminder(a: Analysis, r: Reminder): Set<string> {
  const key = `reminder:${r.id}`;
  const watched = reminderTable(r)?.table;
  const related = watched ? a.relatedTables(watched) : null;
  const failed = new Set<string>();
  const toolId = toolTargetId(r.opens);
  const pageId = pageIdOf(r.opens);
  if (related && watched) {
    const hits = (tables: Iterable<string> | undefined) =>
      [...(tables ?? [])].some((t) => related.has(t));
    if (toolId !== null) {
      const wf = quickActionsOf(a.config).find((x) => x.id === toolId);
      if (wf && !hits(stepRefs(wf, a.registry).map((x) => x.table)))
        a.report(
          null,
          'warning',
          'reminder-opens-unrelated',
          key,
          `reminder ${r.id} watches ${watched} but opens quick action ${toolId}, which doesn't use that table`,
        );
    } else if (pageId === null || !hits(a.pageTables.get(pageId))) {
      const oneHop = pageId !== null && nextPages(a, pageId).some((p) => hits(a.pageTables.get(p)));
      if (oneHop)
        a.report(
          null,
          'warning',
          'reminder-opens-indirect',
          key,
          `reminder ${r.id} watches ${watched}, but page ${pageId} only links to a page that shows it; open that page directly`,
        );
      else if (pageId === 'home')
        // 规则 35 让新表的提醒先开首页，页面下一步才有：点得开，不算用不了。
        a.report(
          null,
          'warning',
          'reminder-opens-unrelated',
          key,
          `reminder ${r.id} watches ${watched} but opens the home page, which doesn't show that table yet`,
        );
      else {
        failed.add(watched);
        a.report(
          `table:${watched}`,
          'blocker',
          'reminder-opens-unrelated',
          key,
          `reminder ${r.id} watches ${watched} but opens ${String(r.opens)}, where nothing shows that table; open a page that shows ${watched}`,
        );
      }
    }
  } else if (pageId !== null) {
    // 每天 / 每周的提醒不绑表，看不出该打开哪里：页面什么都不读、不写时才提醒；标题点了表名时对照一下。
    const tables = a.pageTables.get(pageId);
    const page = a.config.containers.pages.find((p) => p.id === pageId);
    const useful = page?.blocks.some(
      (c) => isKnownComponent(c) && !c.hidden && !FUNCTIONLESS.has(c.look),
    );
    if (!useful)
      a.report(
        null,
        'warning',
        'reminder-opens-empty',
        key,
        `reminder ${r.id} opens page ${pageId}, which has nothing to do or read`,
      );
    const named = a.config.data.tables.find(
      (t) => t.name.length >= 2 && r.title.toLowerCase().includes(t.name.toLowerCase()),
    );
    if (named && useful && !tables?.has(named.id))
      a.report(
        null,
        'warning',
        'reminder-opens-unrelated',
        key,
        `reminder ${r.id} is about ${named.id} ("${r.title}") but page ${pageId} doesn't show that table`,
      );
  }
  // 「完成」写的表和「今天不再提醒」看的表要是同一张，否则点了完成明天照样响。
  if (r.done && r.unless && r.done.table !== r.unless.table && watched) {
    failed.add(watched);
    a.report(
      `table:${watched}`,
      'blocker',
      'reminder-done-wrong-table',
      key,
      `the "done" button of reminder ${r.id} writes to ${r.done.table}, but the reminder stops only when ${r.unless.table} has an entry; make them the same table`,
    );
  }
  return failed;
}

// ---- 快捷操作 ----

function checkQuickAction(
  a: Analysis,
  wf: QuickAction,
  tableOk: (id: string) => boolean,
): CheckedTool {
  const key = `quickAction:${wf.id}`;
  const problems = workflowProblems(wf, a.registry);
  for (const p of problems) a.report(key, 'blocker', `step-${p.code}`, key, p.message);
  const firstStepIsInput = !problems.some((p) => p.code === 'source');
  const chain = !problems.some((p) => p.code === 'binding');
  const params = !problems.some(
    (p) => p.code === 'params' || p.code === 'ask' || p.code === 'unknown-action',
  );

  const refs = stepRefs(wf, a.registry);
  const receiving = refs.filter((r) => r.field === undefined && 'receives' in r);
  let target = true;
  let place = true;
  for (const ref of refs) {
    const at = `${wf.id}/${wf.steps[ref.index]!.id}`;
    const table = a.table(ref.table);
    if (!table) {
      if (ref.field !== undefined) continue;
      target = false;
      a.report(
        key,
        'blocker',
        'step-table-missing',
        key,
        `${at}: table ${ref.table} does not exist`,
      );
    } else if (ref.field !== undefined) {
      if (!isSystemField(ref.field) && !table.fields.some((f) => f.id === ref.field))
        a.report(
          key,
          'blocker',
          'step-field-missing',
          key,
          `${at}: ${ref.field} is not a field of ${table.id}`,
        );
    } else if ('receives' in ref) {
      const missing = missingPlace(table, ref.receives);
      if (missing) {
        place = false;
        a.report(key, 'blocker', 'record-no-place', key, `${at}: ${table.id} needs ${missing}`);
      }
    }
  }

  const via = [...(a.placed.get(wf.id) ?? [])];
  if (wf.package) via.push(`tool package ${wf.package}`);
  if (wf.preset) via.push('quick action library');
  const kinds = workflowKinds(wf) as readonly string[];
  if (a.libraries.some((k) => k === null || kinds.includes(k))) via.push('library block');
  const entry = via.length > 0 ? 'placed' : 'settings';
  if (entry === 'settings') {
    const page = a.placedUnreachable.get(wf.id);
    a.report(
      key,
      'warning',
      'no-entry',
      key,
      page
        ? `quick action ${wf.id} is only on page ${page}, which can't be opened; it is left in Settings > Quick actions`
        : `quick action ${wf.id} is only in Settings > Quick actions; add a button or an action block on a page`,
    );
  }
  const base = { firstStepIsInput, chain, params, entry, entryVia: via } as const;
  const isOk = () => !a.issues.some((x) => x.key === key && x.issue.severity === 'blocker');
  if (receiving.length === 0)
    return {
      kind: 'file',
      id: wf.id,
      name: wf.name,
      ok: isOk(),
      checks: { ...base, entryVia: via },
    };
  const tables = receiving.map((r) => r.table);
  const recordSide = tables.every((t) => a.table(t) === undefined || tableOk(t));
  return {
    kind: 'fileToRecord',
    id: wf.id,
    name: wf.name,
    ok: isOk() && recordSide,
    checks: { ...base, entryVia: via, target, place, recordSide, tables },
  };
}

/**
 * 工具检查：列出配置里的工具（快捷操作、含 out.addRecord 的快捷操作、每张表）和它们的问题。
 * 配置应该已经通过 validateWorkspace；这里不重复校验，只判断能不能用。
 */
export function checkTools(config: WorkspaceConfig, registry: Registry): ToolCheckResult {
  const a = new Analysis(config, registry);
  checkPages(a);
  const live = liveTables(a);
  const records = new Map(config.data.tables.map((t) => [t.id, checkTable(a, t, live)]));
  checkDuplicates(a);
  for (const r of remindersOf(config)) {
    const failed = checkReminder(a, r);
    const watched = reminderTable(r)?.table;
    const checks = watched ? records.get(watched) : undefined;
    if (checks) checks.remind = (checks.remind ?? true) && !failed.has(watched!);
  }
  const blocked = (key: string) =>
    a.issues.some((x) => x.key === key && x.issue.severity === 'blocker');
  const tableOk = (id: string) => !blocked(`table:${id}`);
  const quick = quickActionsOf(config).map((wf) => checkQuickAction(a, wf, tableOk));
  const tables: CheckedTool[] = config.data.tables.map((t) => ({
    kind: 'record',
    id: t.id,
    name: t.name,
    ok: tableOk(t.id) && live.has(t.id),
    checks: records.get(t.id)!,
  }));
  return { tools: [...quick, ...tables], issues: a.issues.map((x) => x.issue) };
}

// ---- 用户句子里说的数和词，有没有落到这次改动上 ----

// 只查高把握的：大小、像素、倍速、页数、目标语言、证件照底色、分辨率。这次改动没碰快捷操作的步骤时不查（不是这句话管的）；
// 有两个以上同类的数时（「500MB 的视频压到 20MB」）只要一个对得上就算对；前面有否定词的不算。宁可漏也不误报。

const CHECK_REGISTRY = createRegistry(BUILTIN_TOOLS);

interface ScopeStep {
  wf: QuickAction;
  step: QuickAction['steps'][number];
  fields: readonly {
    key: string;
    unit?: string;
    showIf?: { key: string; equals: readonly (string | number | boolean)[] };
  }[];
}

/** 这次改动碰到的快捷操作（新加的，或者步骤变了的）。 */
function touchedActions(before: WorkspaceConfig, after: WorkspaceConfig) {
  const old = new Map(quickActionsOf(before).map((w) => [w.id, JSON.stringify(w.steps)]));
  const touched = quickActionsOf(after).filter((w) => old.get(w.id) !== JSON.stringify(w.steps));
  return { touched, added: touched.filter((w) => !old.has(w.id)) };
}

function scopeSteps(actions: readonly QuickAction[]): ScopeStep[] {
  return actions.flatMap((wf) =>
    wf.steps.map((step) => ({
      wf,
      step,
      fields: CHECK_REGISTRY.actions.get(step.action)?.fields ?? [],
    })),
  );
}

/** 参数现在起不起作用（「按大小」时质量不算，showIf）。 */
function fieldActive(params: Record<string, unknown>, f: ScopeStep['fields'][number]): boolean {
  if (!f.showIf || params[f.showIf.key] === undefined) return true;
  return f.showIf.equals.includes(params[f.showIf.key] as string | number | boolean);
}

const NEGATED =
  /(?:不要|不是|别|不用|并非|not|no longer|n'est pas|pas|sans|instead of)\s*(?:再|压到|to|de)?\s*$/i;
const isNegated = (input: string, index: number) =>
  NEGATED.test(input.slice(Math.max(0, index - 12), index));

const ZH_DIGITS: Record<string, string> = {
  一: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
};

/** 单位前面的中文数字换成阿拉伯数字（「两兆」「两倍速」）。 */
function normalizeNumbers(input: string): string {
  return input
    .replace(/一点五(?=\s*倍)/g, '1.5')
    .replace(/零点五(?=\s*倍)/g, '0.5')
    .replace(/([一二两三四五六七八九])(?=\s*(?:mb|kb|兆|倍速|页))/gi, (d) => ZH_DIGITS[d] ?? d);
}

const num = (s: string) => Number(s.replace(',', '.'));

/** 这个数紧跟在别的数字（或小数点、逗号）后面：是更长的数的尾巴，不算（代替后行断言）。 */
const afterNumber = (input: string, index: number, chars: string) =>
  index > 0 && chars.includes(input[index - 1]!);

/** 句子里说的大小，换算成 KB（1 MB = 1024 KB）。 */
function sizeMentions(input: string, locale: Locale): number[] {
  const out: number[] = [];
  const re =
    /(\d+(?:[.,]\d+)?)\s*(kib|mib|gib|kb|mb|gb|ko|mo|go|千字节|兆字节|兆|M(?![A-Za-z])|K(?![A-Za-z]))/gi;
  for (const m of input.matchAll(re)) {
    const unit = m[2]!;
    const low = unit.toLowerCase();
    const n = num(m[1]!);
    if (afterNumber(input, m.index, '0123456789.,') || isNegated(input, m.index)) continue;
    // 「2 mo」英语里是两个月，「5 go」是动词：小写时只认法语。
    if ((low === 'mo' || low === 'go' || low === 'ko') && unit === low && locale !== 'fr') continue;
    // 只有一个字母时要大写而且紧贴数字（2M、500K）；4K、8K 是分辨率。
    if (
      (low === 'm' || low === 'k') &&
      (unit !== unit.toUpperCase() || !m[0].endsWith(m[1]! + unit))
    )
      continue;
    if (low === 'k' && n < 10) continue;
    if (low === 'kb' || low === 'kib' || low === 'ko' || low === 'k' || unit === '千字节')
      out.push(n);
    else if (low === 'gb' || low === 'gib' || low === 'go') out.push(n * 1024 * 1024);
    else out.push(n * 1024);
  }
  return out;
}

const SIZE_LIMIT =
  /不超过|不大于|不要超过|别超过|以内|以下|之内|小于|低于|最多|最大|under|below|less than|at most|no more than|not more than|smaller than|up to|moins de|inférieur|en dessous|maximum|\bmax\b|pas plus de/i;

function checkSizes(
  input: string,
  locale: Locale,
  steps: readonly ScopeStep[],
  added: readonly QuickAction[],
): ToolIssue[] {
  const mentions = sizeMentions(input, locale);
  if (mentions.length === 0) return [];
  const values: number[] = [];
  for (const { step, fields } of steps)
    for (const f of fields) {
      const v = step.params[f.key];
      if (
        (f.unit !== 'KB' && f.unit !== 'MB') ||
        typeof v !== 'number' ||
        !fieldActive(step.params, f)
      )
        continue;
      values.push(f.unit === 'KB' ? v : v * 1024);
    }
  const said = mentions.map((kb) => (kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`)).join(', ');
  const target = `quickAction:${steps[0]!.wf.id}`;
  if (values.length === 0) {
    // 整条链上没有能放大小的参数：只有新建的快捷操作、句子明确要压到多大时才算丢了。
    if (
      added.length === 0 ||
      !(SIZE_LIMIT.test(input) || /压|compress|shrink|réduire/i.test(input))
    )
      return [];
    return [
      {
        severity: 'blocker',
        code: 'param-size',
        target: `quickAction:${added[0]!.id}`,
        message: `the user asked for ${said}, but no step of quick action ${added[0]!.id} has a size limit; use a compress step with that limit`,
      },
    ];
  }
  // 1 MB 按 1024 KB 或 1000 KB 算都认（差 2.4%）。「不超过 1 MB」写 900 KB 也对。
  const limit = SIZE_LIMIT.test(input);
  const matches = (kb: number) =>
    values.some((v) => Math.abs(v - kb) / Math.max(v, kb) <= 0.025 || (limit && v <= kb));
  if (mentions.some(matches)) return [];
  return [
    {
      severity: 'blocker',
      code: 'param-size',
      target,
      message: `the user asked for ${said}, but the quick action's size limit is ${values
        .map((v) => (v >= 1024 ? `${v / 1024} MB` : `${v} KB`))
        .join(', ')}; write the value they said into maxKB or maxMB (not just clear ask)`,
    },
  ];
}

const PIXEL_KEYS = /^(px|width|height|maxSide|sizePx)$/;

function checkPixels(input: string, steps: readonly ScopeStep[]): ToolIssue[] {
  const mentions = new Set<number>();
  for (const m of input.matchAll(/(\d{2,5})\s*(?:px|pixels?|像素)/gi))
    if (!afterNumber(input, m.index, '0123456789.') && !isNegated(input, m.index))
      mentions.add(Number(m[1]));
  for (const m of input.matchAll(
    /(\d{2,5})\s*[x×*]\s*(\d{2,5})(?!\d|\s*(?:cm|mm|in\b|英寸|寸|厘米|毫米))/gi,
  )) {
    if (afterNumber(input, m.index, '0123456789.')) continue;
    mentions.add(Number(m[1]));
    mentions.add(Number(m[2]));
  }
  if (mentions.size === 0) return [];
  // 证件照、打印排版、裁剪的尺寸由规格定（600×600 是 us-passport），对不上不一定错。
  if (steps.some((s) => /^image\.(idPhoto|printSheet|crop)$/.test(s.step.action))) return [];
  const values: number[] = [];
  for (const { step, fields } of steps)
    for (const f of fields) {
      const v = step.params[f.key];
      if (!PIXEL_KEYS.test(f.key) || !fieldActive(step.params, f)) continue;
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && !Number.isNaN(n)) values.push(n);
    }
  const percent = steps.some(
    (s) => s.step.action === 'image.resize' && s.step.params.mode === 'percent',
  );
  if (values.length === 0 && !percent) return [];
  if ([...mentions].some((n) => values.includes(n))) return [];
  const said = [...mentions].join(', ');
  return [
    {
      severity: 'blocker',
      code: 'param-pixels',
      target: `quickAction:${steps[0]!.wf.id}`,
      message: `the user asked for ${said} pixels, but the quick action uses ${values.join(', ') || 'a percentage'}; write the value they said`,
    },
  ];
}

function speedMentions(input: string): number[] {
  const out: number[] = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*倍速/g,
    /倍速\s*(\d+(?:\.\d+)?)/g,
    /加速\s*(\d+(?:\.\d+)?)\s*倍/g,
    /(\d+(?:[.,]\d+)?)\s*[x×]\s*(?:speed|faster|vitesse)/gi,
    /(?:speed|vitesse)[^.。!?\d]{0,12}?[x×]\s*(\d+(?:[.,]\d+)?)/gi,
    /(\d+(?:[.,]\d+)?)\s*(?:times|fois)\s*(?:faster|plus vite)/gi,
    /(?:speed up|accélérer|accelerer)[^.。!?\d]{0,20}?(\d+(?:[.,]\d+)?)\s*(?:[x×]|times|fois)/gi,
  ];
  for (const re of patterns) for (const m of input.matchAll(re)) out.push(num(m[1]!));
  return out;
}

function checkSpeed(input: string, steps: readonly ScopeStep[]): ToolIssue[] {
  const mentions = speedMentions(input);
  if (mentions.length === 0) return [];
  const speed = steps.filter(
    (s) => s.step.action === 'video.speed' || s.step.action === 'audio.fromText',
  );
  if (speed.length === 0) return [];
  const values = speed.map((s) => Number(s.step.params.factor ?? s.step.params.rate));
  if (mentions.some((m) => values.includes(m))) return [];
  return [
    {
      severity: 'blocker',
      code: 'param-speed',
      target: `quickAction:${speed[0]!.wf.id}`,
      message: `the user asked for ${mentions.join(', ')}x speed, but the quick action uses ${values.join(', ')}x; write the value they said`,
    },
  ];
}

function checkPageCounts(input: string, steps: readonly ScopeStep[]): ToolIssue[] {
  const issues: ToolIssue[] = [];
  const every = /每\s*(\d+)\s*页|every\s+(\d+)\s+pages?|toutes les\s+(\d+)\s+pages/i.exec(input);
  const split = steps.filter((s) => s.step.action === 'pdf.split');
  if (every && split.length > 0) {
    const n = Number(every[1] ?? every[2] ?? every[3]);
    if (!split.some((s) => s.step.params.mode === 'every' && s.step.params.n === n))
      issues.push({
        severity: 'blocker',
        code: 'param-pages',
        target: `quickAction:${split[0]!.wf.id}`,
        message: `the user asked to split every ${n} pages, but pdf.split doesn't have mode "every" with n ${n}`,
      });
  }
  const range =
    /第\s*(\d+)\s*(?:[-–~到至]\s*(?:第\s*)?(\d+)\s*)?页|pages?\s+(\d+)\s*(?:-|–|to|à|through)\s*(\d+)/i.exec(
      input,
    );
  const ranged = steps.filter((s) => ['pdf.selectPages', 'pdf.rotate'].includes(s.step.action));
  if (range && ranged.length > 0) {
    const from = range[1] ?? range[3];
    const to = range[2] ?? range[4];
    // 「第 1 页」可以写成 rule first，不查。
    if (to !== undefined || from !== '1') {
      const has = (s: ScopeStep) => {
        const text = String(s.step.params.range ?? '');
        const tokens = text.split(/[^\d]+/);
        return (
          s.step.params.rule === 'range' &&
          tokens.includes(from!) &&
          (to === undefined || tokens.includes(to))
        );
      };
      if (!ranged.some(has))
        issues.push({
          severity: 'blocker',
          code: 'param-pages',
          target: `quickAction:${ranged[0]!.wf.id}`,
          message: `the user asked for pages ${from}${to ? `-${to}` : ''}, but ${ranged[0]!.step.action} doesn't have rule "range" with those pages`,
        });
    }
  }
  return issues;
}

/** 语言的叫法 → translate.text 的 to。中文两种都算（没说繁简时）。 */
const LANGUAGE_WORDS: readonly [RegExp, readonly string[]][] = [
  [/^(?:繁体中文|繁体|繁體|traditional chinese|chinois traditionnel)/i, ['zh-Hant']],
  [/^(?:简体中文|简体|simplified chinese|chinois simplifié)/i, ['zh-Hans']],
  [/^(?:中文|汉语|chinese|chinois)/i, ['zh-Hans', 'zh-Hant']],
  [/^(?:英文|英语|english|anglais)/i, ['en']],
  [/^(?:法文|法语|french|français|francais)/i, ['fr']],
  [/^(?:日文|日语|japanese|japonais)/i, ['ja']],
  [/^(?:韩文|韩语|korean|coréen|coreen)/i, ['ko']],
  [/^(?:德文|德语|german|allemand)/i, ['de']],
  [/^(?:西班牙文|西班牙语|spanish|espagnol)/i, ['es']],
  [/^(?:葡萄牙文|葡萄牙语|portuguese|portugais)/i, ['pt']],
  [/^(?:意大利文|意大利语|italian|italien)/i, ['it']],
  [/^(?:俄文|俄语|russian|russe)/i, ['ru']],
  [/^(?:越南文|越南语|vietnamese|vietnamien)/i, ['vi']],
];

const TRANSLATE_TARGET =
  /(?:翻译|翻|译)\s*(?:成|为|到)\s*|translat\w*\b[^.。!?]{0,60}?\b(?:in)?to\s+|tradui\w*\b[^.。!?]{0,60}?\b(?:en|vers(?:\s+l['’]|\s+le\s+)?)\s*/gi;

/** 没说「翻译」的说法（「变成英文 PDF」）：只有计划里已经有翻译步骤时才算，不然「改成中文」可能是别的意思。 */
const LOOSE_TARGET = /(?:变成|转成|换成|改成|做成)\s*/g;

/** 句子里说的翻译目标（每个说法一组能接受的语言）。 */
function languageMentions(input: string, loose: boolean): (readonly string[])[] {
  const out: (readonly string[])[] = [];
  for (const m of [
    ...input.matchAll(TRANSLATE_TARGET),
    ...(loose ? input.matchAll(LOOSE_TARGET) : []),
  ]) {
    const rest = input.slice(m.index + m[0].length);
    const hit = LANGUAGE_WORDS.find(([re]) => re.test(rest));
    if (hit) out.push(hit[1]);
  }
  return out;
}

function checkLanguage(
  input: string,
  steps: readonly ScopeStep[],
  added: readonly QuickAction[],
): ToolIssue[] {
  const translate = steps.filter((s) => s.step.action === 'translate.text');
  const mentions = languageMentions(input, translate.length > 0);
  if (mentions.length === 0) return [];
  const said = mentions.map((m) => m[0]).join(', ');
  if (translate.length === 0) {
    if (added.length === 0) return [];
    return [
      {
        severity: 'blocker',
        code: 'param-language',
        target: `quickAction:${added[0]!.id}`,
        message: `the user asked for a translation to ${said}, but quick action ${added[0]!.id} has no translate.text step`,
      },
    ];
  }
  const values = translate.map((s) => String(s.step.params.to));
  if (mentions.some((m) => m.some((lang) => values.includes(lang)))) return [];
  return [
    {
      severity: 'blocker',
      code: 'param-language',
      target: `quickAction:${translate[0]!.wf.id}`,
      message: `the user asked for a translation to ${said}, but translate.text has to: ${values.join(', ')}; set to the language they said`,
    },
  ];
}

const BACKGROUND_WORDS: readonly [RegExp, string][] = [
  [/蓝色?(?:底|背景)|blue\s+(?:background|backdrop)|fond\s+bleu/i, 'blue'],
  [/白色?(?:底|背景)|white\s+(?:background|backdrop)|fond\s+blanc/i, 'white'],
  [/红色?(?:底|背景)|red\s+(?:background|backdrop)|fond\s+rouge/i, 'red'],
  [/灰色?(?:底|背景)|gr[ae]y\s+(?:background|backdrop)|fond\s+gris/i, 'gray'],
];

function checkBackground(input: string, steps: readonly ScopeStep[]): ToolIssue[] {
  const said = BACKGROUND_WORDS.filter(([re]) => re.test(input)).map(([, v]) => v);
  const photo = steps.filter((s) => s.step.action === 'image.idPhoto');
  if (said.length === 0 || photo.length === 0) return [];
  const values = photo.map((s) => s.step.params.background);
  if (values.includes('custom') || values.some((v) => said.includes(String(v)))) return [];
  return [
    {
      severity: 'blocker',
      code: 'param-background',
      target: `quickAction:${photo[0]!.wf.id}`,
      message: `the user asked for a ${said.join(' or ')} background, but image.idPhoto has background: ${values.map(String).join(', ')}`,
    },
  ];
}

function checkResolution(input: string, steps: readonly ScopeStep[]): ToolIssue[] {
  const mentions = [...input.matchAll(/(480|720|1080)\s*p\b/gi)]
    .filter((m) => !afterNumber(input, m.index, '0123456789'))
    .map((m) => `${m[1]}p`);
  const video = steps.filter((s) => s.step.action === 'video.compress');
  if (mentions.length === 0 || video.length === 0) return [];
  const hit = video.some(
    (s) => s.step.params.by === 'quality' && mentions.includes(String(s.step.params.quality)),
  );
  if (hit) return [];
  return [
    {
      severity: 'blocker',
      code: 'param-resolution',
      target: `quickAction:${video[0]!.wf.id}`,
      message: `the user asked for ${mentions.join(', ')}, but video.compress doesn't have by "quality" with that quality`,
    },
  ];
}

/**
 * 用户句子里明确说的数和词有没有落到这次改动上。input 是用户的原话（只在本机用，不发出去）。
 * 只报高把握的，对不上就是 blocker；不确定就不报。
 */
export function checkRequestParams(
  input: string,
  locale: Locale,
  before: WorkspaceConfig,
  after: WorkspaceConfig,
): ToolIssue[] {
  const { touched, added } = touchedActions(before, after);
  if (touched.length === 0) return [];
  const steps = scopeSteps(touched);
  const text = normalizeNumbers(input);
  return [
    ...checkSizes(text, locale, steps, added),
    ...checkPixels(text, steps),
    ...checkSpeed(text, steps),
    ...checkPageCounts(text, steps),
    ...checkLanguage(text, steps, added),
    ...checkBackground(text, steps),
    ...checkResolution(text, steps),
  ];
}
