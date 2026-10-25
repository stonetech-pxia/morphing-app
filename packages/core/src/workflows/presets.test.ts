import { describe, expect, it } from 'vitest';

import { applyOps } from '../ops';
import { registry, workspace } from '../test-helpers';
import { validateWorkspace } from '../validate';
import { typesAlong, workflowProblems } from '../workflow/check';
import {
  PRESET_SCENARIOS,
  WORKFLOW_PRESETS,
  newWorkflowId,
  presetWorkflow,
  presetsIn,
} from './presets';

describe('workflow presets', () => {
  it('has the built-in presets with unique ids', () => {
    expect(WORKFLOW_PRESETS.some((p) => p.id === 'join-videos')).toBe(true);
    expect(new Set(WORKFLOW_PRESETS.map((p) => p.id)).size).toBe(WORKFLOW_PRESETS.length);
  });

  it('puts the audio presets in the study and sound scenarios (D-156)', () => {
    expect(presetsIn('study').map((p) => p.id)).toEqual([
      'audio-to-text',
      'merge-recordings',
      'voice-memo-archive',
    ]);
    expect(presetsIn('sound').map((p) => p.id)).toEqual([
      'normal-audio-volume',
      'denoise-audio',
      'audio-too-big',
      'cut-audio',
      'video-sound',
    ]);
    expect(PRESET_SCENARIOS.map((s) => s.name.zh).slice(-2)).toEqual(['学习工作', '发声音']);
  });

  it('puts the video and PDF size presets in their scenarios (D-146)', () => {
    expect(presetsIn('photos').map((p) => p.id)).toContain('video-too-big');
    expect(presetsIn('paperwork').map((p) => p.id)).toContain('pdf-too-big');
    expect(PRESET_SCENARIOS.find((s) => s.id === 'photos')!.name.zh).toBe('发照片和视频');
  });

  it('puts every preset in exactly one scenario, none empty (D-130)', () => {
    const grouped = PRESET_SCENARIOS.flatMap((sc) => presetsIn(sc.id));
    expect(grouped.map((p) => p.id).sort()).toEqual(WORKFLOW_PRESETS.map((p) => p.id).sort());
    for (const sc of PRESET_SCENARIOS) expect(presetsIn(sc.id).length).toBeGreaterThan(0);
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

  it('all of them can be added to a workspace without installing any tool', () => {
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
