import type { Locale } from '@morph/core';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';

// 收件页面的照片和视频全屏看（D-238）：左右滑动翻看这一批里的照片和视频，只在本机显示。
// 视频只给正在看的那一页建播放器，系统自带的播放控件，不自动播放。

export interface ViewerItem {
  uri: string;
  kind: 'image' | 'video';
}

function VideoPage({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.flex} contentFit="contain" nativeControls />;
}

/** 收件页面上那一个视频（D-238）：页面上直接显示，点了才播放。 */
export function InlineVideo({ uri, height }: { uri: string; height: number }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      testID="share-preview-video"
      player={player}
      style={{ height, borderRadius: 8 }}
      contentFit="contain"
      nativeControls
    />
  );
}

export function FileViewer({
  items,
  start,
  onClose,
  palette,
  locale,
}: {
  items: readonly ViewerItem[];
  start: number;
  onClose: () => void;
  palette: Palette;
  locale: Locale;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  return (
    <Modal animationType="fade" onRequestClose={onClose}>
      <View
        testID="share-viewer"
        style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          {/* 「关闭」和收件页面的一样放在左上角。 */}
          <Pressable testID="share-viewer-close" onPress={onClose} hitSlop={10}>
            <Text style={[palette.font('bodyBold', 16), styles.white]}>{t(locale, 'close')}</Text>
          </Pressable>
          <Text testID="share-viewer-count" style={[palette.font('bodyMedium', 15), styles.white]}>
            {`${index + 1} / ${items.length}`}
          </Text>
        </View>
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(item, i) => `${i}-${item.uri}`}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (
            <View style={{ width }}>
              {item.kind === 'image' ? (
                <Image source={{ uri: item.uri }} style={styles.flex} contentFit="contain" />
              ) : i === index ? (
                <VideoPage uri={item.uri} />
              ) : null}
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  white: { color: '#FFFFFF' },
  flex: { flex: 1 },
});
