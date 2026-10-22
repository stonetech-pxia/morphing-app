import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';

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
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
      {assets.length === 0 ? (
        <Text style={{ color: palette.subtext }}>{t(locale, 'noFiles')}</Text>
      ) : (
        assets.map((a) => (
          <Pressable
            key={a.id}
            testID={`file-${a.name}`}
            disabled={!env.interactive}
            onPress={() => files.share(a.path, a.mimeType)}
            style={styles.row}>
            <Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>
              {a.name}
            </Text>
            <Text style={{ color: palette.subtext }}>{formatSize(a.size)}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  name: { flex: 1 },
});
