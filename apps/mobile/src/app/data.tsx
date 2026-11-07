import {
  appConfigFile,
  appConfigFileName,
  LAYOUT_STORE_KEY,
  layoutCount,
  layoutStoreFile,
  parseLayoutStore,
  parsePickStore,
  PICK_STORE_KEY,
  pickCount,
  appFileOps,
  readAppConfigFile,
  readAppFile,
  readLayoutStoreFile,
  readPickStoreFile,
  RECORD_LIMITS,
  serializeLayoutStore,
  serializePickStore,
  formatRef,
  HOME_PAGE_ID,
  pageTarget,
  formatTimestamp,
  calendarOf,
  linkedCollectionIds,
  loadComputedRecords,
  loadLinkResolver,
  recordsToCsv,
  type AppFile,
  type Collection,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { useRecordActions } from '@/data/records';
import { t } from '@/i18n';
import { LocalModelCard } from '@/packs/LocalModelCard';
import { Card, PageTitle, Pill, SectionLabel } from '@/renderer/ui';
import { usePalette } from '@/renderer/theme';
import { useWorkflowChange } from '@/run/workflow-change';
import { findRevisionTables } from '@/storage/revision-pages';
import type { StoredRecord } from '@/storage/types';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/**
 * 「设置 → 数据」：用户记录的管理页，由内核提供，AI 不能修改。
 * 导出 CSV、查看已移出界面的数据表、恢复最近删除的记录（D-037、D-038、D-041）；
 * 导出 App 配置；预填记忆的导出（也是备份）、从文件恢复、一键清空（D-244）；每张表的「自动读取附件」（D-397）；
 * 本机模型的下载和删除（D-396）。
 */
/** 表上的「附件是」的选项（D-421）。 */
const PREFILL_RULES = [
  { rules: undefined, label: 'prefillRulesGeneral' },
  { rules: 'receipt', label: 'prefillRulesReceipt' },
  { rules: 'card', label: 'prefillRulesCard' },
] as const;

export default function DataRoute() {
  const { repo, files, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const version = useWorkspace((s) => s.recordsVersion);
  const bump = useWorkspace((s) => s.bumpRecords);
  const palette = usePalette(config.theme);
  const actions = useRecordActions();
  const change = useWorkflowChange();
  const proposeImport = useWorkspace((s) => s.proposeImport);
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const clearNext = useWorkspace((s) => s.clearNext);
  const clearSuggest = useWorkspace((s) => s.clearSuggest);
  const selectTab = useWorkspace((s) => s.selectTab);
  const leaveApp = useWorkspace((s) => s.leaveApp);
  const router = useRouter();
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [orphans, setOrphans] = useState<
    { collection: Collection | null; id: string; count: number }[]
  >([]);
  const [deleted, setDeleted] = useState<StoredRecord[]>([]);
  const [known, setKnown] = useState<Map<string, Collection>>(new Map());
  const [layouts, setLayouts] = useState(0);
  // 新记录表单里点过的候选（D-394）：一个字段算一个。
  const [picks, setPicks] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await repo.countRecords();
      const deletedRows = await repo.listDeletedRecords();
      // 已移出界面的数据表：从历史版本里找回它的结构（版本只追加、不删除）。
      const missing = new Set(
        [...rows.map((r) => r.collectionId), ...deletedRows.map((r) => r.collectionId)].filter(
          (id) => !config.data.tables.some((c) => c.id === id),
        ),
      );
      const found = await findRevisionTables(repo, missing);
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
      setKnown(new Map([...found, ...config.data.tables.map((c) => [c.id, c] as const)]));
      setLayouts(layoutCount(parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY))));
      setPicks(pickCount(parsePickStore(await repo.getMeta(PICK_STORE_KEY))));
    })();
    return () => {
      alive = false;
    };
  }, [repo, config, version]);

  async function exportCsv(collection: Collection) {
    // 查找、汇总、上一条导出算出来的值（D-291）。
    const { view, records } = await loadComputedRecords(
      (id) => repo.listRecords(id),
      config.data.tables,
      collection,
      new Date(),
      calendarOf(config),
    );
    records.sort((a, b) => a.createdAt - b.createdAt);
    // 引用字段导出被引用记录的标题（D-250）。
    const links = await loadLinkResolver(
      (id) => repo.listRecords(id),
      config.data.tables,
      linkedCollectionIds(view),
      locale,
    );
    await files.shareText(
      `${collection.name}.csv`,
      recordsToCsv(view, records, locale, links),
      'text/csv',
    );
  }

  /** 文件名里的日期（本地时间），导出几次不会互相覆盖。 */
  const today = (now: Date) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  async function exportConfig() {
    const now = new Date();
    await files.shareText(appConfigFileName(now), appConfigFile(config, now), 'application/json');
  }

  /** 导入一份 App 配置（导出的文件）：先预览，确认后换成它，能在改动记录里撤销；记录都留着（底线 5、7）。 */
  async function importConfig() {
    const picked = await files.pickDocuments(['application/json', 'text/plain'], false);
    const file = picked?.[0];
    if (!file) return;
    let text = '';
    try {
      text = await files.readPickedText(file.uri);
    } catch {
      text = '';
    }
    // App 文件（一个 App，D-485）：加到现有的工作区里，不替换任何东西。
    const appFile = readAppFile(text);
    if (appFile) {
      await importApp(appFile);
      return;
    }
    const raw: unknown = readAppConfigFile(text);
    if (!raw) {
      Alert.alert(t(locale, 'importAppConfig'), t(locale, 'importAppConfigInvalid'));
      return;
    }
    const result = await proposeImport(raw, t(locale, 'importAppConfigName'));
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    Alert.alert(
      t(locale, 'importAppConfig'),
      [t(locale, 'importAppConfigConfirm'), ...result.proposal.lines].join('\n'),
      [
        { text: t(locale, 'cancel'), style: 'cancel', onPress: () => void cancel() },
        {
          text: t(locale, 'presetApply'),
          onPress: () =>
            void (async () => {
              if (!(await confirm())) return;
              // 换了一个 App，上一次修改剩下的那句和下一步的建议也就接不上了。
              await clearNext();
              await clearSuggest();
              leaveApp();
              selectTab(pageTarget(HOME_PAGE_ID));
              router.back();
            })(),
        },
      ],
    );
  }

  /** 导入一个 App 文件：先预览，确认后加成一个新 App，能在改动记录里撤销；原来的一个都不动（底线 5、7）。 */
  async function importApp(appFile: AppFile) {
    const plan = appFileOps(appFile, config);
    if (!plan.ok) {
      Alert.alert(
        t(locale, 'importAppConfig'),
        t(locale, 'importAppClash', { reason: plan.error }),
      );
      return;
    }
    const result = await proposeOps(plan.ops, t(locale, 'importAppSummary', { name: plan.name }));
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    Alert.alert(
      t(locale, 'importAppConfig'),
      [t(locale, 'importAppConfirm', { name: plan.name }), ...result.proposal.lines].join('\n'),
      [
        { text: t(locale, 'cancel'), style: 'cancel', onPress: () => void cancel() },
        {
          text: t(locale, 'presetApply'),
          onPress: () =>
            void (async () => {
              if (!(await confirm())) return;
              // 回到主页，新 App 的入口就在那里。
              leaveApp();
              selectTab(pageTarget(HOME_PAGE_ID));
              router.back();
            })(),
        },
      ],
    );
  }

  async function exportMemory() {
    const now = new Date();
    const store = parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY));
    const tapped = parsePickStore(await repo.getMeta(PICK_STORE_KEY));
    await files.shareText(
      `tinkrum-prefill-memory-${today(now)}.json`,
      layoutStoreFile(store, now, tapped),
      'application/json',
    );
  }

  async function restoreMemory() {
    const picked = await files.pickDocuments(['application/json', 'text/plain'], false);
    const file = picked?.[0];
    if (!file) return;
    let store = null;
    let fromFile = null;
    try {
      const text = await files.readPickedText(file.uri);
      store = readLayoutStoreFile(text);
      fromFile = readPickStoreFile(text);
    } catch {
      store = null;
    }
    if (!store) {
      Alert.alert(t(locale, 'prefillMemoryRestore'), t(locale, 'prefillMemoryRestoreInvalid'));
      return;
    }
    const count = layoutCount(store);
    Alert.alert(
      t(locale, 'prefillMemoryRestore'),
      t(locale, 'prefillMemoryRestoreConfirm', { count }),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        {
          text: t(locale, 'prefillMemoryRestore'),
          onPress: () =>
            void repo
              .setMeta(LAYOUT_STORE_KEY, serializeLayoutStore(store))
              .then(() => repo.setMeta(PICK_STORE_KEY, serializePickStore(fromFile ?? {})))
              .then(() => {
                setLayouts(count);
                setPicks(pickCount(fromFile ?? {}));
                Alert.alert(t(locale, 'prefillMemoryRestored', { count }));
              }),
        },
      ],
    );
  }

  /** 表上的「自动读取附件」（D-397）：默认打开，不写；关掉才写 false。能在改动记录里撤销。 */
  const setReadAttachments = (c: Collection, on: boolean) =>
    change(
      [{ op: 'updateData', table: c.id, changes: { readAttachments: on ? null : false } }],
      t(locale, on ? 'describeReadAttachmentsOn' : 'describeReadAttachmentsOff', { name: c.name }),
    );

  /** 表上的「附件是」（D-421）：其他不写，只有通用规则。 */
  const setPrefillRules = (c: Collection, rules: Collection['prefillRules']) =>
    change(
      [{ op: 'updateData', table: c.id, changes: { prefillRules: rules ?? null } }],
      t(
        locale,
        rules === 'receipt'
          ? 'describePrefillRulesReceipt'
          : rules === 'card'
            ? 'describePrefillRulesCard'
            : 'describePrefillRulesGeneral',
        { name: c.name },
      ),
    );

  function clearMemory() {
    Alert.alert(t(locale, 'prefillMemoryClear'), t(locale, 'prefillMemoryClearConfirm'), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'prefillMemoryClear'),
        style: 'destructive',
        onPress: () =>
          void repo
            .setMeta(LAYOUT_STORE_KEY, serializeLayoutStore({}))
            .then(() => repo.setMeta(PICK_STORE_KEY, serializePickStore({})))
            .then(() => {
              setLayouts(0);
              setPicks(0);
            }),
      },
    ]);
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
      {config.data.tables.map((c) => (
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
          {c.fields.some((f) => f.type === 'file') ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[palette.font('bodyMedium', 14), { color: palette.text }]}>
                  {t(locale, 'readAttachmentsLabel')}
                </Text>
                <Text style={caption}>{t(locale, 'readAttachmentsHint')}</Text>
              </View>
              <Switch
                testID={`read-attachments-${c.id}`}
                value={c.readAttachments !== false}
                onValueChange={(on) => void setReadAttachments(c, on)}
                trackColor={{ true: palette.primary }}
              />
            </View>
          ) : null}
          {c.fields.some((f) => f.type === 'file') && c.readAttachments !== false ? (
            <View style={{ gap: 6 }}>
              <Text style={[palette.font('bodyMedium', 14), { color: palette.text }]}>
                {t(locale, 'prefillRulesLabel')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {PREFILL_RULES.map(({ rules, label }) => {
                  const selected = c.prefillRules === rules;
                  return (
                    <Pressable
                      key={label}
                      testID={`prefill-rules-${c.id}-${rules ?? 'general'}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => void setPrefillRules(c, rules)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: selected ? palette.primary : palette.border,
                      }}>
                      <Text
                        style={[
                          palette.font('bodyMedium', 14),
                          { color: selected ? palette.primary : palette.text },
                        ]}>
                        {t(locale, label)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={caption}>{t(locale, 'prefillRulesHint')}</Text>
            </View>
          ) : null}
        </Card>
      ))}

      <SectionLabel palette={palette}>{t(locale, 'appConfigTitle')}</SectionLabel>
      <Card palette={palette} testID="app-config">
        <Text style={caption}>{t(locale, 'appConfigHint')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pill
            palette={palette}
            testID="export-app-config"
            label={t(locale, 'exportAppConfig')}
            onPress={() => void exportConfig()}
          />
          <Pill
            palette={palette}
            testID="import-app-config"
            label={t(locale, 'importAppConfig')}
            onPress={() => void importConfig()}
          />
        </View>
      </Card>

      <SectionLabel palette={palette}>{t(locale, 'prefillMemoryTitle')}</SectionLabel>
      <Card palette={palette} testID="prefill-memory">
        <Text style={[palette.font('title', 15), { color: palette.text }]}>
          {layouts > 0 || picks === 0
            ? layouts > 0
              ? t(locale, 'prefillMemoryCount', { count: layouts })
              : t(locale, 'prefillMemoryNone')
            : null}
          {layouts > 0 && picks > 0 ? '\n' : ''}
          {picks > 0 ? t(locale, 'prefillMemoryPicks', { count: picks }) : null}
        </Text>
        <Text style={caption}>{t(locale, 'prefillMemoryHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {layouts + picks > 0 ? (
            <Pill
              palette={palette}
              testID="export-prefill-memory"
              label={t(locale, 'prefillMemoryExport')}
              onPress={() => void exportMemory()}
            />
          ) : null}
          <Pill
            palette={palette}
            testID="restore-prefill-memory"
            label={t(locale, 'prefillMemoryRestore')}
            onPress={() => void restoreMemory()}
          />
          {layouts + picks > 0 ? (
            <Pill
              palette={palette}
              danger
              testID="clear-prefill-memory"
              label={t(locale, 'prefillMemoryClear')}
              onPress={clearMemory}
            />
          ) : null}
        </View>
      </Card>

      <LocalModelCard palette={palette} locale={locale} />

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
                {name(c ?? null, r.collectionId)} · {formatTimestamp(r.deletedAt!, locale)}
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
