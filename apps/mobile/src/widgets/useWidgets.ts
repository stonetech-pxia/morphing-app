import {
  calendarOf,
  type DataRecord,
  type Locale,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { serial } from '../data/record-actions';
import { t } from '../i18n';
import { newAssetId } from '../runtime/runner';
import type { WorkspaceRepo } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RecordUndo } from '../workspace/store/types';
import { applyInMemory, planWidgetOp } from './ops';
import { useWidgetPlacement } from './placed';
import { buildWidgetSnapshot } from './snapshot';
import type { PlacedWidget, QueuedWidgetOp, WidgetPlatform } from './types';

// 桌面小组件和 App（D-322、D-323）：
// - 取走小组件上点了的操作：App 启动、回到前台、Android 上 App 开着时小组件点了（onQueue）。按点的时间顺序、
//   以点的时间执行（「今天」是点的那天，记录的创建时间也是点的时间），和 App 里的一键操作排在同一个队列里，
//   两边不会同时写。执行完弹一个提示条，可以一起撤销。页面改过、操作换了的不执行，提示条里说。
// - 画面：正式版本的配置、记录、放到桌面的组件、语言变了就重算（等半秒，连着改只算一次），App 开着跨天时也重算。

type Repo = Pick<WorkspaceRepo, 'listRecords' | 'insertRecord' | 'updateRecord'>;

async function allRecords(repo: Repo, config: WorkspaceConfig) {
  const map = new Map<string, DataRecord[]>();
  for (const c of config.collections) map.set(c.id, await repo.listRecords(c.id));
  return map;
}

function parseQueued(raw: readonly string[]): QueuedWidgetOp[] {
  const out: QueuedWidgetOp[] = [];
  for (const text of raw) {
    try {
      const e = JSON.parse(text) as Partial<QueuedWidgetOp>;
      if (
        typeof e.op === 'string' &&
        typeof e.component === 'string' &&
        typeof e.hash === 'string' &&
        typeof e.at === 'number' &&
        Number.isFinite(e.at)
      )
        out.push({
          op: e.op,
          component: e.component,
          hash: e.hash,
          at: e.at,
          ...(typeof e.record === 'string' ? { record: e.record } : {}),
        });
    } catch {
      // 写坏的一条跳过。
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface DrainResult {
  done: number;
  skipped: number;
  undo: Extract<RecordUndo, { kind: 'batch' }>;
}

/** 执行取走的点按。返回 null：队列是空的。 */
export async function runQueuedWidgetOps(
  raw: readonly string[],
  repo: Repo,
  config: WorkspaceConfig,
  now: Date,
): Promise<DrainResult | null> {
  const queued = parseQueued(raw);
  if (raw.length === 0) return null;
  const cal = calendarOf(config);
  let records: Map<string, DataRecord[]> = await allRecords(repo, config);
  const undo: DrainResult['undo'] = { kind: 'batch', discard: [], records: [] };
  let done = 0;
  for (const entry of queued) {
    // 时钟被往回调过、点的时间在未来：按现在算。
    const at = new Date(Math.min(entry.at, now.getTime()));
    const write = planWidgetOp(config, entry, records, at, cal);
    if (!write) continue;
    if (write.kind === 'insert') {
      const id = newAssetId();
      await repo.insertRecord({
        id,
        collectionId: write.collection.id,
        values: write.values,
        createdAt: at.getTime(),
        updatedAt: at.getTime(),
      });
      undo.discard.push(id);
      records = applyInMemory(records, write, at, id);
    } else {
      await repo.updateRecord(write.id, write.values, at.getTime());
      // 撤销改回第一次点之前的值。
      if (!undo.records.some((r) => r.id === write.id))
        undo.records.push({ id: write.id, values: write.before });
      records = applyInMemory(records, write, at, write.id);
    }
    done++;
  }
  return { done, skipped: raw.length - done, undo };
}

/** 提示条的文字：记下了几次；有没执行的，接着说。 */
export function drainMessage(result: DrainResult, locale: Locale): string {
  const parts: string[] = [];
  if (result.done > 0) parts.push(t(locale, 'widgetDone', { n: result.done }));
  if (result.skipped > 0) parts.push(t(locale, 'widgetSkipped', { n: result.skipped }));
  return parts.join(t(locale, 'separatorList'));
}

/** 整份画面的 JSON（小组件读的那份）。 */
export async function widgetSnapshotJson(
  repo: Repo,
  config: WorkspaceConfig,
  placed: readonly PlacedWidget[],
  locale: Locale,
  registry: Registry,
  now: Date,
): Promise<string> {
  const records = await allRecords(repo, config);
  return JSON.stringify(
    await buildWidgetSnapshot({ config, placed, locale, registry, now, records }),
  );
}

const msToNextDay = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000;

/** 放在根布局里。 */
export function WidgetBridge({ platform }: { platform: WidgetPlatform | null }) {
  const { repo, locale, registry, store } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config);
  const recordsVersion = useWorkspace((s) => s.recordsVersion);
  const placed = useWidgetPlacement((s) => s.placed);
  const last = useRef<string | null>(null);
  // App 开着跨天时加一，画面重算（明天那份变成今天，再算后天）。
  const [day, setDay] = useState(0);

  useEffect(() => {
    if (platform) void useWidgetPlacement.getState().load(repo);
  }, [platform, repo]);

  // 取走点按。
  useEffect(() => {
    if (!platform) return;
    const drain = () =>
      serial(async () => {
        const current = store.getState().config;
        if (!current) return;
        const raw = await platform.takeQueue().catch(() => [] as string[]);
        const result = await runQueuedWidgetOps(raw, repo, current, new Date());
        if (!result) return;
        store.getState().bumpRecords();
        store.getState().showToast({
          message: drainMessage(result, locale),
          ...(result.done > 0 ? { undo: result.undo } : {}),
        });
      }).catch(() => undefined);
    void drain();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void drain();
    });
    const off = platform.onQueue(() => void drain());
    return () => {
      sub.remove();
      off();
    };
  }, [platform, repo, store, locale]);

  useEffect(() => {
    if (!platform) return;
    const timer = setTimeout(() => setDay((d) => d + 1), msToNextDay(new Date()));
    return () => clearTimeout(timer);
  }, [platform, day]);

  // 画面：只在内容变了时写（写了系统就重画小组件）。
  useEffect(() => {
    if (!platform || !config || placed === null) return;
    let alive = true;
    const timer = setTimeout(() => {
      void widgetSnapshotJson(repo, config, placed, locale, registry, new Date())
        .then(async (json) => {
          if (!alive || json === last.current) return;
          last.current = json;
          await platform.setSnapshot(json);
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [platform, repo, config, recordsVersion, placed, locale, registry, day]);
  return null;
}
