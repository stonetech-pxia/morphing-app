import { allComponents, childrenOf, type Component, type Page } from '@morph/core';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { Pill } from '../renderer/ui';
import type { ItemBox } from './drop-target';
import { LONG_PRESS_MS } from './entry';

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
  // 分组里（包括里面那层分组里）选中了别的块。
  const contains =
    component.look === 'group' &&
    childrenOf(component).some(
      (c) => c.id === focus.selectedId || childrenOf(c).some((x) => x.id === focus.selectedId),
    );
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
    // 未选中时手指先移动超过 8pt 就放弃，交给页面滚动。RNGH 长按拖动在恰好移动 10pt 时会直接激活
    // （超过 10pt 才失败），竖直快速滑动可能正好落在这个值上，把滚动变成拖动。
    // RNGH 不允许 minDistance 和 failOffset 同时设置。
    minDistance: selected ? 3 : undefined,
    failOffsetX: selected ? undefined : [-8, 8],
    failOffsetY: selected ? undefined : [-8, 8],
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
              pointerEvents={active && component.look !== 'group' ? 'none' : 'auto'}
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
    </View>
  );
}
/** 选中的组件现在是否画在页面上（隐藏了或删掉了就没有）。 */
function shownOnPage(page: Page, id: string): boolean {
  const shown = (list: readonly Component[]): boolean =>
    list.some((c) => !c.hidden && (c.id === id || (c.look === 'group' && shown(c.children))));
  return shown(page.blocks);
}

/**
 * 选中组件的「编辑」「完成」画在滚动内容里，按量到的位置贴在组件右上方：
 * 画在组件框里时，伸出框外的那一半在 iOS 上点不到。
 * 选中的组件在操作面板里被隐藏或删掉后，pinned 的那份固定在可见区域顶部，仍然能「完成」。
 */
export function FocusToolbar({
  env,
  page,
  pinned = false,
}: {
  env: RenderEnv;
  page: Page;
  pinned?: boolean;
}) {
  const focus = env.focus!;
  const id = focus.selectedId;
  const drag = focus.drag;
  const dragging = drag?.draggingId != null;
  const onPage = id !== null && shownOnPage(page, id);
  const [measured, setMeasured] = useState<{ id: string; box: ItemBox | null } | null>(null);
  // 原生视图挂好之后才能量（layout effect 里还量不到）。
  useEffect(() => {
    if (pinned || !id || !onPage || !drag || dragging) return;
    let live = true;
    drag.measureInContent(id, (box) => live && setMeasured({ id, box }));
    return () => {
      live = false;
    };
    // drag 每次渲染都是新对象；选中项、拖动结束和页面变化时重新量。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, id, onPage, dragging, page]);
  if (!id || pinned === onPage) return null;
  const { palette } = env;
  // 只用这个选中项量到的位置；量好之前先不显示，量不到时放在内容右上角，仍然能点。
  const done = measured?.id === id;
  const box = done ? measured.box : null;
  const shown = (pinned || done) && !dragging;
  const exists = allComponents(page).some((c) => c.id === id);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.toolbarRow,
        pinned || !box
          ? { top: pinned ? 8 : 0, left: palette.pad, right: palette.pad }
          : { left: box.x, top: Math.max(0, box.y - 18), width: box.width },
      ]}>
      <View
        testID={`single-toolbar-${id}`}
        pointerEvents={shown ? 'auto' : 'none'}
        style={[
          styles.toolbar,
          { opacity: shown ? 1 : 0 },
          { backgroundColor: palette.surface, borderRadius: palette.controlRadius },
          pinned && palette.cardStyle(palette.surface),
        ]}>
        {exists ? (
          <Pill
            palette={palette}
            label={t(env.locale, 'edit')}
            testID={`single-edit-${id}`}
            onPress={() => focus.onEdit(id)}
          />
        ) : null}
        <Pill
          palette={palette}
          label={t(env.locale, 'done')}
          testID={`single-done-${id}`}
          onPress={focus.onDone}
        />
      </View>
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
  toolbarRow: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 30,
  },
  toolbar: { flexDirection: 'row', gap: 8, padding: 4 },
});
