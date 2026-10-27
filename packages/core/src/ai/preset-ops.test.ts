import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import type { Locale, Workflow } from '../schema';
import { registry, workspace } from '../test-helpers';
import {
  WORKFLOW_PRESETS,
  builtInWorkflows,
  presetById,
  presetWorkflow,
} from '../workflows/presets';
import { expandPresetWorkflows } from './preset-ops';

// 预设的简写 addWorkflow {presetId, params?}（D-259）。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];
const ctx = (locale: Locale) => ({ registry, locale, now: new Date(2026, 9, 27) });
const expand = (ops: unknown[], locale: Locale = 'en', config = workspace(locale)) =>
  expandPresetWorkflows({ kind: 'ops', ops }, config, locale);
const added = (value: unknown) =>
  (value as { ops: { workflow: Workflow }[] }).ops.map((o) => o.workflow);

describe('addWorkflow {presetId}', () => {
  it('every preset expands to exactly what the user gets when adding it, in every language', () => {
    for (const locale of LOCALES) {
      const config = workspace(locale);
      // 用户在快捷操作库里改一个内设快捷操作时，加进配置的就是 builtInWorkflows 里的这一份。
      const userAdds = builtInWorkflows(config.workflows, locale);
      for (const preset of WORKFLOW_PRESETS) {
        const { value, issues } = expand([{ op: 'addWorkflow', presetId: preset.id }], locale);
        expect(issues).toEqual([]);
        const [workflow] = added(value);
        expect(workflow).toEqual(userAdds.find((w) => w.id === preset.id));
        expect(workflow).toEqual(presetWorkflow(preset, locale, preset.id));
        expect(prepareOps(config, (value as { ops: unknown }).ops, ctx(locale)).ok, preset.id).toBe(
          true,
        );
      }
    }
  });

  it('params override parameters by step id; everything else stays the preset', () => {
    const { value, issues } = expand([
      { op: 'addWorkflow', presetId: 'visa-photo', params: { photo: { maxKB: 100 } } },
    ]);
    expect(issues).toEqual([]);
    const [workflow] = added(value);
    const preset = presetWorkflow(presetById('visa-photo')!, 'en', 'visa-photo');
    expect(workflow!.steps[1]).toEqual({
      ...preset.steps[1],
      params: { ...preset.steps[1]!.params, maxKB: 100 },
    });
    expect(workflow!.steps.filter((_, i) => i !== 1)).toEqual(
      preset.steps.filter((_, i) => i !== 1),
    );
    expect(prepareOps(workspace('en'), (value as { ops: unknown }).ops, ctx('en')).ok).toBe(true);
  });

  it('a second copy gets a free id; id and name can be given; the long form still works', () => {
    const { value } = expand([
      { op: 'addWorkflow', presetId: 'visa-photo' },
      { op: 'addWorkflow', presetId: 'visa-photo', name: 'Schengen photo' },
      { op: 'addWorkflow', presetId: 'visa-photo', id: 'kid-photo' },
      { op: 'addWorkflow', workflow: { presetId: 'scan-document', name: 'Scan' } },
    ]);
    expect(added(value).map((w) => [w.id, w.name])).toEqual([
      ['visa-photo', 'Visa / ID photo'],
      ['visa-photo-2', 'Schengen photo'],
      ['kid-photo', 'Visa / ID photo'],
      ['scan-document', 'Scan'],
    ]);
    const full = {
      op: 'addWorkflow',
      workflow: presetWorkflow(presetById('visa-photo')!, 'en', 'x'),
    };
    expect(expand([full]).value).toEqual({ kind: 'ops', ops: [full] });
  });

  it('a wrong preset id, step id or key is sent back; a wrong parameter value fails validation', () => {
    expect(expand([{ op: 'addWorkflow', presetId: 'visa-foto' }]).issues).toEqual([
      expect.stringContaining('ops.0.presetId: unknown preset "visa-foto"'),
    ]);
    expect(
      expand([{ op: 'addWorkflow', presetId: 'visa-photo', params: { idPhoto: { maxKB: 1 } } }])
        .issues,
    ).toEqual([
      'ops.0.params.idPhoto: preset "visa-photo" has no step "idPhoto" (steps: pick, photo, name)',
    ]);
    expect(
      expand([{ op: 'addWorkflow', presetId: 'visa-photo', steps: [] as unknown[] }]).issues,
    ).toEqual(['ops.0: unknown key "steps" in addWorkflow {presetId}']);
    const bad = expand([
      { op: 'addWorkflow', presetId: 'visa-photo', params: { photo: { maxKB: 'small' } } },
    ]);
    expect(bad.issues).toEqual([]);
    expect(prepareOps(workspace('en'), (bad.value as { ops: unknown }).ops, ctx('en')).ok).toBe(
      false,
    );
  });

  it('a workflowRunner can run a built-in quick action by its preset id (nothing added)', () => {
    const runner = (workflowId: string) => [
      {
        op: 'addComponent',
        pageId: 'home',
        component: { id: 'run-it', type: 'workflowRunner', props: { workflowId } },
      },
    ];
    const ok = prepareOps(workspace('en'), runner('visa-photo'), ctx('en'));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.after.workflows).toEqual(workspace('en').workflows);
    expect(prepareOps(workspace('en'), runner('visa-foto'), ctx('en')).ok).toBe(false);
  });
});
