import {
  RECORD_LIMITS,
  expandCollection,
  linkedCollectionIds,
  loadComputedRecords,
  loadLinkResolver,
  monthQueryRange,
  prepareRecordValues,
  type Calendar,
  type Collection,
  type DataRecord,
  type FieldIssue,
  type LinkResolver,
} from '@morph/core';
import { useEffect, useMemo, useState } from 'react';

import { t } from '../i18n';
import { newAssetId } from '../runtime/runner';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';

// 用户记录的读写。只由用户在页面上的操作触发，直接写数据库，不经过 AI、不生成版本
// （docs/DATA_DESIGN.md）。AI 拿到的只有 WorkspaceConfig，而记录从不进入配置。

/** 某张表未删除的全部记录；增删改后自动刷新。null 表示还在读取。 */
export function useRecords(collectionId: string): DataRecord[] | null {
  const { repo } = useWorkspaceContext();
  const version = useWorkspace((s) => s.recordsVersion);
  const [records, setRecords] = useState<DataRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    void repo.listRecords(collectionId).then((r) => alive && setRecords(r));
    return () => {
      alive = false;
    };
  }, [repo, collectionId, version]);
  return records;
}

/**
 * 一张表的记录，连同查找、汇总、上一条算出来的值（D-291，只在本机算，related.ts），和显示用的表（这几种
 * 字段换成它们显示的那种字段）。会读它要用到的别的表的记录；增删改后、表的定义变了重新算。
 * collections、cal 用页面正在显示的那份配置（草稿预览时是草稿）。写记录仍然用原来的表。
 */
export function useComputedRecords(
  collections: readonly Collection[],
  collection: Collection | undefined,
  cal: Calendar,
): { view: Collection | undefined; records: DataRecord[] | null } {
  const { repo } = useWorkspaceContext();
  const version = useWorkspace((s) => s.recordsVersion);
  const [loaded, setLoaded] = useState<{ view: Collection; records: DataRecord[] } | null>(null);
  const calKey = JSON.stringify(cal);
  useEffect(() => {
    if (!collection) return;
    let alive = true;
    void loadComputedRecords(
      (id) => repo.listRecords(id),
      collections,
      collection,
      new Date(),
      JSON.parse(calKey) as Calendar,
    ).then((r) => alive && setLoaded(r));
    return () => {
      alive = false;
    };
  }, [repo, collections, collection, calKey, version]);
  const view = useMemo(
    () => collection && expandCollection(collections, collection),
    [collections, collection],
  );
  // 表换了以后，旧的那份不再用。
  return { view, records: loaded && loaded.view === view ? loaded.records : null };
}

/**
 * 月历（D-305）一个月的记录：只读这个月（多读一天，见 monthQueryRange）。表里有查找、汇总、上一条时，
 * 要别的记录才能算，就读整张表再算（和 useComputedRecords 一样）；dateField 不是存着的日期、日期时间或系统字段时
 * 也读整张表。落在哪天、筛选由调用方按 recordDay 再精确地分。
 */
export function useMonthRecords(
  collections: readonly Collection[],
  collection: Collection | undefined,
  dateField: string,
  month: string,
  cal: Calendar,
): { view: Collection | undefined; records: DataRecord[] | null } {
  const { repo } = useWorkspaceContext();
  const version = useWorkspace((s) => s.recordsVersion);
  const [loaded, setLoaded] = useState<{
    key: string;
    view: Collection;
    records: DataRecord[];
  } | null>(null);
  const calKey = JSON.stringify(cal);
  const key = `${month}|${dateField}`;
  useEffect(() => {
    if (!collection) return;
    let alive = true;
    const stored =
      dateField === 'createdAt' ||
      dateField === 'updatedAt' ||
      collection.fields.some(
        (f) => f.id === dateField && (f.type === 'date' || f.type === 'datetime'),
      );
    // 查找、汇总、上一条要别的记录（上一条可能在上个月）；公式只看自己这条，可以只读这个月。
    const whole =
      !stored ||
      collection.fields.some(
        (f) => f.type === 'lookup' || f.type === 'rollup' || f.type === 'previous',
      );
    const range = { by: dateField, ...monthQueryRange(month) };
    void loadComputedRecords(
      (id) =>
        whole || id !== collection.id ? repo.listRecords(id) : repo.listRecordsInRange(id, range),
      collections,
      collection,
      new Date(),
      JSON.parse(calKey) as Calendar,
    ).then((r) => alive && setLoaded({ key, ...r }));
    return () => {
      alive = false;
    };
  }, [repo, collections, collection, calKey, version, key, dateField, month]);
  const view = useMemo(
    () => collection && expandCollection(collections, collection),
    [collections, collection],
  );
  return {
    view,
    records: loaded && loaded.view === view && loaded.key === key ? loaded.records : null,
  };
}

