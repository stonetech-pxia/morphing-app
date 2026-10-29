import {
  RECORD_LIMITS,
  linkedCollectionIds,
  loadLinkResolver,
  prepareRecordValues,
  type Collection,
  type DataRecord,
  type FieldIssue,
  type LinkResolver,
} from '@morph/core';
import { useEffect, useState } from 'react';

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
 * 引用字段（D-250）显示被引用记录的标题：读出这张表引用的那些表的记录（没删的），增删改后刷新。
 * 被引用的记录删掉了就查不到，显示「已删除的记录」；恢复后又能查到。
 */
export function useLinkResolver(collection: Collection | undefined): LinkResolver | undefined {
  const { repo, locale } = useWorkspaceContext();
  const version = useWorkspace((s) => s.recordsVersion);
  const collections = useWorkspace((s) => s.config?.collections);
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
