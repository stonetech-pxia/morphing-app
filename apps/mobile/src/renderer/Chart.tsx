import {
  CHART_COLORS,
  calendarOf,
  chartSeries,
  choiceRange,
  dateFieldOf,
  filterRecords,
  lineScale,
  piePaths,
  pieSlices,
  previousFullRange,
  recordsInRange,
  todayText,
  type ChartPoint,
  type BlockOf,
  type ComponentStyle,
} from '@morph/core';
import { Canvas, Path } from '@shopify/react-native-skia';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useComputedRecords } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { ChartPlot, PLOT_HEIGHT } from './ChartPlot';
import { statText, useLinkedGroups } from './data';
import { cardColors } from './theme';
import { Card } from './ui';

// 图表组件（D-249）：分组和数值都在 core/chart.ts 算好，这里只画。点按和读屏靠一排透明的可点区域（每根柱子、每个点一格）。
// 柱状图（没有负数时）和折线用 Victory Native XL 画（ChartPlot.tsx，D-438），有负数的柱状图和饼图用 Skia 的 Path。
// 单一序列用主色、不画图例（标题就是它的名字）；饼图每块用固定顺序的分类色，图例总是列出名字和数值，
// 所以不只靠颜色区分。点一根柱子 / 一个点 / 一行图例，标题下面显示它的数值（代替悬停提示）。

