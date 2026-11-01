import {
  RunError,
  allComponents,
  assetUsage,
  componentLabel,
  formatFileSize,
  isUnused,
  linkTitle,
  type AssetUsage,
  type AssetUse,
  type Collection,
  type DataRecord,
  type StringKey,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { runErrorText, t } from '@/i18n';
import { DeskList } from '@/desk/DeskList';
import { placeAssetOnDesk, savedSourceBytes } from '@/desk/saved-source';
import { AttachmentThumb } from '@/renderer/Attachments';
import { Icon } from '@/renderer/Icon';
import { usePalette } from '@/renderer/theme';
import { Button, Card, PageTitle } from '@/renderer/ui';
import { FileViewer, type ViewerItem } from '@/share/FileViewer';
import type { AssetRecord } from '@/storage/types';
import { deleteUserFiles } from '@/storage/user-files';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';
import { revisionTables } from '@/workspace/revision-tables';

/**
 * 「设置 → 存储空间」（D-264）：Morph 保存的全部用户文件、总大小，每个文件用在哪里（哪张表的哪条记录、
 * 哪个页面的哪个组件；只被旧版本用到的标出来）。可以删除单个文件，或者一键清理现在没有地方在用的。
 * 由内核提供，AI 不能修改，也看不到这里的文件名和内容。
 */

interface Loaded {
  assets: AssetRecord[];
  usage: Map<string, AssetUsage>;
  /** 记录所在的表（当前的和只在旧版本里的）。 */
  tables: Map<string, Collection>;
  records: Map<string, DataRecord>;
  /** 带着中间格式的 Excel、Word（能放回桌上改，D-367）：中间格式和原图一共多大，算在这个文件上。 */
  sources: Map<string, number>;
}

const KIND: [string, StringKey][] = [
  ['image/', 'storageKindImage'],
  ['video/', 'storageKindVideo'],
  ['audio/', 'storageKindAudio'],
  ['application/pdf', 'storageKindPdf'],
];

const kindOf = (a: AssetRecord): StringKey =>
  KIND.find(([prefix]) => a.mimeType.startsWith(prefix))?.[1] ?? 'storageKindOther';

/** 一键清理的范围：现在没有地方在用的（快捷操作存的结果除外，它们本来就是用户要留的文件）。 */
const cleanable = (a: AssetRecord, usage: Map<string, AssetUsage>) =>
  a.source !== 'generated' && isUnused(usage.get(a.id));

/** 现在的时间（毫秒）：只在点了以后的处理里用。 */
const nowMs = () => Date.now();

export default function StorageRoute() {
  const { repo, files, locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const recordsVersion = useWorkspace((s) => s.recordsVersion);
  const assetsVersion = useWorkspace((s) => s.assetsVersion);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const palette = usePalette(config.theme);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [viewing, setViewing] = useState<ViewerItem | null>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const assets = await repo.listAssets();
      const revisions = (await repo.listRevisions(1000)).map((r) => r.config);
      const deleted = await repo.listDeletedRecords();
      const ids = new Set([
        ...config.data.tables.map((c) => c.id),
        ...(await repo.countRecords()).map((r) => r.collectionId),
        ...deleted.map((r) => r.collectionId),
      ]);
      const active = (await Promise.all([...ids].map((id) => repo.listRecords(id)))).flat();
      // 只在旧版本里的表：从历史版本里找回结构（和「设置 → 数据」一样）。
      const tables = new Map<string, Collection>();
      for (const raw of revisions) {
        for (const table of revisionTables(raw))
          if (!tables.has(table.id)) tables.set(table.id, table);
      }
      for (const c of config.data.tables) tables.set(c.id, c);
      const records = [...active.map((r) => ({ ...r, deletedAt: null })), ...deleted];
      const usage = assetUsage({
        assetIds: assets.map((a) => a.id),
        config,
        collections: [...tables.values()],
        records,
        revisions,
        now: new Date(),
      });
      const sources = new Map<string, number>();
      for (const a of assets) {
        const bytes = await savedSourceBytes(files, a);
        if (bytes !== null) sources.set(a.id, bytes);
      }
      if (alive)
        setLoaded({
          assets,
          usage,
          tables,
          records: new Map(records.map((r) => [r.id, r])),
          sources,
        });
    })();
    return () => {
      alive = false;
    };
  }, [repo, files, config, recordsVersion, assetsVersion]);

  const caption = [palette.font('body', 13), { color: palette.muted }];
  if (!loaded) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  const { assets, usage, tables, records, sources } = loaded;
  /** 存储空间里的大小：带着中间格式时加上它和原图。 */
  const sizeOf = (a: AssetRecord) => a.size + (sources.get(a.id) ?? 0);
  const total = assets.reduce((n, a) => n + sizeOf(a), 0);
  const unused = assets.filter((a) => cleanable(a, usage));
  const unusedSize = unused.reduce((n, a) => n + sizeOf(a), 0);
  const size = (bytes: number) => formatFileSize(bytes, locale);

  function where(use: AssetUse): string {
    if (use.kind === 'record') {
      const table = tables.get(use.collectionId);
      const record = records.get(use.recordId);
      const title = table && record ? linkTitle(record, table, locale) : '—';
      return t(locale, use.deleted ? 'storageUsedInDeletedRecord' : 'storageUsedInRecord', {
        table: table?.name ?? t(locale, 'storageTableGone'),
        title,
      });
    }
    const page = config.containers.pages.find((p) => p.id === use.pageId);
    const pageTitle = page?.title ?? use.pageId;
    if (use.kind === 'page') return t(locale, 'storageUsedAsBackdrop', { page: pageTitle });
    const component = page && allComponents(page).find((c) => c.id === use.componentId);
    return t(locale, 'storageUsedInComponent', {
      page: pageTitle,
      component: component
        ? componentLabel(component, config, { registry, locale, now: new Date() })
        : use.componentId,
    });
  }

  async function remove(ids: string[]) {
    await deleteUserFiles(ids, repo, files);
    bumpAssets();
  }

  async function preview(a: AssetRecord) {
    const uri = files.fileUri(a.path);
    if (a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/')) {
      setViewing({ uri, kind: a.mimeType.startsWith('video/') ? 'video' : 'image' });
      return;
    }
    try {
      await files.previewFile({ uri, mimeType: a.mimeType, name: a.name });
    } catch (e) {
      Alert.alert(
        a.name,
        e instanceof RunError
          ? runErrorText(locale, e.code, e.detail)
          : runErrorText(locale, 'previewFailed'),
      );
    }
  }

  function askDelete(a: AssetRecord) {
    const n = usage.get(a.id)?.uses.length ?? 0;
    Alert.alert(
      t(locale, 'storageDeleteTitle', { name: a.name }),
      n > 0 ? t(locale, 'storageDeleteUsed', { n }) : t(locale, 'storageDeleteUnused'),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        { text: t(locale, 'delete'), style: 'destructive', onPress: () => void remove([a.id]) },
      ],
    );
  }

  /** 放回桌上改（D-367）：复制一份进新桌面，这个文件不动。 */
  async function putOnDesk(a: AssetRecord) {
    try {
      const desk = await placeAssetOnDesk(files, a, nowMs());
      if (desk) router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } });
    } catch (e) {
      Alert.alert(
        a.name,
        e instanceof RunError ? runErrorText(locale, e.code, e.detail) : String(e),
      );
    }
  }

  function options(a: AssetRecord) {
    Alert.alert(a.name, undefined, [
      ...(sources.has(a.id)
        ? [{ text: t(locale, 'deskPlace'), onPress: () => void putOnDesk(a) }]
        : []),
      { text: t(locale, 'storagePreview'), onPress: () => void preview(a) },
      { text: t(locale, 'delete'), style: 'destructive', onPress: () => askDelete(a) },
      { text: t(locale, 'cancel'), style: 'cancel' },
    ]);
  }

  function askCleanup() {
    Alert.alert(
      t(locale, 'storageCleanupTitle', { n: unused.length }),
      t(locale, 'storageCleanupMessage', { n: unused.length, size: size(unusedSize) }),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        {
          text: t(locale, 'delete'),
          style: 'destructive',
          onPress: () => void remove(unused.map((a) => a.id)),
        },
      ],
    );
  }

  return (
    <ScrollView
      testID="storage-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <PageTitle palette={palette}>{t(locale, 'storageTitle')}</PageTitle>
      <Text style={caption}>{t(locale, 'storageIntro')}</Text>
      {/* 桌上的文件（D-357）：从这里回到房间，放久了提示清掉。 */}
      <DeskList files={files} palette={palette} locale={locale} />
      {assets.length === 0 ? (
        <Card palette={palette}>
          <Text testID="storage-empty" style={caption}>
            {t(locale, 'storageEmpty')}
          </Text>
        </Card>
      ) : (
        <>
          <Text testID="storage-total" style={[palette.font('title', 18), { color: palette.text }]}>
            {t(locale, 'storageSummary', { n: assets.length, size: size(total) })}
          </Text>
          {unused.length > 0 ? (
            <Button
              palette={palette}
              variant="outline"
              danger
              testID="storage-cleanup"
              label={t(locale, 'storageCleanup', { n: unused.length, size: size(unusedSize) })}
              onPress={askCleanup}
            />
          ) : null}
        </>
      )}
      {[...assets]
        .sort((a, b) => sizeOf(b) - sizeOf(a))
        .map((a) => {
          const u = usage.get(a.id);
          const lines = u?.uses.length
            ? u.uses.map(where)
            : [
                a.source === 'generated'
                  ? t(locale, 'storageQuickActionResult')
                  : t(locale, u?.inOldVersions ? 'storageOldVersionsOnly' : 'storageUnused'),
              ];
          return (
            <Card key={a.id} palette={palette}>
              <Pressable
                testID={`storage-file-${a.id}`}
                onPress={() => options(a)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {a.mimeType.startsWith('image/') ? (
                  <AttachmentThumb
                    asset={a}
                    size={48}
                    radius={8}
                    testID={`storage-thumb-${a.id}`}
                  />
                ) : (
                  <Icon
                    name={
                      a.mimeType.startsWith('video/')
                        ? 'video'
                        : a.mimeType.startsWith('audio/')
                          ? 'audio'
                          : 'document'
                    }
                    size={24}
                    color={palette.secondary}
                  />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
                    {a.name}
                  </Text>
                  <Text style={caption}>{`${t(locale, kindOf(a))} · ${size(sizeOf(a))}`}</Text>
                  {lines.map((line, i) => (
                    <Text
                      key={i}
                      testID={`storage-use-${a.id}-${i}`}
                      numberOfLines={1}
                      style={caption}>
                      {line}
                    </Text>
                  ))}
                </View>
              </Pressable>
            </Card>
          );
        })}
      {viewing ? (
        <FileViewer
          items={[viewing]}
          start={0}
          onClose={() => setViewing(null)}
          palette={palette}
          locale={locale}
        />
      ) : null}
    </ScrollView>
  );
}
