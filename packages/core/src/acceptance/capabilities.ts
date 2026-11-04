import { isSystemField } from '../components/define';
import {
  isOpenUse,
  isRecordToolUse,
  type RecordTool,
  type RecordToolValues,
  type ToolUse,
  type ToolUseAs,
} from '../record-ops-schema';
import type { Registry } from '../registry';
import {
  RECORD_LOOKS,
  childrenOf,
  fieldDefinition,
  isKnownComponent,
  pageIdOf,
  quickActionsOf,
  remindersOf,
  tablesOf,
  toolTargetId,
  type BlockOf,
  type Collection,
  type Component,
  type Condition,
  type Field,
  type KnownComponent,
  type Page,
  type QuickAction,
  type RecordLook,
  type Reminder,
  type WorkspaceConfig,
} from '../schema';
import { GROUP_REF, HERE_REF, RECORD_REF, ROW_REF } from '../schema-primitives';
import { dateFieldOf } from '../sequence';
import { checkTools, type ToolCheckResult } from '../tool-check';
import { stepRefs } from '../workflow/refs';

// 个人记录能力表（AGENT_PLAN §3.2，创始人 2026-11-03：App 能实现的个人记录功能是有限的，所以能做出稳定的验收）。
// 每个能力是一个纯函数谓词，只看配置，不绑定表名、字段 ID：任何建法满足都算。
// 只算用户摸得到的：藏起来的块、进不去的页面、关掉的提醒都不算。
// 完整性守护在 capabilities.test.ts：登记表和 schema 多一种东西，这里少一个能力，测试就失败。

/** 用户摸得到的一个块。 */
export interface PlacedBlock {
  page: Page;
  block: KnownComponent;
}

/** 用户摸得到的一个写入口。 */
export interface PlacedWrite {
  tool: RecordTool;
  /** 出现方式；self 是块本身被点（按钮），done 是通知上的「完成」。 */
  as: ToolUseAs | 'self' | 'done';
  /** 工具作用在哪张表的一条上（$row）；没有就是不用先有记录。 */
  rowOf?: string;
  block?: PlacedBlock;
  reminder?: Reminder;
  when: boolean;
}

/** 把文件或文字交给新记录表单的快捷操作（out.addRecord）。 */
export interface FileIntake {
  action: QuickAction;
  table: string;
  /** 摆在页面、手机桌面等地方；不只在「设置 → 快捷操作」里。 */
  placed: boolean;
  /** 链通、参数齐、表里有放文件的字段。 */
  ok: boolean;
  /** 第一步是拍照或扫描。 */
  camera: boolean;
  /** 传进来的是文件（不是文字）。 */
  files: boolean;
}

export interface AppView {
  config: WorkspaceConfig;
  registry: Registry;
  health: ToolCheckResult;
  pages: Page[];
  blocks: PlacedBlock[];
  writes: PlacedWrite[];
  reminders: Reminder[];
  intakes: FileIntake[];
}

function visible(page: Page): KnownComponent[] {
  const walk = (list: readonly Component[]): KnownComponent[] =>
    list.flatMap((c) =>
      c.hidden || !isKnownComponent(c) ? [] : [c, ...walk(childrenOf(c) as Component[])],
    );
  return walk(page.blocks);
}

const toolsOf = (c: KnownComponent): ToolUse[] => (c as { tools?: ToolUse[] }).tools ?? [];

const isRecordLook = (c: KnownComponent) => (RECORD_LOOKS as readonly string[]).includes(c.look);

type RecordBlock = Extract<KnownComponent, { look: RecordLook }>;
type NumberBlock = Extract<KnownComponent, { look: 'number' }>;
type ChartBlock = Extract<KnownComponent, { look: 'chart' }>;

