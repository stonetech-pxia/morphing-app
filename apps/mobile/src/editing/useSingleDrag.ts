import { dropOp, type Op, type Page } from '@morph/core';
import { useEffect, useRef, useState } from 'react';
import { type HostInstance, type ScrollViewInstance, type ScrollViewProps } from 'react-native';
import { useNativeGesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

import { edgeSpeed } from './ArrangeView';
import { findDropTarget, type DropTarget, type ItemBox } from './drop-target';

function measure(view: HostInstance | null | undefined): Promise<ItemBox | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

/** 测量的是没有 transform 的外框；UI 线程上的跟手位移不会污染落点坐标。 */
export function useSingleDrag(
  page: Page,
  onSelect: (id: string) => void,
  onMove: (op: Op) => void,
) {
  const latest = useRef({ page, onSelect, onMove });
  useEffect(() => {
    latest.current = { page, onSelect, onMove };
  });
  const views = useRef(new Map<string, { view: HostInstance; inCell: boolean }>());
  const scrollRef = useRef<ScrollViewInstance>(null);
  const viewportRef = useRef<HostInstance>(null);
  const metrics = useRef({ y: 0, height: 0, content: 0, top: 0, left: 0 });
  const session = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
    scrollAtStart: number;
    scrollAtMeasure: number;
    boxes: Map<string, ItemBox>;
    target: DropTarget | null;
    moved: boolean;
    ready: Promise<void>;
    released: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const scrollShift = useSharedValue(0);
  const scrollGesture = useNativeGesture();

  function stopFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  useEffect(
    () => () => {
      stopFrame();
      session.current = null;
    },
    [],
  );

  function follow() {
    const current = session.current;
    if (!current) return;
    scrollShift.value = metrics.current.y - current.scrollAtStart;
    const shift = metrics.current.y - current.scrollAtMeasure;
    current.target = findDropTarget(latest.current.page, current.id, current.boxes, {
      x: current.x,
      y: current.y + shift,
    });
    const found = current.target;
    setTarget(
      found
        ? {
            ...found,
            line: {
              ...found.line,
              x: found.line.x - metrics.current.left,
              y: found.line.y - shift - metrics.current.top,
            },
          }
        : null,
    );
  }
  function autoScroll() {
    frame.current = null;
    const current = session.current;
    if (!current) return;
    const m = metrics.current;
    const speed = current.moved && m.height > 0 ? edgeSpeed(current.y, m.top, m.top + m.height) : 0;
    const next = Math.max(0, Math.min(Math.max(0, m.content - m.height), m.y + speed));
    if (next !== m.y) {
      m.y = next;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      current.moved = true;
      follow();
    }
    // 即使暂时滚不动，也继续检查；内容尺寸可能刚刚变化。
    frame.current = requestAnimationFrame(autoScroll);
  }
  function begin(id: string, x: number, y: number) {
    if (session.current) return;
    latest.current.onSelect(id);
    const current = {
      id,
      x,
      y,
      startX: x,
      startY: y,
      scrollAtStart: metrics.current.y,
      scrollAtMeasure: metrics.current.y,
      boxes: new Map<string, ItemBox>(),
      target: null as DropTarget | null,
      moved: false,
      released: false,
      ready: Promise.resolve(),
    };
    session.current = current;
    setDraggingId(id);
    scrollShift.value = 0;
    current.ready = Promise.all([
      measure(viewportRef.current),
      ...[...views.current].map(async ([key, entry]) => {
        const box = await measure(entry.view);
        if (box) current.boxes.set(key, { ...box, inCell: entry.inCell });
      }),
    ]).then(([area]) => {
      if (session.current !== current) return;
      if (area) {
        metrics.current.left = area.x;
        metrics.current.top = area.y;
        metrics.current.height = area.height;
      }
      current.scrollAtMeasure = metrics.current.y;
      follow();
      if (!current.released && frame.current === null)
        frame.current = requestAnimationFrame(autoScroll);
    });
  }
  function move(id: string, x: number, y: number) {
    const current = session.current;
    if (!current || current.id !== id) return;
    current.x = x;
    current.y = y;
    if (Math.hypot(x - current.startX, y - current.startY) > 4) current.moved = true;
    follow();
  }
  async function end(id: string, commit: boolean) {
    const current = session.current;
    if (!current || current.id !== id) return;
    current.released = true;
    stopFrame();
    // 松手早于 measureInWindow 回调时，等同一份测量结束后再决定落点。
    // 取消则立即清理；晚到的测量用 session 身份检查丢弃。
    if (commit) {
      await current.ready;
      if (session.current !== current) return;
      follow();
    }
    session.current = null;
    setDraggingId(null);
    setTarget(null);
    scrollShift.value = 0;
    if (!commit || !current.moved || !current.target) return;
    const op = dropOp(latest.current.page, id, current.target.slot);
    if (op) latest.current.onMove(op);
  }
  const scroll: ScrollViewProps = {
    scrollEnabled: draggingId === null,
    removeClippedSubviews: false,
    onScroll: (e) => {
      if (!session.current) metrics.current.y = e.nativeEvent.contentOffset.y;
    },
    onLayout: (e) => {
      metrics.current.height = e.nativeEvent.layout.height;
    },
    onContentSizeChange: (_w, height) => {
      metrics.current.content = height;
    },
  };
  return {
    attachScroll: (view: ScrollViewInstance | null) => {
      scrollRef.current = view;
    },
    attachViewport: (view: HostInstance | null) => {
      viewportRef.current = view;
    },
    scroll,
    draggingId,
    target,
    scrollShift,
    scrollGesture,
    /** 组件相对滚动内容的位置（工具栏画在滚动内容里）；量不了时立刻给 null。 */
    measureInContent: (id: string, done: (box: ItemBox | null) => void) => {
      const view = views.current.get(id)?.view;
      // 测试替身没有内层视图时退回滚动视图本身。
      const inner = scrollRef.current?.getInnerViewRef() ?? scrollRef.current;
      if (!view || !inner) return done(null);
      view.measureLayout(
        inner,
        (x, y, width, height) => done({ x, y, width, height }),
        () => done(null),
      );
    },
    register: (id: string, view: HostInstance | null, inCell: boolean) => {
      if (view) views.current.set(id, { view, inCell });
      else views.current.delete(id);
    },
    begin: (id: string, x: number, y: number) => {
      void begin(id, x, y);
    },
    move,
    end: (id: string, commit: boolean) => {
      void end(id, commit);
    },
  };
}
export type SingleDrag = ReturnType<typeof useSingleDrag>;
