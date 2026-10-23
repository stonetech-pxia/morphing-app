import type { RunItem } from '@morph/core';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useReducer, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { Icon } from '../../renderer/Icon';
import type { Palette } from '../../renderer/theme';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 剪一段（TOOLS_DESIGN §4 trimMedia，D-143）：逐个选开始和结束。视频和音频共用起止拖动、微调、
// 时间显示和「只播放这一段」；上半部分视频显示画面，音频以后由音频工具补上波形（现在是图标）。
// 结果只在本次运行里使用。

/** 至少留多长（毫秒）。 */
export const MIN_TRIM_MS = 1000;
const NUDGE_MS = 1000;
const THUMBS = 8;
const HANDLE = 22;

export interface TrimRange {
  startMs: number;
  endMs: number;
}

/** 移动一边，另一边不动；保证在 0–duration 之间、至少留 MIN_TRIM_MS。 */
export function moveEdge(
  range: TrimRange,
  edge: 'start' | 'end',
  ms: number,
  durationMs: number,
): TrimRange {
  const min = Math.min(MIN_TRIM_MS, durationMs);
  if (edge === 'start') {
    const startMs = Math.round(Math.min(Math.max(0, ms), range.endMs - min));
    return { ...range, startMs };
  }
  const endMs = Math.round(Math.max(Math.min(durationMs, ms), range.startMs + min));
  return { ...range, endMs };
}

/** 跳到某个时间（毫秒）。 */
function seek(player: VideoPlayer, ms: number) {
  player.currentTime = ms / 1000;
}

/** 0:05、1:02:03（显示到十分之一秒时 0:05.4）。 */
export function formatTime(ms: number, tenths = false): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

interface TrimState {
  index: number;
  ranges: TrimRange[];
  width: number;
  drag: { edge: 'start' | 'end'; from: number } | null;
  /** 最近动过的一边：画面停在这一边。 */
  edge: 'start' | 'end' | null;
}

type TrimAction =
  | { type: 'layout'; width: number }
  | { type: 'grant'; x: number }
  | { type: 'move'; dx: number }
  | { type: 'end' }
  | { type: 'nudge'; edge: 'start' | 'end'; deltaMs: number }
  | { type: 'next' };

function reduce(state: TrimState, action: TrimAction, durations: number[]): TrimState {
  const duration = durations[state.index]!;
  const range = state.ranges[state.index]!;
  const replace = (next: TrimRange) => state.ranges.map((r, j) => (j === state.index ? next : r));
  const msPerPx = state.width > 0 ? duration / state.width : 0;
  switch (action.type) {
    case 'layout':
      return { ...state, width: action.width };
    case 'grant': {
      if (!msPerPx) return state;
      // 拖离手指近的那一边。
      const ms = action.x * msPerPx;
      const edge = Math.abs(ms - range.startMs) <= Math.abs(ms - range.endMs) ? 'start' : 'end';
      return {
        ...state,
        edge,
        drag: { edge, from: edge === 'start' ? range.startMs : range.endMs },
      };
    }
    case 'move': {
      if (!state.drag || !msPerPx) return state;
      const next = moveEdge(
        range,
        state.drag.edge,
        state.drag.from + action.dx * msPerPx,
        duration,
      );
      return { ...state, ranges: replace(next) };
    }
    case 'end':
      return { ...state, drag: null };
    case 'nudge': {
      const at = action.edge === 'start' ? range.startMs : range.endMs;
      return {
        ...state,
        edge: action.edge,
        ranges: replace(moveEdge(range, action.edge, at + action.deltaMs, duration)),
      };
    }
    case 'next':
      return {
        ...state,
        index: Math.min(state.index + 1, durations.length - 1),
        drag: null,
        edge: null,
      };
  }
}

/** 上半部分：视频画面，音频是图标（波形以后由音频工具补上）；下面是「只播放这一段」。 */
function Preview({
  item,
  player,
  range,
  edge,
  palette,
  locale,
}: {
  item: RunItem;
  player: VideoPlayer;
  range: TrimRange;
  edge: 'start' | 'end' | null;
  palette: Palette;
  locale: 'en' | 'zh';
}) {
  const video = item.mimeType.startsWith('video/');
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  // 拖动时画面跟着跳到那一边。
  useEffect(() => {
    if (edge === null) return;
    player.pause();
    seek(player, edge === 'start' ? range.startMs : range.endMs);
  }, [player, edge, range.startMs, range.endMs]);

  // 「只播放这一段」：播到结束点停下。
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (player.playing && currentTime * 1000 >= range.endMs) player.pause();
  });

  return (
    <View style={styles.preview}>
      {video ? (
        <VideoView
          testID="trim-video"
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
        />
      ) : (
        <View style={[styles.video, styles.center, { backgroundColor: palette.primaryTint }]}>
          <Icon name="audio" size={48} color={palette.primaryText} />
        </View>
      )}
      <Pressable
        testID="trim-play"
        onPress={() => {
          if (isPlaying) {
            player.pause();
            return;
          }
          seek(player, range.startMs);
          player.play();
        }}
        style={[styles.play, { borderColor: palette.border, borderRadius: palette.controlRadius }]}>
        <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
          {t(locale, isPlaying ? 'trimPause' : 'trimPlaySelection')}
        </Text>
      </Pressable>
    </View>
  );
}

