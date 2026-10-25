import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';
import { formatTime, seek, useThumbnails } from './TrimScreen';

/** 时间轴与剪切共用缩略图；截帧只选一个时间，选择结果留在设备上。 */
export function FrameScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'frameMedia'>) {
  const [index, setIndex] = useState(0);
  const [times, setTimes] = useState(() => input.items.map(() => 0));
  const item = input.items[index]!;
  const time = times[index]!;
  const end = Math.max(0, (item.durationMs ?? 1) - 1);
  const [width, setWidth] = useState(0);
  const player = useVideoPlayer(item.uri);
  const thumbnails = useThumbnails(player, item, input.loadThumbnails, index);
  useEffect(() => {
    player.pause();
    seek(player, time);
  }, [player, time]);
  const select = (ms: number) =>
    setTimes((values) =>
      values.map((v, i) => (i === index ? Math.round(Math.min(end, Math.max(0, ms))) : v)),
    );
  return (
    <LocalFrame
      palette={palette}
      title={`${t(locale, 'frameTitle')} · ${index + 1}/${input.items.length}`}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, index === input.items.length - 1 ? 'frameDone' : 'trimNext')}
      onCancel={onCancel}
      onDone={() => (index === input.items.length - 1 ? onDone(times) : setIndex(index + 1))}>
      <VideoView
        testID="frame-preview"
        player={player}
        nativeControls={false}
        contentFit="contain"
        style={styles.preview}
      />
      <View style={styles.controls}>
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'frameHint')}
        </Text>
        <Pressable
          testID="frame-timeline"
          style={styles.timeline}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (width > 0) select((e.nativeEvent.locationX / width) * end);
          }}>
          {/* 缩略图不接收点击：否则 locationX 是相对被点中的那一张算的，点中间会选到开头附近。 */}
          <View style={styles.strip} pointerEvents="none">
            {thumbnails.map((thumb, i) => (
              <Image key={i} source={thumb} contentFit="cover" style={styles.thumb} />
            ))}
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.marker,
              { left: end > 0 ? (time / end) * width : 0, backgroundColor: palette.primary },
            ]}
          />
        </Pressable>
        <Text
          testID="frame-time"
          style={[palette.font('bodyBold', 20), { textAlign: 'center', color: palette.text }]}>
          {formatTime(time, true, locale)}
        </Text>
        <View style={styles.row}>
          {[-1000, -100, 100, 1000].map((delta) => (
            <Pressable
              key={delta}
              testID={`frame-nudge-${delta}`}
              accessibilityRole="button"
              onPress={() => select(time + delta)}
              style={[
                styles.nudge,
                { borderColor: palette.border, borderRadius: palette.controlRadius },
              ]}>
              <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
                {delta > 0 ? '+' : '−'}
                {Math.abs(delta) / 1000}s
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </LocalFrame>
  );
}
const styles = StyleSheet.create({
  preview: { flex: 1, backgroundColor: '#000000', marginHorizontal: 16, borderRadius: 8 },
  controls: { padding: 20, gap: 16 },
  timeline: { height: 60, flexDirection: 'row', marginHorizontal: 24, backgroundColor: '#000000' },
  strip: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  thumb: { flex: 1 },
  marker: { position: 'absolute', top: -4, bottom: -4, width: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  nudge: { padding: 12, borderWidth: 1 },
});