export function Chart({
  block,
  env,
  tone,
}: {
  block: BlockOf<'chart'>;
  env: RenderEnv;
  tone?: ComponentStyle['tone'];
}) {
  const { palette, locale } = env;
  const { source, show } = block;
  const table = env.config.data.tables.find((c) => c.id === source.table);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）按算好的值画。
  const { view: collection, records } = useComputedRecords(env.config.data.tables, table, cal);
  // 按单选 / 引用字段分组（没有 unit）；引用字段（D-336）：被引用的表里每条记录一个点。
  const byChoice = source.group.unit === undefined;
  const linked = useLinkedGroups(env, collection, byChoice ? source.group.by : undefined);
  const [picked, setPicked] = useState<number | null>(null);
  if (!collection) return null;
  const now = new Date();
  const field = source.field ? collection.fields.find((f) => f.id === source.field) : undefined;
  // 页面上选的时间范围（D-440）：source.period 是 "page" 且页面有 period 块时，按选的范围画；
  // 筛选里的 inPeriod 不再用，时间分组的 group.unit 和 last 也不再用（按范围长短自己选）。
  const choice = source.period === 'page' ? env.pageRange?.choice : undefined;
  const matched = filterRecords(
    records ?? [],
    collection,
    choice ? (source.filter ?? []).filter((c) => c.op !== 'inPeriod') : source.filter,
    now,
    cal,
  );
  const timed = source.group.unit !== undefined;
  const range = choice ? choiceRange(choice, now, cal) : undefined;
  // 饼图（按单选分组）没有时间段，只留下范围里的记录；用哪个日期和数日子的统计一样。
  const dateRef = dateFieldOf(collection, timed ? source.group.by : source.days?.date);
  const inRange =
    range && !timed ? recordsInRange(matched, collection, dateRef, range, now, cal) : matched;
  const series = chartSeries(
    inRange,
    collection,
    source,
    now,
    t(locale, 'statNoChoice'),
    cal,
    linked ?? undefined,
    false,
    timed ? range : undefined,
  );
  const points = show.kind === 'pie' ? pieSlices(series, t(locale, 'chartOther')) : series;
  // 上一期（D-439）：只有时间分组、柱状图和折线图（配置检查保证），和最近几段一一对应。
  // 选了页面范围时（D-440）是紧挨在前面的一整段，段数不一样时（上个月比这个月短）按位置对齐、多的去掉、少的补 0。
  const previous =
    source.compare === 'previous' && timed && show.kind !== 'pie'
      ? (() => {
          const before = chartSeries(
            matched,
            collection,
            source,
            now,
            t(locale, 'statNoChoice'),
            cal,
            undefined,
            true,
            choice ? previousFullRange(choice, now, cal) : undefined,
          );
          return choice
            ? series.map((_, i) => before[i] ?? { key: null, label: '', value: 0, empty: false })
            : before;
        })()
      : null;
  const pointText = (p: ChartPoint, i: number) => {
    const before = previous?.[i];
    return before
      ? t(locale, 'chartPointCompare', {
          label: p.label,
          value: valueText(p),
          previous: valueText(before),
        })
      : t(locale, 'chartPoint', { label: p.label, value: valueText(p) });
  };
  const valueText = (p: ChartPoint) =>
    p.empty ? '—' : statText(p.value, source.aggregate, field, locale);
  const nothing = records !== null && linked !== null && points.every((p) => p.value === 0);
  // 默认显示最后一段（时间）或最大的一块（单选）。
  // 时间分组：今天所在的那一段（选了页面范围时，范围里还没到的日子在后面，不默认显示它们）。
  const today = todayText(now, cal);
  const nowIndex = points.reduce(
    (found, p, i) => (p.key !== null && p.key <= today ? i : found),
    points.length - 1,
  );
  const fallback = byChoice
    ? points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -Infinity) ? i : best), 0)
    : nowIndex;
  const selected = picked !== null && picked < points.length ? picked : fallback;
  const current = points[selected];

  const header = (
    <View style={styles.header}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>{show.title}</Text>
      {current && !nothing && show.kind !== 'pie' ? (
        <Text
          testID={`chart-readout-${source.table}`}
          style={[palette.font('body', 13), { color: palette.muted }]}>
          {pointText(current, selected)}
        </Text>
      ) : null}
    </View>
  );

  // 每个点一格可以点的区域（盖在图上，比柱子和点本身大）：读屏、点一下看数值都靠它。
  const slots = (prefix: 'bar' | 'point') => (
    <View style={[StyleSheet.absoluteFill, styles.bars]}>
      {points.map((p, i) => (
        <Pressable
          key={p.key ?? `none-${i}`}
          testID={`chart-${prefix}-${i}`}
          accessibilityRole="button"
          accessibilityLabel={pointText(p, i)}
          disabled={!env.interactive}
          onPress={() => setPicked(i)}
          onLongPress={env.onLongPress}
          style={styles.barSlot}
        />
      ))}
    </View>
  );

  let plot: ReactNode = null;
  if (nothing || records === null) {
    plot = (
      <Text style={[palette.font('body', 14), { color: palette.caption }]}>
        {records === null ? ' ' : t(locale, 'chartEmpty')}
      </Text>
    );
  } else if (show.kind === 'bar' && points.every((p) => p.value >= 0)) {
    // 没有负数：Victory 画（柱子从 0 画起）；有负数的用下面原来的画法，Victory 的柱子只会画到图的底边。
    plot = (
      <ChartPlot
        kind="bar"
        values={points.map((p) => p.value)}
        previous={previous?.map((p) => p.value)}
        selected={selected}
        color={palette.primary}
        mutedColor={palette.caption}
        gridColor={palette.border}
        labelColor={palette.caption}>
        {slots('bar')}
      </ChartPlot>
    );
  } else if (show.kind === 'bar') {
    const scale = lineScale(
      points.map((p) => p.value),
      1,
      PLOT_HEIGHT,
      0,
    );
    plot = (
      <View style={[styles.bars, { height: PLOT_HEIGHT }]}>
        {points.map((p, i) => {
          const top = Math.min(scale.y(p.value), scale.zero);
          const height = Math.max(Math.abs(scale.zero - scale.y(p.value)), p.value === 0 ? 0 : 2);
          return (
            <Pressable
              key={p.key ?? `none-${i}`}
              testID={`chart-bar-${i}`}
              accessibilityRole="button"
              accessibilityLabel={t(locale, 'chartPoint', { label: p.label, value: valueText(p) })}
              disabled={!env.interactive}
              onPress={() => setPicked(i)}
              onLongPress={env.onLongPress}
              style={styles.barSlot}>
              <View
                style={{
                  position: 'absolute',
                  left: 1,
                  right: 1,
                  top,
                  height,
                  borderTopLeftRadius: p.value >= 0 ? 4 : 0,
                  borderTopRightRadius: p.value >= 0 ? 4 : 0,
                  borderBottomLeftRadius: p.value < 0 ? 4 : 0,
                  borderBottomRightRadius: p.value < 0 ? 4 : 0,
                  backgroundColor: palette.primary,
                  opacity: i === selected ? 1 : 0.55,
                }}
              />
            </Pressable>
          );
        })}
      </View>
    );
  } else if (show.kind === 'line') {
    plot = (
      <ChartPlot
        kind="line"
        values={points.map((p) => p.value)}
        previous={previous?.map((p) => p.value)}
        selected={selected}
        color={palette.primary}
        mutedColor={palette.caption}
        gridColor={palette.border}
        labelColor={palette.caption}>
        {slots('point')}
      </ChartPlot>
    );
  } else {
    const total = points.reduce((s, p) => s + p.value, 0);
    const colors = palette.dark ? CHART_COLORS.dark : CHART_COLORS.light;
    const other = palette.dark ? CHART_COLORS.other.dark : CHART_COLORS.other.light;
    const colorOf = (p: ChartPoint, i: number) =>
      p.key === null ? other : colors[i % colors.length]!;
    const size = PLOT_HEIGHT;
    const paths = piePaths(
      points.map((p) => p.value),
      size / 2,
      size / 2,
      size / 2 - 2,
    );
    plot = (
      <View style={styles.pie}>
        <Canvas style={{ width: size, height: size }} pointerEvents="none">
          {paths.map((d, i) =>
            d ? <Path key={`fill-${i}`} path={d} color={colorOf(points[i]!, i)} /> : null,
          )}
          {/* 块与块之间 2px 的缝（表面色描边）。 */}
          {paths.map((d, i) =>
            d && points.length > 1 ? (
              <Path
                key={`gap-${i}`}
                path={d}
                style="stroke"
                strokeWidth={2}
                color={palette.surface}
              />
            ) : null,
          )}
        </Canvas>
        <View style={styles.legend}>
          {points.map((p, i) => (
            <Pressable
              key={p.key ?? `other-${i}`}
              testID={`chart-slice-${p.key ?? 'other'}`}
              disabled={!env.interactive}
              onPress={() => setPicked(i)}
              onLongPress={env.onLongPress}
              style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: colorOf(p, i) }]} />
              {/* 名称和数值上下排：法语金额（「1 234,50 CNY」）较长，并排时名称会被截断。 */}
              <View style={styles.flex}>
                <Text
                  numberOfLines={2}
                  style={[
                    palette.font(i === selected ? 'bodyBold' : 'body', 14),
                    { color: palette.text },
                  ]}>
                  {p.label}
                </Text>
                <Text style={[palette.font('body', 13), { color: palette.muted }]}>
                  {t(locale, 'chartShare', {
                    value: valueText(p),
                    percent: `${Math.round((p.value / total) * 100)}%`,
                  })}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <Card palette={palette} background={tone ? cardColors(palette, tone).background : undefined}>
      {header}
      {plot}
      {show.kind !== 'pie' && !nothing && points.length > 1 ? (
        // 只标第一段和最后一段，中间的点一下才看。
        <View style={styles.axis}>
          <Text style={[palette.font('body', 12), { color: palette.caption }]}>
            {points[0]!.label}
          </Text>
          <Text style={[palette.font('body', 12), { color: palette.caption }]}>
            {points[points.length - 1]!.label}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  bars: { flexDirection: 'row', alignItems: 'stretch' },
  barSlot: { flex: 1, minHeight: 44 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  flex: { flex: 1 },
});
