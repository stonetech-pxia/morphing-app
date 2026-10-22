import {
  CollectionSchema,
  RECORD_LIMITS,
  formatRef,
  formatTimestamp,
  recordsToCsv,
  type Collection,
} from '@morph/core';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { useRecordActions } from '@/data/records';
import { t } from '@/i18n';
import { Card, PageTitle, Pill, SectionLabel } from '@/renderer/ui';
import { usePalette } from '@/renderer/theme';
import type { StoredRecord } from '@/storage/types';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/**
 * 「设置 → 数据」：用户记录的管理页，由内核提供，AI 不能修改。
 * 导出 CSV、查看已移出界面的数据表、恢复最近删除的记录（D-037、D-038、D-041）。
 */
export default function DataRoute() {
  const { repo, files, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const version = useWorkspace((s) => s.recordsVersion);
  const bump = useWorkspace((s) => s.bumpRecords);
  const palette = usePalette(config.theme);
  const actions = useRecordActions();
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [orphans, setOrphans] = useState<
    { collection: Collection | null; id: string; count: number }[]
  >([]);
  const [deleted, setDeleted] = useState<StoredRecord[]>([]);
  const [known, setKnown] = useState<Map<string, Collection>>(new Map());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await repo.countRecords();
      const deletedRows = await repo.listDeletedRecords();
      // 已移出界面的数据表：从历史版本里找回它的结构（版本只追加、不删除）。
      const missing = new Set(
        [...rows.map((r) => r.collectionId), ...deletedRows.map((r) => r.collectionId)].filter(
          (id) => !config.collections.some((c) => c.id === id),
        ),
      );
      const found = new Map<string, Collection>();
      if (missing.size > 0) {
        for (const rev of await repo.listRevisions(1000)) {
          const list = (rev.config as { collections?: unknown[] } | null)?.collections ?? [];
          for (const raw of list) {
            const parsed = CollectionSchema.safeParse(raw);
            if (parsed.success && missing.has(parsed.data.id) && !found.has(parsed.data.id)) {
              found.set(parsed.data.id, parsed.data);
            }
          }
        }
      }
      if (!alive) return;
      setCounts(new Map(rows.map((r) => [r.collectionId, r.count])));
      setOrphans(
        rows
          .filter((r) => missing.has(r.collectionId))
          .map((r) => ({
            id: r.collectionId,
            count: r.count,
            collection: found.get(r.collectionId) ?? null,
          })),
      );
      // 超过保留期、但还没到下次启动清除的记录不再显示。
      const cutoff = Date.now() - RECORD_LIMITS.deletedRetentionDays * 24 * 60 * 60 * 1000;
      setDeleted(deletedRows.filter((r) => r.deletedAt! >= cutoff));
      setKnown(new Map([...found, ...config.collections.map((c) => [c.id, c] as const)]));
    })();
    return () => {
      alive = false;
    };
  }, [repo, config, version]);

  async function exportCsv(collection: Collection) {
    const records = await repo.listRecords(collection.id);
    records.sort((a, b) => a.createdAt - b.createdAt);
    await files.shareText(
      `${collection.name}.csv`,
      recordsToCsv(collection, records, locale),
      'text/csv',
    );
  }

  function deleteForever(id: string, name: string, count: number) {
    Alert.alert(t(locale, 'deleteForever'), t(locale, 'deleteForeverConfirm', { name, count }), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'deleteForever'),
        style: 'destructive',
        onPress: () => void repo.purgeCollection(id).then(bump),
      },
    ]);
  }

  const caption = [palette.font('body', 13), { color: palette.muted }];
  const name = (c: Collection | null, id: string) => c?.name ?? t(locale, 'unknownTable', { id });

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <PageTitle palette={palette}>{t(locale, 'dataTitle')}</PageTitle>
      <Card palette={palette} background={palette.secondaryTint}>
        <Text style={[palette.font('bodyMedium', 14), { color: palette.onSecondaryTint }]}>
          {t(locale, 'dataPrivacy')}
        </Text>
      </Card>

      <SectionLabel palette={palette}>{t(locale, 'dataTables')}</SectionLabel>
      {config.collections.map((c) => (
        <Card key={c.id} palette={palette} testID={`table-${c.id}`}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>{c.name}</Text>
          <Text style={caption}>{t(locale, 'recordCount', { count: counts.get(c.id) ?? 0 })}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill
              palette={palette}
              testID={`export-${c.id}`}
              label={t(locale, 'exportCsv')}
              onPress={() => void exportCsv(c)}
            />
          </View>
        </Card>
      ))}

      {orphans.length > 0 ? (
        <>
          <SectionLabel palette={palette}>{t(locale, 'unusedTables')}</SectionLabel>
          <Text style={caption}>{t(locale, 'unusedTablesHint')}</Text>
          {orphans.map((o) => (
            <Card key={o.id} palette={palette} testID={`orphan-${o.id}`}>
              <Text style={[palette.font('title', 16), { color: palette.text }]}>
                {name(o.collection, o.id)}
              </Text>
              <Text style={caption}>{t(locale, 'recordCount', { count: o.count })}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {o.collection ? (
                  <Pill
                    palette={palette}
                    testID={`export-${o.id}`}
                    label={t(locale, 'exportCsv')}
                    onPress={() => void exportCsv(o.collection!)}
                  />
                ) : null}
                <Pill
                  palette={palette}
                  danger
                  testID={`purge-${o.id}`}
                  label={t(locale, 'deleteForever')}
                  onPress={() => deleteForever(o.id, name(o.collection, o.id), o.count)}
                />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <SectionLabel palette={palette}>{t(locale, 'recentlyDeleted')}</SectionLabel>
      <Text style={caption}>{t(locale, 'recentlyDeletedHint')}</Text>
      {deleted.length === 0 ? (
        <Card palette={palette}>
          <Text style={caption}>{t(locale, 'nothingDeleted')}</Text>
        </Card>
      ) : (
        deleted.map((r) => {
          const c = known.get(r.collectionId);
          const first = c?.fields.find((f) => f.type === 'text') ?? c?.fields[0];
          const title = c && first ? formatRef(r, c, first.id, locale) : '';
          return (
            <Card key={r.id} palette={palette} testID={`deleted-${r.id}`}>
              <Text style={[palette.font('title', 15), { color: palette.text }]}>
                {title || '—'}
              </Text>
              <Text style={caption}>
                {name(c ?? null, r.collectionId)} · {formatTimestamp(r.deletedAt!)}
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Pill
                  palette={palette}
                  testID={`restore-record-${r.id}`}
                  label={t(locale, 'restore')}
                  onPress={() => void actions.restore(r.id)}
                />
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
