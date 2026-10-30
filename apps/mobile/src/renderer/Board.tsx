import {
  boardColumns,
  boardField,
  boardDragTool,
  boardMoveAction,
  boardTargets,
  calendarOf,
  filterRecords,
  formatRef,
  type BoardColumn,
  type DataRecord,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type HostInstance,
  type ScrollViewInstance,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useRecordActionRunner } from '../data/record-actions';
import { useLinkResolver } from '../data/records';
import { edgeSpeed } from '../editing/ArrangeView';
import { setInnerGesture } from '../editing/useSingleDrag';
import { LONG_PRESS_MS } from '../editing/entry';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import {
  AddHere,
  addHereOf,
  openAddHere,
  useLinkedGroups,
  useListRecords,
  type RecordBlock,
  type Tone,
} from './data';
import { openRow } from './open-row';
import { cardColors, type Palette } from './theme';

// 记录列表的看板外观（D-313）：按一个单选字段分栏，每个选项一栏，再加「未分」；栏横向滚动。
// 长按卡片拖到另一栏 = 改这个字段（一键操作的 set，D-314），弹可以撤销的提示条。
// 不用拖也能移：点卡片弹出「打开 / 移到…」，读屏可以直接用「移到…」操作（给读屏和手不方便的人用）。

const COLUMN_WIDTH = 248;
/** 拖动要比页面的长按编辑（LONG_PRESS_MS）先开始，否则长按会先打开组件的操作面板。 */
const DRAG_DELAY = LONG_PRESS_MS - 150;

const columnKey = (c: BoardColumn) => c.option ?? '';

interface Box {
  key: string;
  x: number;
  width: number;
}

function measure(view: HostInstance | undefined): Promise<{ x: number; width: number } | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, _y, width) => resolve({ x, width }));
  });
}

