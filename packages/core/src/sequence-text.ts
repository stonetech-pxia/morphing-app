import { t } from './messages';
import {
  SEQUENCE_AGGREGATES,
  type Locale,
  type SequenceAggregate,
  type StreakUnit,
} from './schema-primitives';

// 按顺序的聚合（D-284）显示成什么字：统计和汇总字段（D-288）共用。不依赖记录的读法，字段定义也能直接用。

export const isSequenceAggregate = (a: string): a is SequenceAggregate =>
  (SEQUENCE_AGGREGATES as readonly string[]).includes(a);

/** 统计里显示的文字（带单位，单复数按 isSingular）；没有值时是「—」。 */
export function sequenceText(
  aggregate: SequenceAggregate,
  unit: StreakUnit | undefined,
  value: number | null,
  locale: Locale,
): string {
  if (value === null) return '—';
  switch (aggregate) {
    case 'streak':
      return t(locale, unit === 'week' ? 'seqWeeks' : unit === 'month' ? 'seqMonths' : 'seqDays', {
        n: value,
      });
    case 'daysSince':
      return value === 0 ? t(locale, 'seqToday') : t(locale, 'seqDaysAgo', { n: value });
    case 'avgInterval':
      return t(locale, 'seqAvgDays', { n: value });
    case 'distinctDays':
      return t(locale, 'seqDays', { n: value });
  }
}
