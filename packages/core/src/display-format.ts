import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { fieldOf, recordValue, type DataRecord } from './data';
import { formatDuration } from './field-values';
import type { Collection } from './schema';

// 记录列表右侧字段的显示格式（D-303，recordList 的 trailingFormat）：
// - elapsed：从一个日期时间（或创建时间）到现在，或到另一个日期时间字段。没有结束时间的就是正在走的计时器。
// - progress：一个数值和目标（固定数或这条记录的另一个字段）的比例，画成环或条。
// 只是显示方式，不存值、不进导出；纯逻辑在这里，App 负责每秒刷新和画环。

const pad = (n: number) => String(n).padStart(2, '0');

/** 日期时间（本地，YYYY-MM-DDTHH:mm）或创建 / 修改时间 → 毫秒。 */
function instantOf(record: DataRecord, collection: Collection, ref: string): number | undefined {
  if (ref === 'createdAt' || ref === 'updatedAt') return record[ref];
  const field = fieldOf(collection, ref);
  if (field?.type !== 'datetime') return undefined;
  const v = recordValue(record, collection, ref);
  if (typeof v !== 'string') return undefined;
  const [y, m, d] = v.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [h, mi] = v.slice(11, 16).split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, mi).getTime();
}

export interface Elapsed {
  seconds: number;
  /** 没有结束时间：正在走，App 每秒刷新。 */
  running: boolean;
}

/** 从 from 到 until（没有值时到 now）过了多久；没有开始时间时没有。早于开始的算 0。 */
export function elapsedOf(
  record: DataRecord,
  collection: Collection,
  from: string,
  until: string | undefined,
  now: Date,
): Elapsed | undefined {
  const start = instantOf(record, collection, from);
  if (start === undefined) return undefined;
  const end = until === undefined ? undefined : instantOf(record, collection, until);
  const running = end === undefined;
  const seconds = Math.max(0, Math.floor(((end ?? now.getTime()) - start) / 1000));
  return { seconds, running };
}

/** 正在走的写成 h:mm:ss（2:15:30），结束了的和时长字段一样写 h:mm（8:30）。 */
export function formatElapsed(e: Elapsed): string {
  if (!e.running) return formatDuration(Math.floor(e.seconds / 60));
  const h = Math.floor(e.seconds / 3600);
  return `${h}:${pad(Math.floor((e.seconds % 3600) / 60))}:${pad(e.seconds % 60)}`;
}

export interface Progress {
  value: number;
  goal: number;
  /** 画环、画条用的比例，0–1（超过目标也是 1）。 */
  ratio: number;
  done: boolean;
}

/** 值和目标；没有值或目标不是正数时没有。 */
export function progressOf(value: number | null | undefined, goal: number | null | undefined) {
  if (typeof value !== 'number' || typeof goal !== 'number' || !(goal > 0)) return undefined;
  const ratio = Math.min(1, Math.max(0, value / goal));
  return { value, goal, ratio: Math.round(ratio * 10_000) / 10_000, done: value >= goal };
}

/** 一条记录上的进度：goal 是固定数，或这条记录上一个数字类字段（汇总、公式也行）。 */
export function recordProgress(
  record: DataRecord,
  collection: Collection,
  fieldId: string,
  goal: number | string,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): Progress | undefined {
  const value = recordValue(record, collection, fieldId, now, cal);
  const target = typeof goal === 'number' ? goal : recordValue(record, collection, goal, now, cal);
  return progressOf(
    typeof value === 'number' ? value : null,
    typeof target === 'number' ? target : null,
  );
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** 进度环的弧（从 12 点钟方向顺时针，SVG 路径字符串，Skia 的 Path 直接认）；满了是整圆，0 是空。 */
export function ringPath(cx: number, cy: number, r: number, ratio: number): string {
  if (!(ratio > 0)) return '';
  const top = `M${num(cx)} ${num(cy - r)}`;
  if (ratio >= 1)
    return `${top} A${num(r)} ${num(r)} 0 1 1 ${num(cx)} ${num(cy + r)} A${num(r)} ${num(r)} 0 1 1 ${num(cx)} ${num(cy - r)}`;
  const angle = -Math.PI / 2 + ratio * Math.PI * 2;
  const large = ratio > 0.5 ? 1 : 0;
  return `${top} A${num(r)} ${num(r)} 0 ${large} 1 ${num(cx + r * Math.cos(angle))} ${num(cy + r * Math.sin(angle))}`;
}
