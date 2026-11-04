import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { GROUP_BY_TYPES } from '../list-groups-schema';
import { t } from '../messages';
import { ToolUseSchema } from '../record-ops-schema';
import {
  boundedText,
  FieldRefSchema,
  filterSchema,
  GroupingSchema,
  IdSchema,
  SortSchema,
} from '../schema-base';
import {
  collectionName,
  type CheckContext,
  type CheckProblem,
  type LookDefinitionOf,
  type LookMeta,
  type Pin,
  defineLook,
  isSystemField,
  NUMERIC_FIELD_TYPES,
} from './define';

/**
 * 右侧字段的显示格式（D-306）：elapsed = 从这个日期时间（或创建时间）到现在、或到 until，没有 until 的值时每秒在走；
 * progress = 这个数值和目标（固定数或这条记录的另一个数字类字段）的比例，画成环（默认）或条。
 */
export const TrailingFormatSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('elapsed'), until: IdSchema.optional() }),
  z.strictObject({
    kind: z.literal('progress'),
    goal: z.union([z.number().positive().max(1_000_000_000), IdSchema]),
    style: z.enum(['ring', 'bar']).optional(),
  }),
]);

/** 记录块读什么：一张表，筛选、排序、条数，可以分组（每组一段 / 一栏 / 一天）。limit 是每段 / 每栏最多几条。 */
export const RecordSourceSchema = z.strictObject({
  table: IdSchema,
  filter: filterSchema().optional(),
  sort: SortSchema.optional(),
  // 不写时 30 条（模型偶尔漏写，不该因此拒绝整份修改）。
  limit: z.number().int().min(1).max(100).default(30),
  group: GroupingSchema.optional(),
});
export type RecordSource = z.infer<typeof RecordSourceSchema>;

/** 每一条的记录卡片（重复嵌套，NEW_FORMAT §4）：固定的槽位。 */
const SlotsSchema = z.strictObject({
  title: FieldRefSchema,
  subtitles: z.array(FieldRefSchema).max(2).optional(),
  /** 显示在右侧的字段，例如金额。 */
  trailing: FieldRefSchema.optional(),
  format: TrailingFormatSchema.optional(),
  /** 月历按这个单选字段给每天上色（这一天最后一条的选项）。 */
  color: IdSchema.optional(),
  emptyText: boundedText(1, 80).optional(),
  /**
   * 用户在列表上临时找、换着看（D-424，只有 list、cards、checklist）：search 有搜索框，sort、group 是能换的字段。
   * 换了只在这个块画着的时候有效，离开就回到 source 的排序和分组，什么都不写（底线 15）。
   * filter：单选、标签字段，一排可点的值，一次选一个（创始人 2026-11-04 定）。pin：搜索框和这几排固定在页面上方。
   * 有 browse 时 source.limit 是每次显示几条，滚到底再显示下一批（没有 browse 的 limit 是硬上限）。
   */
  browse: z
    .strictObject({
      search: z.literal(true).optional(),
      sort: z.array(FieldRefSchema).min(1).max(6).optional(),
      group: z.array(FieldRefSchema).min(1).max(6).optional(),
      filter: z.array(IdSchema).min(1).max(3).optional(),
      /** 一排「全部 / 本周 / 本月 / 本年」，按这个日期字段（或 createdAt、updatedAt）切换（D-437）。 */
      period: FieldRefSchema.optional(),
      pin: z.literal(true).optional(),
    })
    .optional(),
});

const shape = {
  source: RecordSourceSchema,
  show: SlotsSchema,
  /** 每一条上的工具（≤3 个按钮 + 勾 / 点一下 / 拖动 / 就地添加）和列表上方的按钮（≤3，D-428），检查在 record-ops.ts。 */
  tools: z.array(ToolUseSchema).min(1).max(8).optional(),
  /** 点一条打开这个页面（D-342，page.of 是这张表），不写是编辑页。 */
  opens: IdSchema.optional(),
};

export const RECORD_LOOKS = ['list', 'cards', 'checklist', 'tiles', 'board', 'calendar'] as const;
export type RecordLook = (typeof RECORD_LOOKS)[number];

