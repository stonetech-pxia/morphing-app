import {
  dropOp,
  dropSlots,
  moveStepOp,
  type Component,
  type Op,
  type Page,
  type DropSlot,
} from '@morph/core';
import { useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type HostInstance,
  type ScrollViewProps,
} from 'react-native';

import { t } from '../i18n';
import { ComponentView, type RenderEnv } from '../renderer/components';
import { Pill } from '../renderer/ui';

// 「调整顺序」模式（D-052）：每个组件带拖动把手和 ↑ ↓ 按钮，隐藏的组件也显示出来。
// 拖动只在界面上移动；松手时翻译成一个 moveComponent 操作提交，和箭头按钮一样生成可撤销的新版本。

interface Line {
  slot: DropSlot;
  y: number;
}

interface Drag {
  id: string;
  slot: DropSlot | null;
}

const sameSlot = (a: DropSlot | null, b: DropSlot) =>
  a !== null && a.parentId === b.parentId && a.index === b.index;

function measure(view: HostInstance | undefined): Promise<{ y: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((_x, y, _w, height) => resolve({ y, height }));
  });
}

/** 一个组件的编辑行：内容（点按打开操作面板）+ 把手 + ↑ ↓。 */
function Row({
  component,
  env,
  dragging,
  translateY,
  lineBefore,
  lineAfter,
  onEdit,
  onStep,
  onDragStart,
  onDragMove,
  onDragEnd,
  register,
  page,
  children,
}: {
  component: Component;
  env: RenderEnv;
  dragging: boolean;
  translateY: Animated.Value;
  lineBefore: boolean;
  lineAfter: boolean;
  onEdit: (id: string) => void;
  onStep: (op: Op, id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (dy: number, pageY: number) => void;
  onDragEnd: (commit: boolean) => void;
  register: (id: string, view: HostInstance | null) => void;
  page: Page;
  children?: ReactNode;
}) {
  const { palette, locale } = env;
  const id = component.id;
  // PanResponder 只创建一次。拖动回调只依赖 ref 和这一页的配置；配置一变（新版本），整个页面会重新挂载。
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => onDragStart(id),
      onPanResponderMove: (_e, g) => onDragMove(g.dy, g.moveY),
      onPanResponderRelease: () => onDragEnd(true),
      onPanResponderTerminate: () => onDragEnd(false),
    }),
  );
  const up = moveStepOp(page, id, 'up');
  const down = moveStepOp(page, id, 'down');
  const arrow = (op: Op | null, glyph: string, name: string, label: string) => (
    <Pressable
      testID={`arrange-${name}-${id}`}
      accessibilityLabel={label}
      disabled={!op}
      hitSlop={4}
      onPress={() => op && onStep(op, id)}
      style={({ pressed }) => [
        styles.control,
        { backgroundColor: palette.primaryTint, opacity: !op ? 0.3 : pressed ? 0.6 : 1 },
      ]}>
      <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>{glyph}</Text>
    </Pressable>
  );
  const line = (where: 'top' | 'bottom') => (
    <View
      pointerEvents="none"
      style={[
        styles.line,
        { backgroundColor: palette.primary },
        where === 'top' ? { top: -palette.gap / 2 - 2 } : { bottom: -palette.gap / 2 - 2 },
      ]}
    />
  );
  return (
    <Animated.View
      ref={(v: HostInstance | null) => register(id, v)}
      testID={`arrange-${id}`}
      style={[
        styles.row,
        {
          borderColor: dragging ? palette.primary : palette.border,
          borderRadius: palette.radius,
          backgroundColor: dragging ? palette.surface : 'transparent',
          gap: palette.gap - 4,
        },
        dragging && styles.dragging,
        dragging && { transform: [{ translateY }] },
      ]}>
      {lineBefore ? line('top') : null}
      <View style={styles.head}>
        <Pressable
          testID={`arrange-edit-${id}`}
          onPress={() => onEdit(id)}
          style={[styles.content, component.hidden && styles.hidden]}>
          <View pointerEvents="none">
            {component.type === 'group' ? (
              <Text style={[palette.font('bodyBold', 12), { color: palette.caption }]}>
                {(component.props.title ?? t(locale, 'groupLabel')).toUpperCase()}
              </Text>
            ) : (
              <ComponentView component={component} env={env} />
            )}
          </View>
        </Pressable>
        <View style={styles.controls}>
          {arrow(up, '↑', 'up', t(locale, 'moveUp'))}
          <View
            {...responder.panHandlers}
            testID={`arrange-drag-${id}`}
            accessibilityLabel={t(locale, 'arrange')}
            style={[styles.control, { backgroundColor: palette.primary }]}>
            <Text style={[palette.font('bodyBold', 16), { color: palette.onPrimary }]}>≡</Text>
          </View>
          {arrow(down, '↓', 'down', t(locale, 'moveDown'))}
        </View>
      </View>
      {component.hidden ? (
        <Text style={[palette.font('bodyBold', 12), { color: palette.caption }]}>
          {t(locale, 'hiddenTag')}
        </Text>
      ) : null}
      {children}
      {lineAfter ? line('bottom') : null}
    </Animated.View>
  );
}

