import { THEME_PRESETS, type IconName, type Locale } from '@morph/core';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { t, type StringKey } from '../i18n';
import { Icon, UiIcon } from '../renderer/Icon';
import { makePalette, type Palette } from '../renderer/theme';

// 划屏介绍每页上方的图（D-149）：用 View / Text 画，跟随当前主题，不用截图。

export type WelcomeArtKind = 'scan' | 'records' | 'style';

/** 「改之后」的缩略图固定用赛博霓虹：不管现在是什么风格，都看得出变化。 */
const NEON = makePalette(THEME_PRESETS.neon.theme, true);

const SOURCES: { icon: IconName; label: StringKey }[] = [
  { icon: 'scan', label: 'guideIntroSourceScan' },
  { icon: 'document', label: 'guideIntroSourceOpen' },
];
const RECORDS: { icon: IconName; title: StringKey; value: StringKey }[] = [
  { icon: 'note', title: 'guideIntroReceipt', value: 'guideIntroReceiptValue' },
  { icon: 'person', title: 'guideIntroCard', value: 'guideIntroCardValue' },
  { icon: 'document', title: 'guideIntroContract', value: 'guideIntroContractValue' },
];

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
    case 'scan':
      return <ScanArt palette={palette} locale={locale} />;
    case 'records':
      return <RecordsArt palette={palette} locale={locale} />;
    case 'style':
      return <StyleArt palette={palette} locale={locale} />;
  }
}

/** 扫描：取景框里的一页纸。 */
function ScanArt({ palette, locale }: { palette: Palette; locale: Locale }) {
  const corner = { borderColor: palette.primary };
  return (
    <View style={styles.art} testID="welcome-art-scan">
      <View style={styles.viewfinder}>
        <View style={[styles.corner, styles.cornerTL, corner]} />
        <View style={[styles.corner, styles.cornerTR, corner]} />
        <View style={[styles.corner, styles.cornerBL, corner]} />
        <View style={[styles.corner, styles.cornerBR, corner]} />
        <View
          style={[
            styles.paper,
            { backgroundColor: palette.surface, boxShadow: `0px 2px 8px ${palette.shadow}2E` },
          ]}>
          <View style={[styles.paperTitle, { backgroundColor: palette.primary }]} />
          {[0, 1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={[
                styles.paperLine,
                i === 4 && styles.paperShort,
                { backgroundColor: palette.border },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

/** 记录：扫描和打开文件两个来源，下面是几种不同的记录。 */
function RecordsArt({ palette, locale }: { palette: Palette; locale: Locale }) {
  return (
    <View style={styles.art} testID="welcome-art-records">
      <View style={styles.sources}>
        {SOURCES.map((source) => (
          <View
            key={source.label}
            style={[
              styles.source,
              { backgroundColor: palette.primary, borderRadius: palette.controlRadius },
            ]}>
            <Icon name={source.icon} size={18} color={palette.onPrimary} />
            <Text
              numberOfLines={1}
              style={[palette.font('bodyBold', 14), { color: palette.onPrimary, flexShrink: 1 }]}>
              {t(locale, source.label)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.selfCenter}>
        <UiIcon name="arrowDown" size={20} color={palette.primary} />
      </View>
      {RECORDS.map((record) => (
        <View
          key={record.title}
          style={[
            styles.record,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <View style={[styles.recordIcon, { backgroundColor: palette.primaryTint }]}>
            <Icon name={record.icon} size={18} color={palette.primaryText} />
          </View>
          <View style={styles.flex}>
            <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
              {t(locale, record.title)}
            </Text>
            <Text numberOfLines={1} style={[palette.font('body', 12), { color: palette.muted }]}>
              {t(locale, record.value)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** 改风格和界面：改之前（当前风格）→ 一句话 → 改之后（霓虹，数字卡片换到最上面）。 */
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
      <MiniPhone p={NEON} frame={palette.text} title={title} numberFirst />
    </View>
  );
}

/** 迷你手机界面：标题、待办卡片、数字卡片、按钮、导航栏，颜色全部来自 p。 */
function MiniPhone({
  p,
  frame,
  title,
  numberFirst,
}: {
  p: Palette;
  frame: string;
  title: string;
  numberFirst?: boolean;
}) {
  const card = miniCard(p);
  const todo = (
    <View style={card}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.miniRow}>
          <View
            style={[
              styles.miniCheck,
              i === 0 ? { backgroundColor: p.primary } : { borderWidth: 1, borderColor: p.primary },
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
  );
  const number = (
    <View style={card}>
      <Text style={[p.font('title', 11), { color: p.secondary }]}>86</Text>
      <View style={[styles.miniLine, styles.miniShort, { backgroundColor: p.border }]} />
    </View>
  );
  return (
    <View style={[styles.mini, { backgroundColor: p.background, borderColor: frame }]}>
      <Text numberOfLines={1} style={[p.font('title', 11), { color: p.text }]}>
        {title}
      </Text>
      {numberFirst ? number : todo}
      {numberFirst ? todo : number}
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

const CORNER = 22;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  selfCenter: { alignSelf: 'center' },
  art: { alignSelf: 'stretch', gap: 12 },
  viewfinder: {
    alignSelf: 'center',
    width: 136,
    height: 172,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  paper: { width: 104, height: 140, borderRadius: 4, padding: 12, gap: 8 },
  paperTitle: { height: 7, width: 52, borderRadius: 3 },
  paperLine: { height: 5, borderRadius: 2 },
  paperShort: { width: 44 },
  sources: { flexDirection: 'row', gap: 8 },
  source: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  recordIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
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
});
