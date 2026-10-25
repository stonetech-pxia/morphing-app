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
 */
export function Banner({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const banner = useWorkspace((s) => s.banner);
  const undo = useWorkspace((s) => s.undo);
  const dismiss = useWorkspace((s) => s.dismissBanner);
  useEffect(() => {
    if (banner?.kind !== 'applied') return;
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
        styles.banner,
        {
          backgroundColor: warn ? palette.danger : palette.primary,
          borderRadius: palette.controlRadius,
        },
      ]}>
      <Text style={[styles.bannerText, palette.font('bodyMedium', 14), { color }]}>
        {banner.message}
      </Text>
      {banner.undoTo !== undefined ? (
        <Pressable onPress={undo} hitSlop={8}>
          <Text style={[palette.font('bodyBold', 14), { color }]}>{t(locale, 'undo')}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel={t(locale, 'close')}>
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

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bannerText: { flex: 1 },
});