type RecordBlock = z.infer<z.ZodObject<typeof shape>> & {
  id: string;
  look: RecordLook;
  pin?: Pin | undefined;
};

const refs = {
  'source.table': { to: 'table' },
  'show.title': { to: 'field' },
  'show.subtitles': { to: 'field', role: 'subtitleField' },
  'show.trailing': { to: 'field', role: 'trailingField' },
  'show.color': { to: 'field', role: 'colorField', types: ['choice'] },
  'show.browse.sort': { to: 'field', role: 'show.browse.sort' },
  'show.browse.group': { to: 'field', role: 'show.browse.group' },
  'show.browse.period': { to: 'field', role: 'show.browse.period', types: ['date', 'datetime'] },
  'show.browse.filter': { to: 'field', role: 'show.browse.filter', types: ['tags', 'choice'] },
  'source.filter': { to: 'filter' },
} as const;

/** 列表上能换着分组的字段：分段能用的，加上文字（按公司分，每个不同的值一段，D-424）。 */
const BROWSE_GROUP_TYPES: readonly string[] = [...GROUP_BY_TYPES, 'text'];

/** 每种记录外观自己的要求（v33 靠 check 拦的，v34 写进各自的 look 里，规则 E6）。 */
function recordProblems(c: RecordBlock, ctx: CheckContext): CheckProblem[] {
  const { collection, config } = ctx;
  const problems: string[] = [];
  const table = c.source.table;
  if (c.opens !== undefined) {
    const target = config.containers.pages.find((p) => p.id === c.opens);
    if (!target) problems.push(`opens ${c.opens} is not a page`);
    else if (target.of !== table)
      problems.push(`opens ${c.opens} must be a page for one entry of ${table} (of: "${table}")`);
  }
  const field = (id: string) => collection!.fields.find((f) => f.id === id);
  const typeOf = (id: string) => (isSystemField(id) ? 'datetime' : field(id)?.type);
  if (c.look !== 'calendar' && c.show.color !== undefined)
    problems.push('show.color only applies to look "calendar"');
  const browse = c.show.browse;
  if (browse) {
    if (c.look !== 'list' && c.look !== 'cards' && c.look !== 'checklist')
      problems.push('show.browse only applies to looks "list", "cards" and "checklist"');
    if (
      browse.search === undefined &&
      !browse.sort &&
      !browse.group &&
      !browse.filter &&
      !browse.period
    )
      problems.push('show.browse needs search, sort, group, filter or period');
    if (browse.pin) {
      if (ctx.parent)
        problems.push('show.browse.pin only works on a top-level list, not inside a group');
      const pinned = ctx.page.blocks.filter(
        (b) => (b as { show?: { browse?: { pin?: true } } }).show?.browse?.pin === true,
      );
      if (pinned.length > 1)
        problems.push(`page ${ctx.page.id} can pin the search of only one list`);
    }
    // 能一直往下加载的列表要在滚动的中间，固定不住。
    if (c.pin !== undefined)
      problems.push('a list with show.browse scrolls in the middle of the page: no pin');
    for (const id of browse.sort ?? []) {
      const f = field(id);
      if (f && fieldDefinition(f.type).sort === false)
        problems.push(`show.browse.sort: can't sort by the ${f.type} field ${id}`);
    }
    for (const id of browse.group ?? []) {
      const type = typeOf(id);
      if (type && !BROWSE_GROUP_TYPES.includes(type))
        problems.push(
          `show.browse.group ${id} must be a ${BROWSE_GROUP_TYPES.join(', ')} field or createdAt / updatedAt`,
        );
    }
  }
  const format = c.show.format;
  const trailing = c.show.trailing;
  const trailingType = trailing ? typeOf(trailing) : undefined;
  if (format && !trailing) problems.push(`show.format ${format.kind} needs show.trailing`);
  else if (format?.kind === 'elapsed') {
    if (trailingType !== 'datetime')
      problems.push(
        'show.format elapsed needs show.trailing set to a datetime field or "createdAt" (the start)',
      );
    if (format.until !== undefined && field(format.until)?.type !== 'datetime')
      problems.push(`show.format until must be a datetime field of ${collection!.id} (the end)`);
  } else if (format?.kind === 'progress') {
    if (!trailingType || !NUMERIC_FIELD_TYPES.includes(trailingType))
      problems.push(
        'show.format progress needs show.trailing set to a number, money, rating, duration, formula or rollup field',
      );
    const goal = typeof format.goal === 'string' ? field(format.goal) : undefined;
    if (typeof format.goal === 'string' && (!goal || !NUMERIC_FIELD_TYPES.includes(goal.type)))
      problems.push(
        `show.format goal ${format.goal} must be a number or a number field of ${collection!.id}`,
      );
  }
  const group = c.source.group;
  const by = group?.by;
  const byType = by === undefined ? undefined : isSystemField(by) ? 'date' : field(by)?.type;
  if (by !== undefined && !isSystemField(by) && !field(by))
    problems.push(`source.group.by ${by} is not a field of ${collection!.id}`);
  if (group?.last !== undefined) problems.push('source.group.last only applies to a chart');
  if (c.look === 'calendar') {
    if (group?.unit !== 'day')
      problems.push('a calendar needs source.group {unit: "day", by?: a date field}');
    else if (by !== undefined && byType && !['date', 'datetime', 'schedule'].includes(byType))
      problems.push(
        `source.group.by ${by} must be a date or datetime or schedule field of ${collection!.id}`,
      );
    if (group?.showEmpty || group?.filter)
      problems.push('a calendar groups by day only: no showEmpty or filter');
  } else if (c.look === 'board') {
    if (!group || by === undefined || (byType !== 'choice' && byType !== 'link'))
      problems.push('a board needs source.group.by set to a choice or link field');
    if (group?.unit || group?.showEmpty)
      problems.push('a board has one column per option: no unit or showEmpty');
    if (group?.filter && byType !== 'link')
      problems.push('source.group.filter only applies when grouping by a link field');
  } else if (c.look === 'tiles') {
    if (group) problems.push('tiles are not grouped: no source.group');
  } else if (group) {
    if (by === undefined && group.unit === undefined)
      problems.push('source.group needs by (a field) or unit');
    else if (byType && !GROUP_BY_TYPES.includes(byType))
      problems.push(
        `source.group.by ${by} must be a ${GROUP_BY_TYPES.join(', ')} field or createdAt / updatedAt`,
      );
    const dated = byType !== 'choice' && byType !== 'link';
    if (group.unit && !dated)
      problems.push('source.group.unit only applies when grouping by a date or schedule field');
    if (group.showEmpty && dated)
      problems.push('source.group.showEmpty only applies when grouping by a choice or link field');
    if (group.filter) problems.push('source.group.filter only applies to a board');
  }
  if (c.source.sort) {
    const sorted = field(c.source.sort.field);
    if (!isSystemField(c.source.sort.field) && !sorted)
      problems.push(`sort field ${c.source.sort.field} is not a field of ${table}`);
    if (sorted && fieldDefinition(sorted.type).sort === false)
      problems.push(`can't sort by the ${sorted.type} field ${c.source.sort.field}`);
  }
  return problems;
}

