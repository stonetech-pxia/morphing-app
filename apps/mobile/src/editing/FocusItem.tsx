import type { Component } from '@morph/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { t } from '../i18n';
import { LONG_PRESS_MS, type RenderEnv } from '../renderer/components';
import { Pill } from '../renderer/ui';

/** 单组件编辑不改变页面排版；分组里选中子项时，分组本身不变淡。 */
export function FocusItem({
  component,
  env,
  style,
  children,
}: {
  component: Component;
  env: RenderEnv;
  style?: StyleProp<ViewStyle>;
  children: (env: RenderEnv) => ReactNode;
}) {
  const focus = env.focus!;
  const active = focus.selectedId !== null;
  const selected = focus.selectedId === component.id;
  const contains =
    component.type === 'group' && component.children.some((c) => c.id === focus.selectedId);
  const dimmed = active && !selected && !contains && !env.focusWithinSelected;
  const open = () => env.edit?.(component.id);
  const { palette } = env;
  const id = component.id;
  const drag = focus.drag;
  const begin = drag?.begin;
  const move = drag?.move;
  const end = drag?.end;
  const scrollShift = drag?.scrollShift;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gesture = usePanGesture({
    testID: `single-drag-${id}`,
    enabled: Boolean(drag),
    // 配置变化不替换 detector，长按选中后同一次触摸仍能继续拖。
    activateAfterLongPress: selected ? 0 : LONG_PRESS_MS,
    minDistance: selected ? 3 : 0,
    maxPointers: 1,
    cancelsTouchesInView: true,
    cancelsJSResponder: true,
    block: drag ? [drag.scrollGesture, ...(env.parentDrag ? [env.parentDrag] : [])] : undefined,
    onActivate: (e) => {
      x.value = 0;
      y.value = 0;
      if (begin) scheduleOnRN(begin, id, e.absoluteX, e.absoluteY);
    },
    onUpdate: (e) => {
      x.value = e.translationX;
      y.value = e.translationY;
      if (move) scheduleOnRN(move, id, e.absoluteX, e.absoluteY);
    },
    onDeactivate: (e) => {
      x.value = 0;
      y.value = 0;
      if (end) scheduleOnRN(end, id, !e.canceled);
    },
  });
  const dragging = drag?.draggingId === id;
  const animated = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragging ? x.value : 0 },
      { translateY: dragging ? y.value + (scrollShift?.value ?? 0) : 0 },
      { scale: selected ? 1.03 : 1 },
    ],
  }));
  return (
    <View
      testID={`single-frame-${id}`}
      collapsable={false}
      ref={(view) => drag?.register(id, view, env.inCell ?? false)}
      style={[style, { zIndex: selected || contains ? 10 : 0 }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[animated, selected && styles.lift]}>
          <Pressable
            testID={`component-${id}`}
            accessible={selected}
            onLongPress={open}
            delayLongPress={LONG_PRESS_MS}
            onPress={active ? () => undefined : undefined}
            accessibilityActions={[{ name: 'activate', label: t(env.locale, 'edit') }]}
            onAccessibilityAction={() => {
              open();
              focus.onEdit(id);
            }}>
            <View
              testID={`single-content-${id}`}
              pointerEvents={active && component.type !== 'group' ? 'none' : 'auto'}
              style={{
                opacity: dimmed && !env.focusWithinDimmed ? 0.5 : 1,
              }}>
              {children({
                ...env,
                parentDrag: gesture,
                focusWithinSelected: env.focusWithinSelected || selected,
                focusWithinDimmed: env.focusWithinDimmed || dimmed,
                interactive: active ? false : env.interactive,
                onLongPress: open,
              })}
            </View>
            {selected ? (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    borderWidth: 2,
                    borderColor: palette.primary,
                    borderRadius: palette.radius,
                  },
                ]}
              />
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
      {selected ? (
        <View
          testID={`single-toolbar-${id}`}
          pointerEvents={dragging ? 'none' : 'auto'}
          style={[
            styles.toolbar,
            { opacity: dragging ? 0 : 1 },
            { backgroundColor: palette.surface, borderRadius: palette.controlRadius },
          ]}>
          <Pill
            palette={palette}
            label={t(env.locale, 'edit')}
            testID={`single-edit-${id}`}
            onPress={() => focus.onEdit(id)}
          />
          <Pill
            palette={palette}
            label={t(env.locale, 'done')}
            testID={`single-done-${id}`}
            onPress={focus.onDone}
          />
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  lift: {
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  toolbar: {
    position: 'absolute',
    top: -18,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    zIndex: 20,
  },
});
