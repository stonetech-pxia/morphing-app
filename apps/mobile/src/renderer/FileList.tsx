import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import { Card } from './ui';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
      if (alive) setAssets(all.filter((a) => !mimeType || a.mimeType === mimeType).slice(0, limit));
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
            onPress={() => files.share(a.path, a.mimeType)}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
            ]}>
            <Icon name="document" size={18} color={palette.secondary} />
            <Text
              numberOfLines={1}
              style={[styles.name, palette.font('bodyMedium', 15), { color: palette.text }]}>
              {a.name}
            </Text>
            <Text style={[palette.font('body', 13), { color: palette.caption }]}>
              {formatSize(a.size)}
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
