import { useEffect, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import type { Palette } from '../../renderer/theme';

// 横向滑块（标注的字号、旋转）：按下哪里就跳到哪里，再左右拖。

class Live {
  width = 0;
  min = 0;
  max = 1;
  from = 0;
  onChange: (value: number) => void = () => {};
  sync(width: number, min: number, max: number, onChange: (value: number) => void) {
    this.width = width;
    this.min = min;
    this.max = max;
    this.onChange = onChange;
  }
}

export function Slider({
  value,
  min,
  max,
  onChange,
  palette,
  testID,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  palette: Palette;
  testID: string;
  label: string;
}) {
  const [width, setWidth] = useState(0);
  // 手势回调里要用最新的宽度、范围和回调：放在一个不变的对象里，渲染完再更新。
  const [live] = useState(() => new Live());
  useEffect(() => live.sync(width, min, max, onChange));
  const [responder] = useState(() => {
    const at = (x: number) => {
      if (!live.width) return;
      live.onChange(
        live.min + (Math.max(0, Math.min(live.width, x)) / live.width) * (live.max - live.min),
      );
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        live.from = e.nativeEvent.locationX;
        at(live.from);
      },
      onPanResponderMove: (_e, g) => at(live.from + g.dx),
    });
  });
  const ratio = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: Math.round(value) }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: palette.surface, borderColor: palette.border }]}
      {...responder.panHandlers}>
      <View
        pointerEvents="none"
        style={[styles.fill, { width: ratio * width, backgroundColor: palette.border }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { left: ratio * Math.max(0, width - 28), backgroundColor: palette.background },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  thumb: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
