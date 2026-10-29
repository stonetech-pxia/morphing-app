import type { DataRecord } from '@morph/core';

import {
  RevisionConflictError,
  type AssetRecord,
  type ChangeRequestRecord,
  type CommitInput,
  type RevisionRecord,
  type StoredRecord,
  type ToolRunRecord,
  type WorkspaceRepo,
  type RecordRange,
} from './types';

// 内存实现：用于测试，语义与 SQLite 实现一致。数据以 JSON 字符串保存，模拟“写入后重新读取”。

export class MemoryWorkspaceRepo implements WorkspaceRepo {
  private revisions: (Omit<RevisionRecord, 'config'> & { configJson: string })[] = [];
  private headId: number | null = null;
  private changeRequests: ChangeRequestRecord[] = [];
  private assets: AssetRecord[] = [];
  private grants = new Set<string>();
  private toolRuns: ToolRunRecord[] = [];
  private meta = new Map<string, string>();
  /** 记录以 JSON 保存，模拟数据库的写入与读取。 */
  private records = new Map<string, string>();
  private clock = 0;

  private now() {
    return ++this.clock;
  }

  private toRecord(r: Omit<RevisionRecord, 'config'> & { configJson: string }): RevisionRecord {
    const { configJson, ...rest } = r;
    return { ...rest, config: JSON.parse(configJson) };
  }

  /** 测试用：直接写入任意（可能损坏的）快照并设为 head。 */
  forceHead(config: unknown, parentId: number | null = this.headId): number {
    const id = this.revisions.length + 1;
    this.revisions.push({
      id,
      parentId,
      schemaVersion: (config as { schemaVersion?: number })?.schemaVersion ?? -1,
      configJson: JSON.stringify(config),
      source: 'ai',
      summary: 'forced',
      createdAt: this.now(),
    });
    this.headId = id;
    return id;
  }

  async getHead() {
    return this.headId === null ? null : this.getRevision(this.headId);
  }

  async getRevision(id: number) {
    const r = this.revisions.find((x) => x.id === id);
    return r ? this.toRecord(r) : null;
  }

  async listRevisions(limit: number) {
    return [...this.revisions]
      .reverse()
      .slice(0, limit)
      .map((r) => this.toRecord(r));
  }

  async commitRevision(input: CommitInput) {
    if (this.headId !== input.baseId) throw new RevisionConflictError(input.baseId, this.headId);
    const record = {
      id: this.revisions.length + 1,
      parentId: input.baseId,
      schemaVersion: input.config.schemaVersion,
      configJson: JSON.stringify(input.config),
      source: input.source,
      summary: input.summary,
      createdAt: this.now(),
    };
    this.revisions.push(record);
    this.headId = record.id;
    return this.toRecord(record);
  }

  async createChangeRequest(input: Parameters<WorkspaceRepo['createChangeRequest']>[0]) {
    const at = this.now();
    const id = this.changeRequests.length + 1;
    this.changeRequests.push({
      id,
      input: input.input,
      plan: input.plan,
      status: input.status,
      baseRevisionId: input.baseRevisionId,
      resultRevisionId: null,
      error: input.error ?? null,
      createdAt: at,
      updatedAt: at,
    });
    return id;
  }

  async updateChangeRequest(
    id: number,
    patch: Parameters<WorkspaceRepo['updateChangeRequest']>[1],
  ) {
    const cr = this.changeRequests.find((x) => x.id === id);
    if (!cr) throw new Error(`change request ${id} not found`);
    cr.status = patch.status;
    if (patch.resultRevisionId !== undefined) cr.resultRevisionId = patch.resultRevisionId;
    if (patch.error !== undefined) cr.error = patch.error;
    cr.updatedAt = this.now();
  }

  async getChangeRequest(id: number) {
    return this.changeRequests.find((x) => x.id === id) ?? null;
  }

  async addAsset(asset: AssetRecord) {
    this.assets.push({ ...asset });
  }

  async getAsset(id: string) {
    return this.assets.find((a) => a.id === id) ?? null;
  }

  async listAssets() {
    return [...this.assets].reverse();
  }

  async deleteAsset(id: string) {
    this.assets = this.assets.filter((a) => a.id !== id);
    for (const key of [...this.grants]) if (key.endsWith(`/${id}`)) this.grants.delete(key);
    for (const run of this.toolRuns) if (run.outputAssetId === id) run.outputAssetId = null;
  }

  async grantAsset(toolId: string, assetId: string) {
    this.grants.add(`${toolId}/${assetId}`);
  }

