import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// 全屏看图时双指缩放（D-277）：双指放大（1–5 倍），放大后单指拖动看局部，双击放大到 2.5 倍 / 复原。
// 没放大时单指的横滑交给外面的翻页列表（onZoomed 告诉它暂时别翻页）。

const MAX = 5;

export function ZoomImage({
  uri,
  width,
  height,
  onZoomed,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomed?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const start = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const zoomed = useSharedValue(false);

  const [isZoomed, setIsZoomed] = useState(false);
  const report = (value: boolean) => {
    setIsZoomed(value);
    onZoomed?.(value);
  };
  /** 放大后能拖动的范围：图片不离开屏幕。 */
  const clampOffsets = () => {
    'worklet';
    const mx = ((scale.value - 1) * width) / 2;
    const my = ((scale.value - 1) * height) / 2;
    x.value = Math.min(mx, Math.max(-mx, x.value));
    y.value = Math.min(my, Math.max(-my, y.value));
  };
  const setZoomed = (value: boolean) => {
    'worklet';
    if (zoomed.value !== value) {
      zoomed.value = value;
      runOnJS(report)(value);
    }
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX, Math.max(1, start.value * e.scale));
      clampOffsets();
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        x.value = withTiming(0);
        y.value = withTiming(0);
        setZoomed(false);
      } else {
        setZoomed(true);
      }
    });
  const pan = Gesture.Pan()
    // 没放大时不接单指拖动，横滑由翻页列表处理。
    .enabled(isZoomed)
    .averageTouches(true)
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
      clampOffsets();
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        x.value = withTiming(0);
        y.value = withTiming(0);
        setZoomed(false);
      } else {
        scale.value = withTiming(2.5);
        setZoomed(true);
      }
    });
  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.flex, style]}>
        <Image source={{ uri }} style={styles.flex} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