/** 配置 → 用户摸得到的东西。页面进不进得去用工具检查的结论，不再算一遍。 */
export function viewOf(config: WorkspaceConfig, registry: Registry): AppView {
  const health = checkTools(config, registry);
  const lost = new Set(
    health.issues.filter((i) => i.code === 'page-unreachable').map((i) => i.target),
  );
  const pages = config.containers.pages.filter((p) => !lost.has(`page:${p.id}`));
  const blocks = pages.flatMap((page) => visible(page).map((block) => ({ page, block })));
  const reminders = remindersOf(config).filter((r) => r.enabled);
  const writes: PlacedWrite[] = [];
  for (const placed of blocks) {
    const { block } = placed;
    const source = isRecordLook(block) ? (block as RecordBlock).source.table : undefined;
    for (const use of toolsOf(block)) {
      if (!isRecordToolUse(use)) continue;
      const { as, label: _label, when, ...tool } = use;
      writes.push({
        tool: tool as RecordTool,
        as: as ?? 'self',
        ...(source !== undefined && as !== 'addHere' ? { rowOf: source } : {}),
        block: placed,
        when: when !== undefined,
      });
    }
  }
  for (const r of reminders)
    if (r.done)
      writes.push({
        tool: r.done,
        as: 'done',
        ...('each' in r.when ? { rowOf: r.when.each.table } : {}),
        reminder: r,
        when: false,
      });
  const intakes: FileIntake[] = [];
  for (const action of quickActionsOf(config)) {
    const checked = health.tools.find((t) => t.kind === 'fileToRecord' && t.id === action.id);
    for (const ref of stepRefs(action, registry)) {
      if (ref.field !== undefined || !('receives' in ref)) continue;
      const first = action.steps[0];
      const source = first?.params.source;
      intakes.push({
        action,
        table: ref.table,
        placed:
          checked !== undefined && 'entry' in checked.checks && checked.checks.entry === 'placed',
        ok: checked?.ok === true,
        camera: first?.action === 'in.photos' && (source === 'camera' || source === 'scanner'),
        files: ref.receives !== 'text',
      });
    }
  }
  return { config, registry, health, pages, blocks, writes, reminders, intakes };
}

// ---- 读配置的小函数（场景的谓词也用）----

export const tableOf = (v: AppView, id: string): Collection | undefined =>
  tablesOf(v.config).find((t) => t.id === id);

const fieldIn = (table: Collection | undefined, id: string): Field | undefined =>
  table?.fields.find((f) => f.id === id);

export const tableIds = (v: AppView): string[] => tablesOf(v.config).map((t) => t.id);

export const recordBlocks = (v: AppView, table?: string): RecordBlock[] =>
  v.blocks
    .map((x) => x.block)
    .filter(isRecordLook)
    .map((c) => c as RecordBlock)
    .filter((c) => table === undefined || c.source.table === table);

export const numberBlocks = (v: AppView, table?: string): NumberBlock[] =>
  v.blocks
    .map((x) => x.block)
    .filter((c): c is NumberBlock => c.look === 'number')
    .filter((c) => table === undefined || c.source.table === table);

export const chartBlocks = (v: AppView, table?: string): ChartBlock[] =>
  v.blocks
    .map((x) => x.block)
    .filter((c): c is ChartBlock => c.look === 'chart')
    .filter((c) => table === undefined || c.source.table === table);

const presetsOf = (w: PlacedWrite): string[] => {
  if (w.tool.do !== 'create') return [];
  const { values } = w.tool;
  if (values === HERE_REF) {
    const source = w.block && isRecordLook(w.block.block) && (w.block.block as RecordBlock).source;
    if (!source) return [];
    return [
      ...(source.group?.by ? [source.group.by] : []),
      ...(source.filter ?? []).filter((c) => c.op === 'is').map((c) => c.field),
    ];
  }
  return Object.keys((values as RecordToolValues | undefined) ?? {});
};

/** 这次新建会不会问这个字段（用户自己填）。 */
function asksField(w: PlacedWrite, field: string): boolean {
  if (w.tool.do !== 'create') return false;
  const { ask, smartDate } = w.tool;
  return ask === 'all' || (Array.isArray(ask) && ask.includes(field)) || smartDate?.to === field;
}

/** 这次新建有没有给这个字段值（问的或预设的）。 */
export const createCovers = (w: PlacedWrite, field: string): boolean =>
  asksField(w, field) || presetsOf(w).includes(field);

const isComputed = (f: Field) => fieldDefinition(f.type).inForm === false;

const hasDefault = (f: Field) =>
  ('default' in f && f.default !== undefined) || fieldDefinition(f.type).emptyNew !== undefined;

/** 这次新建存得进去：必填的字段都有值。 */
function createSaves(w: PlacedWrite, table: Collection): boolean {
  return table.fields.every(
    (f) =>
      !('required' in f) ||
      !f.required ||
      isComputed(f) ||
      !fieldDefinition(f.type).write ||
      hasDefault(f) ||
      createCovers(w, f.id),
  );
}

export const createsOn = (v: AppView, table: string): PlacedWrite[] =>
  v.writes.filter((w) => w.tool.do === 'create' && w.tool.table === table);

/**
 * 这张表从一条记录都没有开始，用户加得进去：表单、按钮、就地添加、快捷操作，或者别的表每一条上的按钮
 * （那张表自己要加得进去）。每一条上的「复制一条」开不了头。
 */
