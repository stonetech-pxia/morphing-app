import { currentFiles } from '@morph/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon, UiIcon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card } from '../renderer/ui';
import { useWorkspaceContext } from '../workspace/context';
import { listDesks } from './store';

// 首页的「继续上次的桌面」（D-344，创始人 2026-10-30 同意）：内核自己放在首页最上面，不是页面上的组件，
// 不改用户的页面配置（和引导卡片一样）。只在有桌面时出现，点一下回到最近动过的那个桌面。
// 文件名只在本机显示，AI 看不到。

export function DeskResume({ palette }: { palette: Palette }) {
  const { files, locale } = useWorkspaceContext();
  const router = useRouter();
  const [latest, setLatest] = useState<{ id: string; names: string } | null>(null);
  // 每次回到首页重新看一遍（在房间里清空了桌面、或者新放了一个）。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listDesks(files).then(
        (list) => {
          const desk = list[0];
          if (!alive) return;
          setLatest(
            desk
              ? {
                  id: desk.id,
                  names: currentFiles(desk)
                    .map((f) => `${f.name}.${f.ext}`)
                    .join(t(locale, 'separatorList')),
                }
              : null,
          );
        },
        () => undefined,
      );
      return () => {
        alive = false;
      };
    }, [files, locale]),
  );
  if (!latest) return null;
  return (
    <View style={styles.wrap}>
      <Card
        palette={palette}
        background={palette.surface}
        testID="desk-resume"
        accessibilityLabel={t(locale, 'deskResume')}
        onPress={() => router.push({ pathname: '/desk/[deskId]', params: { deskId: latest.id } })}>
        <View style={styles.row}>
          <Icon name="document" size={20} color={palette.primaryText} />
          <View style={styles.flex}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>
              {t(locale, 'deskResume')}
            </Text>
            <Text numberOfLines={1} style={[palette.font('body', 13), { color: palette.caption }]}>
              {latest.names}
            </Text>
          </View>
          <UiIcon name="chevronRight" size={16} color={palette.caption} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 2 },
});
