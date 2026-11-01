import { FILE_LIMITS, type BlockOf } from '@morph/core';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import { pickPicture } from './pictures';

// 图片组件（D-045）：AI 只放图片位；用户点图片位从相册选照片，照片存成用户文件，
// 配置里只记录文件 ID。AI 看不到照片内容，也看不到文件名。

type ImageProps = BlockOf<'image'>['show'];

const ASPECT = { wide: 16 / 9, landscape: 4 / 3, square: 1, portrait: 3 / 4 } as const;

export function ImageView({
  props,
  env,
  componentId,
  center,
}: {
  props: ImageProps;
  env: RenderEnv;
  componentId: string;
  /** 说明文字居中（组件的 style.align）。 */
  center?: boolean;
}) {
  const { palette, locale } = env;
  const { repo, files } = useWorkspaceContext();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  // undefined：读取中；null：文件不存在（例如来自另一台设备的版本）。
  const [uri, setUri] = useState<string | null | undefined>(props.asset ? undefined : null);

  useEffect(() => {
    if (!props.asset) return;
    let alive = true;
    void repo.getAsset(props.asset).then((a) => alive && setUri(a ? files.fileUri(a.path) : null));
    return () => {
      alive = false;
    };
  }, [repo, files, props.asset]);

  async function setPicture(assetId: string | null) {
    if (!env.pageId) return;
    const result = await proposeOps(
      [
        {
          op: 'updateContainer',
          page: env.pageId,
          block: componentId,
          changes: { show: { asset: assetId } },
        },
      ],
      t(locale, assetId ? 'setImageSummary' : 'removeImageSummary'),
    );
    if (result.kind === 'preview') await confirm();
    else
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
  }

  async function choose() {
    const picked = await pickPicture(files, repo);
    if (picked.kind === 'tooLarge') {
      Alert.alert(t(locale, 'imageTooLarge', { mb: FILE_LIMITS.maxFileBytes / 1024 / 1024 }));
      return;
    }
    if (picked.kind !== 'saved') return;
    bumpAssets();
    await setPicture(picked.assetId);
  }

  function options() {
    Alert.alert(props.caption ?? t(locale, 'imageTitle'), undefined, [
      { text: t(locale, 'chooseImage'), onPress: () => void choose() },
      {
        text: t(locale, 'removeImage'),
        style: 'destructive',
        onPress: () => void setPicture(null),
      },
      { text: t(locale, 'cancel'), style: 'cancel' },
    ]);
  }

  const frame = {
    aspectRatio: ASPECT[props.aspect],
    borderRadius: palette.radius,
    backgroundColor: palette.primaryTint,
  };
  let body;
  if (uri) {
    body = (
      <Image
        testID={`image-${componentId}`}
        source={{ uri }}
        contentFit={props.fit}
        accessibilityLabel={props.caption}
        style={[styles.image, frame]}
      />
    );
  } else {
    const hint =
      uri === null && props.asset
        ? t(locale, 'imageMissing')
        : (props.placeholder ?? t(locale, 'imagePlaceholder'));
    body = (
      <View style={[styles.image, styles.empty, frame, { borderColor: palette.border }]}>
        <Icon name="plus" size={28} color={palette.primaryText} />
        <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>{hint}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Pressable
        testID={`image-slot-${componentId}`}
        disabled={!env.interactive || uri === undefined}
        onPress={env.locked ?? (uri ? options : () => void choose())}
        onLongPress={env.onLongPress}
        accessibilityRole="imagebutton"
        accessibilityLabel={props.caption ?? props.placeholder ?? t(locale, 'imagePlaceholder')}>
        {body}
      </Pressable>
      {props.caption ? (
        <Text style={[palette.font('body', 13), { color: palette.muted }, center && styles.center]}>
          {props.caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  image: { width: '100%', overflow: 'hidden' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  center: { textAlign: 'center' },
});
