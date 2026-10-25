import { centeredCropForAspect, clampCrop, type Rect } from '@morph/tool-image';
import { Image } from 'expo-image';
import { useReducer, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 裁剪框（TOOLS_DESIGN §4 crop）：逐张框选，拖框内移动，拖四角缩放；锁定比例时保持比例。
// 坐标一律用原图像素，结果交回执行器按原图裁剪。

const HANDLE = 28;

type Corner = 'tl' | 'tr' | 'bl' | 'br';

function initialRect(size: { width: number; height: number }, aspect: number | null): Rect {
  if (aspect) return centeredCropForAspect(size, aspect);
  const inset = 0.05;
  return {
    x: Math.round(size.width * inset),
    y: Math.round(size.height * inset),
    width: Math.round(size.width * (1 - 2 * inset)),
    height: Math.round(size.height * (1 - 2 * inset)),
  };
}

/** 拖动某个角：对角固定；锁定比例时以宽度为准。 */
function resizeFrom(
  start: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  aspect: number | null,
): Rect {
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  let width = Math.max(16, start.width + (left ? -dx : dx));
  let height = Math.max(16, start.height + (top ? -dy : dy));
  if (aspect) height = width / aspect;
  if (aspect && height < 16) {
    height = 16;
    width = height * aspect;
  }
  return {
    x: left ? start.x + start.width - width : start.x,
    y: top ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

interface CropState {
  index: number;
  rects: Rect[];
  box: { width: number; height: number };
  drag: { mode: Corner | 'move'; start: Rect } | null;
}

type CropAction =
  | { type: 'layout'; width: number; height: number }
  | { type: 'grant'; x: number; y: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'end' }
  | { type: 'next' }
  | { type: 'reset' };

/** 图片在区域里的显示位置和缩放。 */
function layoutOf(box: CropState['box'], size: { width: number; height: number }) {
  const scale = box.width ? Math.min(box.width / size.width, box.height / size.height) : 0;
  const shown = { width: size.width * scale, height: size.height * scale };
  return {
    scale,
    shown,
    offset: { x: (box.width - shown.width) / 2, y: (box.height - shown.height) / 2 },
  };
}

function reduce(
  state: CropState,
  action: CropAction,
  sizes: { width: number; height: number }[],
  aspect: number | null,
): CropState {
  const size = sizes[state.index]!;
  const rect = state.rects[state.index]!;
  const { scale, offset } = layoutOf(state.box, size);
  const replace = (next: Rect) => state.rects.map((r, j) => (j === state.index ? next : r));
  switch (action.type) {
    case 'layout':
      return { ...state, box: { width: action.width, height: action.height } };
    case 'grant': {
      if (!scale) return state;
      const px = (action.x - offset.x) / scale;
      const py = (action.y - offset.y) / scale;
      const near = (x: number, y: number) =>
        Math.abs(px - x) * scale < HANDLE && Math.abs(py - y) * scale < HANDLE;
      const mode: Corner | 'move' = near(rect.x, rect.y)
        ? 'tl'
        : near(rect.x + rect.width, rect.y)
          ? 'tr'
          : near(rect.x, rect.y + rect.height)
            ? 'bl'
            : near(rect.x + rect.width, rect.y + rect.height)
              ? 'br'
              : 'move';
      return { ...state, drag: { mode, start: rect } };
    }
    case 'move': {
      if (!state.drag || !scale) return state;
      const { mode, start } = state.drag;
      const dx = action.dx / scale;
      const dy = action.dy / scale;
      const next =
        mode === 'move'
          ? {
              ...start,
              x: Math.min(Math.max(0, start.x + dx), size.width - start.width),
              y: Math.min(Math.max(0, start.y + dy), size.height - start.height),
            }
          : clampCrop(resizeFrom(start, mode, dx, dy, aspect), size, aspect ? { aspect } : {});
      return { ...state, rects: replace(next) };
    }
    case 'end':
      return { ...state, drag: null };
    case 'next':
      return { ...state, index: Math.min(state.index + 1, sizes.length - 1), drag: null };
    case 'reset':
      return { ...state, rects: replace(initialRect(size, aspect)) };
  }
}

export function CropScreen({ input, palette, locale, onDone, onCancel }: LocalScreenProps<'crop'>) {
  const { items, aspect } = input;
  const sizes = items.map((it) => ({ width: it.width ?? 1, height: it.height ?? 1 }));
  const [state, dispatch] = useReducer(
    (s: CropState, a: CropAction) => reduce(s, a, sizes, aspect),
    null,
    () => ({
      index: 0,
      rects: sizes.map((size) => initialRect(size, aspect)),
      box: { width: 0, height: 0 },
      drag: null,
    }),
  );
  const { index, rects } = state;
  const item = items[index]!;
  const { scale, shown, offset } = layoutOf(state.box, sizes[index]!);
  const rect = rects[index]!;

  // PanResponder 只创建一次；回调只发出动作，所有计算在 reduce 里完成。
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) =>
        dispatch({ type: 'grant', x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
      onPanResponderMove: (_e, g) => dispatch({ type: 'move', dx: g.dx, dy: g.dy }),
      onPanResponderRelease: () => dispatch({ type: 'end' }),
      onPanResponderTerminate: () => dispatch({ type: 'end' }),
    }),
  );

  const last = index === items.length - 1;

  const view = (r: Rect) => ({
    left: offset.x + r.x * scale,
    top: offset.y + r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
  });
  const v = view(rect);
  const shade = '#00000088';

  return (
    <LocalFrame
      palette={palette}
      title={
        items.length > 1
          ? `${t(locale, 'CropScreen_Crop_007d5')} ${index + 1}/${items.length}`
          : t(locale, 'CropScreen_Crop_007d5')
      }
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'localDone' : 'localNext')}
      onCancel={onCancel}
      onDone={() => {
        if (!last) return dispatch({ type: 'next' });
        onDone(rects.map((r, j) => clampCrop(r, sizes[j]!)));
      }}>
      <View
        testID="crop-area"
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
            {/* 图片和遮罩都不接收触摸，坐标始终相对于裁剪区域。 */}
            <View
              pointerEvents="none"
              style={[styles.abs, { left: offset.x, top: offset.y, ...shown }]}>
              <Image source={{ uri: item.uri }} style={shown} contentFit="fill" />
            </View>
            {/* 框外变暗 */}
            <View
              pointerEvents="none"
              style={[
                styles.abs,
                {
                  left: offset.x,
                  top: offset.y,
                  width: shown.width,
                  height: v.top - offset.y,
                  backgroundColor: shade,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.abs,
                {
                  left: offset.x,
                  top: v.top + v.height,
                  width: shown.width,
                  height: offset.y + shown.height - v.top - v.height,
                  backgroundColor: shade,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.abs,
                {
                  left: offset.x,
                  top: v.top,
                  width: v.left - offset.x,
                  height: v.height,
                  backgroundColor: shade,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.abs,
                {
                  left: v.left + v.width,
                  top: v.top,
                  width: offset.x + shown.width - v.left - v.width,
                  height: v.height,
                  backgroundColor: shade,
                },
              ]}
            />
            <View pointerEvents="none" style={[styles.abs, styles.frame, v]}>
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <View
                  key={c}
                  style={[
                    styles.handle,
                    {
                      [c[0] === 't' ? 'top' : 'bottom']: -4,
                      [c[1] === 'l' ? 'left' : 'right']: -4,
                    },
                  ]}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {`${Math.round(rect.width)} × ${Math.round(rect.height)} px`}
        </Text>
        <Pressable testID="crop-reset" onPress={() => dispatch({ type: 'reset' })}>
          <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
            {t(locale, 'CropScreen_Reset_efa10')}
          </Text>
        </Pressable>
      </View>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, margin: 16, backgroundColor: '#00000010' },
  abs: { position: 'absolute' },
  frame: { borderWidth: 2, borderColor: '#FFFFFF' },
  handle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#00000055',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
});
