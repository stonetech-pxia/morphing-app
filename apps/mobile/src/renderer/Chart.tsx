import {
  CHART_COLORS,
  calendarOf,
  chartSeries,
  filterRecords,
  lineScale,
  linePath,
  piePaths,
  pieSlices,
  type ChartPoint,
  type Component,
  type ComponentStyle,
} from '@morph/core';
import { Canvas, Path } from '@shopify/react-native-skia';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useComputedRecords } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { statText, useLinkedGroups } from './data';
import { cardColors } from './theme';
import { Card } from './ui';

// 图表组件（D-249）：分组和数值都在 core/chart.ts 算好，这里只画。柱状图用普通 View（读屏能逐根读），
// 折线和饼图用 Skia 的 Path（SVG 路径字符串，Hermes 上能跑，不需要新依赖）。
// 单一序列用主色、不画图例（标题就是它的名字）；饼图每块用固定顺序的分类色，图例总是列出名字和数值，
// 所以不只靠颜色区分。点一根柱子 / 一个点 / 一行图例，标题下面显示它的数值（代替悬停提示）。

type ChartProps = Extract<Component, { type: 'chart' }>['props'];

const PLOT_HEIGHT = 150;

export function Chart({
  props,
  env,
  tone,
}: {
  props: ChartProps;
  env: RenderEnv;
  tone?: ComponentStyle['tone'];
}) {
  const { palette, locale } = env;
  const table = env.config.collections.find((c) => c.id === props.collectionId);
  const cal = calendarOf(env.config);
  // 查找、汇总、上一条（D-291）按算好的值画。
  const { view: collection, records } = useComputedRecords(env.config.collections, table, cal);
  // 按引用字段分组（D-336）：被引用的表里每条记录一个点。
  const linked = useLinkedGroups(
    env,
    collection,
    props.group === 'choice' ? props.choiceField : undefined,
  );
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  if (!collection) return null;
  const now = new Date();
  const field = props.fieldId ? collection.fields.find((f) => f.id === props.fieldId) : undefined;
  // 连续天数这类只有一个值的聚合不能画图（D-284，校验已经挡住）。
  const series =
    props.aggregate === 'streak' ||
    props.aggregate === 'daysSince' ||
    props.aggregate === 'avgInterval'
      ? []
      : chartSeries(
          filterRecords(records ?? [], collection, props.filter, now, cal),
          collection,
          { ...props, aggregate: props.aggregate },
          now,
          t(locale, 'statNoChoice'),
          cal,
          linked ?? undefined,
        );
  const points = props.kind === 'pie' ? pieSlices(series, t(locale, 'chartOther')) : series;
  const valueText = (p: ChartPoint) =>
    p.empty ? '—' : statText(p.value, props.aggregate, field, locale);
  const nothing = records !== null && linked !== null && points.every((p) => p.value === 0);
  // 默认显示最后一段（时间）或最大的一块（单选）。
  const fallback =
    props.group === 'choice'
      ? points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -Infinity) ? i : best), 0)
      : points.length - 1;
  const selected = picked !== null && picked < points.length ? picked : fallback;
  const current = points[selected];

  const header = (
    <View style={styles.header}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>{props.title}</Text>
      {current && !nothing && props.kind !== 'pie' ? (
        <Text
          testID={`chart-readout-${props.collectionId}`}
          style={[palette.font('body', 13), { color: palette.muted }]}>
          {t(locale, 'chartPoint', { label: current.label, value: valueText(current) })}
        </Text>
      ) : null}
    </View>
  );

  let plot: ReactNode = null;
  if (nothing || records === null) {
    plot = (
      <Text style={[palette.font('body', 14), { color: palette.caption }]}>
        {records === null ? ' ' : t(locale, 'chartEmpty')}
      </Text>
    );
  } else if (props.kind === 'bar') {
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
  } else if (props.kind === 'line') {
    const values = points.map((p) => p.value);
    const scale = width > 0 ? lineScale(values, width, PLOT_HEIGHT) : null;
    plot = (
      <View style={{ height: PLOT_HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {scale ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path
              path={linePath(values, width, PLOT_HEIGHT)}
              style="stroke"
              strokeWidth={2}
              strokeJoin="round"
              strokeCap="round"
              color={palette.primary}
            />
            {current ? (
              <Path
                path={dot(scale.x(selected), scale.y(current.value), 5)}
                color={palette.primary}
              />
            ) : null}
          </Canvas>
        ) : null}
        {/* 每个点一列可以点的区域，比点本身大。 */}
        <View style={[StyleSheet.absoluteFill, styles.bars]}>
          {points.map((p, i) => (
            <Pressable
              key={p.key ?? `none-${i}`}
              testID={`chart-point-${i}`}
              accessibilityRole="button"
              accessibilityLabel={t(locale, 'chartPoint', { label: p.label, value: valueText(p) })}
              disabled={!env.interactive}
              onPress={() => setPicked(i)}
              onLongPress={env.onLongPress}
              style={styles.barSlot}
            />
          ))}
        </View>
      </View>
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
      {props.kind !== 'pie' && !nothing && points.length > 1 ? (
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

/** 一个实心圆点（SVG 路径）。 */
const dot = (x: number, y: number, r: number) =>
  `M${x - r} ${y} A${r} ${r} 0 1 0 ${x + r} ${y} A${r} ${r} 0 1 0 ${x - r} ${y} Z`;

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