export function Board({ block, env, tone }: { block: RecordBlock; env: RenderEnv; tone?: Tone }) {
  const { palette, locale } = env;
  const router = useRouter();
  const runner = useRecordActionRunner();
  const { collection, view, sorted } = useListRecords(block, env);
  const links = useLinkResolver(view);
  const [menu, setMenu] = useState<{ record: DataRecord; from: string | null } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // 拖动时的测量和自动横向滚动（拖到看不见的栏）。
  const scrollRef = useRef<ScrollViewInstance>(null);
  const viewport = useRef<HostInstance>(null);
  const columnViews = useRef(new Map<string, HostInstance>());
  const scrollX = useRef(0);
  const session = useRef<{
    id: string;
    from: string;
    fingerX: number;
    scrollAtStart: number;
    scrollAtMeasure: number;
    left: number;
    right: number;
    boxes: Box[];
    hover: string | null;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const scrollShift = useSharedValue(0);
  const content = useRef({ width: 0, viewport: 0 });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const group = block.source.group;
  const linkedAll = useLinkedGroups(env, view, group?.by);
  const field = collection ? boardField(collection, group?.by) : undefined;
  // 拖到另一栏是块上的拖动工具（as drag）；没有它看板只能看（v33 迁移来的看板都有）。
  const drag = boardDragTool(block.tools);
  // 引用字段分栏（D-351）要等被引用的表读出来；groupFilter 先筛出要哪几栏。
  if (!collection || !view || !field || linkedAll === null) return null;
  const linked = linkedAll && {
    ...linkedAll,
    records: filterRecords(
      linkedAll.records,
      linkedAll.collection,
      group?.filter,
      new Date(),
      calendarOf(env.config),
    ),
  };
  const columns = boardColumns(field, sorted, block.source.limit, linked);
  const background = cardColors(palette, tone).background;
  const cal = calendarOf(env.config);
  const now = new Date();
  const columnLabel = (c: BoardColumn) => c.label ?? t(locale, 'boardNotSet');
  // 单组件编辑选中了某个组件时不能拖（那时长按拖的是组件本身）。
  const canDrag = env.interactive && !env.focus?.selectedId && drag !== undefined;

  function move(record: DataRecord, to: BoardColumn) {
    if (env.locked) return env.locked();
    if (!drag) return;
    const label = columnLabel(to);
    void runner.runRow(boardMoveAction(drag, to.option, label), record, {
      message: t(locale, 'boardMoved', { column: label }),
    });
  }

  function hoverAt(fingerX: number) {
    const s = session.current;
    if (!s) return;
    const shift = scrollX.current - s.scrollAtMeasure;
    const box = s.boxes.find((b) => fingerX >= b.x - shift && fingerX < b.x - shift + b.width);
    const next = box?.key ?? null;
    if (next !== s.hover) {
      s.hover = next;
      setHover(next);
    }
  }

  function autoScroll() {
    frame.current = null;
    const s = session.current;
    if (!s) return;
    const speed = s.right > s.left ? edgeSpeed(s.fingerX, s.left, s.right) : 0;
    const max = Math.max(0, content.current.width - content.current.viewport);
    const next = Math.max(0, Math.min(max, scrollX.current + speed));
    if (next === scrollX.current) return;
    scrollX.current = next;
    scrollRef.current?.scrollTo({ x: next, animated: false });
    scrollShift.value = next - s.scrollAtStart;
    hoverAt(s.fingerX);
    frame.current = requestAnimationFrame(autoScroll);
  }

  async function begin(id: string, from: string, fingerX: number) {
    scrollShift.value = 0;
    session.current = {
      id,
      from,
      fingerX,
      scrollAtStart: scrollX.current,
      scrollAtMeasure: scrollX.current,
      left: 0,
      right: 0,
      boxes: [],
      hover: from,
    };
    setDragging({ id, from });
    setHover(from);
    const area = await measure(viewport.current ?? undefined);
    const boxes: Box[] = [];
    for (const [key, v] of columnViews.current) {
      const b = await measure(v);
      if (b) boxes.push({ key, ...b });
    }
    const s = session.current;
    if (!s || s.id !== id) return;
    if (area) {
      s.left = area.x;
      s.right = area.x + area.width;
    }
    s.boxes = boxes;
    s.scrollAtMeasure = scrollX.current;
    hoverAt(s.fingerX);
  }

  function update(fingerX: number) {
    const s = session.current;
    if (!s) return;
    s.fingerX = fingerX;
    hoverAt(fingerX);
    if (frame.current === null) autoScroll();
  }

  function end(commit: boolean) {
    const s = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    scrollShift.value = 0;
    setDragging(null);
    setHover(null);
    if (!commit || !s || s.hover === null || s.hover === s.from) return;
    const record = sorted.find((r) => r.id === s.id);
    const from = columns.find((c) => columnKey(c) === s.from);
    const to =
      from && boardTargets(field!, columns, from.option).find((c) => columnKey(c) === s.hover);
    if (record && to) move(record, to);
  }

  return (
    <View ref={viewport} collapsable={false}>
      <ScrollView
        ref={scrollRef}
        horizontal
        testID="board-scroll"
        scrollEnabled={dragging === null}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          if (!session.current) scrollX.current = e.nativeEvent.contentOffset.x;
        }}
        onLayout={(e) => void (content.current.viewport = e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => void (content.current.width = w)}
        // 底下留出栏的阴影，不被横向滚动的边界切掉。
        style={styles.scroll}
        contentContainerStyle={{ gap: palette.gap - 4, paddingRight: 4, paddingBottom: 12 }}>
        {columns.map((column) => {
          const key = columnKey(column);
          const label = columnLabel(column);
          const targets = boardTargets(field, columns, column.option);
          const lit = dragging !== null && hover === key && key !== dragging.from;
          const droppable = targets.length > 0;
          return (
            <View
              key={key || '-none'}
              testID={`board-column-${key || 'none'}`}
              collapsable={false}
              ref={(v) => {
                // 必填字段不能拖进「未分」：不登记它的位置，拖过去不会亮。
                if (v && (column.option !== null || !field.required))
                  columnViews.current.set(key, v);
                else columnViews.current.delete(key);
              }}
              style={[
                palette.cardStyle(background),
                styles.column,
                {
                  borderRadius: palette.radius,
                  padding: 10,
                  zIndex: dragging?.from === key ? 10 : 0,
                  borderWidth: 2,
                  borderColor: lit ? palette.primary : 'transparent',
                },
              ]}>
              <View style={styles.header} accessibilityRole="header">
                <Text
                  numberOfLines={1}
                  style={[palette.font('title', 15), styles.flex, { color: palette.text }]}>
                  {label}
                </Text>
                <Text
                  style={[palette.font('bodyBold', 13), styles.tabular, { color: palette.muted }]}>
                  {column.records.length}
                </Text>
              </View>
              {column.records.length === 0 ? (
                <View
                  style={[
                    styles.empty,
                    { borderColor: palette.border, borderRadius: palette.controlRadius },
                  ]}>
                  <Text style={[palette.font('body', 13), { color: palette.caption }]}>
                    {t(locale, 'boardColumnEmpty')}
                  </Text>
                </View>
              ) : (
                column.records.map((r) => (
                  <BoardCard
                    key={r.id}
                    record={r}
                    env={env}
                    title={formatRef(r, view, block.show.title, locale, links, now, cal) || '—'}
                    subtitle={(block.show.subtitles ?? [])
                      .map((f) => formatRef(r, view, f, locale, links, now, cal))
                      .filter(Boolean)
                      .join(' · ')}
                    dragging={dragging?.id === r.id}
                    canDrag={canDrag && droppable}
                    scrollShift={scrollShift}
                    moveLabels={targets.map((c) => ({
                      key: columnKey(c),
                      label: t(locale, 'boardMoveTo', { column: columnLabel(c) }),
                    }))}
                    onPress={() =>
                      env.locked ? env.locked() : setMenu({ record: r, from: column.option })
                    }
                    onMove={(to) => {
                      const target = targets.find((c) => columnKey(c) === to);
                      if (target) move(r, target);
                    }}
                    onBegin={(x) => void begin(r.id, key, x)}
                    onUpdate={update}
                    onEnd={end}
                  />
                ))
              )}
              {addHereOf(block) ? (
                <AddHere
                  testID={`board-add-${key || 'none'}`}
                  label={t(locale, 'entryFormAdd')}
                  palette={palette}
                  onPress={
                    env.interactive
                      ? (env.locked ??
                        (() =>
                          openAddHere(
                            router,
                            collection,
                            view,
                            block.source,
                            column.option === null ? {} : { [field.id]: column.option },
                          )))
                      : undefined
                  }
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {menu ? (
        <MoveMenu
          palette={palette}
          locale={locale}
          title={formatRef(menu.record, view, block.show.title, locale, links, now, cal) || '—'}
          options={[
            { key: 'open', label: t(locale, 'open') },
            ...(drag ? boardTargets(field, columns, menu.from) : []).map((c) => ({
              key: `to:${columnKey(c)}`,
              label: t(locale, 'boardMoveTo', { column: columnLabel(c) }),
            })),
          ]}
          onClose={() => setMenu(null)}
          onPick={(key) => {
            const { record, from } = menu;
            setMenu(null);
            if (key === 'open') return openRow(router, block.opens, collection.id, record.id);
            const to = boardTargets(field, columns, from).find((c) => `to:${columnKey(c)}` === key);
            if (to) move(record, to);
          }}
        />
      ) : null}
    </View>
  );
}

function BoardCard({
  record,
  title,
  subtitle,
  env,
  dragging,
  canDrag,
  scrollShift,
  moveLabels,
  onPress,
  onMove,
  onBegin,
  onUpdate,
  onEnd,
}: {
  record: DataRecord;
  title: string;
  subtitle: string;
  env: RenderEnv;
  dragging: boolean;
  canDrag: boolean;
  scrollShift: SharedValue<number>;
  moveLabels: { key: string; label: string }[];
  onPress: () => void;
  onMove: (key: string) => void;
  onBegin: (x: number) => void;
  onUpdate: (x: number) => void;
  onEnd: (commit: boolean) => void;
}) {
  const { palette, locale } = env;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gesture = usePanGesture({
    testID: `board-drag-${record.id}`,
    enabled: canDrag,
    activateAfterLongPress: DRAG_DELAY,
    // 长按前手指先移动超过 8pt 就放弃，交给横向和页面滚动。
    failOffsetX: [-8, 8],
    failOffsetY: [-8, 8],
    maxPointers: 1,
    cancelsTouchesInView: true,
    cancelsJSResponder: true,
    // 拖卡片比页面的长按编辑（D-235）先开始；外层的手势照样会激活，由 setInnerGesture 让它不选中组件。
    onFinalize: () => {
      scheduleOnRN(setInnerGesture, false);
    },
    onActivate: (e) => {
      scheduleOnRN(setInnerGesture, true);
      x.value = 0;
      y.value = 0;
      scheduleOnRN(onBegin, e.absoluteX);
    },
    onUpdate: (e) => {
      x.value = e.translationX;
      y.value = e.translationY;
      scheduleOnRN(onUpdate, e.absoluteX);
    },
    onDeactivate: (e) => {
      x.value = 0;
      y.value = 0;
      scheduleOnRN(onEnd, !e.canceled);
    },
  });
  const animated = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value + (dragging ? scrollShift.value : 0) },
      { translateY: y.value },
      { scale: dragging ? 1.04 : 1 },
    ],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[animated, dragging && styles.lift, { zIndex: dragging ? 10 : 0 }]}>
        <Pressable
          testID={`board-card-${record.id}`}
          accessibilityRole="button"
          accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
          accessibilityHint={t(locale, 'boardCardHint')}
          accessibilityActions={[
            { name: 'activate' },
            ...moveLabels.map((m) => ({ name: `move:${m.key}`, label: m.label })),
          ]}
          onAccessibilityAction={(e) => {
            const name = e.nativeEvent.actionName;
            if (name === 'activate') onPress();
            else if (env.interactive) onMove(name.slice('move:'.length));
          }}
          disabled={!env.interactive}
          onPress={onPress}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              borderRadius: palette.controlRadius,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <Text numberOfLines={2} style={[palette.font('title', 15), { color: palette.text }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} style={[palette.font('body', 13), { color: palette.muted }]}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/** 点卡片弹出的菜单：打开、移到某一栏、取消；每行至少 44 高。 */
function MoveMenu({
  palette,
  locale,
  title,
  options,
  onPick,
  onClose,
}: {
  palette: Palette;
  locale: RenderEnv['locale'];
  title: string;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID="board-menu-backdrop"
        accessibilityLabel={t(locale, 'cancel')}
        style={styles.backdrop}
        onPress={onClose}
      />
      <View
        testID="board-menu"
        style={[
          styles.sheet,
          {
            backgroundColor: palette.surface,
            borderTopLeftRadius: palette.radius,
            borderTopRightRadius: palette.radius,
            paddingBottom: 12 + insets.bottom,
          },
        ]}>
        <Text
          numberOfLines={2}
          style={[palette.font('title', 16), styles.sheetTitle, { color: palette.text }]}>
          {title}
        </Text>
        <ScrollView style={styles.sheetList}>
          {options.map((o) => (
            <Pressable
              key={o.key}
              testID={`board-menu-${o.key}`}
              accessibilityRole="button"
              onPress={() => onPick(o.key)}
              style={({ pressed }) => [
                styles.sheetRow,
                { borderColor: palette.border, opacity: pressed ? 0.6 : 1 },
              ]}>
              <Text
                numberOfLines={1}
                style={[palette.font('bodyMedium', 16), { color: palette.primaryText }]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            testID="board-menu-cancel"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.sheetRow,
              { borderColor: palette.border, opacity: pressed ? 0.6 : 1 },
            ]}>
            <Text style={[palette.font('body', 16), { color: palette.muted }]}>
              {t(locale, 'cancel')}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { marginBottom: -12 },
  column: { width: COLUMN_WIDTH, gap: 8, alignSelf: 'flex-start' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    minHeight: 28,
  },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4, minHeight: 44 },
  lift: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { paddingTop: 16, paddingHorizontal: 16, maxHeight: '70%' },
  sheetTitle: { paddingHorizontal: 4, paddingBottom: 8 },
  sheetList: { flexGrow: 0 },
  sheetRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
