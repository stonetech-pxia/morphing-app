import { formatFileSize, type Locale } from '@morph/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import { Card } from './ui';

export const formatSize = (bytes: number, locale: Locale = 'en') => formatFileSize(bytes, locale);

/** fileList 组件：展示工作空间里的用户文件（与配置版本无关），点击即可分享 / 导出。 */
export function FileList({
  title,
  limit,
  mimeType,
  env,
}: {
  title: string;
  limit: number;
  mimeType?: string | undefined;
  env: RenderEnv;
}) {
  const { repo, files } = useWorkspaceContext();
  const version = useWorkspace((s) => s.assetsVersion);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const { palette, locale } = env;

  useEffect(() => {
    let alive = true;
    void repo.listAssets().then((all) => {
      // 文件列表只显示文档；界面用的照片也是用户文件，但不在这里列出（D-051）。
      // mimeType 可以是一大类（video/*、audio/*、image/*，D-140）。
      const documents = all.filter((a) =>
        mimeType?.endsWith('/*')
          ? a.mimeType.startsWith(mimeType.slice(0, -1))
          : mimeType
            ? a.mimeType === mimeType
            : !a.mimeType.startsWith('image/'),
      );
      if (alive) setAssets(documents.slice(0, limit));
    });
    return () => {
      alive = false;
    };
  }, [repo, version, limit, mimeType]);

  return (
    <Card palette={palette}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>{title}</Text>
      {assets.length === 0 ? (
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {t(locale, 'noFiles')}
        </Text>
      ) : (
        assets.map((a, i) => (
          <Pressable
            key={a.id}
            testID={`file-${a.name}`}
            disabled={!env.interactive}
            onPress={env.locked ?? (() => void files.share(a.path, a.mimeType))}
            onLongPress={env.onLongPress}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
            ]}>
            <Icon
              name={
                a.mimeType.startsWith('video/')
                  ? 'video'
                  : a.mimeType.startsWith('audio/')
                    ? 'audio'
                    : 'document'
              }
              size={18}
              color={palette.secondary}
            />
            <Text
              numberOfLines={1}
              style={[styles.name, palette.font('bodyMedium', 15), { color: palette.text }]}>
              {a.name}
            </Text>
            <Text style={[palette.font('body', 13), { color: palette.caption }]}>
              {formatSize(a.size, locale)}
            </Text>
          </Pressable>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  name: { flex: 1 },
});
