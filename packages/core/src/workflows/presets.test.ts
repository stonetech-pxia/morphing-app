import { describe, expect, it } from 'vitest';

import { applyOps } from '../ops';
import { registry, workspace } from '../test-helpers';
import { validateWorkspace } from '../validate';
import { typesAlong, workflowProblems } from '../workflow/check';
import { WORKFLOW_PRESETS, newWorkflowId, presetWorkflow } from './presets';

describe('workflow presets', () => {
  it('has the ten presets with unique ids', () => {
    expect(WORKFLOW_PRESETS).toHaveLength(10);
    expect(new Set(WORKFLOW_PRESETS.map((p) => p.id)).size).toBe(10);
  });

  it.each(WORKFLOW_PRESETS.map((p) => [p.id, p] as const))(
    '%s passes the static checks in both languages',
    (_id, preset) => {
      for (const locale of ['zh', 'en'] as const) {
        const wf = presetWorkflow(preset, locale, preset.id);
        expect(workflowProblems(wf, registry)).toEqual([]);
        expect(typesAlong(wf.steps, registry).every((t) => t !== null)).toBe(true);
        expect(preset.name[locale] && preset.description[locale]).toBeTruthy();
      }
      // 声明的扩展包和步骤实际需要的一致。
      const packs = new Set(
        preset.steps('en').flatMap((s) => registry.actions.get(s.action)?.pack ?? []),
      );
      expect([...packs].sort()).toEqual([...(preset.packs ?? [])].sort());
    },
  );

  it('all ten can be added to a workspace without installing any tool', () => {
    const base = workspace('zh');
    const ops = WORKFLOW_PRESETS.map((p) => ({
      op: 'addWorkflow' as const,
      workflow: presetWorkflow(p, 'zh', newWorkflowId(p.id, base.workflows)),
    }));
    const result = applyOps(base, ops, { registry, locale: 'zh' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkspace(result.config, registry)).toMatchObject({ ok: true });
    expect(result.config.workflows.map((w) => w.presetId)).toEqual(
      WORKFLOW_PRESETS.map((p) => p.id),
    );
  });

  it('makes ids from names that are free', () => {
    expect(newWorkflowId('visa-photo', [])).toBe('visa-photo');
    expect(newWorkflowId('visa-photo', [{ id: 'visa-photo' }, { id: 'visa-photo-2' }])).toBe(
      'visa-photo-3',
    );
    expect(newWorkflowId('My Photos!', [])).toBe('my-photos');
    expect(newWorkflowId('签证', [])).toBe('workflow');
    expect(newWorkflowId('2024 trip', [])).toBe('w-2024-trip');
  });
});
