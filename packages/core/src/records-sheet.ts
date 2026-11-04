import {
  formatTimestamp,
  formatValue,
  recordValue,
  type DataRecord,
  type LinkResolver,
} from './data';
import { fieldDefinition, type Collection, type Field, type Locale } from './schema';
import { t } from './messages';

// 记录 → 表格的格子（D-427，records.toExcel）：列和 CSV 一样（字段 + 创建时间）。写 xlsx 在 tool-office。

export type SheetValue =
  | { kind: 'text'; text: string }
  /** 真的数字或日期（Excel 的日期就是带日期格式的数字）；text 是估列宽和行高用的。 */
  | { kind: 'number'; value: number; format: string; text: string };

const MONEY_FORMAT = '#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd';
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm';

/** 1900-03-01 之前 Excel 的序号和真实日期差一天，这种日期写成文字。 */
const FIRST_SERIAL_DAY = Date.UTC(1900, 2, 1);
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** 日期的各部分 → Excel 的序号；不是真的日期（2 月 31 日）时 null。 */
function serial(y: number, mo: number, d: number, h = 0, mi = 0): number | null {
  const day = Date.UTC(y, mo - 1, d);
  const check = new Date(day);
  if (y < 1000 || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || day < FIRST_SERIAL_DAY) return null;
  return (day - EXCEL_EPOCH) / DAY_MS + (h * 60 + mi) / 1440;
}

function dateCell(raw: unknown, text: string): SheetValue {
  const m =
    typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw) : null;
  if (!m) return { kind: 'text', text };
  const timed = m[4] !== undefined;
  const value = serial(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0));
  return value === null
    ? { kind: 'text', text }
    : { kind: 'number', value, format: timed ? DATE_TIME_FORMAT : DATE_FORMAT, text };
}

/** 时长显示成「1 小时 30 分」：一个裸数字（分钟）反而看不懂，留成文字。 */
const isPlainNumber = (f: Field) =>
  fieldDefinition(f.type).numeric === true && f.type !== 'duration';

function cellOf(
  f: Field,
  record: DataRecord,
  collection: Collection,
  locale: Locale,
  links?: LinkResolver,
): SheetValue {
  const v = recordValue(record, collection, f.id);
  if (v === undefined) return { kind: 'text', text: '' };
  const csv = fieldDefinition(f.type).csv;
  const text = csv ? csv(f, v) : formatValue(f, v, locale, links);
  if (isPlainNumber(f) && typeof v === 'number' && Number.isFinite(v))
    return {
      kind: 'number',
      value: v,
      format: f.type === 'money' ? MONEY_FORMAT : 'General',
      text,
    };
  if (f.type === 'date' || f.type === 'datetime') return dateCell(v, text);
  return { kind: 'text', text };
}

/** 第一行是字段名，后面每条记录一行。 */
export function recordsToSheet(
  collection: Collection,
  records: readonly DataRecord[],
  locale: Locale,
  links?: LinkResolver,
): SheetValue[][] {
  const head = (text: string): SheetValue => ({ kind: 'text', text });
  // 金额格子只有数字：货币写在表头。每笔自己选货币时（D-429）货币本来就是一列。
  const header = [
    ...collection.fields.map((f) =>
      head(f.type === 'money' && !f.currencyField ? `${f.name} (${f.currency})` : f.name),
    ),
    head(t(locale, 'data_Created_1626a')),
  ];
  const rows = records.map((r) => {
    const at = new Date(r.createdAt);
    const value = serial(
      at.getFullYear(),
      at.getMonth() + 1,
      at.getDate(),
      at.getHours(),
      at.getMinutes(),
    );
    const text = formatTimestamp(r.createdAt, locale);
    const created: SheetValue =
      value === null
        ? { kind: 'text', text }
        : { kind: 'number', value, format: DATE_TIME_FORMAT, text };
    return [...collection.fields.map((f) => cellOf(f, r, collection, locale, links)), created];
  });
  return [header, ...rows];
}