export function canAdd(v: AppView, table: string, seen: ReadonlySet<string> = new Set()): boolean {
  if (seen.has(table)) return false;
  const t = tableOf(v, table);
  if (!t) return false;
  if (v.intakes.some((x) => x.table === table && x.ok)) return true;
  const next = new Set([...seen, table]);
  return createsOn(v, table).some(
    (w) =>
      createSaves(w, t) &&
      (w.rowOf === undefined || (w.rowOf !== table && canAdd(v, w.rowOf, next))),
  );
}

/** 写入口（新建时问的、预设的，或者每一条上的工具）写得到这个字段。不算默认值，不算打开编辑页。 */
export function entryWrites(v: AppView, table: string, field: string): boolean {
  if (v.intakes.some((x) => x.table === table && x.ok)) return true;
  return v.writes.some(
    (w) =>
      w.tool.table === table &&
      (w.tool.do === 'create' ? createCovers(w, field) : w.tool.field === field),
  );
}

/** 用户在写入口能自己选这个字段（表单问）。 */
export const entryAsks = (v: AppView, table: string, field: string): boolean =>
  v.intakes.some((x) => x.table === table && x.ok) ||
  createsOn(v, table).some((w) => asksField(w, field));

/** 新记录这个字段有值：系统字段、算出来的、有默认值的，或者写入口写得到。 */
export function entryFills(v: AppView, table: string, field: string): boolean {
  if (isSystemField(field)) return true;
  const f = fieldIn(tableOf(v, table), field);
  if (!f) return false;
  return isComputed(f) || hasDefault(f) || entryWrites(v, table, field);
}

/** 这张表按日子算时用哪个字段（不写时 dateFieldOf 的默认）。 */
export function dayField(v: AppView, table: string, date?: string): string {
  const t = tableOf(v, table);
  return t ? dateFieldOf(t, date) : 'createdAt';
}

/** 条件要字段有值才可能成立（isEmpty、isNot 空着也成立）。 */
const needsValue = (c: Condition) => c.op !== 'isEmpty' && c.op !== 'isNot';

/** 这个统计或图表依赖的字段（值、日子、筛选、分组），在写入口都有值：统计不会永远是空的。 */
export function statInputsFilled(v: AppView, block: NumberBlock | ChartBlock): boolean {
  const { table, field, filter, group, days, aggregate } = block.source;
  const needed = new Set<string>();
  if (field && aggregate !== 'count' && aggregate !== 'distinctDays') needed.add(field);
  for (const c of filter ?? []) if (needsValue(c)) needed.add(c.field);
  if (group?.by) needed.add(group.by);
  if (group?.unit) needed.add(dayField(v, table, group.by));
  if (['streak', 'daysSince', 'avgInterval', 'distinctDays'].includes(aggregate))
    needed.add(dayField(v, table, days?.date));
  return [...needed].every((id) => entryFills(v, table, id));
}

/** 新记录一存下就有这个字段：默认值，或者新建时问的、预设的。不算之后每一条上的工具。 */
export function createFills(v: AppView, table: string, field: string): boolean {
  const f = fieldIn(tableOf(v, table), field);
  if (!f) return false;
  return (
    hasDefault(f) ||
    v.intakes.some((x) => x.table === table && x.ok) ||
    createsOn(v, table).some((w) => createCovers(w, field))
  );
}

/** 这个字段显示出来了：列表的槽位、数字或图表读的值。 */
export function displayed(v: AppView, table: string, field: string): boolean {
  const shownInRecords = recordBlocks(v, table).some(({ show }) =>
    [show.title, ...(show.subtitles ?? []), show.trailing, show.color].includes(field),
  );
  return (
    shownInRecords ||
    [...numberBlocks(v, table), ...chartBlocks(v, table)].some((b) => b.source.field === field)
  );
}

export interface PlacedRollup {
  host: string;
  field: Extract<Field, { type: 'rollup' }>;
}

/** 汇总 over 这张表、而且显示出来了的字段。 */
export const rollupsOver = (v: AppView, table: string): PlacedRollup[] =>
  tablesOf(v.config).flatMap((host) =>
    host.fields.flatMap((field) =>
      field.type === 'rollup' && field.table === table && displayed(v, host.id, field.id)
        ? [{ host: host.id, field }]
        : [],
    ),
  );

/** 汇总依赖的字段在写入口都有值。 */
export function rollupInputsFilled(v: AppView, { field }: PlacedRollup): boolean {
  const needed = new Set([field.via]);
  if (field.field && field.aggregate !== 'count' && field.aggregate !== 'distinctDays')
    needed.add(field.field);
  for (const c of field.filter ?? []) if (needsValue(c)) needed.add(c.field);
  if (['streak', 'daysSince', 'avgInterval', 'distinctDays', 'latest'].includes(field.aggregate))
    needed.add(dayField(v, field.table, field.days?.date));
  return [...needed].every((id) => entryFills(v, field.table, id));
}

