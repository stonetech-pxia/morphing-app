import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import type { Palette } from './theme';

// 附件字段（D-187、D-263）：值是一组 Morph 的文件 ID。文件名只在本机显示，不进配置，也不发给 AI。

/** 表单里的值 → 文件 ID 列表（旧数据里的单个 ID 当成一组）。 */
export function attachmentIds(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** 读一组用户文件。还没读到的是 undefined，不在这台设备上的（已删除）是 null。 */
export function useAssets(ids: readonly string[]): Map<string, AssetRecord | null> {
  const { repo } = useWorkspaceContext();
  const key = ids.join(',');
  const [loaded, setLoaded] = useState<{ key: string; assets: Map<string, AssetRecord | null> }>({
    key: '',
    assets: new Map(),
  });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(key.split(',').map((id) => repo.getAsset(id))).then((list) => {
      if (alive)
        setLoaded({ key, assets: new Map(key.split(',').map((id, i) => [id, list[i] ?? null])) });
    });
    return () => {
      alive = false;
    };
  }, [repo, key]);
  return loaded.key === key ? loaded.assets : new Map();
}

/** 附件字段的输入：列出每个文件，点一下打开分享面板（用别的 App 看），可以去掉。 */
export function AttachmentsInput({
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean | undefined;
  testID: string;
}) {
  const { files } = useWorkspaceContext();
  const ids = attachmentIds(value);
  const assets = useAssets(ids);
  if (ids.length === 0) {
    return (
      <Text style={[palette.font('body', 14), { color: palette.caption }]}>
        {t(locale, 'noAttachment')}
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {ids.map((id, i) => {
        const asset = assets.get(id);
        return (
          <View key={id} style={styles.row}>
            <Pressable
              testID={`${testID}-file-${i}`}
              disabled={!asset}
              onPress={() => asset && void files.share(asset.path, asset.mimeType)}
              style={[styles.flex, styles.row]}>
              <Icon name="document" size={18} color={palette.secondary} />
              <Text
                numberOfLines={1}
                style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
                {asset ? asset.name : asset === null ? t(locale, 'attachmentMissing') : ''}
              </Text>
            </Pressable>
            <Pressable
              testID={`${testID}-remove-${i}`}
              disabled={disabled}
              hitSlop={8}
              onPress={() => onChange(ids.filter((x) => x !== id))}>
              <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                {t(locale, 'removeAttachment')}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