/**
 * 六种记录块共用的写法（提示词里写一次，每种外观的 ai.doc 只写自己的部分）。
 * limit 是每段 / 每栏 / 每天最多几条。
 */
export const RECORD_LOOK_DOC =
  'source {table, filter?, sort? {field, direction: "asc"|"desc"}, limit? (1-100, default 30; per section, column or day when grouped), group?}, show {title, subtitles? (≤2), trailing? (shown on the right, e.g. an amount), format? (rule 46), color? (calendar only), emptyText?, browse? {search?: true, sort?: [fields], group?: [fields], filter?: [tags or choice fields], period?: a date field or createdAt / updatedAt, pin?: true} (list, cards and checklist only: a search box over every field, the fields the user can switch to, a row of values to tap for filter, and a row All / This week / This month / This year over that date field (period); all temporary, nothing is written; pin keeps them fixed above the scrolling list; with browse, limit is how many to show at a time and scrolling to the bottom shows more; set it when the user asks to search, sort, group or filter a list themselves)}, tools?, opens? (a page for one entry, rule 48)';

const DOCS: Record<RecordLook, string> = {
  list: 'rows; tapping a row opens the built-in editor (or the page in opens)',
  cards: 'cards, one per entry',
  checklist:
    'rows with a check box: needs one tool {as: "check", do: "toggle", table, field: <a checkbox field>}',
  tiles:
    'a grid of big circles, one per entry, show.title under each (at most 24 shown) ("习惯做成大圆块，点一下打卡", "Streaks-style habit grid"): a tap runs the first {as: "tap", label, when?, …} tool whose when matches (rule 44; e.g. on a habits table {as: "tap", label: "Done", do: "create", table: "check-ins", values: {habit: "$row"}}, or an increment); without one a tap opens the entry. show.trailing + show.format progress (rule 46) draws a ring around the circle that fills at the goal (e.g. a rollup "done today" with goal "daily-goal"); otherwise the trailing value is shown inside. Tiles never change entries by themselves',
  board:
    'a board with one column per option of source.group.by (a choice or link field; link: rule 45) plus "not set"; dragging a card needs {as: "drag", do: "set", table, field: <the same field>, value: "$group"}, without it the board is read-only (rule 45)',
  calendar:
    'a month calendar: source.group {unit: "day", by?: a date, datetime or schedule field}, show.color? a choice field (rule 45)',
};

