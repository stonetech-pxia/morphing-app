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
import { newAssetId } from '../runtime/ids';
import type { WorkspaceRepo } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { applyInMemory, planWidgetOp } from './ops';
import { useWidgetPlacement } from './placed';
import { buildWidgetSnapshot } from './snapshot';
import type { PlacedWidget, QueueEntry, QueuedWidgetOp, WidgetPlatform } from './types';

// 桌面小组件和 App（D-322、D-323）：
// - 处理小组件上点了的操作：App 启动、回到前台、Android 上 App 开着时小组件点了（onQueue）。先读出来（不删），按点的时间顺序、
//   以点的时间执行（「今天」是点的那天，记录的创建时间也是点的时间），和 App 里的一键操作排在同一个队列里，
//   两边不会同时写。执行完弹一个提示条说记下了几次（不带撤销，底线 11）。页面改过、操作换了的不执行，提示条里说。
// - 画面：正式版本的配置、记录、放到桌面的组件、语言变了就重算（等半秒，连着改只算一次），App 开着跨天时也重算。

type Repo = Pick<WorkspaceRepo, 'listRecords' | 'applyRecordWrites' | 'getMeta' | 'setMeta'>;

async function allRecords(repo: Repo, config: WorkspaceConfig) {
  const map = new Map<string, DataRecord[]>();
  for (const c of config.data.tables) map.set(c.id, await repo.listRecords(c.id));
  return map;
}

function parseQueuedOp(text: string): QueuedWidgetOp | null {
  try {
    const e = JSON.parse(text) as Partial<QueuedWidgetOp>;
    if (
      typeof e.op === 'string' &&
      typeof e.component === 'string' &&
      typeof e.hash === 'string' &&
      typeof e.at === 'number' &&
      Number.isFinite(e.at)
    )
      return {
        op: e.op,
        component: e.component,
        hash: e.hash,
        at: e.at,
        ...(typeof e.record === 'string' ? { record: e.record } : {}),
      };
  } catch {
    // 写坏的一条跳过。
  }
  return null;
}

export interface DrainResult {
  done: number;
  skipped: number;
  /** 出了错、留在队列里下次再做的点按个数（没有时没有这一项）。 */
  pending?: number;
}

/** 处理过的点按（队列里的 id）；存在设备上，和记录一起存：做完了但删除没成功，下次读到也不会再做一遍。 */
const HANDLED_KEY = 'widgetOpsHandled';
const HANDLED_KEEP = 300;

async function loadHandled(repo: Repo): Promise<string[]> {
  try {
    const raw = await repo.getMeta(HANDLED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 执行读出来的点按（R07）：一条一条按点的时间做，每做完一条就把「这条做过了」和记录写入存进同一个事务；
 * 全部处理完才让 remove 确认删掉队列里这些点按。中途出错（写不进去）就停下：做完的照常确认删除，
 * 没做的留在队列里，下次接着做。返回 null：没有要处理的（队列是空的，或读到的都是做过的）。
 */
export async function runQueuedWidgetOps(
  entries: readonly QueueEntry[],
  repo: Repo,
  config: WorkspaceConfig,
  now: Date,
  remove: (ids: readonly string[]) => Promise<void>,
): Promise<DrainResult | null> {
  if (entries.length === 0) return null;
  const cal = calendarOf(config);
  const handled = await loadHandled(repo);
  const seen = new Set(handled);
  const ordered = entries
    .map((e) => ({ id: e.id, op: parseQueuedOp(e.text) }))
    .sort((a, b) => (a.op?.at ?? 0) - (b.op?.at ?? 0) || (a.id < b.id ? -1 : 1));
  let records: Map<string, DataRecord[]> = await allRecords(repo, config);
  let done = 0;
  let skipped = 0;
  let pending = 0;
  let stopped = false;
  let marksPending = false;
  /** 处理好了、可以确认删掉的。 */
  const finished: string[] = [];
  const markValue = (extra: string) => JSON.stringify([...handled, extra].slice(-HANDLED_KEEP));

  for (const { id, op } of ordered) {
    if (seen.has(id)) {
      finished.push(id);
      continue;
    }
    if (stopped) {
      pending++;
      continue;
    }
    if (!op) {
      skipped++;
      finished.push(id);
      continue;
    }
    let outcome: 'done' | 'skipped' | 'stop' = 'stop';
    // 读到写之间记录被别处改了（表单、提醒按钮）就重新读一次再算，最多三次。
    for (let attempt = 0; attempt < 3 && outcome === 'stop'; attempt++) {
      // 时钟被往回调过、点的时间在未来：按现在算。
      const at = new Date(Math.min(op.at, now.getTime()));
      const write = planWidgetOp(config, op, records, at, cal);
      if (!write) {
        outcome = 'skipped';
        break;
      }
      const time = at.getTime();
      const recordId = write.kind === 'insert' ? newAssetId() : write.id;
      const before =
        write.kind === 'update'
          ? records.get(write.collection.id)?.find((r) => r.id === write.id)
          : undefined;
      let result: 'applied' | 'conflict';
      try {
        result = await repo.applyRecordWrites(
          [
            write.kind === 'insert'
              ? {
                  kind: 'insert',
                  record: {
                    id: recordId,
                    collectionId: write.collection.id,
                    values: write.values,
                    createdAt: time,
                    updatedAt: time,
                  },
                }
              : {
                  kind: 'update',
                  id: write.id,
                  values: write.values,
                  updatedAt: time,
                  ...(before ? { expected: before.values } : {}),
                },
          ],
          { key: HANDLED_KEY, value: markValue(id) },
        );
      } catch {
        break;
      }
      if (result === 'applied') {
        handled.push(id);
        records = applyInMemory(records, write, at, recordId);
        outcome = 'done';
      } else {
        records = await allRecords(repo, config);
      }
    }
    if (outcome === 'done') {
      done++;
      finished.push(id);
    } else if (outcome === 'skipped') {
      skipped++;
      handled.push(id);
      marksPending = true;
      finished.push(id);
    } else {
      stopped = true;
      pending++;
    }
  }
  if (marksPending)
    await repo
      .setMeta(HANDLED_KEY, JSON.stringify(handled.slice(-HANDLED_KEEP)))
      .catch(() => undefined);
  if (finished.length > 0) await remove(finished).catch(() => undefined);
  if (done === 0 && skipped === 0) return null;
  return { done, skipped, ...(pending > 0 ? { pending } : {}) };
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
        const entries = await platform.readQueue().catch(() => [] as QueueEntry[]);
        const result = await runQueuedWidgetOps(entries, repo, current, new Date(), (ids) =>
          platform.removeQueue([...ids]),
        );
        if (!result) return;
        store.getState().bumpRecords();
        store.getState().showToast({ message: drainMessage(result, locale) });
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
