import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import {
  HABIT_RUNS,
  dismissHabit,
  habitKey,
  habitLabel,
  habitWorkflow,
  hasSameWorkflow,
  recordHabit,
  rememberedAnswers,
  shouldSuggest,
  type HabitRecord,
} from './habits';
import { homeEntryOps } from './home-entry';
import { quickActionsOf } from './schema';
import { createStarterWorkspace } from './starter';
import { registry } from './test-helpers';

const now = new Date(2026, 9, 23, 9, 0);
const config = createStarterWorkspace('zh', registry);
const compress = quickActionsOf(config).find((w) =>
  w.steps.some((s) => s.action === 'image.compress'),
)!;
const compressStep = compress.steps.find((s) => s.action === 'image.compress')!;

describe('habits (D-127)', () => {
  it('remembers numbers and choices, never names or text', () => {
    const answers = rememberedAnswers(
      compress,
      [
        { stepId: compressStep.id, values: { maxKB: 200, format: 'jpeg' } },
        { stepId: 'nope', values: { maxKB: 1 } },
      ],
      registry,
    );
    expect(answers).toEqual([{ stepId: compressStep.id, values: { maxKB: 200, format: 'jpeg' } }]);

    const stamp = quickActionsOf(config).find((w) => w.steps.some((s) => s.action === 'pdf.stamp'));
    if (stamp) {
      const step = stamp.steps.find((s) => s.action === 'pdf.stamp')!;
      expect(
        rememberedAnswers(stamp, [{ stepId: step.id, values: { text: '机密' } }], registry),
      ).toBeNull();
    }
  });

  it('suggests after the same answer several times in a row, until dismissed', () => {
    const key = habitKey([{ stepId: 'compress', values: { maxKB: 200 } }]);
    let record: HabitRecord | null = null;
    for (let i = 0; i < HABIT_RUNS - 1; i++) record = recordHabit(record, key);
    expect(shouldSuggest(record!)).toBe(false);
    record = recordHabit(record, key);
    expect(shouldSuggest(record)).toBe(true);

    // 换了一个值就重新数。
    const other = recordHabit(record, habitKey([{ stepId: 'compress', values: { maxKB: 500 } }]));
    expect(other.count).toBe(1);

    const dismissed = dismissHabit(record);
    expect(shouldSuggest(recordHabit(dismissed, key))).toBe(false);
    expect(recordHabit(dismissed, null)).toMatchObject({ count: 0, dismissed: [key] });
  });

  it('keys do not depend on the order of steps or values', () => {
    expect(
      habitKey([
        { stepId: 'b', values: { y: 1, x: 2 } },
        { stepId: 'a', values: { z: 'q' } },
      ]),
    ).toBe(
      habitKey([
        { stepId: 'a', values: { z: 'q' } },
        { stepId: 'b', values: { x: 2, y: 1 } },
      ]),
    );
  });

  it('labels the answer with a preset name or the value', () => {
    const preset = [{ stepId: compressStep.id, values: { maxKB: 500 } }];
    expect(habitLabel(compress, preset, registry, 'zh', now)).toBe('500 KB');
    const custom = [{ stepId: compressStep.id, values: { maxKB: 300 } }];
    expect(habitLabel(compress, custom, registry, 'zh', now)).toBe('300 KB');
  });

  it('makes a quick action that no longer asks, and can go on the home page', () => {
    const answers = [{ stepId: compressStep.id, values: { maxKB: 300 } }];
    const wf = habitWorkflow(compress, answers, 'compress-300', '压缩图片 · 300 KB');
    const step = wf.steps.find((s) => s.id === compressStep.id)!;
    expect(step.params).toMatchObject({ maxKB: 300 });
    expect(step.ask ?? []).not.toContain('maxKB');
    expect(wf).toMatchObject({ kind: 'quickAction' });
    expect(wf).not.toHaveProperty('package');

    const prepared = prepareOps(
      config,
      [{ op: 'addTool', tool: wf }, ...homeEntryOps(config, [wf.id])],
      { registry, locale: 'zh', now },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(hasSameWorkflow(quickActionsOf(prepared.after), wf)).toBe(true);
    expect(hasSameWorkflow(quickActionsOf(config), wf)).toBe(false);
  });
});
