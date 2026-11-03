import type { Registry } from '../registry';
import type { WorkspaceConfig } from '../schema';
import { viewOf, type AppView } from './capabilities';
import type { Scenario } from './scenarios';

export * from './capabilities';
export * from './scenarios';

// 个人记录能力验收的打分：配置进来，每项要求过没过，core 全过才算合格。纯函数，只读配置。

export interface RequirementScore {
  id: string;
  core: boolean;
  pass: boolean;
}

export interface ScenarioScore {
  scenario: string;
  requirements: RequirementScore[];
  passed: number;
  total: number;
  corePassed: number;
  coreTotal: number;
  /** core 项全过。 */
  qualified: boolean;
  /** 还没过的 core 项（按场景里的顺序）。 */
  missingCore: string[];
  /** 工具检查的 blocker：不影响合格，实验台据此点「把这些补上」。 */
  blockers: { code: string; target: string; message: string }[];
}

function scoreView(scenario: Scenario, view: AppView): ScenarioScore {
  const requirements = scenario.requirements.map(({ id, core, cap }) => ({
    id,
    core,
    pass: cap(view),
  }));
  const core = requirements.filter((r) => r.core);
  const missingCore = core.filter((r) => !r.pass).map((r) => r.id);
  return {
    scenario: scenario.id,
    requirements,
    passed: requirements.filter((r) => r.pass).length,
    total: requirements.length,
    corePassed: core.length - missingCore.length,
    coreTotal: core.length,
    qualified: missingCore.length === 0,
    missingCore,
    blockers: view.health.issues
      .filter((i) => i.severity === 'blocker')
      .map(({ code, target, message }) => ({ code, target, message })),
  };
}

export function scoreScenario(
  scenario: Scenario,
  config: WorkspaceConfig,
  registry: Registry,
): ScenarioScore {
  return scoreView(scenario, viewOf(config, registry));
}

/**
 * 用户接下来说哪一句：还没过的 core 项按顺序，一次一句；说过的先跳过，都说过了再从头说。
 * 全过了返回 null。
 */
export function nextAsk(
  scenario: Scenario,
  score: ScenarioScore,
  asked: ReadonlySet<string>,
): { id: string; text: string } | null {
  const missing = score.missingCore;
  const id = missing.find((x) => !asked.has(x)) ?? missing[0];
  if (id === undefined) return null;
  const requirement = scenario.requirements.find((r) => r.id === id)!;
  return { id, text: requirement.ask[scenario.locale] };
}
