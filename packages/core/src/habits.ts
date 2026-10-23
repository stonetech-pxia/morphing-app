import type { Registry } from './registry';
import type { Locale, Workflow } from './schema';
import { formatParamValue } from './workflow/format';

// 从使用习惯里提议（D-127）：同一个快捷操作连续几次在「每次运行时问」里选了同样的值（例如都压到
// 200 KB），结果页问一句要不要做成一个不用再选的快捷操作、放到首页。只在本机统计，不发给 AI，
// 也不会自己改 App：用户点「做一个」才生成一次可撤销的修改。

/** 连续几次选同样的值才提议。 */
export const HABIT_RUNS = 3;

/** 一次运行里，某一步「每次运行时问」的回答。 */
export interface AskedAnswer {
  stepId: string;
  values: Record<string, unknown>;
}

/** 存在本机的统计（每个快捷操作一条）。 */
export interface HabitRecord {
  /** 最近一次回答（habitKey）。 */
  key: string;
  /** 连续几次是这个回答。 */
  count: number;
  /** 用户点过「不用了」的回答，不再提。 */
  dismissed: string[];
}

/** 只记数字、选项和开关；文件名、用户写的文字、颜色这类回答不记。 */
const REMEMBERED = new Set(['number', 'choice', 'toggle']);

/** 去掉不该记的回答；什么都不剩时返回 null（这次运行不算）。 */
export function rememberedAnswers(
  workflow: Workflow,
  answers: readonly AskedAnswer[],
  registry: Registry,
): AskedAnswer[] | null {
  const out: AskedAnswer[] = [];
  for (const answer of answers) {
    const step = workflow.steps.find((s) => s.id === answer.stepId);
    const action = step ? registry.actions.get(step.action) : undefined;
    if (!action) continue;
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answer.values)) {
      const field = action.fields.find((f) => f.key === key);
      if (!field || field.private || !REMEMBERED.has(field.kind)) continue;
      if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean')
        continue;
      values[key] = value;
    }
    if (Object.keys(values).length > 0) out.push({ stepId: answer.stepId, values });
  }
  return out.length > 0 ? out : null;
}

/** 回答的稳定表示（键按字母排序），用来比较两次是否一样。 */
export function habitKey(answers: readonly AskedAnswer[]): string {
  return JSON.stringify(
    [...answers]
      .sort((a, b) => a.stepId.localeCompare(b.stepId))
      .map((a) => [
        a.stepId,
        Object.keys(a.values)
          .sort()
          .map((k) => [k, a.values[k]]),
      ]),
  );
}

/** 记一次运行：和上次一样就加一，不一样从 1 开始；没有可记的回答时清零。 */
export function recordHabit(prev: HabitRecord | null, key: string | null): HabitRecord {
  const dismissed = prev?.dismissed ?? [];
  if (key === null) return { key: '', count: 0, dismissed };
  return { key, count: prev?.key === key ? prev.count + 1 : 1, dismissed };
}

export const shouldSuggest = (record: HabitRecord): boolean =>
  record.count >= HABIT_RUNS && !record.dismissed.includes(record.key);

/** 用户点「不用了」：这个回答以后不再提。 */
export const dismissHabit = (record: HabitRecord): HabitRecord => ({
  ...record,
  dismissed: [...record.dismissed.filter((k) => k !== record.key), record.key].slice(-10),
});

/** 回答写成短短的一句：用上常用规格的名字（「500 KB」「护照 35×45」），否则写出值。 */
export function habitLabel(
  workflow: Workflow,
  answers: readonly AskedAnswer[],
  registry: Registry,
  locale: Locale,
  now: Date,
): string {
  const parts: string[] = [];
  for (const answer of answers) {
    const step = workflow.steps.find((s) => s.id === answer.stepId);
    const action = step ? registry.actions.get(step.action) : undefined;
    if (!action) continue;
    const keys = Object.keys(answer.values);
    const preset = action.presets?.find((p) => keys.every((k) => p.values[k] === answer.values[k]));
    if (preset) {
      parts.push(preset.label[locale]);
      continue;
    }
    for (const field of action.fields) {
      if (field.key in answer.values)
        parts.push(formatParamValue(field, answer.values[field.key], locale, now));
    }
  }
  return parts.join(locale === 'zh' ? '、' : ', ');
}

/**
 * 做成的新快捷操作：复制原来的步骤，把回答写进参数、不再问这几项（其余照问，例如文件名）。
 * 是用户自己的快捷操作（没有 toolId），移除工具时不会跟着消失。
 */
export function habitWorkflow(
  workflow: Workflow,
  answers: readonly AskedAnswer[],
  id: string,
  name: string,
): Workflow {
  return {
    id,
    name,
    ...(workflow.icon ? { icon: workflow.icon } : {}),
    steps: workflow.steps.map((step) => {
      const answer = answers.find((a) => a.stepId === step.id);
      if (!answer) return step;
      const ask = (step.ask ?? []).filter((k) => !(k in answer.values));
      const { ask: _old, ...rest } = step;
      return {
        ...rest,
        params: { ...step.params, ...answer.values },
        ...(ask.length > 0 ? { ask } : {}),
      };
    }),
  };
}

/** 用户自己的快捷操作里已经有一样的（步骤和参数都相同）时不再提议。 */
export function hasSameWorkflow(workflows: readonly Workflow[], candidate: Workflow): boolean {
  const shape = (w: Workflow) =>
    JSON.stringify(w.steps.map((s) => [s.action, s.params, s.ask ?? []]));
  return workflows.some((w) => !w.toolId && shape(w) === shape(candidate));
}
