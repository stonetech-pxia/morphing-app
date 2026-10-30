import {
  allComponents,
  MAX_TILES,
  calendarOf,
  changeLabel,
  compareChange,
  componentLabel,
  filterRecords,
  formatRef,
  linkedCollectionIds,
  loadComputedRecords,
  loadLinkResolver,
  previousLabel,
  progressOf,
  recordProgress,
  resolveColors,
  shownRowAction,
  sortRecords,
  isKnownComponent,
  readNumber,
  type BlockOf,
  type Calendar,
  type Component,
  type DataRecord,
  type Locale,
  type Registry,
  type Theme,
  type WorkspaceConfig,
} from '@morph/core';

import { t } from '../i18n';
import {
  amountText,
  isRecordBlock as isRecordLook,
  statText,
  type RecordBlock,
} from '../renderer/data';
import { iosSymbolName } from '../renderer/Icon';
import {
  actionHash,
  applyInMemory,
  buttonOpKey,
  findComponent,
  planWidgetOp,
  rowOpKey,
  widgetButtonAction,
  widgetRowAction,
  type RecordsByTable,
} from './ops';
import type {
  PlacedWidget,
  WidgetOpRef,
  WidgetPalette,
  WidgetRow,
  WidgetSnapshot,
  WidgetState,
  WidgetView,
  WidgetViews,
} from './types';

// 小组件的画面（D-321、D-322）：和页面上的组件用同一份配置、同一套算法（筛选、聚合、目标、上一段比较、
// 排序、行操作的条件），在本机算成文字。只算正式版本（草稿不算），只算用户放到桌面的组件。
// 每个能点的操作另外预先算好「连点 1…REPEATS 次以后」的画面，小组件点了马上换上，不用等 App 执行。

/** 每个操作预先算几次连点。 */
export const REPEATS = 4;
/** 小组件最多画几行 / 几个圆（大尺寸）。 */
const MAX_ROWS = 7;
const WIDGET_TILES = Math.min(8, MAX_TILES);

/**
 * 组件在给一条记录用的页面上（D-342）：小组件不知道是哪一条，放不到桌面。
 */
export function onRecordPage(c: Component, config: WorkspaceConfig): boolean {
  return config.containers.pages.some(
    (p) => p.of !== undefined && allComponents(p).some((x) => x.id === c.id),
  );
}

/** 能放到桌面的组件：统计、按钮、记录列表（月历和看板除外）。 */
export function widgetSupported(c: Component): boolean {
  return ['list', 'cards', 'checklist', 'tiles', 'number', 'button'].includes(c.look as string);
}

/** 小组件和「编辑小组件」列表里的名字：统计、按钮用它自己的文字，列表用表名，其它用组件的说明。 */
export function widgetName(
  c: Component,
  config: WorkspaceConfig,
  registry: Registry,
  locale: Locale,
): string {
  if (!isKnownComponent(c)) return componentLabel(c, config, { registry, locale, now: new Date() });
  if (c.look === 'number' || c.look === 'button') return c.show.label;
  if (isRecordLook(c)) {
    const table = config.data.tables.find((x) => x.id === c.source.table);
    if (table) return table.name;
  }
  return componentLabel(c, config, { registry, locale, now: new Date() });
}

/** 点一下打开 App：组件所在的页面，或按钮指向的地方（由 app/widget/[componentId] 转过去）。 */
export const componentLink = (componentId: string) =>
  `morph://widget/${encodeURIComponent(componentId)}`;
const recordLink = (collectionId: string, recordId?: string) =>
  `morph://record/${encodeURIComponent(collectionId)}${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ''}`;

interface Ctx {
  config: WorkspaceConfig;
  locale: Locale;
  registry: Registry;
  cal: Calendar;
  now: Date;
  records: RecordsByTable;
  /** 收集小组件上能点的操作。 */
  ops: Record<string, WidgetOpRef>;
}

const lister = (records: RecordsByTable) => async (id: string) => [...(records.get(id) ?? [])];

