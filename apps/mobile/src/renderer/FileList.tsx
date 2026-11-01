import { formatFileSize, readFiles, type BlockOf, type Locale } from '@morph/core';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import { Card } from './ui';

export const formatSize = (bytes: number, locale: Locale = 'en') => formatFileSize(bytes, locale);

/** 文件列表（look files，读系统表 $files）：展示工作空间里的用户文件（与配置版本无关），点击即可分享 / 导出。 */
export function FileList({ block, env }: { block: BlockOf<'files'>; env: RenderEnv }) {
  const { repo, files } = useWorkspaceContext();
  const version = useWorkspace((s) => s.assetsVersion);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
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
