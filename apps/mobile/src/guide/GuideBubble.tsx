import { homeFileEntryOps, localize } from '@morph/core';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import type { ComponentRef, RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { LOOK_PROMPTS, openLookGuide, useGuide } from './store';

/**
 * 引导第 1、2 步：右上角 Tink 说的话（D-447）。浮在页面上面，不占页面的位置；
 * 气泡下面的页面轻微虚化（Tink 那一行不虚化，Tink 自己带光圈）。
 * 第 1 步：点气泡打开那句话；右下角「跳过」直接加上两个文件入口（不进预览，D-239）。
 * 第 2 步：「搭好了」，右下角「我知道了」关掉气泡，引导结束（第 3 步样板 App 取消了，D-447）。
 */
export function GuideBubble({
  palette,
  top,
  blurTarget,
}: {
  palette: Palette;
  /** 气泡尖角的位置：Tink 那一行的下边。 */
  top: number;
  /** Android 要把被虚化的内容包进 BlurTargetView 才会真模糊。 */
  blurTarget: RefObject<ComponentRef<typeof View> | null>;
}) {
  const { locale } = useWorkspaceContext();
  const stage = useGuide((s) => s.stage);
  const setStage = useGuide((s) => s.setStage);
  const config = useWorkspace((s) => s.config)!;
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const router = useRouter();
  if (stage !== 'look' && stage !== 'goal') return null;
  const look = stage === 'look';

  /** 跳过引导（D-231）：直接加上两个文件入口（不进预览），顶部不出「已改好 · 撤销」（D-239）。 */
  async function skip() {
    const ops = homeFileEntryOps(config, locale);
    if (ops.length > 0) {
      const proposed = await proposeOps(ops, localize(LOOK_PROMPTS[0]!, locale));
      if (proposed.kind === 'preview') await confirm({ quiet: true });
    }
    await setStage('done');
  }

  const onBubble = { color: palette.onPrimary };
  return (
    <View style={[StyleSheet.absoluteFill, { top }]} testID="guide-overlay">
      <BlurView
        testID="guide-blur"
        intensity={Platform.OS === 'ios' ? 4 : 8}
        tint={palette.dark ? 'dark' : 'light'}
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[styles.wrap, { paddingLeft: palette.pad, paddingRight: palette.pad - 3 }]}
        testID={look ? 'guide-look' : 'guide-goal'}>
        <Pressable
          testID={look ? 'guide-look-0' : undefined}
          accessibilityRole={look ? 'button' : undefined}
          disabled={!look}
          onPress={() => openLookGuide(router)}
          style={({ pressed }) => [
            styles.bubble,
            {
              paddingHorizontal: palette.inset,
              backgroundColor: palette.primary,
              opacity: pressed ? 0.85 : 1,
              // 高光：主色的光晕，和右上角 Tink 的光圈一起把人的目光带过去。
              boxShadow: `0px 0px 18px ${palette.primary}99`,
            },
          ]}>
          <View style={[styles.tail, { borderBottomColor: palette.primary }]} />
          <Text style={[palette.font('bodyMedium', 16), onBubble, { lineHeight: 23 }]}>
            {t(locale, look ? 'guideTinkSays' : 'guideTinkDone')}
          </Text>
          <Pressable
            testID={look ? 'guide-skip' : 'guide-later'}
            accessibilityRole="button"
            hitSlop={10}
            style={styles.action}
            onPress={() => void (look ? skip() : setStage('done'))}>
            <Text style={[palette.font('bodyBold', 14), onBubble, { opacity: look ? 0.75 : 1 }]}>
              {t(locale, look ? 'guideSkip' : 'guideGotIt')}
            </Text>
          </Pressable>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 气泡贴在右上角 Tink 下面，三角尖角对着 Tink：Tink 的中心离屏幕右边 pad + 12（入口那一行贴着页面边距），
  // 气泡右边离屏幕 pad - 3，尖角中心离气泡右边 15；靠 Tink 的那个角收小，尖角落在直边上。
  wrap: { alignItems: 'flex-end', paddingTop: 12 },
  tail: {
    position: 'absolute',
    top: -10,
    right: 6,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  bubble: {
    maxWidth: 300,
    borderRadius: 18,
    borderTopRightRadius: 6,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 6,
  },
  action: { alignSelf: 'flex-end', paddingVertical: 2 },
});
