import { localize, pageTarget, type ComponentStyle, type EntryLook } from '@morph/core';

import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { onPicture } from './Backdrop';
import type { RenderEnv } from './components';
import { SIZES } from './style';
import { cardColors, iconColors } from './theme';
import { Card, IconTile } from './ui';

// 入口类卡片（快捷入口、工具卡片、工具目录入口）共用的样子（D-230）。

export function Tile({
  env,
  style,
  icon,
  title,
  subtitle,
  onPress,
  titleColor,
  look,
  testID,
}: {
  env: RenderEnv;
  style: ComponentStyle | undefined;
  icon: Parameters<typeof IconTile>[0]['icon'];
  title: string;
  subtitle?: string | undefined;
  onPress: () => void;
  titleColor?: string;
  /** row = 像设置页的一行（浅色图标底、右边有箭头），tile = 大图标块（D-230）。 */
  look: EntryLook;
  testID?: string;
}) {
  const palette = onPicture(env.palette, style?.backdrop);
  const colors = cardColors(palette, style?.tone);
  const scale = SIZES[style?.size ?? 'medium'];
  const center = style?.align === 'center';
  const stacked = center || env.inCell;
  // 宫格和居中排列里没有横向的位置，总是竖着排。
  const listRow = look === 'row' && !stacked;
  const iconTile = iconColors(palette, listRow ? 'tint' : 'solid', style?.tone);
  return (
    <Card
      palette={palette}
      background={colors.background}
      backdrop={style?.backdrop}
      onPress={env.interactive ? onPress : undefined}
      onLongPress={env.onLongPress}
      testID={testID}
      style={styles.fill}>
      <View style={center ? styles.tileCenter : stacked ? styles.tileStacked : styles.tileRow}>
        <IconTile
          palette={palette}
          icon={icon}
          size={Math.round((listRow ? 40 : 46) * scale)}
          {...iconTile}
        />
        <View style={[styles.flexText, stacked && styles.centerText, center && styles.centerItems]}>
          <Text
            style={[
              palette.font('title', 16 * scale),
              // 图片上的文字一律用正文色（D-258）。
              { color: (!style?.backdrop?.assetId && titleColor) || palette.text },
              center && styles.textCenter,
            ]}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                palette.font('body', 14 * scale),
                { color: palette.muted },
                center && styles.textCenter,
              ]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {listRow ? (
          <Text style={[palette.font('title', 20), { color: palette.caption }]}>›</Text>
        ) : null}
      </View>
    </Card>
  );
}

export function ToolCard({
  toolId,
  look,
  style,
  env,
}: {
  toolId: string;
  look: EntryLook | undefined;
  style?: ComponentStyle;
  env: RenderEnv;
}) {
  const def = env.registry.tools.get(toolId);
  const installed = env.config.tools.find((x) => x.toolId === toolId);
  if (!def || !installed) {
    return (
      <Card palette={env.palette}>
        <Text style={[env.palette.font('body', 15), { color: env.palette.muted }]}>
          {t(env.locale, 'toolMissing')}
        </Text>
      </Card>
    );
  }
  const page = env.config.pages.find((p) => p.id === installed.pageId);
  return (
    <Tile
      env={env}
      style={style}
      icon={def.icon}
      title={page?.title ?? localize(def.name, env.locale)}
      subtitle={localize(def.description, env.locale)}
      onPress={() => env.navigate(pageTarget(installed.pageId))}
      look={look ?? 'tile'}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tileCenter: { alignItems: 'center', gap: 10 },
  tileStacked: { alignItems: 'flex-start', gap: 12 },
  flexText: { flex: 1, gap: 3 },
  centerText: { flex: 0 },
  centerItems: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
});
