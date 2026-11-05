import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

/** 「已应用」提示条显示多久后自动消失（D-106）；之后仍可在「设置 → 改动记录」撤销。 */
export const APPLIED_BANNER_MS = 6000;

/**
 * 版本提示条：已应用 / 已回退，带「撤销」。外壳和独立页面都显示。
 * 「已应用」几秒后自动消失，免得之后被当成撤销别的操作；回退、冲突等警告要用户自己关。
 * 浮在内容上（绝对定位），不占布局：出现和消失时页面不动，不会因为内容上跳点错。
 * 放在所在容器的顶部；容器上方还有别的东西时用 BannerAnchor。
 */
export function Banner({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const banner = useWorkspace((s) => s.banner);
  const undo = useWorkspace((s) => s.undo);
  const dismiss = useWorkspace((s) => s.dismissBanner);
  const hold = useWorkspace((s) => s.holdBanner);
  useEffect(() => {
    if (banner?.kind !== 'applied' || banner.held) return;
    const timer = setTimeout(dismiss, APPLIED_BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner, dismiss]);
  if (!banner) return null;
  const warn = banner.kind !== 'applied';
  const color = warn ? '#FFFFFF' : palette.onPrimary;
  return (
    <View
      testID="banner"
      style={[
        styles.floating,
        { left: palette.pad, right: palette.pad, paddingLeft: palette.inset },
        {
          backgroundColor: warn ? palette.danger : palette.primary,
          borderRadius: palette.controlRadius,
        },
      ]}>
      <Text
        numberOfLines={3}
        style={[styles.bannerText, palette.font('bodyMedium', 14), { color }]}>
        {banner.message}
      </Text>
      {banner.undoTo !== undefined ? (
        <Pressable
          testID="banner-undo"
          accessibilityRole="button"
          style={styles.action}
          onPressIn={() => hold(true)}
          onPressOut={() => hold(false)}
          onPress={undo}>
          <Text style={[palette.font('bodyBold', 14), { color }]}>{t(locale, 'undo')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={styles.action}
        accessibilityRole="button"
        onPress={dismiss}
        accessibilityLabel={t(locale, 'close')}>
        <Text style={[palette.font('bodyBold', 14), { color }]}>✕</Text>
      </Pressable>
    </View>
  );
}

/** 草稿的提示（D-190）：重新套用时去掉了几步、某一步显示不出来已经撤掉。 */
export function DraftNotice({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const notice = useWorkspace((s) => s.draftNotice);
  const dismiss = useWorkspace((s) => s.dismissDraftNotice);
  if (!notice) return null;
  return (
    <View
      testID="draft-notice"
      style={[
        styles.banner,
        { marginHorizontal: palette.pad, paddingHorizontal: palette.inset },
        { backgroundColor: palette.danger, borderRadius: palette.controlRadius },
      ]}>
      <Text style={[styles.bannerText, palette.font('bodyMedium', 14), { color: '#FFFFFF' }]}>
        {notice}
      </Text>
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel={t(locale, 'close')}>
        <Text style={[palette.font('bodyBold', 14), { color: '#FFFFFF' }]}>✕</Text>
      </Pressable>
    </View>
  );
}

export function BannerAnchor({ palette }: { palette: Palette }) {
  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <Banner palette={palette} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 高度是 0 的定位点：提示条从这里往下浮，不占位置。
  anchor: { height: 0, zIndex: 50 },
  floating: {
    position: 'absolute',
    top: 8,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 4,
    paddingVertical: 2,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  // 撤销和关闭至少 44 见方、彼此不重叠，点「撤销」不会落到「关闭」上。
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    paddingVertical: 12,
  },
  bannerText: { flex: 1 },
});
