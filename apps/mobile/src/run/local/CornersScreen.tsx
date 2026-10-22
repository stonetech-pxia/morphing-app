import { Canvas, Path } from '@shopify/react-native-skia';
import {
  QUAD_CORNERS,
  clampQuad,
  defaultQuad,
  isConvexQuad,
  type Point,
  type Quad,
  type QuadCorner,
} from '@morph/tool-image';
import { Image } from 'expo-image';
import { useReducer, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 扫描的四个角（TOOLS_DESIGN §4 corners）：显示扫描包找到的纸张边框，用户逐张确认或拖动四个角。
// 找不到时给一个内缩的默认框。坐标一律用原图像素；拖乱（交叉）的框不能提交。

/** 手指离角多近算按住了这个角（屏幕点）。 */
const GRAB = 44;

type Size = { width: number; height: number };

interface State {
  index: number;
  quads: Quad[];
  box: Size;
  drag: { corner: QuadCorner; start: Point } | null;
}

type Action =
  | { type: 'layout'; width: number; height: number }
  | { type: 'grant'; x: number; y: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'end' }
  | { type: 'next' }
  | { type: 'set'; quad: Quad };

function layoutOf(box: Size, size: Size) {
  const scale = box.width ? Math.min(box.width / size.width, box.height / size.height) : 0;
  const shown = { width: size.width * scale, height: size.height * scale };
  return {
    scale,
    shown,
    offset: { x: (box.width - shown.width) / 2, y: (box.height - shown.height) / 2 },
  };
}

function reduce(state: State, action: Action, sizes: Size[]): State {
  const size = sizes[state.index]!;
  const quad = state.quads[state.index]!;
  const { scale, offset } = layoutOf(state.box, size);
  const replace = (next: Quad) => state.quads.map((q, j) => (j === state.index ? next : q));
  switch (action.type) {
    case 'layout':
      return { ...state, box: { width: action.width, height: action.height } };
    case 'grant': {
      if (!scale) return state;
      let best: { corner: QuadCorner; d: number } | null = null;
      for (const corner of QUAD_CORNERS) {
        const p = quad[corner];
        const d = Math.hypot(offset.x + p.x * scale - action.x, offset.y + p.y * scale - action.y);
        if (d < GRAB && (!best || d < best.d)) best = { corner, d };
      }
      return best ? { ...state, drag: { corner: best.corner, start: quad[best.corner] } } : state;
    }
    case 'move': {
      if (!state.drag || !scale) return state;
      const { corner, start } = state.drag;
      const next = {
        ...quad,
        [corner]: { x: start.x + action.dx / scale, y: start.y + action.dy / scale },
      };
      return { ...state, quads: replace(clampQuad(next, size)) };
    }
    case 'end':
      return { ...state, drag: null };
    case 'next':
      return { ...state, index: Math.min(state.index + 1, sizes.length - 1), drag: null };
    case 'set':
      return { ...state, quads: replace(action.quad) };
  }
}

export function CornersScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'corners'>) {
  const zh = locale === 'zh';
  const { items } = input;
  const sizes = items.map(({ item }) => ({ width: item.width ?? 1, height: item.height ?? 1 }));
  const initial = (i: number) => items[i]!.quad ?? defaultQuad(sizes[i]!);
  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reduce(s, a, sizes),
    null,
    () => ({
      index: 0,
      quads: items.map((_, i) => initial(i)),
      box: { width: 0, height: 0 },
      drag: null,
    }),
  );
  const { index, quads } = state;
  const { item, quad: found } = items[index]!;
  const quad = quads[index]!;
  const { scale, shown, offset } = layoutOf(state.box, sizes[index]!);
  const valid = isConvexQuad(quad, 64);
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

  const screen = (p: Point) => ({ x: offset.x + p.x * scale, y: offset.y + p.y * scale });
  const outline = QUAD_CORNERS.map((c, i) => {
    const p = screen(quad[c]);
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(' ');

  const link = (label: string, onPress: () => void, testID: string) => (
    <Pressable testID={testID} onPress={onPress} hitSlop={8}>
      <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>{label}</Text>
    </Pressable>
  );

  return (
    <LocalFrame
      palette={palette}
      title={
        items.length > 1
          ? `${zh ? '调整四个角' : 'Adjust corners'} ${index + 1}/${items.length}`
          : zh
            ? '调整四个角'
            : 'Adjust corners'
      }
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'localDone' : 'localNext')}
      doneDisabled={!valid}
      onCancel={onCancel}
      onDone={() => {
        if (!last) return dispatch({ type: 'next' });
        onDone(quads);
      }}>
      <Text style={[palette.font('body', 14), styles.hint, { color: palette.muted }]}>
        {found
          ? zh
            ? '已找到纸张的边。不对的话，拖动四个角。'
            : 'Found the edges of the paper. Drag the corners if they are off.'
          : zh
            ? '没找到纸张的边，请把四个角拖到纸张的四个角上。'
            : 'Could not find the paper. Drag the four corners onto its corners.'}
      </Text>
      <View
        testID="corners-area"
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
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path path={`${outline} Z`} style="fill" color={valid ? '#3B82F633' : '#EF444433'} />
              <Path
                path={`${outline} Z`}
                style="stroke"
                strokeWidth={2.5}
                strokeJoin="round"
                color={valid ? '#3B82F6' : '#EF4444'}
              />
            </Canvas>
            {QUAD_CORNERS.map((c) => {
              const p = screen(quad[c]);
              return (
                <View
                  key={c}
                  pointerEvents="none"
                  testID={`corner-${c}`}
                  style={[styles.handle, { left: p.x - 14, top: p.y - 14 }]}
                />
              );
            })}
          </>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text
          style={[
            palette.font('body', 14),
            styles.flex,
            { color: valid ? palette.muted : palette.danger },
          ]}>
          {valid
            ? zh
              ? '拖动圆点调整'
              : 'Drag the dots'
            : zh
              ? '四个角的位置不对'
              : 'The corners are crossed'}
        </Text>
        {found
          ? link(
              zh ? '自动找到的' : 'Detected',
              () => dispatch({ type: 'set', quad: found }),
              'corners-detected',
            )
          : null}
        {link(
          zh ? '整张照片' : 'Whole photo',
          () => dispatch({ type: 'set', quad: defaultQuad(sizes[index]!, 0) }),
          'corners-whole',
        )}
      </View>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: 20 },
  area: { flex: 1, margin: 16, backgroundColor: '#00000010' },
  abs: { position: 'absolute' },
  handle: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFFCC',
    borderWidth: 3,
    borderColor: '#3B82F6',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  flex: { flex: 1 },
});
