import {
  RECORD_LIMITS,
  prepareRecordValues,
  type Collection,
  type DataRecord,
  type FieldIssue,
} from '@morph/core';
import { useEffect, useState } from 'react';

import { t } from '../i18n';
import { newAssetId } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

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

export type SaveResult =
  { ok: true; id: string } | { ok: false; issues: FieldIssue[] } | { ok: false; full: true };

export function useRecordActions() {
  const { repo, locale } = useWorkspaceContext();
  const bump = useWorkspace((s) => s.bumpRecords);
  const showToast = useWorkspace((s) => s.showToast);

  return {
    async add(collection: Collection, input: Record<string, unknown>): Promise<SaveResult> {
      const counts = await repo.countRecords();
      const count = counts.find((c) => c.collectionId === collection.id)?.count ?? 0;
      if (count >= RECORD_LIMITS.perCollection) return { ok: false, full: true };
      const now = new Date();
      const prepared = prepareRecordValues(collection, input, null, now);
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
      const prepared = prepareRecordValues(collection, input, record.values, now);
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
