import type { IconValue } from '@morph/core';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GlassFill } from './GlassFill';
import { Icon } from './Icon';
import { iconColors, type Palette } from './theme';

// Clay 风格的基础界面元素（对应 Docudis 的 clay_widgets）。配置渲染器和系统页面共用，
// 所以主题里的颜色、字体、圆角和间距会作用到整个 App。

/** 卡片：主题圆角、柔和阴影（或描边），按下时轻微缩小。 */
export function Card({
  palette,
  children,
  onPress,
  onLongPress,
  disabled,
  background,
  style,
  testID,
  accessibilityLabel,
}: {
  palette: Palette;
  children: ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  /** 页面编辑：长按打开组件的操作面板（D-052）。 */
  onLongPress?: () => void;
  disabled?: boolean;
  background?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const base = [palette.cardStyle(background), { padding: palette.pad - 2, gap: 8 }, style];
  if (!onPress) {
    return (
      <View testID={testID} style={base}>
        <GlassFill palette={palette} />
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.97 }] }]}>
      <GlassFill palette={palette} />
      {children}
    </Pressable>
  );
}

/** 彩色图标块：三个圆角加一个较尖的左下角。 */
export function IconTile({
  palette,
  icon,
  background,
  color,
  size = 46,
}: {
  palette: Palette;
  icon: IconValue;
  background: string;
  color: string;
  size?: number;
}) {
  const scale = palette.radius / 22;
  const round = Math.round(16 * scale);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
        borderTopLeftRadius: round,
        borderTopRightRadius: round,
        borderBottomRightRadius: round,
        borderBottomLeftRadius: Math.round(6 * scale),
      }}>
      <Icon name={icon} size={Math.round(size * 0.48)} color={color} />
    </View>
  );
}

/**
 * 主按钮（52pt 高）、描边按钮和文字按钮；icon 显示在文字前面。
 * variant 为 icon 时只显示一个圆形图标，文字留给读屏（D-230）。
 */
export function Button({
  palette,
  label,
  onPress,
  onLongPress,
  variant = 'filled',
  icon,
  disabled,
  loading,
  danger,
  testID,
  style,
}: {
  palette: Palette;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: 'filled' | 'outline' | 'text' | 'icon';
  icon?: IconValue;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (variant === 'icon' && icon) {
    const colors = iconColors(palette, 'solid');
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.iconButton,
          { backgroundColor: colors.background, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
          style,
        ]}>
        {loading ? (
          <ActivityIndicator color={colors.color} />
        ) : (
          <Icon name={icon} size={24} color={colors.color} />
        )}
      </Pressable>
    );
  }
  const accent = danger ? palette.danger : palette.primary;
  const filled = variant === 'filled';
  const color = filled ? palette.onPrimary : danger ? palette.danger : palette.primaryText;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: variant === 'text' ? 44 : 52,
          paddingHorizontal: variant === 'text' ? 4 : 20,
          borderRadius: palette.controlRadius,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        },
        filled && { backgroundColor: pressed ? palette.primaryText : accent },
        variant === 'outline' && {
          borderWidth: 1.5,
          borderColor: danger ? palette.danger : palette.border,
          backgroundColor: palette.surface,
        },
        pressed && !filled && { opacity: 0.6 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : icon ? (
        <View style={styles.labelRow}>
          <Icon name={icon} size={20} color={color} />
          <Text style={[palette.font('title', 16), { color }]}>{label}</Text>
        </View>
      ) : (
        <Text style={[palette.font('title', 16), { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** 小号胶囊按钮（工具目录里的操作）。 */
export function Pill({
  palette,
  label,
  onPress,
  danger,
  testID,
}: {
  palette: Palette;
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: danger ? palette.danger : palette.border,
        backgroundColor: danger ? palette.surface : palette.primaryTint,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Text
        style={[
          palette.font('bodyBold', 13),
          { color: danger ? palette.danger : palette.primaryText },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 页面大标题（Sora 28）。 */
export function PageTitle({ palette, children }: { palette: Palette; children: ReactNode }) {
  return (
    <Text
      style={[
        palette.font('display', 28),
        { color: palette.text, letterSpacing: -0.5, paddingTop: 8, paddingBottom: 4 },
      ]}>
      {children}
    </Text>
  );
}

/** 大写的小节标题。 */
export function SectionLabel({ palette, children }: { palette: Palette; children: string }) {
  return (
    <Text
      style={[
        palette.font('bodyBold', 12),
        { color: palette.caption, letterSpacing: 0.5, marginTop: 8 },
      ]}>
      {children.toUpperCase()}
    </Text>
  );
}

/** 设置页等列表里的一行：图标块、标题、说明、右侧箭头。 */
export function ListRow({
  palette,
  icon,
  label,
  value,
  onPress,
  testID,
}: {
  palette: Palette;
  icon?: IconValue;
  label: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Card palette={palette} onPress={onPress} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {icon ? (
          <IconTile palette={palette} icon={icon} size={40} {...iconColors(palette, 'tint')} />
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>{label}</Text>
          {value ? (
            <Text style={[palette.font('body', 14), { color: palette.muted }]}>{value}</Text>
          ) : null}
        </View>
        {onPress ? (
          <Text style={[palette.font('title', 20), { color: palette.caption }]}>›</Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
