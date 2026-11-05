import { axisTickText, chartYDomain } from '@morph/core';
import { Circle, useFont } from '@shopify/react-native-skia';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Bar, CartesianChart, Line } from 'victory-native';

// 柱状图和折线图的画法（D-438）：Victory Native XL（Skia）画柱子、折线、网格和 Y 轴刻度；
// 点按、读屏标签和读数还是 Chart.tsx 里那一排透明的可点区域（children），所以 x 轴按「每个点一格」排：
// 点 i 在第 i 格的正中（x 范围 -0.5 到 n-0.5），可点区域的每一格正好盖在它上面。
// X 轴的文字不在这里画（Skia 字体没有中文字形，分类名可能是中文），由 Chart.tsx 用普通文字标第一段和最后一段。

const KARLA = require('@expo-google-fonts/karla/400Regular/Karla_400Regular.ttf');

export const PLOT_HEIGHT = 150;

export function ChartPlot({
  kind,
  values,
  selected,
  color,
  gridColor,
  labelColor,
  children,
}: {
  kind: 'bar' | 'line';
  values: readonly number[];
  selected: number;
  color: string;
  gridColor: string;
  labelColor: string;
  /** 盖在图上的一排可点区域（每个点一格）。 */
  children: ReactNode;
}) {
  const font = useFont(KARLA, 11);
  const [width, setWidth] = useState(0);
  const n = values.length;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <View style={{ height: PLOT_HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && n > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <CartesianChart
            data={data}
            xKey="i"
            yKeys={['v']}
            padding={{ top: 8, bottom: 0, left: 0, right: 0 }}
            domain={{ x: [-0.5, n - 0.5], y: chartYDomain(values) }}
            axisOptions={{
              font,
              tickCount: { x: 0, y: 4 },
              labelPosition: { x: 'outset', y: 'inset' },
              labelColor,
              lineColor: { grid: { x: 'transparent', y: gridColor }, frame: 'transparent' },
              lineWidth: { grid: { x: 0, y: StyleSheet.hairlineWidth }, frame: 0 },
              formatXLabel: () => '',
              formatYLabel: (v) => axisTickText(Number(v)),
            }}>
            {({ points, chartBounds }) =>
              kind === 'bar' ? (
                <>
                  <Bar
                    points={points.v.filter((_, i) => i !== selected)}
                    chartBounds={chartBounds}
                    color={color}
                    opacity={0.55}
                    barWidth={(width / n) * 0.8}
                    roundedCorners={{ topLeft: 4, topRight: 4 }}
                  />
                  <Bar
                    points={points.v.filter((_, i) => i === selected)}
                    chartBounds={chartBounds}
                    color={color}
                    barWidth={(width / n) * 0.8}
                    roundedCorners={{ topLeft: 4, topRight: 4 }}
                  />
                </>
              ) : (
                <>
                  <Line
                    points={points.v}
                    color={color}
                    strokeWidth={2}
                    strokeJoin="round"
                    strokeCap="round"
                    curveType="linear"
                  />
                  {points.v[selected]?.y != null ? (
                    <Circle
                      cx={points.v[selected]!.x}
                      cy={points.v[selected]!.y as number}
                      r={5}
                      color={color}
                    />
                  ) : null}
                </>
              )
            }
          </CartesianChart>
        </View>
      ) : null}
      {children}
    </View>
  );
}