/** 这张表的记录上这些聚合算得出来（数字块，或者另一张表上显示出来的汇总字段）。 */
export function aggregatesOn(v: AppView, table: string, kinds: readonly string[]): boolean {
  return (
    numberBlocks(v, table).some(
      (b) => kinds.includes(b.source.aggregate) && statInputsFilled(v, b),
    ) ||
    rollupsOver(v, table).some((r) => kinds.includes(r.field.aggregate) && rollupInputsFilled(v, r))
  );
}

/** 不用填东西、点一下就写。 */
export const isOneTap = (w: PlacedWrite): boolean => {
  if (!['tap', 'button', 'check', 'self'].includes(w.as)) return false;
  if (w.tool.do === 'create') return w.tool.ask === undefined && w.tool.values !== HERE_REF;
  return w.tool.do !== 'setAll';
};

/** 这个工具作用的那一条存在（要先有记录的话，那张表加得进去）。 */
export const rowExists = (v: AppView, w: PlacedWrite): boolean =>
  w.rowOf === undefined || canAdd(v, w.rowOf);

/** 这次新建记下了日子：日子字段有预设、有默认，或者就是创建时间。 */
export function createKnowsDay(v: AppView, w: PlacedWrite): boolean {
  if (w.tool.do !== 'create') return false;
  const table = w.tool.table;
  const id = dayField(v, table);
  if (isSystemField(id)) return true;
  const f = fieldIn(tableOf(v, table), id);
  return f !== undefined && (hasDefault(f) || createCovers(w, id));
}

/** 点一下新建一条、记得下今天：连续天数、月历只认这种。 */
export const oneTapCreateTables = (v: AppView): Set<string> =>
  new Set(
    v.writes
      .filter((w) => {
        const table = tableOf(v, w.tool.table);
        return (
          w.tool.do === 'create' &&
          isOneTap(w) &&
          table !== undefined &&
          createSaves(w, table) &&
          rowExists(v, w) &&
          createKnowsDay(v, w)
        );
      })
      .map((w) => w.tool.table),
  );

/** 点一下就算记了（新建一条、打勾、加一、写今天，任何一种）。 */
export const oneTapTables = (v: AppView): Set<string> =>
  new Set([
    ...oneTapCreateTables(v),
    ...v.writes
      .filter((w) => w.tool.do !== 'create' && isOneTap(w) && rowExists(v, w))
      .map((w) => w.tool.table),
  ]);

/** 这个页面上的块读或写这张表。 */
export function pageTouches(v: AppView, pageId: string, table: string): boolean {
  return v.blocks.some(
    ({ page, block }) =>
      page.id === pageId &&
      ((block as { source?: { table?: string } }).source?.table === table ||
        toolsOf(block).some((u) => isRecordToolUse(u) && u.table === table)),
  );
}

/** 提醒的钟点（after 没有钟点）。 */
export const reminderTime = (r: Reminder): string | null => ('at' in r.when ? r.when.at : null);

/** 点开这个提醒能看到或写到这张表：打开的页面碰这张表，或者快捷操作用这张表。 */
export function reminderReaches(v: AppView, r: Reminder, table: string): boolean {
  const page = pageIdOf(r.opens);
  if (page !== null) return pageTouches(v, page, table);
  const tool = toolTargetId(r.opens);
  const wf = tool === null ? undefined : quickActionsOf(v.config).find((x) => x.id === tool);
  return wf !== undefined && stepRefs(wf, v.registry).some((ref) => ref.table === table);
}

/** 做完之后下一次会往后排：日程的 lastDone 由这张表每一条上的工具写到（写日期，或者在完成表里新建一条）。 */
/**
 * 每一条上点一下，新建一条完成记录：写到另一张表，引用字段指回这一条（Todoist 的完成表）。
 * 要填东西的不算（「写评论」也是这样连回来的）。
 */
export function completionCreates(v: AppView, table: string): PlacedWrite[] {
  return v.writes.filter((w) => {
    if (w.tool.do !== 'create' || w.rowOf !== table || w.tool.table === table) return false;
    const target = tableOf(v, w.tool.table);
    if (!target || !isOneTap(w) || !createSaves(w, target) || !rowExists(v, w)) return false;
    const values = w.tool.values;
    return target.fields.some(
      (f) =>
        f.type === 'link' &&
        f.table === table &&
        values !== HERE_REF &&
        (values as RecordToolValues | undefined)?.[f.id] === '$row',
    );
  });
}

