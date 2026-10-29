import {
  CHART_COLORS,
  calendarOf,
  chartDateField,
  contrast,
  currentMonth,
  dateOfDayNumber,
  dayTitle,
  filterRecords,
  heatLevel,
  mix,
  monthDays,
  monthTitle,
  monthWeeks,
  shiftMonth,
  sortRecords,
  todayNumber,
  weekdayLabels,
} from '@morph/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMonthRecords } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { useCollection, useRecordRows, type RecordListProps, type Tone } from './data';
import { UiIcon } from './Icon';
import { Card } from './ui';

// 记录列表的月历外观（D-305）：一个月的格子，每天按记录条数分深浅，或者按一个单选字段上色（这一天最后一条的
// 选项）；左右翻月，点某一天在下面列出当天的记录（和普通列表一样的行，点记录打开编辑页）。
// 只读这个月的记录（useMonthRecords）。格子至少 44 高、日期 16 号字；今天加粗并在数字下面画一道主色的线，
// 选中的那天有一圈文字色的框，深色模式下颜色从同一套分类色的深色版里取。

/** 深浅四档：表面色往主色混多少。 */
const HEAT = [0, 0.2, 0.4, 0.65, 0.9];

/** 填色上的文字：黑白里对比度高的那个。 */
const readable = (fill: string) =>
  contrast(fill, '#FFFFFF') >= contrast(fill, '#111111') ? '#FFFFFF' : '#111111';