/**
 * 引用字段（D-250）显示被引用记录的标题：读出这张表引用的那些表的记录（没删的），增删改后刷新。
 * 被引用的记录删掉了就查不到，显示「已删除的记录」；恢复后又能查到。
 */
export function useLinkResolver(collection: Collection | undefined): LinkResolver | undefined {
  const { repo, locale } = useWorkspaceContext();
  const version = useWorkspace((s) => s.recordsVersion);
  const collections = useWorkspace((s) => s.config?.data.tables);
  const targets = collection ? linkedCollectionIds(collection).join(',') : '';
  // 记下是为哪几张表读的：表换了以后旧的不再用。
  const [loaded, setLoaded] = useState<{ targets: string; resolver: LinkResolver } | null>(null);
  useEffect(() => {
    if (!targets || !collections) return;
    let alive = true;
    void loadLinkResolver(
      (id) => repo.listRecords(id),
      collections,
      targets.split(','),
      locale,
    ).then((resolver) => alive && setLoaded({ targets, resolver }));
    return () => {
      alive = false;
    };
  }, [repo, collections, targets, locale, version]);
  return loaded && loaded.targets === targets ? loaded.resolver : undefined;
}

export type SaveResult =
  { ok: true; id: string } | { ok: false; issues: FieldIssue[] } | { ok: false; full: true };

export function useRecordActions() {
  const { repo, locale } = useWorkspaceContext();
  const bump = useWorkspace((s) => s.bumpRecords);
  const showToast = useWorkspace((s) => s.showToast);
  const cal = useCalendar();

  return {
    async add(collection: Collection, input: Record<string, unknown>): Promise<SaveResult> {
      const counts = await repo.countRecords();
      const count = counts.find((c) => c.collectionId === collection.id)?.count ?? 0;
      if (count >= RECORD_LIMITS.perCollection) return { ok: false, full: true };
      const now = new Date();
      const prepared = prepareRecordValues(collection, input, null, now, cal);
      if (!prepared.ok) return { ok: false, issues: prepared.issues };
      const id = newAssetId();
      await repo.insertRecord({
        id,
        collectionId: collection.id,
        values: prepared.values,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
      bump();
      return { ok: true, id };
    },

    async update(
      collection: Collection,
      record: DataRecord,
      input: Record<string, unknown>,
    ): Promise<SaveResult> {
      const now = new Date();
      const prepared = prepareRecordValues(collection, input, record.values, now, cal);
      if (!prepared.ok) return { ok: false, issues: prepared.issues };
      await repo.updateRecord(record.id, prepared.values, now.getTime());
      bump();
      return { ok: true, id: record.id };
    },

    /** 软删除，提示条上可以撤销。 */
    async remove(record: DataRecord): Promise<void> {
      await repo.deleteRecord(record.id, Date.now());
      bump();
      showToast({ message: t(locale, 'recordDeleted'), restoreRecordId: record.id });
    },

    async restore(id: string): Promise<void> {
      await repo.restoreRecord(id);
      bump();
    },
  };
}
