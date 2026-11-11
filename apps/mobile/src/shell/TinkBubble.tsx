import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { Palette } from '../renderer/theme';

/** 四个角一样圆；尖角的底边落在直边上（离右边至少 RADIUS）。 */
const RADIUS = 12;
/** 缩成三个点时的大小：三个点（5，间距 4）加上左右各 11、上下各 7 的内边距。 */
const DOT = 5;
const MINI = { w: 3 * DOT + 2 * 4 + 22, h: DOT + 14 };
const SHRINK_MS = 320;
const MARGIN = 12;

/**
 * Tink 在右上角说的话（D-526）：气泡浮在页面上，尖角对着 Tink；展开时是内容加右下角「我知道了」，
 * 点它气泡的宽、高、圆角和尖角一起平滑缩成只有三个点的小气泡（文字先淡出，点后淡入），点三个点再展开。
 * 内容太长时气泡有最大高度，内容在里面滚动，「我知道了」始终在下面。
 *
 * 外面的壳只管位置和动画；展开时的高度自己量一次（内容换了就换 `key` 重新量）。
 * `top` 是气泡顶边（尖角在它上面 10）；`tinkRight` 是 Tink 的中心离右边多远，尖角跟着它对齐。
 */
export function TinkBubble({
  palette,
  top,
  tinkRight,
  collapsed,
  gotIt,
  expandLabel,
  onGotIt,
  onExpand,
  children,
}: {
  palette: Palette;
  top: number;
  tinkRight: number;
  collapsed: boolean;
  gotIt: string;
  expandLabel: string;
  onGotIt: () => void;
  onExpand: () => void;
  children: ReactNode;
}) {
  const window = useWindowDimensions();
  const width = Math.min(300, window.width - 2 * MARGIN);
  const maxContent = Math.round(window.height * 0.4);
  const [progress] = useState(() => new Animated.Value(collapsed ? 1 : 0)); // 0 展开，1 三个点
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  useEffect(() => {
    Animated.timing(progress, {
      toValue: collapsed ? 1 : 0,
      duration: SHRINK_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [collapsed, progress]);

  const out = [0, 1] as const;
  const onBubble = { color: palette.onPrimary };
  // 尖角的中心对着 Tink（气泡右边离屏幕 MARGIN）；底边不超出直边。
  const tailRight = Math.max(RADIUS, tinkRight - MARGIN - 9);
  const content = (
    <Animated.View
      testID={collapsed ? undefined : 'draft-reply'}
      pointerEvents={collapsed ? 'none' : 'auto'}
      onLayout={(e) => setFullHeight((prev) => prev ?? e.nativeEvent.layout.height)}
      style={[
        fullHeight === null ? null : { position: 'absolute', top: 0, left: 0 },
        {
          width,
          opacity: progress.interpolate({
            inputRange: [0, 0.4],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          }),
        },
      ]}>
      <View style={[styles.content, { paddingHorizontal: palette.inset }]}>
        <ScrollView
          style={{ maxHeight: maxContent }}
          bounces={false}
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
        <Pressable
          testID="draft-reply-hide"
          accessibilityRole="button"
          hitSlop={10}
          style={styles.action}
          onPress={onGotIt}>
          <Text style={[palette.font('bodyBold', 14), onBubble]}>{gotIt}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top, right: MARGIN }]}>
      <Pressable
        testID={collapsed ? 'draft-reply-show' : undefined}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? expandLabel : undefined}
        disabled={!collapsed}
        hitSlop={collapsed ? 12 : 0}
        onPress={onExpand}>
        <Animated.View
          style={[
            fullHeight === null
              ? { width }
              : {
                  width: progress.interpolate({ inputRange: out, outputRange: [width, MINI.w] }),
                  height: progress.interpolate({
                    inputRange: out,
                    outputRange: [fullHeight, MINI.h],
                  }),
                },
            {
              // 量完高度之前不显示，免得先闪一下。
              opacity: fullHeight === null ? 0 : 1,
              backgroundColor: palette.primary,
              borderRadius: progress.interpolate({
                inputRange: out,
                outputRange: [RADIUS, MINI.h / 2],
              }),
              // 高光：主色的光晕，和 Tink 的光圈一起把人的目光带过去。
              boxShadow: `0px 0px 18px ${palette.primary}99`,
            },
          ]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.tail,
              { right: tailRight, borderBottomColor: palette.primary },
              {
                transformOrigin: '50% 100%',
                transform: [
                  { scale: progress.interpolate({ inputRange: out, outputRange: [1, 0.72] }) },
                ],
              },
            ]}
          />
          {fullHeight === null ? (
            content
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.clip]}>
              {content}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.dots,
                  {
                    opacity: progress.interpolate({
                      inputRange: [0.45, 1],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                  },
                ]}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: palette.onPrimary }]} />
                ))}
              </Animated.View>
            </View>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', alignItems: 'flex-end', zIndex: 20 },
  tail: {
    position: 'absolute',
    top: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  content: { paddingTop: 12, paddingBottom: 10, gap: 6 },
  action: { alignSelf: 'flex-end', paddingVertical: 2 },
  clip: { overflow: 'hidden', borderRadius: RADIUS },
  dots: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