export function completionReschedules(v: AppView, table: string): boolean {
  const t = tableOf(v, table);
  for (const f of t?.fields ?? []) {
    if (f.type !== 'schedule' || !f.lastDone) continue;
    const last = fieldIn(t, f.lastDone);
    if (!last) continue;
    if (last.type !== 'rollup') {
      if (
        v.writes.some(
          (w) =>
            w.as !== 'done' &&
            w.tool.do === 'set' &&
            w.tool.table === table &&
            w.tool.field === last.id &&
            (w.tool.value === 'today' || w.tool.value === 'now') &&
            rowExists(v, w),
        )
      )
        return true;
      continue;
    }
    const via = last.via;
    if (
      v.writes.some(
        (w) =>
          w.as !== 'done' &&
          w.tool.do === 'create' &&
          w.tool.table === last.table &&
          w.rowOf === table &&
          presetsOf(w).includes(via) &&
          createKnowsDay(v, w),
      )
    )
      return true;
  }
  return false;
}

/** 配置里用到的所有筛选条件（块、汇总字段、按钮的 when 没有细分，提醒的 unless）。 */
function allConditions(v: AppView): Condition[] {
  const out: Condition[] = [];
  for (const { block } of v.blocks) {
    // 文件块筛的是文件，不是记录。
    if (block.look === 'files') continue;
    const source = (
      block as {
        source?: {
          filter?: Condition[];
          group?: { filter?: Condition[] };
          minus?: { filter?: Condition[] };
        };
      }
    ).source;
    out.push(
      ...(source?.filter ?? []),
      ...(source?.group?.filter ?? []),
      ...(source?.minus?.filter ?? []),
    );
    for (const u of toolsOf(block)) out.push(...(u.when ?? []));
  }
  for (const t of tablesOf(v.config))
    for (const f of t.fields) if (f.type === 'rollup') out.push(...(f.filter ?? []));
  for (const r of v.reminders) out.push(...(r.unless?.filter ?? []));
  for (const w of v.writes) if (w.tool.do === 'setAll') out.push(...(w.tool.filter ?? []));
  return out;
}

function allFields(v: AppView): { table: Collection; field: Field }[] {
  return tablesOf(v.config).flatMap((table) => table.fields.map((field) => ({ table, field })));
}

function fieldUsed(v: AppView, type: Field['type']): boolean {
  return allFields(v).some((x) => x.field.type === type);
}

function aggregateUsed(v: AppView, kind: string): boolean {
  return (
    numberBlocks(v).some((b) => b.source.aggregate === kind) ||
    chartBlocks(v).some((b) => b.source.aggregate === kind) ||
    allFields(v).some((x) => x.field.type === 'rollup' && x.field.aggregate === kind)
  );
}

const blocksWithGroup = (v: AppView) =>
  v.blocks
    .map((x) => x.block as { source?: { group?: NonNullable<RecordBlock['source']['group']> } })
    .flatMap((b) => (b.source?.group ? [b.source.group] : []));

function groupByType(v: AppView, types: readonly string[]): boolean {
  return [...recordBlocks(v), ...numberBlocks(v), ...chartBlocks(v)].some((b) => {
    const by = b.source.group?.by;
    const f = by === undefined ? undefined : fieldIn(tableOf(v, b.source.table), by);
    return f !== undefined && types.includes(f.type);
  });
}

const whenIs = (v: AppView, key: 'before' | 'each' | 'after') =>
  v.reminders.some((r) => key in r.when);

const valueUsed = (v: AppView, value: unknown) =>
  v.writes.some((w) => {
    const { tool } = w;
    if (tool.do === 'create') {
      if (tool.values === value) return true;
      return Object.values((tool.values as RecordToolValues | undefined) ?? {}).includes(
        value as never,
      );
    }
    return (tool.do === 'set' || tool.do === 'setAll') && tool.value === value;
  });

const usesOpen = (v: AppView) =>
  v.blocks.some(({ block }) => toolsOf(block).some((u) => isOpenUse(u) && u.opens === 'record'));

// ---- 能力表 ----

export type CapabilityGroup = 'field' | 'write' | 'read' | 'remind' | 'connect';

export interface Capability {
  id: string;
  group: CapabilityGroup;
  test: (v: AppView) => boolean;
}

const cap = (id: string, group: CapabilityGroup, test: Capability['test']): Capability => ({
  id,
  group,
  test,
});
const fieldCap = (type: Field['type']) => cap(`field.${type}`, 'field', (v) => fieldUsed(v, type));
const doCap = (kind: RecordTool['do']) =>
  cap(`write.do.${kind}`, 'write', (v) => v.writes.some((w) => w.tool.do === kind));
