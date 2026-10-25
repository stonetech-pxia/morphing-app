import type { Workflow } from '@morph/core';

import type { WorkspaceRepo } from '../storage/types';

// 顺序、配置和一次交接共同确定一条成功接力；只记本机，不作为 AI 上下文。
const key = (first: string, second: string) =>
  `chain:${encodeURIComponent(first)}:${encodeURIComponent(second)}`;
export const sameWorkflow = (a: Workflow, b: Workflow) => JSON.stringify(a) === JSON.stringify(b);

interface ChainRecord {
  signature: string;
  count: number;
  transfer: string;
}

/** 同一批结果重复运行第二段不增加次数；任一配置变化后重新累计。 */
export async function recordChain(
  repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'>,
  first: Workflow,
  second: Workflow,
  transfer: string,
): Promise<boolean> {
  const metaKey = key(first.id, second.id);
  const signature = JSON.stringify([first, second]);
  let previous: ChainRecord | null = null;
  try {
    const raw = await repo.getMeta(metaKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'signature' in parsed &&
      'count' in parsed &&
      'transfer' in parsed &&
      typeof parsed.signature === 'string' &&
      typeof parsed.count === 'number' &&
      Number.isInteger(parsed.count) &&
      parsed.count > 0 &&
      typeof parsed.transfer === 'string'
    )
      previous = parsed as ChainRecord;
  } catch {
    /* 旧统计损坏时从头记，不影响处理文件。 */
  }
  const same = previous !== null && previous.signature === signature;
  const count =
    same && previous ? Math.min(2, previous.count + (previous.transfer === transfer ? 0 : 1)) : 1;
  await repo.setMeta(metaKey, JSON.stringify({ signature, count, transfer }));
  return count >= 2;
}
