import {
  WORKFLOW_PRESETS,
  presetWorkflow,
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
  const existing = workflows
    .map((wf) => ({
      wf,
      fit: shareFit(wf, infos),
      preset: undefined as (typeof WORKFLOW_PRESETS)[number] | undefined,
    }))
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
  const presets = WORKFLOW_PRESETS.filter((p) => !workflows.some((w) => w.presetId === p.id))
    .map((preset) => ({ preset, wf: presetWorkflow(preset, locale, preset.id) }))
    .map((item) => ({ ...item, fit: shareFit(item.wf, infos) }))
    .filter(({ fit }) => fit.ok);
  const fillers = [
    ...unused.filter(({ wf }) => !wf.toolId),
    ...presets,
    ...unused.filter(({ wf }) => wf.toolId),
  ];
  const all = [...fresh, ...used, ...fillers];
  return { all, recommended: (used.length < 3 ? all : [...fresh, ...used]).slice(0, 5) };
}