const asCap = (as: ToolUseAs) =>
  cap(`write.as.${as}`, 'write', (v) => v.writes.some((w) => w.as === as));
const browseOf = (v: AppView) =>
  v.blocks.flatMap((x) => {
    const browse = (x.block as { show?: { browse?: BlockOf<'list'>['show']['browse'] } }).show
      ?.browse;
    return browse ? [browse] : [];
  });
const lookCap = (look: string) =>
  cap(`read.look.${look}`, 'read', (v) => v.blocks.some((x) => x.block.look === look));
const aggregateCap = (kind: string) =>
  cap(`read.aggregate.${kind}`, 'read', (v) => aggregateUsed(v, kind));
const opCap = (op: Condition['op']) =>
  cap(`read.op.${op}`, 'read', (v) => allConditions(v).some((c) => c.op === op));
const periodCap = (period: string) =>
  cap(`read.period.${period}`, 'read', (v) =>
    allConditions(v).some((c) => c.op === 'inPeriod' && c.value === period),
  );
const unitCap = (unit: string) =>
  cap(`read.group.unit.${unit}`, 'read', (v) => blocksWithGroup(v).some((g) => g.unit === unit));
const chartCap = (kind: 'bar' | 'line' | 'pie') =>
  cap(`read.chart.${kind}`, 'read', (v) => chartBlocks(v).some((b) => b.show.kind === kind));
const streakUnitCap = (unit: 'day' | 'week' | 'month') =>
  cap(`read.streak.unit.${unit}`, 'read', (v) =>
    [
      ...numberBlocks(v).map((b) => (b.source.aggregate === 'streak' ? b.source.days : undefined)),
      ...allFields(v).map((x) =>
        x.field.type === 'rollup' && x.field.aggregate === 'streak' ? x.field.days : undefined,
      ),
    ].some((d) => d?.unit === unit),
  );

