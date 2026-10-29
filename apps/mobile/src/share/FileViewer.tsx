import type { Locale } from '@morph/core';
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { ZoomImage } from './ZoomImage';

// 收件页面的照片和视频全屏看（D-238）：左右滑动翻看这一批里的照片和视频，只在本机显示。
// 照片可以双指缩放（D-277）；结果页的缩略图也用它打开。
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
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  // 放大看图时不翻页（单指拖动用来看局部）。
  const [zoomed, setZoomed] = useState(false);
  return (
    <Modal animationType="fade" onRequestClose={onClose}>
      {/* Android 的 Modal 是另一个窗口，手势要自己的根视图。 */}
      <GestureHandlerRootView style={styles.flex}>
        <View
          testID="share-viewer"
          style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            {/* 「关闭」和收件页面的一样放在左上角。 */}
            <Pressable testID="share-viewer-close" onPress={onClose} hitSlop={10}>
              <Text style={[palette.font('bodyBold', 16), styles.white]}>{t(locale, 'close')}</Text>
            </Pressable>
            <Text
              testID="share-viewer-count"
              style={[palette.font('bodyMedium', 15), styles.white]}>
              {`${index + 1} / ${items.length}`}
            </Text>
          </View>
          <FlatList
            data={items}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!zoomed}
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(item, i) => `${i}-${item.uri}`}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index: i }) => (
              <View style={{ width }}>
                {item.kind === 'image' ? (
                  <ZoomImage
                    uri={item.uri}
                    width={width}
                    height={height}
                    onZoomed={i === index ? setZoomed : undefined}
                  />
                ) : i === index ? (
                  <VideoPage uri={item.uri} />
                ) : null}
              </View>
            )}
          />
        </View>
      </GestureHandlerRootView>
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
