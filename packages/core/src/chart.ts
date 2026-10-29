import {
  DEFAULT_CALENDAR,
  dateOfDayNumber,
  todayNumber,
  weekStartOf,
  type Calendar,
} from './calendar';
import { aggregateRecords, fieldOf, localDate, recordValue, type DataRecord } from './data';
import type { Collection } from './schema';
import { distinctDays } from './sequence';

// 图表组件（D-249）：一张表的记录按时间段（日 / 周 / 月）或单选字段分组聚合。
// 这里是纯逻辑：分组、数值和画图用的几何（SVG 路径字符串，Skia 的 Path 直接认），App 只负责画。

export const CHART_KINDS = ['bar', 'line', 'pie'] as const;
export const CHART_GROUPS = ['day', 'week', 'month', 'choice'] as const;
export type ChartGroup = (typeof CHART_GROUPS)[number];

/** 不写 periods 时显示最近几段：7 天、8 周、6 个月。 */
export const DEFAULT_PERIODS: Record<Exclude<ChartGroup, 'choice'>, number> = {
  day: 7,
  week: 8,
  month: 6,
};
export const MAX_PERIODS = 31;

/**
 * 饼图的分类色（按固定顺序用，不循环）：dataviz 参考调色板的 8 个色相，相邻两色在色盲模拟下也分得开；
 * 浅色、深色界面各一套。超过 7 类时第 8 块是「其他」，用中性灰。
 */
export const CHART_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
  other: { light: '#8a8a85', dark: '#9a9a94' },
} as const;
export const MAX_PIE_SLICES = 8;

export interface ChartPoint {
  /** 时间段的开始日期（YYYY-MM-DD）或选项 ID；「其他」和「未选」是 null。 */
  key: string | null;
  label: string;
  value: number;
  /** 这一段有没有可统计的数（平均值没有数时 value 是 0，但显示「—」）。 */
  empty: boolean;
}

export interface ChartSpec {
  /** distinctDays：这一段里有记录的天数（D-284）。 */
  aggregate: 'count' | 'sum' | 'avg' | 'distinctDays';
  fieldId?: string | undefined;
  group: ChartGroup;
  /** 按时间分组时用哪个日期（日期字段或 createdAt / updatedAt）；不写时用表里第一个日期字段，没有就用创建时间。 */
  dateField?: string | undefined;
  /** 按单选字段分组时的字段。 */
  choiceField?: string | undefined;
  periods?: number | undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 时间分组用的日期字段（统计按日子算时也用，D-284）。 */
export function chartDateField(
  collection: Collection,
  spec: { dateField?: string | undefined },
): string {
  return spec.dateField ?? collection.fields.find((f) => f.type === 'date')?.id ?? 'createdAt';
}

/**
 * 最近 n 段的开始日期（从早到晚，最后一段包含今天）。今天和一周的第一天按 cal（D-286），和数据筛选一样。
 */
function periodStarts(
  group: Exclude<ChartGroup, 'choice'>,
  n: number,
  now: Date,
  cal: Calendar,
): Date[] {
  const todayNum = todayNumber(now, cal);
  const [y, m, d] = dateOfDayNumber(todayNum).split('-').map(Number) as [number, number, number];
  const weekStart = d - (todayNum - weekStartOf(todayNum, cal));
  const starts: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    if (group === 'day') starts.push(new Date(y, m - 1, d - i));
    else if (group === 'week') starts.push(new Date(y, m - 1, weekStart - 7 * i));
    else starts.push(new Date(y, m - 1 - i, 1));
  }
  return starts;
}

const periodLabel = (group: ChartGroup, d: Date) =>
  group === 'month'
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 图表的数据。时间分组：最近 periods 段，每段一个点（没有记录的段是 0）。
 * 单选分组：每个选项一个点（按选项顺序），没选的记录有的话另算一个点（label 用 noChoice）。
 */