export function MonthCalendar({
  props,
  env,
  tone,
  componentId,
}: {
  props: RecordListProps;
  env: RenderEnv;
  tone?: Tone;
  componentId: string;
}) {
  const { palette, locale } = env;
  const collection = useCollection(env, props.collectionId);
  const cal = calendarOf(env.config);
  const now = new Date();
  const thisMonth = currentMonth(now, cal);
  const today = todayNumber(now, cal);
  const [month, setMonth] = useState(thisMonth);
  const [picked, setPicked] = useState<number | null>(today);
  const dateRef = collection ? chartDateField(collection, props) : 'createdAt';
  const { view, records } = useMonthRecords(
    env.config.collections,
    collection,
    dateRef,
    month,
    cal,
  );
  const rows = useRecordRows(props, env, tone, collection, view);
  if (!collection || !view || !rows) return null;

  const matched = filterRecords(records ?? [], view, props.filter, now, cal);
  const { days, max } = monthDays(
    matched,
    view,
    { dateField: dateRef, colorField: props.colorField },
    month,
    now,
    cal,
  );
  const color = props.colorField ? view.fields.find((f) => f.id === props.colorField) : undefined;
  const options = color?.type === 'choice' ? color.options : [];
  const scheme = palette.dark ? CHART_COLORS.dark : CHART_COLORS.light;
  const other = palette.dark ? CHART_COLORS.other.dark : CHART_COLORS.other.light;
  // 选项按顺序用分类色（和饼图一样，第 8 个起和「未选」一起用中性灰）。
  const optionColor = (id: string | null) => {
    const i = id === null ? -1 : options.findIndex((o) => o.id === id);
    return i >= 0 && i < scheme.length ? scheme[i]! : other;
  };
  const fillOf = (count: number, optionId: string | null) => {
    if (count === 0) return undefined;
    if (color) return optionColor(optionId);
    return mix(palette.surface, palette.primary, HEAT[heatLevel(count, max)]!);
  };
  const inMonth = (d: number) => dateOfDayNumber(d).slice(0, 7) === month;
  const selected = picked !== null && inMonth(picked) ? picked : null;
  const go = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setPicked(next === thisMonth ? today : null);
  };
  const background = rows.background;
  const navButton = (
    id: string,
    icon: 'chevronLeft' | 'chevronRight',
    label: string,
    d: number,
  ) => (
    <Pressable
      testID={`calendar-${componentId}-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => go(d)}
      onLongPress={env.onLongPress}
      hitSlop={6}
      style={[styles.nav, { borderColor: palette.border }]}>
      <UiIcon name={icon} size={20} color={palette.text} />
    </Pressable>
  );
  const usedNone = [...days.values()].some((d) => d.optionId === null);
  const dayRecords = selected === null ? [] : (days.get(selected)?.records ?? []);
  const shown = (
    props.sort ? sortRecords(dayRecords, view, props.sort, now, cal) : dayRecords
  ).slice(0, props.limit);

  return (
    <View style={{ gap: palette.gap - 4 }}>
      <Card palette={palette} background={background} style={styles.card}>
        <View style={styles.header}>
          {navButton('prev', 'chevronLeft', t(locale, 'calendarPrevMonth'), -1)}
          <Text
            accessibilityRole="header"
            style={[styles.title, palette.font('title', 17), { color: palette.text }]}>
            {monthTitle(month, locale)}
          </Text>
          {month !== thisMonth ? (
            <Pressable
              testID={`calendar-${componentId}-today`}
              accessibilityRole="button"
              onPress={() => {
                setMonth(thisMonth);
                setPicked(today);
              }}
              hitSlop={6}
              style={[styles.todayButton, { borderColor: palette.border }]}>
              <Text style={[palette.font('bodyBold', 13), { color: palette.primaryText }]}>
                {t(locale, 'calendarToday')}
              </Text>
            </Pressable>
          ) : null}
          {navButton('next', 'chevronRight', t(locale, 'calendarNextMonth'), 1)}
        </View>
        <View style={styles.week}>
          {weekdayLabels(cal, locale).map((w, i) => (
            <Text
              key={i}
              style={[styles.weekday, palette.font('bodyBold', 12), { color: palette.muted }]}>
              {w}
            </Text>
          ))}
        </View>
        {monthWeeks(month, cal).map((week) => (
          <View key={week[0]} style={styles.week}>
            {week.map((d) => {
              if (!inMonth(d)) return <View key={d} style={styles.cell} />;
              const info = days.get(d);
              const count = info?.count ?? 0;
              const fill = fillOf(count, info?.optionId ?? null);
              const isToday = d === today;
              const isPicked = d === selected;
              const text = fill ? readable(fill) : palette.text;
              const date = dateOfDayNumber(d);
              const optionLabel =
                color && info
                  ? (options.find((o) => o.id === info.optionId)?.label ??
                    t(locale, 'statNoChoice'))
                  : undefined;
              return (
                <Pressable
                  key={d}
                  testID={`calendar-${componentId}-day-${date}`}
                  accessibilityRole="button"
                  accessibilityLabel={t(locale, 'calendarDayLabel', {
                    date: dayTitle(d, locale),
                    n: count,
                  })}
                  accessibilityHint={optionLabel}
                  accessibilityState={{ selected: isPicked }}
                  onPress={env.interactive ? () => setPicked(d) : undefined}
                  onLongPress={env.onLongPress}
                  style={[
                    styles.cell,
                    styles.day,
                    {
                      backgroundColor: fill ?? 'transparent',
                      borderColor: isPicked ? palette.text : 'transparent',
                      borderRadius: Math.min(palette.controlRadius, 12),
                    },
                  ]}>
                  <Text style={[palette.font(isToday ? 'bodyBold' : 'body', 16), { color: text }]}>
                    {Number(date.slice(8))}
                  </Text>
                  {isToday ? (
                    <View
                      style={[styles.todayMark, { backgroundColor: fill ? text : palette.primary }]}
                    />
                  ) : null}
                  {color && count > 1 ? (
                    <Text style={[styles.count, palette.font('bodyBold', 10), { color: text }]}>
                      {count}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        {color ? (
          <View style={styles.legend}>
            {[
              ...options.map((o) => ({ id: o.id as string | null, label: o.label })),
              ...(usedNone ? [{ id: null, label: t(locale, 'statNoChoice') }] : []),
            ].map((o) => (
              <View key={o.id ?? '-'} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: optionColor(o.id) }]} />
                <Text style={[palette.font('body', 13), { color: palette.text }]}>{o.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
      {selected !== null && records !== null ? (
        <>
          <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>
            {dayTitle(selected, locale)}
          </Text>
          {shown.length > 0 ? (
            rows.list(shown)
          ) : (
            <Card palette={palette} background={background}>
              <Text style={[palette.font('body', 14), { color: palette.caption }]}>
                {props.emptyText ?? t(locale, 'calendarDayEmpty')}
              </Text>
            </Card>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { flex: 1, textAlign: 'center' },
  nav: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
  },
  week: { flexDirection: 'row', gap: 4 },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 4 },
  cell: { flex: 1, minHeight: 44, aspectRatio: 1 },
  day: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  todayMark: { width: 14, height: 3, borderRadius: 2, marginTop: 2 },
  count: { position: 'absolute', top: 3, right: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
