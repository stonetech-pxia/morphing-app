import {
  builtInWorkflows,
  shareFit,
  type Locale,
  type SharedFileInfo,
  type Workflow,
} from '@morph/core';

import type { SucceededRuns } from '../storage/types';

export function shareRecommendations(
  workflows: Workflow[],
  infos: SharedFileInfo[],
  usage: SucceededRuns,
  locale: Locale,
  newest?: string,
) {
  // 内设的快捷操作（D-236）排在配置里的后面：没用过时先补自己的，再补内设的。
  const existing = [...workflows, ...builtInWorkflows(workflows, locale)]
    .map((wf) => ({ wf, fit: shareFit(wf, infos) }))
    .filter(({ wf, fit }) => fit.ok || (fit.reason !== 'type' && usage.has(wf.id)));
  const fresh = existing.filter(({ wf }) => wf.id === newest);
  const used = existing
    .filter(({ wf }) => wf.id !== newest && usage.has(wf.id))
    .sort((a, b) => {
      const x = usage.get(a.wf.id)!;
      const y = usage.get(b.wf.id)!;
      return y.count - x.count || y.lastAt - x.lastAt;
    });
  const unused = existing.filter(({ wf }) => wf.id !== newest && !usage.has(wf.id));
  const fillers = [
    ...unused.filter(({ wf }) => !wf.toolId),
    ...unused.filter(({ wf }) => wf.toolId),
  ];
  // 只有能运行的才算「用过的够了」：先保证至少 3 个能运行的，再放用过但个数不对的（灰卡片，
  // 说明原因），剩下的位置用没用过的补；灰卡片不能把能用的挤到「查看全部」里去。
  const usedOk = used.filter(({ fit }) => fit.ok);
  const usedOff = used.filter(({ fit }) => !fit.ok);
  const lead = fresh.length + usedOk.length;
  const needed = usedOk.length < 3 ? Math.max(0, 3 - lead) : 0;
  const all = [
    ...fresh,
    ...usedOk,
    ...fillers.slice(0, needed),
    ...usedOff,
    ...fillers.slice(needed),
  ];
  return {
    all,
    recommended: (usedOk.length < 3 ? all : [...fresh, ...usedOk, ...usedOff]).slice(0, 5),
    anyUsed: used.length > 0,
  };
}
