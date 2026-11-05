import { RunError, formatFileSize, readFiles, type BlockOf, type Locale } from '@morph/core';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import type { Palette } from './theme';
import { Card } from './ui';

export const formatSize = (bytes: number, locale: Locale = 'en') => formatFileSize(bytes, locale);

const extOf = (name: string) => /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toUpperCase() ?? '';

/**
 * 文件列表（look files，读系统表 $files）：展示工作空间里的用户文件（与配置版本无关）。
 * D-451：每行是缩略图（图片用原图，PDF 用存进来时画好的第一页）、文件名、「类型 · 日期」；
 * 点一行用系统预览打开，标题右边「全部」打开全部文件页面（D-453）。只读，不生成缩略图（底线 15）。
 */
export function FileList({ block, env }: { block: BlockOf<'files'>; env: RenderEnv }) {
  const { repo, files } = useWorkspaceContext();
  const version = useWorkspace((s) => s.assetsVersion);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const router = useRouter();
  const { palette, locale } = env;
  const title = block.show.title;
  const { source } = block;
  const cal = useCalendar();

  useEffect(() => {
    let alive = true;
    // 筛选、排序、条数都按 source（core 的 readFiles）；迁移来的文件列表筛掉了界面用的照片（D-051）。
    void repo.listAssets().then((all) => {
      if (alive) setAssets(readFiles(source, all, new Date(), cal));
    });
    return () => {
      alive = false;
    };
  }, [repo, version, source, cal]);

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text style={[palette.font('bodyMedium', 14), { color: palette.caption }]}>{title}</Text>
        {env.interactive && assets.length > 0 ? (
          <Pressable
            testID="files-all"
            accessibilityRole="button"
            hitSlop={8}
            onPress={env.locked ?? (() => router.push('/files'))}>
            <Text style={[palette.font('bodyMedium', 14), { color: palette.primaryText }]}>
              {t(locale, 'filesAll')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {assets.length === 0 ? (
        <View
          testID="files-empty"
          style={[styles.empty, { borderColor: palette.border, borderRadius: palette.radius }]}>
          <Icon name="document" size={22} color={palette.caption} />
          <Text style={[palette.font('body', 14), styles.center, { color: palette.caption }]}>
            {t(locale, 'noFiles')}
          </Text>
        </View>
      ) : (
        <Card palette={palette} style={styles.card}>
          {assets.map((a, i) => (
            <FileRow
              key={a.id}
              asset={a}
              first={i === 0}
              palette={palette}
              locale={locale}
              disabled={!env.interactive}
              onPress={env.locked ?? (() => void previewAsset(files, a, locale))}
              onLongPress={env.onLongPress}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

/** 用系统预览打开一个用户文件；打不开时说明原因。 */
export async function previewAsset(
  files: ReturnType<typeof useWorkspaceContext>['files'],
  a: AssetRecord,
  locale: Locale,
) {
  try {
    await files.previewFile({ uri: files.fileUri(a.path), mimeType: a.mimeType, name: a.name });
  } catch (e) {
    Alert.alert(a.name, runErrorText(locale, e instanceof RunError ? e.code : 'previewFailed', {}));
  }
}

/** 一行文件：缩略图、文件名、「类型 · 日期」（首页的最近文件和全部文件页面共用）。 */
export function FileRow({
  asset,
  first,
  palette,
  locale,
  disabled,
  onPress,
  onLongPress,
}: {
  asset: AssetRecord;
  first: boolean;
  palette: Palette;
  locale: Locale;
  disabled?: boolean;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
}) {
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(asset.createdAt),
  );
  return (
    <Pressable
      testID={`file-${asset.name}`}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
      ]}>
      <Thumb asset={asset} palette={palette} />
      <View style={styles.text}>
        <Text numberOfLines={1} style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
          {asset.name}
        </Text>
        <Text style={[palette.font('body', 12), { color: palette.caption }]}>
          {[extOf(asset.name), date].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

/** 缩略图：图片用原图，PDF 用第一页（D-451），别的用图标。 */
function Thumb({ asset, palette }: { asset: AssetRecord; palette: Palette }) {
  const { files } = useWorkspaceContext();
  const uri = asset.mimeType.startsWith('image/')
    ? files.fileUri(asset.path)
    : asset.mimeType === 'application/pdf'
      ? (files.thumbnailUri?.(asset.path) ?? null)
      : null;
  const frame = [
    styles.thumb,
    { backgroundColor: palette.background, borderColor: palette.border },
  ];
  if (uri)
    return (
      <Image
        testID={`file-thumb-${asset.id}`}
        source={{ uri }}
        contentFit="cover"
        allowDownscaling
        style={frame}
      />
    );
  return (
    <View style={[frame, styles.iconThumb]}>
      <Icon
        name={
          asset.mimeType.startsWith('video/')
            ? 'video'
            : asset.mimeType.startsWith('audio/')
              ? 'audio'
              : 'document'
        }
        size={18}
        color={palette.secondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  // 标题在方块外面：贴着页面边距，和卡片的边对齐（D-454）。
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  card: { paddingVertical: 4, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  thumb: { width: 34, height: 44, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth },
  iconThumb: { alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', gap: 6, padding: 24 },
  center: { textAlign: 'center' },
});
