import { THEME_PRESETS, type Locale } from '@morph/core';
import { Fragment } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { t, type StringKey } from '../i18n';
import { Icon, UiIcon } from '../renderer/Icon';
import { makePalette, type Palette } from '../renderer/theme';

// 划屏介绍每页上方的图（D-149）：用 View / Text 画，跟随当前主题，不用截图。

export type WelcomeArtKind = 'app' | 'style' | 'quick' | 'try';

/** 「改之后」的缩略图固定用赛博霓虹：不管现在是什么风格，都看得出变化。 */
const NEON = makePalette(THEME_PRESETS.neon.theme, true);

const OLD_STEPS: StringKey[] = [
  'guideIntroOld1',
  'guideIntroOld2',
  'guideIntroOld3',
  'guideIntroOld4',
  'guideIntroOld5',
];
const IDEAS: StringKey[] = ['guideIntroIdea1', 'guideIntroIdea2', 'guideIntroIdea3'];

export function WelcomeArt({
  kind,
  palette,
  locale,
}: {
  kind: WelcomeArtKind;
  palette: Palette;
  locale: Locale;
}) {
  switch (kind) {
    case 'app':
      return (
        <View style={[styles.badge, { backgroundColor: palette.primaryTint }]}>
          <Icon name="sparkles" size={56} color={palette.primaryText} />
        </View>
      );
    case 'style':
      return <StyleArt palette={palette} locale={locale} />;
    case 'quick':
      return <QuickArt palette={palette} locale={locale} />;
    case 'try':
      return <TryArt palette={palette} locale={locale} />;
  }
}

/** 改风格：改之前（当前风格）→ 一句话 → 改之后（霓虹）。 */
function StyleArt({ palette, locale }: { palette: Palette; locale: Locale }) {
  const title = t(locale, 'guideIntroMiniTitle');
  return (
    <View style={styles.styleRow} testID="welcome-art-style">
      <MiniPhone p={palette} frame={palette.text} title={title} />
      <View style={styles.ask}>
        <View style={[styles.askBubble, { backgroundColor: palette.primaryTint }]}>
          <Text style={[palette.font('body', 11), styles.center, { color: palette.primaryText }]}>
            {t(locale, 'guideIntroStyleAsk')}
          </Text>
        </View>
        <UiIcon name="arrowRight" size={22} color={palette.primary} />
      </View>
      <MiniPhone p={NEON} frame={palette.text} title={title} />
    </View>
  );
}

/** 迷你手机界面：标题、待办卡片、数字卡片、按钮、导航栏，颜色全部来自 p。 */
function MiniPhone({ p, frame, title }: { p: Palette; frame: string; title: string }) {
  const card = miniCard(p);
  return (
    <View style={[styles.mini, { backgroundColor: p.background, borderColor: frame }]}>
      <Text numberOfLines={1} style={[p.font('title', 11), { color: p.text }]}>
        {title}
      </Text>
      <View style={card}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.miniRow}>
            <View
              style={[
                styles.miniCheck,
                i === 0
                  ? { backgroundColor: p.primary }
                  : { borderWidth: 1, borderColor: p.primary },
              ]}
            />
            <View
              style={[
                styles.miniLine,
                i === 2 ? styles.miniShort : styles.flex,
                { backgroundColor: p.border },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={card}>
        <Text style={[p.font('title', 11), { color: p.secondary }]}>86</Text>
        <View style={[styles.miniLine, styles.miniShort, { backgroundColor: p.border }]} />
      </View>
      <View style={[styles.miniButton, { backgroundColor: p.primary }]} />
      <View style={[styles.miniNav, { borderColor: p.border }]}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.miniDot, { backgroundColor: i === 0 ? p.primary : p.border }]}
          />
        ))}
      </View>
    </View>
  );
}

function miniCard(p: Palette): ViewStyle {
  const glow = p.theme.cardStyle === 'glow';
  return {
    backgroundColor: p.surface,
    borderRadius: 8,
    padding: 5,
    gap: 4,
    ...(glow
      ? { borderWidth: 1, borderColor: p.primary, boxShadow: `0px 0px 6px ${p.primary}8C` }
      : { boxShadow: `0px 1px 3px ${p.shadow}2E` }),
  };
}

/** 快捷操作：以前的五步 → 现在点一下。 */
function QuickArt({ palette, locale }: { palette: Palette; locale: Locale }) {
  const caption = [palette.font('body', 12), { color: palette.caption }];
  return (
    <View style={styles.art} testID="welcome-art-quick">
      <View
        style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.panelHead}>
          <Text style={[palette.font('bodyBold', 13), { color: palette.caption }]}>
            {t(locale, 'guideIntroBefore')}
          </Text>
          <Text style={caption}>{t(locale, 'guideIntroBeforeCount')}</Text>
        </View>
        <View style={styles.steps}>
          {OLD_STEPS.map((key, i) => (
            <Fragment key={key}>
              {i > 0 ? <UiIcon name="chevronRight" size={11} color={palette.caption} /> : null}
              <View style={[styles.step, { backgroundColor: palette.background }]}>
                <Text style={[palette.font('body', 12), { color: palette.muted }]}>
                  {t(locale, key)}
                </Text>
              </View>
            </Fragment>
          ))}
        </View>
      </View>
      <View style={styles.selfCenter}>
        <UiIcon name="arrowDown" size={20} color={palette.primary} />
      </View>
      <View
        style={[
          styles.action,
          {
            backgroundColor: palette.primary,
            borderRadius: palette.controlRadius,
            boxShadow: `0px 3px 8px ${palette.shadow}38`,
          },
        ]}>
        <Icon name="photo" size={20} color={palette.onPrimary} />
        <Text style={[palette.font('bodyBold', 15), styles.flex, { color: palette.onPrimary }]}>
          {t(locale, 'guideIntroNow')}
        </Text>
      </View>
    </View>
  );
}

/** 邀请动手：一个对话框和几个想法（只是展示，点「开始」进入第 1 步）。 */
function TryArt({ palette, locale }: { palette: Palette; locale: Locale }) {
  return (
    <View style={styles.art} testID="welcome-art-try">
      <View
        style={[
          styles.composer,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            borderRadius: palette.controlRadius,
            boxShadow: `0px 2px 6px ${palette.shadow}1F`,
          },
        ]}>
        <Icon name="sparkles" size={18} color={palette.primary} />
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {t(locale, 'guideIntroAsk')}
        </Text>
      </View>
      <View style={styles.ideas}>
        {IDEAS.map((key) => (
          <View key={key} style={[styles.idea, { backgroundColor: palette.primaryTint }]}>
            <Text style={[palette.font('body', 13), { color: palette.primaryText }]}>
              {t(locale, key)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  selfCenter: { alignSelf: 'center' },
  art: { alignSelf: 'stretch', gap: 10 },
  badge: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ask: { width: 56, alignItems: 'center', gap: 4 },
  askBubble: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 4 },
  mini: {
    width: 96,
    height: 184,
    borderRadius: 14,
    borderWidth: 3,
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 5,
    overflow: 'hidden',
  },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniCheck: { width: 7, height: 7, borderRadius: 2 },
  miniLine: { height: 4, borderRadius: 2 },
  miniShort: { width: 40 },
  miniButton: { height: 16, borderRadius: 6 },
  miniNav: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 4,
    borderTopWidth: 1,
  },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
  panel: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  steps: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  step: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  idea: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
