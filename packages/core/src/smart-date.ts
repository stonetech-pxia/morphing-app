import { DEFAULT_CALENDAR, dateOfDayNumber, type Calendar } from './calendar';
import { findDatePhrase, type DatePhrase, type DatePhraseValue } from './date-phrases';
import { dayNumber } from './formula';
import { scheduleText, shortDate, type ScheduleRule } from './schedule';
import { t } from './messages';
import type { Field, Locale } from './schema';

// 快速添加表单的 smartDate（D-334）：在本机认出文字里说的日期，换成要填的那个字段（日期、日期时间、日程）
// 的表单输入。不经过 AI（D-113）。认出来但这种字段填不了的（日期字段遇到「每周一」）当作没认出来。
// 日程字段连钟点一起填（D-336）。

export interface SmartDate {
  phrase: DatePhrase;
  /** 表单输入，交给 prepareRecordValues。 */
  input: unknown;
  /** 给用户看的：会填成什么（明天、11月5日 15:00、每周一）。 */
  preview: string;
}

function inputFor(value: DatePhraseValue, field: Field, today: number): unknown {
  const date = value.kind === 'time' ? dateOfDayNumber(today) : 'date' in value ? value.date : '';
  switch (field.type) {
    case 'date':
      return value.kind === 'date' ? value.date : undefined;
    case 'datetime':
      // 日期时间要有钟点：只说了日期时不填（用户自己选钟点）。
      return value.kind !== 'repeat' && value.time ? `${date} ${value.time}` : undefined;
    case 'schedule': {
      // 钟点也带上（D-336）：「周五下午3点」→ 一次，周五 15:00；只说了钟点是今天。
      const at = value.time ? { time: value.time } : {};
      if (value.kind === 'repeat') return { ...value.rule, ...at };
      return { repeat: 'once', date, ...at };
    }
    default:
      return undefined;
  }
}

function previewOf(input: unknown, field: Field, today: number, locale: Locale): string {
  if (field.type === 'schedule') {
    const rule = input as ScheduleRule;
    if (rule.repeat !== 'once') return scheduleText(rule, locale);
    const day = shortDate(dayNumber(rule.date!)!, today, locale);
    return rule.time ? t(locale, 'scheduleAtTime', { rule: day, time: rule.time }) : day;
  }
  const text = String(input);
  const day = shortDate(dayNumber(text.slice(0, 10))!, today, locale);
  return text.length > 10 ? `${day} ${text.slice(11)}` : day;
}

/** 文字里能填进这个字段的日期说法；没有、或者填不了时 undefined。 */
export function smartDateOf(
  text: string,
  field: Field,
  today: number,
  locale: Locale,
  cal: Calendar = DEFAULT_CALENDAR,
): SmartDate | undefined {
  const phrase = findDatePhrase(text, today, cal);
  if (!phrase) return undefined;
  const input = inputFor(phrase.value, field, today);
  if (input === undefined) return undefined;
  return { phrase, input, preview: previewOf(input, field, today, locale) };
}
