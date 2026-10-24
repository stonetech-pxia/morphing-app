import type { Collection } from '@morph/core';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { NextCard } from './NextCard';

/**
 * 「数据表做好了」（D-191）：AI 新建了一张数据表（功能，直接生效）。现在就能记一笔试试；
 * 页面是外观，作为「接着改」放在这里，点了进草稿。
 */
export function TableReadyScreen({
  collection,
  notes,
}: {
  collection: Collection;
  notes: string[];
}) {
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const next = useWorkspace((s) => s.next);
  const palette = usePalette(config.theme);
  const router = useRouter();
  const body = [palette.font('body', 15), { color: palette.text }];

  return (
    <ScrollView
      testID="table-ready-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: palette.secondary }]}>
          <Icon name="check" size={22} color="#FFFFFF" />
        </View>
        <Text style={[palette.font('heading', 22), styles.flex, { color: palette.text }]}>
          {t(locale, 'tableReadyTitle')}
        </Text>
      </View>
      <Card palette={palette}>
        <Text
          testID="table-ready-name"
          style={[palette.font('title', 17), { color: palette.text }]}>
          {collection.name}
        </Text>
        {collection.fields.map((field) => (
          <Text key={field.id} style={body}>
            • {field.name}
          </Text>
        ))}
        {notes.map((note, i) => (
          <Text key={i} style={[palette.font('body', 13), { color: palette.muted }]}>
            {note}
          </Text>
        ))}
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, 'tableReadyWhere')}
        </Text>
      </Card>
      <NextCard palette={palette} primary />
      <Button
        palette={palette}
        testID="table-ready-record"
        variant={next ? 'outline' : 'filled'}
        label={t(locale, 'tableReadyRecord')}
        onPress={() =>
          router.replace({
            pathname: '/record/[collectionId]',
            params: { collectionId: collection.id },
          })
        }
      />
      <Button
        palette={palette}
        testID="table-ready-later"
        variant="text"
        label={t(locale, 'readyLater')}
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
});
