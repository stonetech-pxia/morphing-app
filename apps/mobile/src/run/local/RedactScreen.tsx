import type { Rect } from '@morph/tool-image';
import { Image } from 'expo-image';
import { useReducer, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 打码（TOOLS_DESIGN §4 redact）：在图片上拖出方框盖住隐私内容，逐张确认。
// 坐标一律用原图像素；框的内容只在本次运行里使用。

type Size = { width: number; height: number };

interface State {
  index: number;
  boxes: Rect[][];
  box: Size;
  /** 正在画的框：起点（原图像素）。 */
  start: { x: number; y: number } | null;
  draft: Rect | null;
}

type Action =
  | { type: 'layout'; width: number; height: number }
  | { type: 'grant'; x: number; y: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'next' };

function layoutOf(box: Size, size: Size) {
  const scale = box.width ? Math.min(box.width / size.width, box.height / size.height) : 0;
  const shown = { width: size.width * scale, height: size.height * scale };
  return {
    scale,
    shown,
    offset: { x: (box.width - shown.width) / 2, y: (box.height - shown.height) / 2 },
  };
}

const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);

function reduce(state: State, action: Action, sizes: Size[]): State {
  const size = sizes[state.index]!;
  const { scale, offset } = layoutOf(state.box, size);
  switch (action.type) {
    case 'layout':
      return { ...state, box: { width: action.width, height: action.height } };
    case 'grant':
      if (!scale) return state;
      return {
        ...state,
        start: {
          x: clamp((action.x - offset.x) / scale, size.width),
          y: clamp((action.y - offset.y) / scale, size.height),
        },
        draft: null,
      };
    case 'move': {
      if (!state.start || !scale) return state;
      const x2 = clamp(state.start.x + action.dx / scale, size.width);
      const y2 = clamp(state.start.y + action.dy / scale, size.height);
      return {
        ...state,
        draft: {
          x: Math.min(state.start.x, x2),
          y: Math.min(state.start.y, y2),
          width: Math.abs(x2 - state.start.x),
          height: Math.abs(y2 - state.start.y),
        },
      };
    }
    case 'end': {
      // 太小的框（手指只是点了一下）不算。
      const ok = state.draft && state.draft.width * scale >= 8 && state.draft.height * scale >= 8;
      const boxes = ok
        ? state.boxes.map((b, j) => (j === state.index ? [...b, state.draft!] : b))
        : state.boxes;
      return { ...state, boxes, start: null, draft: null };
    }
    case 'undo':
      return {
        ...state,
        boxes: state.boxes.map((b, j) => (j === state.index ? b.slice(0, -1) : b)),
      };
    case 'next':
      return { ...state, index: Math.min(state.index + 1, sizes.length - 1) };
  }
}

export function RedactScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'redact'>) {
  const zh = locale === 'zh';
  const { items } = input;
  const sizes = items.map((it) => ({ width: it.width ?? 1, height: it.height ?? 1 }));
  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reduce(s, a, sizes),
    null,
    () => ({
      index: 0,
      boxes: items.map(() => []),
      box: { width: 0, height: 0 },
      start: null,
      draft: null,
    }),
  );
  const { index } = state;
  const item = items[index]!;
  const { scale, shown, offset } = layoutOf(state.box, sizes[index]!);
  const boxes = state.boxes[index]!;
  const last = index === items.length - 1;

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) =>
        dispatch({ type: 'grant', x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
      onPanResponderMove: (_e, g) => dispatch({ type: 'move', dx: g.dx, dy: g.dy }),
      onPanResponderRelease: () => dispatch({ type: 'end' }),
      onPanResponderTerminate: () => dispatch({ type: 'end' }),
    }),
  );

  const view = (r: Rect) => ({
    left: offset.x + r.x * scale,
    top: offset.y + r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
  });

  return (
    <LocalFrame
      palette={palette}
      title={
        items.length > 1
          ? `${zh ? '打码' : 'Hide parts'} ${index + 1}/${items.length}`
          : zh
            ? '打码'
            : 'Hide parts'
      }
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'localDone' : 'localNext')}
      onCancel={onCancel}
      onDone={() => {
        if (!last) return dispatch({ type: 'next' });
        onDone(state.boxes);
      }}>
      <Text style={[palette.font('body', 14), styles.hint, { color: palette.muted }]}>
        {zh
          ? '用手指拖出方框，盖住姓名、号码等不想给别人看的地方。'
          : 'Drag to draw boxes over names, numbers or anything private.'}
      </Text>
      <View
        testID="redact-area"
        style={styles.area}
        onLayout={(e) =>
          dispatch({
            type: 'layout',
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
        {...responder.panHandlers}>
        {scale > 0 ? (
          <>
            <View
              pointerEvents="none"
              style={[styles.abs, { left: offset.x, top: offset.y, ...shown }]}>
              <Image source={{ uri: item.uri }} style={shown} contentFit="fill" />
            </View>
            {boxes.map((r, i) => (
              <View
                key={i}
                pointerEvents="none"
                testID={`redact-box-${i}`}
                style={[styles.abs, styles.mark, view(r)]}
              />
            ))}
            {state.draft ? (
              <View pointerEvents="none" style={[styles.abs, styles.draft, view(state.draft)]} />
            ) : null}
          </>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={[palette.font('body', 14), styles.flex, { color: palette.muted }]}>
          {zh ? `${boxes.length} 处` : `${boxes.length} boxes`}
        </Text>
        <Pressable
          testID="redact-undo"
          disabled={boxes.length === 0}
          onPress={() => dispatch({ type: 'undo' })}
          hitSlop={8}>
          <Text
            style={[
              palette.font('bodyBold', 15),
              { color: boxes.length ? palette.primaryText : palette.border },
            ]}>
            {zh ? '撤销一个' : 'Undo'}
          </Text>
        </Pressable>
      </View>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: 20 },
  area: { flex: 1, margin: 16, backgroundColor: '#00000010' },
  abs: { position: 'absolute' },
  mark: { backgroundColor: '#000000CC', borderWidth: 1, borderColor: '#FFFFFF' },
  draft: { borderWidth: 2, borderColor: '#EF4444', backgroundColor: '#EF444433' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  flex: { flex: 1 },
});