export function chartSeries(
  records: readonly DataRecord[],
  collection: Collection,
  spec: ChartSpec,
  now: Date,
  noChoice: string,
  cal: Calendar = DEFAULT_CALENDAR,
): ChartPoint[] {
  const dateRef = chartDateField(collection, spec);
  const point = (key: string | null, label: string, list: DataRecord[]): ChartPoint => {
    const value =
      spec.aggregate === 'distinctDays'
        ? distinctDays(list, collection, { dateField: dateRef, now, cal })
        : aggregateRecords(list, collection, spec.aggregate, spec.fieldId);
    return { key, label, value: value ?? 0, empty: value === null };
  };
  if (spec.group === 'choice') {
    const field = spec.choiceField ? fieldOf(collection, spec.choiceField) : undefined;
    if (field?.type !== 'choice') return [];
    const buckets = new Map<string | null, DataRecord[]>(field.options.map((o) => [o.id, []]));
    for (const r of records) {
      const v = recordValue(r, collection, field.id, now, cal);
      const key = typeof v === 'string' && buckets.has(v) ? v : null;
      buckets.set(key, [...(buckets.get(key) ?? []), r]);
    }
    return [...buckets.entries()].flatMap(([key, list]) =>
      key === null && list.length === 0
        ? []
        : [
            point(
              key,
              key === null ? noChoice : field.options.find((o) => o.id === key)!.label,
              list,
            ),
          ],
    );
  }
  const n = Math.min(MAX_PERIODS, spec.periods ?? DEFAULT_PERIODS[spec.group]);
  const starts = periodStarts(spec.group, n, now, cal).map(localDate);
  const end = dateOfDayNumber(todayNumber(now, cal));
  const buckets = starts.map(() => [] as DataRecord[]);
  for (const r of records) {
    const v = recordValue(r, collection, dateRef, now, cal);
    if (typeof v !== 'string' || v < starts[0]! || v > end) continue;
    // 落在最后一个开始日期不晚于它的那一段。
    let i = starts.length - 1;
    while (i > 0 && starts[i]! > v) i--;
    buckets[i]!.push(r);
  }
  return starts.map((start, i) => {
    const [y, m, d] = start.split('-').map(Number) as [number, number, number];
    return point(start, periodLabel(spec.group, new Date(y, m - 1, d)), buckets[i]!);
  });
}

/** 饼图：只要正数；超过 MAX_PIE_SLICES 块时最小的几块合成「其他」（other）。 */
export function pieSlices(points: readonly ChartPoint[], other: string): ChartPoint[] {
  const positive = points.filter((p) => p.value > 0);
  if (positive.length <= MAX_PIE_SLICES) return positive;
  const keep = [...positive].sort((a, b) => b.value - a.value).slice(0, MAX_PIE_SLICES - 1);
  const kept = positive.filter((p) => keep.includes(p));
  const rest = positive.filter((p) => !keep.includes(p)).reduce((s, p) => s + p.value, 0);
  return [...kept, { key: null, label: other, value: rest, empty: false }];
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** 折线：值映射到 width × height 的框里（0 在底边，最大值在顶边留 pad）。只有一个点时是一个点。 */
export function linePath(
  values: readonly number[],
  width: number,
  height: number,
  padding = 6,
): string {
  if (values.length === 0) return '';
  const { x, y } = lineScale(values, width, height, padding);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${num(x(i))} ${num(y(v))}`).join(' ');
}

/** 折线和柱子共用的比例尺：最小值不高于 0（有负数时 0 线往上移）。 */
export function lineScale(values: readonly number[], width: number, height: number, padding = 6) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - 2 * padding) / (values.length - 1) : 0;
  return {
    x: (i: number) => (values.length > 1 ? padding + i * step : width / 2),
    y: (v: number) => padding + (1 - (v - min) / span) * (height - 2 * padding),
    zero: padding + (1 - (0 - min) / span) * (height - 2 * padding),
  };
}

/**
 * 饼图每一块的路径（圆心 cx, cy，半径 r，从 12 点钟方向顺时针）。只有一块时是整个圆。
 * 块与块之间的白缝由 App 用表面色描边画出来。
 */
export function piePaths(values: readonly number[], cx: number, cy: number, r: number): string[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => '');
  const nonZero = values.filter((v) => v > 0).length;
  let angle = -Math.PI / 2;
  return values.map((v) => {
    if (v <= 0) return '';
    if (nonZero === 1)
      return `M${num(cx - r)} ${num(cy)} A${num(r)} ${num(r)} 0 1 1 ${num(cx + r)} ${num(cy)} A${num(r)} ${num(r)} 0 1 1 ${num(cx - r)} ${num(cy)} Z`;
    const sweep = (v / total) * Math.PI * 2;
    const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    angle += sweep;
    const [x2, y2] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const large = sweep > Math.PI ? 1 : 0;
    return `M${num(cx)} ${num(cy)} L${num(x1)} ${num(y1)} A${num(r)} ${num(r)} 0 ${large} 1 ${num(x2)} ${num(y2)} Z`;
  });
}