async function statView(c: BlockOf<'number'>, ctx: Ctx): Promise<WidgetView | null> {
  const { config, locale, cal, now } = ctx;
  const source = c.source;
  // 和页面上的数字块同一份读法（core 的 readNumber）。
  const read = readNumber(source, { config, records: ctx.records, now, cal, locale });
  if (!read) return null;
  const field = source.field ? read.view.fields.find((f) => f.id === source.field) : undefined;
  const text = (v: number | null) =>
    statText(v, source.aggregate, field, locale, source.days?.unit);
  const goal = (v: number | null) => {
    const p = source.goal === undefined ? undefined : progressOf(v ?? 0, source.goal);
    return (
      p && {
        ratio: p.ratio,
        label: t(locale, 'progressOfGoal', { value: text(v), goal: text(p.goal) }),
      }
    );
  };
  const base = { kind: 'stat' as const, title: c.show.label, link: componentLink(c.id) };
  if (read.groups) {
    return {
      ...base,
      value: '',
      rows: read.groups.map((g) => {
        const p = goal(g.value);
        return {
          id: g.optionId ?? '-',
          title: g.label,
          trailing: p?.label ?? text(g.value),
          ...(p ? { ratio: p.ratio } : {}),
        };
      }),
    };
  }
  const p = goal(read.value);
  let note: string | undefined;
  if (read.best !== undefined) note = t(locale, 'seqBest', { value: text(read.best) });
  else if (read.previous) {
    const change = changeLabel(compareChange(read.value, read.previous.value), locale);
    note = [previousLabel(read.previous.period, text(read.previous.value), locale), change]
      .filter(Boolean)
      .join(' · ');
  }
  return {
    ...base,
    value: p ? p.label : text(read.value),
    ...(p
      ? { ratio: p.ratio, percent: t(locale, 'progressPercent', { n: Math.round(p.ratio * 100) }) }
      : {}),
    ...(note ? { note } : {}),
  };
}

function buttonView(c: BlockOf<'button'>, ctx: Ctx): WidgetView {
  const icon = c.show.icon ? iosSymbolName(c.show.icon) : undefined;
  const base = { kind: 'button' as const, title: c.show.label, ...(icon ? { icon } : {}) };
  const action = widgetButtonAction(c);
  if (action) {
    const key = buttonOpKey(c.id);
    ctx.ops[key] = { component: c.id, hash: actionHash(action) };
    return { ...base, op: key };
  }
  // 打开表单（预设值在 App 里填，Q6）、筛出来一起改（要先确认）、打开页面：在 App 里做。
  return { ...base, link: componentLink(c.id) };
}

async function listView(c: RecordBlock, ctx: Ctx): Promise<WidgetView | null> {
  const { config, locale, cal, now } = ctx;
  const { source, show } = c;
  const table = config.data.tables.find((x) => x.id === source.table);
  if (!table) return null;
  const { view, records } = await loadComputedRecords(
    lister(ctx.records),
    config.data.tables,
    table,
    now,
    cal,
  );
  const targets = linkedCollectionIds(view);
  const links = targets.length
    ? await loadLinkResolver(lister(ctx.records), config.data.tables, targets, locale)
    : undefined;
  const tiles = c.look === 'tiles';
  const sorted = sortRecords(
    filterRecords(records, view, source.filter, now, cal),
    view,
    source.sort,
    now,
    cal,
  );
  const shown = sorted.slice(0, Math.min(source.limit, tiles ? WIDGET_TILES : MAX_ROWS));
  const format = show.format;
  const trailingField = view.fields.find((f) => f.id === show.trailing);
  const rows = shown.map((r): WidgetRow => {
    const title = formatRef(r, view, show.title, locale, links, now, cal) || '—';
    const progress =
      format?.kind === 'progress' && show.trailing
        ? recordProgress(r, view, show.trailing, format.goal, now, cal)
        : undefined;
    const trailing = progress
      ? t(locale, 'progressOfGoal', {
          value: amountText(progress.value, trailingField, locale),
          goal: amountText(progress.goal, trailingField, locale),
        })
      : show.trailing
        ? formatRef(r, view, show.trailing, locale, links, now, cal)
        : '';
    const row: WidgetRow = { id: r.id, title, ...(trailing ? { trailing } : {}) };
    if (!tiles) return { ...row, link: recordLink(table.id, r.id) };
    const action = widgetRowAction(shownRowAction(c.tools, r, view, now, cal));
    const extra = progress ? { ratio: progress.ratio, full: progress.ratio >= 1 } : {};
    if (!action) return { ...row, ...extra, link: recordLink(table.id, r.id) };
    const key = rowOpKey(c.id, r.id);
    ctx.ops[key] = { component: c.id, record: r.id, hash: actionHash(action) };
    return { ...row, ...extra, op: key };
  });
  return {
    kind: 'list',
    title: widgetName(c, config, ctx.registry, locale),
    display: tiles ? 'tiles' : 'list',
    rows,
    empty: show.emptyText ?? t(locale, 'noRecords'),
    link: componentLink(c.id),
  };
}