/** 全部个人记录能力。手写每一项：加了新东西，守护测试让人来这里补一个谓词。 */
export const CAPABILITIES: readonly Capability[] = [
  // 字段
  fieldCap('text'),
  fieldCap('note'),
  fieldCap('number'),
  fieldCap('money'),
  fieldCap('checkbox'),
  fieldCap('date'),
  fieldCap('choice'),
  fieldCap('rating'),
  fieldCap('file'),
  fieldCap('link'),
  fieldCap('formula'),
  fieldCap('time'),
  fieldCap('datetime'),
  fieldCap('duration'),
  fieldCap('lookup'),
  fieldCap('rollup'),
  fieldCap('previous'),
  fieldCap('schedule'),
  cap('field.schedule.lastDone', 'field', (v) =>
    allFields(v).some((x) => x.field.type === 'schedule' && x.field.lastDone !== undefined),
  ),
  cap('field.schedule.countEarly', 'field', (v) =>
    allFields(v).some((x) => x.field.type === 'schedule' && x.field.countEarly === true),
  ),
  cap('field.text.format', 'field', (v) =>
    allFields(v).some((x) => x.field.type === 'text' && x.field.format !== undefined),
  ),
  cap('field.table.readAttachments', 'field', (v) =>
    tablesOf(v.config).some((t) => t.readAttachments === true),
  ),
  cap('field.table.prefillRules', 'field', (v) =>
    tablesOf(v.config).some((t) => t.prefillRules !== undefined),
  ),

  // 写
  doCap('create'),
  doCap('set'),
  doCap('toggle'),
  doCap('increment'),
  doCap('setAll'),
  asCap('submit'),
  asCap('button'),
  asCap('check'),
  asCap('tap'),
  asCap('drag'),
  asCap('addHere'),
  cap('write.look.form', 'write', (v) => v.blocks.some((x) => x.block.look === 'form')),
  cap('write.look.button', 'write', (v) => v.writes.some((w) => w.as === 'self')),
  cap('write.form.inline', 'write', (v) =>
    v.blocks.some((x) => x.block.look === 'form' && x.block.show.mode === 'inline'),
  ),
  cap('write.form.sheet', 'write', (v) =>
    v.blocks.some((x) => x.block.look === 'form' && x.block.show.mode === 'sheet'),
  ),
  cap('write.ask.all', 'write', (v) =>
    v.writes.some((w) => w.tool.do === 'create' && w.tool.ask === 'all'),
  ),
  cap('write.ask.fields', 'write', (v) =>
    v.writes.some((w) => w.tool.do === 'create' && Array.isArray(w.tool.ask)),
  ),
  cap('write.smartDate', 'write', (v) =>
    v.writes.some((w) => w.tool.do === 'create' && w.tool.smartDate !== undefined),
  ),
  cap('write.when', 'write', (v) => v.writes.some((w) => w.when)),
  cap('write.value.today', 'write', (v) => valueUsed(v, 'today')),
  cap('write.value.now', 'write', (v) => valueUsed(v, 'now')),
  cap('write.value.row', 'write', (v) => valueUsed(v, ROW_REF)),
  cap('write.value.record', 'write', (v) => valueUsed(v, RECORD_REF)),
  cap('write.value.group', 'write', (v) => valueUsed(v, GROUP_REF)),
  cap('write.value.here', 'write', (v) => valueUsed(v, HERE_REF)),
  cap('write.action.out.addRecord', 'write', (v) => v.intakes.length > 0),
  cap('write.fileInForm', 'write', (v) =>
    allFields(v).some(
      ({ table, field }) => field.type === 'file' && entryAsks(v, table.id, field.id),
    ),
  ),

  // 读
  lookCap('list'),
  lookCap('cards'),
  lookCap('checklist'),
  lookCap('tiles'),
  lookCap('board'),
  lookCap('calendar'),
  lookCap('number'),
  lookCap('chart'),
  lookCap('single'),
  cap('read.single.qr', 'read', (v) =>
    v.blocks.some((x) => x.block.look === 'single' && x.block.show.qr === true),
  ),
  cap('read.browse.search', 'read', (v) => browseOf(v).some((b) => b.search === true)),
  cap('read.browse.sort', 'read', (v) => browseOf(v).some((b) => b.sort !== undefined)),
  cap('read.browse.group', 'read', (v) => browseOf(v).some((b) => b.group !== undefined)),
  cap('read.showIf.some', 'read', (v) => v.blocks.some((x) => x.block.showIf?.has === 'some')),
  cap('read.showIf.none', 'read', (v) => v.blocks.some((x) => x.block.showIf?.has === 'none')),
  cap('connect.recordsToVCard', 'connect', (v) =>
    quickActionsOf(v.config).some((q) => q.steps.some((s) => s.action === 'records.toVCard')),
  ),
  chartCap('bar'),
  chartCap('line'),
  chartCap('pie'),
  cap('read.filter', 'read', (v) =>
    [...recordBlocks(v), ...numberBlocks(v), ...chartBlocks(v)].some(
      (b) => (b.source.filter ?? []).length > 0,
    ),
  ),
  cap('read.sort', 'read', (v) => recordBlocks(v).some((b) => b.source.sort !== undefined)),
  cap('read.group.choice', 'read', (v) => groupByType(v, ['choice'])),
  cap('read.group.link', 'read', (v) => groupByType(v, ['link'])),
  cap('read.group.schedule', 'read', (v) => groupByType(v, ['schedule'])),
  unitCap('day'),
  unitCap('week'),
  unitCap('month'),
  cap('read.group.last', 'read', (v) => blocksWithGroup(v).some((g) => g.last !== undefined)),
  cap('read.group.showEmpty', 'read', (v) => blocksWithGroup(v).some((g) => g.showEmpty === true)),
  cap('read.group.filter', 'read', (v) => blocksWithGroup(v).some((g) => g.filter !== undefined)),
  aggregateCap('count'),
  aggregateCap('sum'),
  aggregateCap('avg'),
  aggregateCap('min'),
  aggregateCap('max'),
  aggregateCap('latest'),
  aggregateCap('streak'),
  aggregateCap('daysSince'),
  aggregateCap('avgInterval'),
  aggregateCap('distinctDays'),
  streakUnitCap('day'),
  streakUnitCap('week'),
  streakUnitCap('month'),
  cap('read.streak.perUnit', 'read', (v) =>
    numberBlocks(v).some((b) => b.source.days?.perUnit !== undefined),
  ),
  cap('read.streak.skip', 'read', (v) =>
    numberBlocks(v).some((b) => b.source.days?.skip !== undefined),
  ),
  cap('read.number.goal', 'read', (v) => numberBlocks(v).some((b) => b.source.goal !== undefined)),
  cap('read.number.compare', 'read', (v) =>
    numberBlocks(v).some((b) => b.source.compare !== undefined),
  ),
  cap('read.number.minus', 'read', (v) =>
    numberBlocks(v).some((b) => b.source.minus !== undefined),
  ),
  opCap('is'),
  opCap('isNot'),
  opCap('contains'),
  opCap('gt'),
  opCap('lt'),
  opCap('isEmpty'),
  opCap('isNotEmpty'),
  opCap('inPeriod'),
  opCap('due'),
  periodCap('today'),
  periodCap('thisWeek'),
  periodCap('thisMonth'),
  periodCap('thisYear'),
  periodCap('last7days'),
  periodCap('last30days'),
  periodCap('last14days'),
  periodCap('last90days'),
  periodCap('last365days'),
  periodCap('thisTwoWeeks'),
  periodCap('thisHalfMonth'),
  cap('read.show.color', 'read', (v) => recordBlocks(v).some((b) => b.show.color !== undefined)),
  cap('read.format.elapsed', 'read', (v) =>
    recordBlocks(v).some((b) => b.show.format?.kind === 'elapsed'),
  ),
  cap('read.format.progress', 'read', (v) =>
    recordBlocks(v).some((b) => b.show.format?.kind === 'progress'),
  ),
  cap(
    'read.recordPage',
    'read',
    (v) =>
      v.pages.some((p) => p.of !== undefined) && recordBlocks(v).some((b) => b.opens !== undefined),
  ),
  cap('read.openEditor', 'read', usesOpen),
  cap('read.action.in.records', 'read', (v) =>
    quickActionsOf(v.config).some((q) => q.steps.some((s) => s.action === 'in.records')),
  ),

  // 提醒
  cap('remind.when.everyDay', 'remind', (v) =>
    v.reminders.some((r) => 'every' in r.when && r.when.every === 'day'),
  ),
  cap('remind.when.everyWeek', 'remind', (v) =>
    v.reminders.some((r) => 'every' in r.when && r.when.every === 'week'),
  ),
  cap('remind.when.before', 'remind', (v) => whenIs(v, 'before')),
  cap('remind.when.each', 'remind', (v) => whenIs(v, 'each')),
  cap('remind.when.after', 'remind', (v) => whenIs(v, 'after')),
  cap('remind.unless', 'remind', (v) => v.reminders.some((r) => r.unless !== undefined)),
  cap('remind.done', 'remind', (v) => v.reminders.some((r) => r.done !== undefined)),
  cap('remind.snoozeMinutes', 'remind', (v) =>
    v.reminders.some((r) => r.snoozeMinutes !== undefined),
  ),

  // 能力之间的连接：单项都有，也可能接不起来。
  cap('connect.writeReadSameTable', 'connect', (v) =>
    tableIds(v).some(
      (t) =>
        canAdd(v, t) &&
        (recordBlocks(v, t).length > 0 ||
          numberBlocks(v, t).length > 0 ||
          chartBlocks(v, t).length > 0),
    ),
  ),
  cap('connect.statInputsFilled', 'connect', (v) => {
    const stats = [...numberBlocks(v), ...chartBlocks(v)];
    return stats.length > 0 && stats.every((b) => statInputsFilled(v, b));
  }),
  cap('connect.calendarDayFilled', 'connect', (v) => {
    const calendars = recordBlocks(v).filter((b) => b.look === 'calendar');
    return (
      calendars.length > 0 &&
      calendars.every((b) =>
        entryFills(v, b.source.table, dayField(v, b.source.table, b.source.group?.by)),
      )
    );
  }),
  cap('connect.calendarColorFilled', 'connect', (v) =>
    recordBlocks(v).some(
      (b) =>
        b.look === 'calendar' &&
        b.show.color !== undefined &&
        entryWrites(v, b.source.table, b.show.color),
    ),
  ),
  cap('connect.tapReachesRows', 'connect', (v) => {
    const taps = v.writes.filter((w) => w.as === 'tap');
    return taps.length > 0 && taps.every((w) => rowExists(v, w));
  }),
  cap('connect.dragWritesGroupField', 'connect', (v) =>
    v.writes.some(
      (w) =>
        w.as === 'drag' &&
        w.tool.do === 'set' &&
        w.block !== undefined &&
        w.tool.field === (w.block.block as RecordBlock).source.group?.by,
    ),
  ),
  cap('connect.reminderReachesTable', 'connect', (v) =>
    v.reminders.some((r) => tableIds(v).some((t) => reminderReaches(v, r, t))),
  ),
  cap('connect.doneWritesCountedTable', 'connect', (v) =>
    v.reminders.some(
      (r) =>
        r.done !== undefined && aggregatesOn(v, r.done.table, ['streak', 'count', 'distinctDays']),
    ),
  ),
  cap('connect.rescheduleOnDone', 'connect', (v) =>
    tableIds(v).some((t) => completionReschedules(v, t)),
  ),
  cap('connect.fileIntakePlaced', 'connect', (v) =>
    v.intakes.some((x) => x.placed && x.ok && x.files),
  ),
];