const META: Record<RecordLook, NonNullable<LookMeta['tools']>> = {
  list: {
    as: ['button', 'addHere', 'list'],
    do: ['create', 'set', 'toggle', 'increment'],
    ref: ['quickAction'],
    open: true,
    max: 7,
  },
  cards: {
    as: ['button', 'addHere', 'list'],
    do: ['create', 'set', 'toggle', 'increment'],
    ref: ['quickAction'],
    open: true,
    max: 7,
  },
  checklist: {
    as: ['check', 'button', 'addHere', 'list'],
    do: ['create', 'set', 'toggle', 'increment'],
    ref: ['quickAction'],
    open: true,
    max: 8,
  },
  tiles: { as: ['tap'], do: ['create', 'set', 'toggle', 'increment'], open: true, max: 3 },
  board: {
    as: ['drag', 'button', 'addHere'],
    do: ['create', 'set', 'toggle', 'increment'],
    open: true,
    max: 5,
  },
  calendar: {
    as: ['button', 'addHere'],
    do: ['create', 'set', 'toggle', 'increment'],
    open: true,
    max: 4,
  },
};

function recordLook<L extends RecordLook>(look: L): LookDefinitionOf<L, typeof shape> {
  return defineLook({
    look,
    shape,
    kind: 'container',
    layer: 'record',
    reads: 'table',
    writes: true,
    tools: META[look],
    refs,
    check: (c, ctx) => recordProblems(c as RecordBlock, ctx),
    describe: (c, config, ctx) =>
      t(ctx.locale, 'describe_list_0b528', { v0: collectionName(c.source.table, config) }),
    edit: { text: [], style: ['tone'] },
    ai: {
      doc: DOCS[look],
    },
    example: {
      source: {
        table: 'expenses',
        sort: { field: 'date', direction: 'desc' },
        limit: 30,
        ...(look === 'calendar'
          ? { group: { unit: 'day' as const } }
          : look === 'board'
            ? { group: { by: 'category' } }
            : {}),
      },
      show: { title: 'category', subtitles: ['note', 'date'], trailing: 'amount' },
      ...(look === 'checklist'
        ? {
            tools: [
              { as: 'check' as const, do: 'toggle' as const, table: 'expenses', field: 'paid' },
            ],
          }
        : look === 'board'
          ? {
              tools: [
                {
                  as: 'drag' as const,
                  do: 'set' as const,
                  table: 'expenses',
                  field: 'category',
                  value: '$group' as const,
                },
              ],
            }
          : {}),
    },
  });
}

export const listComponent = recordLook('list');
export const cardsComponent = recordLook('cards');
export const checklistComponent = recordLook('checklist');
export const tilesComponent = recordLook('tiles');
export const boardComponent = recordLook('board');
export const calendarComponent = recordLook('calendar');