async function viewOf(c: Component | undefined, ctx: Ctx, name: string): Promise<WidgetView> {
  const gone: WidgetView = { kind: 'message', title: name, note: t(ctx.locale, 'widgetGone') };
  if (!c) return gone;
  if (!widgetSupported(c) || onRecordPage(c, ctx.config))
    return {
      kind: 'message',
      title: name,
      note: t(ctx.locale, 'widgetUnsupported'),
      link: componentLink(c.id),
    };
  const view = !isKnownComponent(c)
    ? null
    : c.look === 'number'
      ? await statView(c, ctx)
      : c.look === 'button'
        ? buttonView(c, ctx)
        : isRecordLook(c)
          ? await listView(c, ctx)
          : null;
  return view ?? gone;
}

async function viewsAt(
  placed: readonly PlacedWidget[],
  names: Map<string, string>,
  ctx: Ctx,
): Promise<WidgetViews> {
  const views: WidgetViews = {};
  for (const p of placed) {
    views[p.componentId] = await viewOf(
      findComponent(ctx.config, p.componentId),
      ctx,
      names.get(p.componentId) ?? p.componentId,
    );
  }
  return views;
}

const startOfDay = (d: Date, plusDays = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays);

/** 一段时间（从 from 开始算）的画面和每个操作连点以后的画面。 */
async function stateFor(
  from: Date,
  until: Date,
  at: Date,
  placed: readonly PlacedWidget[],
  names: Map<string, string>,
  base: Omit<Ctx, 'now' | 'records' | 'ops'>,
  records: RecordsByTable,
  ops: Record<string, WidgetOpRef>,
): Promise<WidgetState> {
  const here: Record<string, WidgetOpRef> = {};
  const views = await viewsAt(placed, names, { ...base, now: at, records, ops: here });
  Object.assign(ops, here);
  const after: Record<string, WidgetViews[]> = {};
  for (const [key, ref] of Object.entries(here)) {
    const list: WidgetViews[] = [];
    let current = records;
    for (let k = 1; k <= REPEATS; k++) {
      const time = new Date(at.getTime() + k);
      const write = planWidgetOp(base.config, ref, current, time, base.cal);
      if (!write) break;
      current = applyInMemory(current, write, time, `widget-preview-${k}`);
      const next = await viewsAt(placed, names, { ...base, now: time, records: current, ops: {} });
      // 点过的按钮下面写「已记下」。
      for (const v of Object.values(next))
        if (v.kind === 'button' && v.op === key) v.note = t(base.locale, 'widgetAdded');
      list.push(next);
    }
    if (list.length) after[key] = list;
  }
  return { from: from.getTime(), until: until.getTime(), views, after };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
// 小组件的底色跟系统的深浅色走（App 的风格可能固定浅色），所以两份都按风格的颜色直接算。
function paletteOf(theme: Theme, dark: boolean): WidgetPalette {
  const p = resolveColors(theme, dark);
  const hex = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);
  return {
    primary: hex(p.primary, '#C2603A'),
    tint: hex(p.primaryTint, dark ? '#3A2A22' : '#F6E3D9'),
    onPrimary: hex(p.onPrimary, '#FFFFFF'),
  };
}

export interface SnapshotInput {
  config: WorkspaceConfig;
  placed: readonly PlacedWidget[];
  locale: Locale;
  registry: Registry;
  now: Date;
  /** 所有表存着的记录。 */
  records: RecordsByTable;
}

/** 整份画面：今天一份、明天一份（D-322）。没有放到桌面的组件时 items 为空，小组件显示怎么放。 */
export async function buildWidgetSnapshot(input: SnapshotInput): Promise<WidgetSnapshot> {
  const { config, placed, locale, registry, now, records } = input;
  const cal = calendarOf(config);
  const base = { config, locale, registry, cal };
  const names = new Map<string, string>();
  for (const p of placed) {
    const c = findComponent(config, p.componentId);
    names.set(p.componentId, c ? widgetName(c, config, registry, locale) : p.componentId);
  }
  const ops: Record<string, WidgetOpRef> = {};
  const tomorrow = startOfDay(now, 1);
  const states = [
    await stateFor(startOfDay(now), tomorrow, now, placed, names, base, records, ops),
    await stateFor(tomorrow, startOfDay(now, 2), tomorrow, placed, names, base, records, ops),
  ];
  return {
    v: 1,
    strings: { stale: t(locale, 'widgetStale') },
    colors: { light: paletteOf(config.theme, false), dark: paletteOf(config.theme, true) },
    items: placed.map((p) => ({ id: p.componentId, name: names.get(p.componentId)! })),
    ops,
    states,
  };
}
