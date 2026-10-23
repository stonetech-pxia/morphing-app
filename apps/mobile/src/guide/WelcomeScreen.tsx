import type { IconName } from '@morph/core';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t, type StringKey } from '../i18n';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useGuide } from './store';

const PAGES: { icon: IconName; title: StringKey; body: StringKey }[] = [
  { icon: 'sparkles', title: 'guideIntro1Title', body: 'guideIntro1Body' },
  { icon: 'history', title: 'guideIntro2Title', body: 'guideIntro2Body' },
  { icon: 'workflow', title: 'guideIntro3Title', body: 'guideIntro3Body' },
];

/**
 * 划屏介绍（D-149）：三页，每页一句话；可以跳过。看完或跳过都进入首页的第 1 步，
 * 惊喜留给用户自己动手。
 */
export function WelcomeScreen() {
  const { locale } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  const setStage = useGuide((s) => s.setStage);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const last = index === PAGES.length - 1;

  function finish() {
    void setStage('look');
    router.back();
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <View
      testID="welcome"
      style={[
        styles.root,
        palette.backdrop,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 16 },
      ]}>
      <Pressable
        testID="welcome-skip"
        accessibilityRole="button"
        onPress={finish}
        hitSlop={10}
        style={styles.skip}>
        <Text style={[palette.font('bodyMedium', 15), { color: palette.muted }]}>
          {t(locale, 'guideSkip')}
        </Text>
      </Pressable>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={styles.flex}>
        {PAGES.map((page, i) => (
          <View key={page.title} style={[styles.page, { width }]} testID={`welcome-page-${i}`}>
            <View style={[styles.badge, { backgroundColor: palette.primaryTint }]}>
              <Icon name={page.icon} size={56} color={palette.primaryText} />
            </View>
            <Text
              style={[
                palette.font('heading', 28),
                styles.center,
                { color: palette.text, letterSpacing: -0.5 },
              ]}>
              {t(locale, page.title)}
            </Text>
            <Text style={[palette.font('body', 17), styles.center, { color: palette.muted }]}>
              {t(locale, page.body)}
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {PAGES.map((page, i) => (
          <View
            key={page.title}
            style={[
              styles.dot,
              { backgroundColor: i === index ? palette.primary : palette.border },
              i === index && styles.dotActive,
            ]}
          />
        ))}
      </View>
      <Button
        palette={palette}
        testID="welcome-next"
        label={t(locale, last ? 'guideStart' : 'guideNext')}
        style={styles.button}
        onPress={() => {
          if (last) return finish();
          scroller.current?.scrollTo({ x: (index + 1) * width, animated: true });
          setIndex(index + 1);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  skip: { alignSelf: 'flex-end', paddingHorizontal: 24, paddingVertical: 12 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 36 },
  badge: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  center: { textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { width: 22 },
  button: { marginHorizontal: 24 },
});