/** 时间轴的缩略图（只有视频）。 */
function useThumbnails(player: VideoPlayer, item: RunItem): VideoThumbnail[] {
  // 记下是哪个文件的缩略图：换文件时不用在 effect 里清空。
  const [thumbs, setThumbs] = useState<{ uri: string; list: VideoThumbnail[] } | null>(null);
  const duration = item.durationMs ?? 0;
  const video = item.mimeType.startsWith('video/');
  const uri = item.uri;
  useEffect(() => {
    if (!video || duration <= 0) return;
    let alive = true;
    const times = Array.from({ length: THUMBS }, (_, i) => ((i + 0.5) * duration) / THUMBS / 1000);
    player
      .generateThumbnailsAsync(times, { maxWidth: 160 })
      .then((list) => {
        if (alive) setThumbs({ uri, list });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [player, video, duration, uri]);
  return thumbs?.uri === uri ? thumbs.list : [];
}

export function TrimScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'trimMedia'>) {
  const { items } = input;
  const durations = items.map((it) => Math.max(1, it.durationMs ?? 1));
  const [state, dispatch] = useReducer(
    (s: TrimState, a: TrimAction) => reduce(s, a, durations),
    null,
    () => ({
      index: 0,
      ranges: durations.map((d) => ({ startMs: 0, endMs: d })),
      width: 0,
      drag: null,
      edge: null,
    }),
  );
  const { index, ranges, width } = state;
  const item = items[index]!;
  const range = ranges[index]!;
  const duration = durations[index]!;
  // 换到下一个文件时换播放器（useVideoPlayer 随地址重建）。
  const player = useVideoPlayer(item.uri, (p) => {
    p.timeUpdateEventInterval = 0.1;
  });
  const thumbs = useThumbnails(player, item);

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => dispatch({ type: 'grant', x: e.nativeEvent.locationX }),
      onPanResponderMove: (_e, g) => dispatch({ type: 'move', dx: g.dx }),
      onPanResponderRelease: () => dispatch({ type: 'end' }),
      onPanResponderTerminate: () => dispatch({ type: 'end' }),
    }),
  );

  const last = index === items.length - 1;
  const left = (range.startMs / duration) * width;
  const right = (range.endMs / duration) * width;
  const nudge = (edge: 'start' | 'end', deltaMs: number, label: string) => (
    <Pressable
      testID={`trim-${edge}-${deltaMs > 0 ? 'plus' : 'minus'}`}
      onPress={() => dispatch({ type: 'nudge', edge, deltaMs })}
      hitSlop={6}
      style={[styles.nudge, { borderColor: palette.border, borderRadius: palette.controlRadius }]}>
      <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>{label}</Text>
    </Pressable>
  );
  const edgeRow = (edge: 'start' | 'end') => (
    <View style={styles.edgeRow}>
      <Text style={[palette.font('body', 15), styles.edgeLabel, { color: palette.muted }]}>
        {t(locale, edge === 'start' ? 'trimStart' : 'trimEnd')}
      </Text>
      {nudge(edge, -NUDGE_MS, '−1s')}
      <Text
        testID={`trim-${edge}`}
        style={[palette.font('bodyBold', 17), styles.time, { color: palette.text }]}>
        {formatTime(edge === 'start' ? range.startMs : range.endMs, true)}
      </Text>
      {nudge(edge, NUDGE_MS, '+1s')}
    </View>
  );

  return (
    <LocalFrame
      palette={palette}
      title={
        items.length > 1
          ? `${t(locale, 'trimTitle')} · ${t(locale, 'trimOf', { n: index + 1, total: items.length })}`
          : t(locale, 'trimTitle')
      }
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'trimDone' : 'trimNext')}
      onCancel={onCancel}
      onDone={() => {
        if (!last) return dispatch({ type: 'next' });
        onDone(ranges);
      }}>
      <Preview
        key={item.uri}
        item={item}
        player={player}
        range={range}
        edge={state.edge}
        palette={palette}
        locale={locale}
      />
      <View style={styles.controls}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {t(locale, 'trimHint')}
        </Text>
        <View
          testID="trim-timeline"
          style={[styles.timeline, { backgroundColor: palette.primaryTint }]}
          onLayout={(e) => dispatch({ type: 'layout', width: e.nativeEvent.layout.width })}
          {...responder.panHandlers}>
          <View style={styles.strip} pointerEvents="none">
            {thumbs.map((thumb, i) => (
              <Image key={i} source={thumb} style={styles.thumb} contentFit="cover" />
            ))}
          </View>
          {width > 0 ? (
            <>
              <View pointerEvents="none" style={[styles.dim, { left: 0, width: left }]} />
              <View
                pointerEvents="none"
                style={[styles.dim, { left: right, width: Math.max(0, width - right) }]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.selection,
                  { left, width: Math.max(0, right - left), borderColor: palette.primary },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.handle,
                  { left: left - HANDLE / 2, backgroundColor: palette.primary },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.handle,
                  { left: right - HANDLE / 2, backgroundColor: palette.primary },
                ]}
              />
            </>
          ) : null}
        </View>
        {edgeRow('start')}
        {edgeRow('end')}
        <Text
          testID="trim-length"
          style={[palette.font('bodyMedium', 15), { color: palette.muted, textAlign: 'center' }]}>
          {t(locale, 'trimLength', { length: formatTime(range.endMs - range.startMs, true) })}
        </Text>
      </View>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, paddingHorizontal: 16, gap: 10 },
  video: { flex: 1, backgroundColor: '#000000', borderRadius: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  play: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 8, borderWidth: 1 },
  strip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: { flex: 1 },
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  timeline: { height: 52, borderRadius: 8 },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#00000055' },
  selection: { position: 'absolute', top: 0, bottom: 0, borderTopWidth: 3, borderBottomWidth: 3 },
  handle: { position: 'absolute', top: -4, bottom: -4, width: HANDLE, borderRadius: 6 },
  edgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  edgeLabel: { width: 48 },
  time: { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  nudge: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
});
