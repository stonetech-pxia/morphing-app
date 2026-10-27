import { overlayOpacity, type Backdrop } from '@morph/core';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useWorkspaceContext } from '../workspace/context';
import type { Palette } from './theme';

// 图片背景（D-258）：卡片类组件和页面可以用用户选的一张图片代替底色。图片上盖一层原来底色的遮罩，
// 不透明度由 overlayOpacity 算（不管图片什么样，正文都过对比度检查）；图片上的文字一律用正文色（onPicture）。
// 图片是用户文件，配置里只有它的 ID；选的时候已经缩到显示用的尺寸（Android 解码时就缩，见 pickImage）。

/** 选背景图片时缩到的最长边：卡片不用太大，整页要铺满屏幕。 */
export const BACKDROP_SIDE = { card: 1200, page: 2048 } as const;

/** 有背景图片时的配色：灰字、说明、主色字、提示框的字都换成正文色（遮罩只保证正文色的对比度）。 */
export function onPicture(palette: Palette, backdrop: Backdrop | undefined): Palette {
  if (!backdrop?.assetId) return palette;
  const { text } = palette;
  return {
    ...palette,
    muted: text,
    subtext: text,
    caption: text,
    primaryText: text,
    onSecondaryTint: text,
    onTertiaryTint: text,
  };
}

/** 用户文件的显示地址。undefined：读取中或没有；null：文件不在这台设备上。 */
export function useAssetUri(assetId: string | undefined): string | null | undefined {
  const { repo, files } = useWorkspaceContext();
  const [loaded, setLoaded] = useState<{ id: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    void repo
      .getAsset(assetId)
      .then((a) => alive && setLoaded({ id: assetId, uri: a ? files.fileUri(a.path) : null }));
    return () => {
      alive = false;
    };
  }, [repo, files, assetId]);
  return assetId && loaded?.id === assetId ? loaded.uri : undefined;
}

/**
 * 铺满父视图的图片和遮罩（父视图要 overflow: hidden 并设好圆角）。color 是不透明的底色：
 * 毛玻璃卡片的底色是半透明的，遮罩用它不透明的那个颜色。没有图片或图片不在这台设备上时什么都不画。
 */
export function BackdropFill({
  backdrop,
  color,
  palette,
  radius = 0,
}: {
  backdrop: Backdrop;
  color: string;
  palette: Palette;
  /** 卡片的圆角：图片自己裁圆角，卡片不设 overflow（iOS 上会把阴影也裁掉）。 */
  radius?: number;
}) {
  const uri = useAssetUri(backdrop.assetId);
  if (!uri) return null;
  return (
    <View
      pointerEvents="none"
      testID="backdrop-picture"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Image
        source={{ uri }}
        contentFit="cover"
        // 解码成显示的尺寸（Android 默认就这样，这里写明）。
        allowDownscaling
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <View
        testID="backdrop-overlay"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: color,
            opacity: overlayOpacity(backdrop.overlay, color, palette.text),
          },
        ]}
      />
    </View>
  );
}