export function ArrangeView({
  page,
  env,
  bottomInset = 0,
  scroll,
  onEdit,
  onMove,
  onDone,
}: {
  page: Page;
  env: RenderEnv;
  bottomInset?: number;
  scroll?: ScrollViewProps;
  onEdit: (componentId: string) => void;
  onMove: (op: Op, componentId: string) => void;
  onDone: () => void;
}) {
  const { palette, locale } = env;
  // 编辑行里的组件只展示，不响应点按。
  const viewEnv: RenderEnv = { ...env, pageId: page.id, interactive: false };
  const views = useRef(new Map<string, HostInstance>());
  const lines = useRef<Line[]>([]);
  const [translateY] = useState(() => new Animated.Value(0));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const register = (id: string, view: HostInstance | null) => {
    if (view) views.current.set(id, view);
    else views.current.delete(id);
  };

  function update(next: Drag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  async function startDrag(id: string) {
    translateY.setValue(0);
    lines.current = [];
    update({ id, slot: null });
    // 记下每个可放下位置在屏幕上的高度（拖动期间页面不滚动）。
    const boxes = new Map<string, { y: number; height: number } | null>();
    await Promise.all(
      [...views.current].map(async ([key, view]) => boxes.set(key, await measure(view))),
    );
    const edge = (list: Component[], i: number, fallbackId: string): number | null => {
      const before = list[i] && boxes.get(list[i]!.id);
      if (before) return before.y;
      const last = list.at(-1);
      const after = last && boxes.get(last.id);
      if (after) return after.y + after.height;
      const parent = boxes.get(fallbackId);
      return parent ? parent.y + parent.height / 2 : null;
    };
    const result: Line[] = [];
    for (const slot of dropSlots(page, id)) {
      const group =
        slot.parentId === undefined
          ? null
          : page.components.find((c) => c.id === slot.parentId && c.type === 'group');
      const list = group && group.type === 'group' ? group.children : page.components;
      const y = edge(list, slot.index, slot.parentId ?? id);
      if (y !== null) result.push({ slot, y });
    }
    if (dragRef.current?.id === id) lines.current = result;
  }

  function moveDrag(dy: number, pageY: number) {
    const current = dragRef.current;
    if (!current) return;
    translateY.setValue(dy);
    let best: Line | null = null;
    for (const line of lines.current) {
      if (!best || Math.abs(line.y - pageY) < Math.abs(best.y - pageY)) best = line;
    }
    if (best && !sameSlot(current.slot, best.slot)) update({ ...current, slot: best.slot });
  }

  function endDrag(commit: boolean) {
    const current = dragRef.current;
    update(null);
    translateY.setValue(0);
    if (!commit || !current?.slot) return;
    const op = dropOp(page, current.id, current.slot);
    if (op) onMove(op, current.id);
  }

  const rows = (list: Component[], parentId?: string) =>
    list.map((c, i) => (
      <Row
        key={c.id}
        page={page}
        component={c}
        env={viewEnv}
        dragging={drag?.id === c.id}
        translateY={translateY}
        lineBefore={drag !== null && sameSlot(drag.slot, { parentId, index: i })}
        lineAfter={
          drag !== null && i === list.length - 1 && sameSlot(drag.slot, { parentId, index: i + 1 })
        }
        onEdit={onEdit}
        onStep={onMove}
        onDragStart={(id) => void startDrag(id)}
        onDragMove={moveDrag}
        onDragEnd={endDrag}
        register={register}>
        {c.type === 'group' ? (
          <View style={[styles.children, { gap: palette.gap }]}>
            {c.children.length === 0 ? (
              <View
                style={[
                  styles.empty,
                  { borderColor: palette.border, borderRadius: palette.controlRadius },
                  drag !== null &&
                    sameSlot(drag.slot, { parentId: c.id, index: 0 }) && {
                      borderColor: palette.primary,
                    },
                ]}
              />
            ) : (
              rows(c.children, c.id)
            )}
          </View>
        ) : null}
      </Row>
    ));

  return (
    <View style={styles.root}>
      <View
        testID="arrange-bar"
        style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.barText}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>
            {t(locale, 'arrange')}
          </Text>
          <Text style={[palette.font('body', 13), { color: palette.muted }]}>
            {t(locale, 'arrangeHint')}
          </Text>
        </View>
        <Pill palette={palette} testID="arrange-done" label={t(locale, 'done')} onPress={onDone} />
      </View>
      <ScrollView
        {...scroll}
        scrollEnabled={drag === null}
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={{
          padding: palette.pad,
          gap: palette.gap,
          paddingBottom: 24 + bottomInset,
        }}>
        {rows(page.components)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barText: { flex: 1, gap: 2 },
  row: { borderWidth: 1.5, borderStyle: 'dashed', padding: 10 },
  dragging: {
    zIndex: 10,
    borderStyle: 'solid',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  content: { flex: 1 },
  hidden: { opacity: 0.4 },
  controls: { gap: 6, alignItems: 'center' },
  control: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  children: { paddingLeft: 4 },
  empty: { height: 44, borderWidth: 1.5, borderStyle: 'dashed' },
  line: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
});
