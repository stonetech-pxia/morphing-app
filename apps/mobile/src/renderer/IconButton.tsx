import type { IconValue } from '@morph/core';
import { Image, Pressable, StyleSheet, type ImageSourcePropType } from 'react-native';

import { Icon } from './Icon';
import type { Palette } from './theme';

/** 首页图标按钮用的线条图（D-449）：单色 PNG，按主题染色（和 Tink 的小锤子一样）。 */
const GLYPHS = {
  scan: require('../../assets/images/scan-outline.png') as ImageSourcePropType,
  folderOpen: require('../../assets/images/folder-open-outline.png') as ImageSourcePropType,
};
export type IconButtonGlyph = keyof typeof GLYPHS;

/** 配置里的图标在这种按钮上换成线条图：扫描用扫描框。 */
const GLYPH_OF: Partial<Record<string, IconButtonGlyph>> = { scan: 'scan' };

/**
 * 只有图标的方形按钮（D-449）：新用户首页的「扫描」「打开文件」。和设置页的图标底同一个形状
 * （三个大圆角、左下角小圆角，跟着主题的圆角缩放），白底、主色线条图标；
 * 比格子小一圈、居中，两个按钮之间留出空。字不显示，但读屏会读出 label。
 */
export function IconButton({
  palette,
  icon,
  glyph,
  label,
  onPress,
  onLongPress,
  disabled,
  testID,
}: {
  palette: Palette;
  /** 配置里的图标名；glyph 给了就用线条图。 */
  icon: IconValue;
  glyph?: IconButtonGlyph;
  label: string;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
  disabled?: boolean;
  testID: string;
}) {
  const shown = glyph ?? (typeof icon === 'string' ? GLYPH_OF[icon] : undefined);
  const scale = palette.radius / 22;
  const round = Math.round(30 * scale);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.surface,
          boxShadow: `0px 2px 10px ${palette.shadow}1F`,
          borderTopLeftRadius: round,
          borderTopRightRadius: round,
          borderBottomRightRadius: round,
          borderBottomLeftRadius: Math.round(11 * scale),
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        pressed && styles.pressed,
      ]}>
      {shown ? (
        <Image
          source={GLYPHS[shown]}
          style={{ width: 46, height: 46, tintColor: palette.primaryText }}
        />
      ) : (
        <Icon name={icon} size={46} color={palette.primaryText} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '82%',
    alignSelf: 'center',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.97 }] },
});