  async hasGrant(toolId: string, assetId: string) {
    return this.grants.has(`${toolId}/${assetId}`);
  }

  async revokeToolGrants(toolId: string) {
    for (const key of [...this.grants]) if (key.startsWith(`${toolId}/`)) this.grants.delete(key);
  }

  async startToolRun(input: { toolId: string; workflowId: string; revisionId: number }) {
    const id = this.toolRuns.length + 1;
    this.toolRuns.push({
      id,
      ...input,
      status: 'running',
      error: null,
      outputAssetId: null,
      startedAt: this.now(),
      finishedAt: null,
    });
    return id;
  }

  async finishToolRun(id: number, result: Parameters<WorkspaceRepo['finishToolRun']>[1]) {
    const run = this.toolRuns.find((r) => r.id === id);
    if (!run) throw new Error(`tool run ${id} not found`);
    run.status = result.status;
    run.error = result.error ?? null;
    run.outputAssetId = result.outputAssetId ?? null;
    run.finishedAt = this.now();
  }

  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }

  async countSucceededRuns() {
    const counts: import('./types').SucceededRuns = new Map();
    for (const run of this.toolRuns) {
      if (run.status !== 'succeeded') continue;
      const prev = counts.get(run.workflowId);
      counts.set(run.workflowId, {
        count: (prev?.count ?? 0) + 1,
        lastAt: Math.max(prev?.lastAt ?? 0, run.startedAt),
      });
    }
    return counts;
  }

  async listToolRuns(limit: number) {
    return [...this.toolRuns].reverse().slice(0, limit);
  }

  private readRecord(id: string): StoredRecord | null {
    const json = this.records.get(id);
    return json ? (JSON.parse(json) as StoredRecord) : null;
  }

  private writeRecord(record: StoredRecord) {
    this.records.set(record.id, JSON.stringify(record));
  }

  private allRecords(): StoredRecord[] {
    return [...this.records.keys()].map((id) => this.readRecord(id)!);
  }

  async listRecords(collectionId: string) {
    return this.allRecords()
      .filter((r) => r.collectionId === collectionId && r.deletedAt === null)
      .map(({ deletedAt: _, ...rest }) => rest);
  }

  async listRecordsInRange(collectionId: string, range: RecordRange) {
    return this.allRecords()
      .filter((r) => {
        if (r.collectionId !== collectionId || r.deletedAt !== null) return false;
        if (range.by === 'createdAt' || range.by === 'updatedAt')
          return r[range.by] >= range.fromMs && r[range.by] < range.untilMs;
        const v = r.values[range.by];
        return typeof v === 'string' && v >= range.from && v < range.until;
      })
      .map(({ deletedAt: _, ...rest }) => rest);
  }

  async getRecord(id: string) {
    return this.readRecord(id);
  }

  async insertRecord(record: DataRecord) {
    if (this.records.has(record.id)) throw new Error(`record ${record.id} exists`);
    this.writeRecord({ ...record, deletedAt: null });
  }

  async updateRecord(id: string, values: Record<string, unknown>, updatedAt: number) {
    const r = this.readRecord(id);
    if (r) this.writeRecord({ ...r, values, updatedAt });
  }

  async deleteRecord(id: string, deletedAt: number) {
    const r = this.readRecord(id);
    if (r) this.writeRecord({ ...r, deletedAt });
  }

  async restoreRecord(id: string) {
    const r = this.readRecord(id);
    if (r) this.writeRecord({ ...r, deletedAt: null });
  }

  async discardRecord(id: string) {
    this.records.delete(id);
  }

  async listDeletedRecords() {
    return this.allRecords()
      .filter((r) => r.deletedAt !== null)
      .sort((a, b) => b.deletedAt! - a.deletedAt!);
  }

  async purgeDeletedRecords(before: number) {
    const old = this.allRecords().filter((r) => r.deletedAt !== null && r.deletedAt < before);
    for (const r of old) this.records.delete(r.id);
    return old.length;
  }

  async countRecords() {
    const counts = new Map<string, number>();
    for (const r of this.allRecords()) {
      if (r.deletedAt === null) counts.set(r.collectionId, (counts.get(r.collectionId) ?? 0) + 1);
    }
    return [...counts].map(([collectionId, count]) => ({ collectionId, count }));
  }

  async purgeCollection(collectionId: string) {
    for (const r of this.allRecords())
      if (r.collectionId === collectionId) this.records.delete(r.id);
  }
}
