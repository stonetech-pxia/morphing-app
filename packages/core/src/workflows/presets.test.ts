import { describe, expect, it } from 'vitest';

import { applyOps } from '../ops';
import { registry, workspace } from '../test-helpers';
import { validateWorkspace } from '../validate';
import { typesAlong, workflowProblems } from '../workflow/check';
import {
  PRESET_SCENARIOS,
  builtInWorkflows,
  findWorkflow,
  WORKFLOW_PRESETS,
  newWorkflowId,
  presetById,
  presetWorkflow,
  presetsIn,
  sharePresetOrder,
} from './presets';
import { shareFit } from '../share';

describe('workflow presets', () => {
  it('has the built-in presets with unique ids', () => {
    expect(WORKFLOW_PRESETS.some((p) => p.id === 'join-videos')).toBe(true);
    expect(new Set(WORKFLOW_PRESETS.map((p) => p.id)).size).toBe(WORKFLOW_PRESETS.length);
  });

  it('puts the audio presets in the study and sound scenarios (D-156, D-270)', () => {
    expect(presetsIn('study').map((p) => p.id)).toEqual([
      'audio-to-text',
      'merge-recordings',
      'voice-memo-archive',
      'pdf-to-audio',
      'paper-to-audio',
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
    '%s passes the static checks in all three languages',
    (_id, preset) => {
      for (const locale of ['zh', 'en', 'fr'] as const) {
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

  it.each(['zh', 'en', 'fr'] as const)(
    'all presets can be added without installing tools (%s)',
    (locale) => {
      const base = workspace(locale);
      const ops = WORKFLOW_PRESETS.map((p) => ({
        op: 'addWorkflow' as const,
        workflow: presetWorkflow(p, locale, newWorkflowId(p.id, base.workflows)),
      }));
      const result = applyOps(base, ops, { registry, locale });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(validateWorkspace(result.config, registry)).toMatchObject({ ok: true });
      expect(result.config.workflows.map((w) => w.presetId)).toEqual(
        WORKFLOW_PRESETS.map((p) => p.id),
      );
    },
  );

  it('makes ids from names that are free', () => {
    expect(newWorkflowId('visa-photo', [])).toBe('visa-photo');
    expect(newWorkflowId('visa-photo', [{ id: 'visa-photo' }, { id: 'visa-photo-2' }])).toBe(
      'visa-photo-3',
    );
    expect(newWorkflowId('My Photos!', [])).toBe('my-photos');
    expect(newWorkflowId('签证', [])).toBe('workflow');
    expect(newWorkflowId('2024 trip', [])).toBe('w-2024-trip');
  });

  it('offers every preset as built in until the config has its own copy (D-236)', () => {
    expect(builtInWorkflows([], 'zh').map((w) => w.id)).toEqual(WORKFLOW_PRESETS.map((p) => p.id));
    const edited = presetWorkflow(presetById('visa-photo')!, 'zh', 'visa-photo-2');
    const sameId = { id: 'email-photos', name: 'Mine', steps: [] };
    const ids = builtInWorkflows([edited, sameId], 'zh').map((w) => w.id);
    expect(ids).not.toContain('visa-photo');
    expect(ids).not.toContain('email-photos');
    expect(findWorkflow([edited], 'visa-photo-2', 'zh')).toBe(edited);
    expect(findWorkflow([], 'visa-photo', 'zh')).toMatchObject({
      id: 'visa-photo',
      presetId: 'visa-photo',
    });
    expect(findWorkflow([edited], 'visa-photo', 'zh')).toBeUndefined();
  });
});

describe('inbox order for each kind of file (D-237)', () => {
  const files = (mimeType: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `f${i}`, mimeType, size: 1 }));

  it('puts the most common actions first for one photo, many photos, videos, PDFs and audio', () => {
    // 一张照片常常是拍的纸质文件或表格：扫描、转 Excel 排在第二、第三（2026-10-29 真机：物业账单照片
    // 推荐里没有转 Excel，要点「查看全部」才找到）。
    expect(sharePresetOrder(files('image/jpeg', 1))).toEqual([
      'email-photos',
      'scan-document',
      'scan-table-excel',
      'document-packet',
      'visa-photo',
    ]);
    expect(sharePresetOrder(files('image/heic', 3))[0]).toBe('document-packet');
    expect(sharePresetOrder(files('video/mp4', 1))[0]).toBe('video-too-big');
    expect(sharePresetOrder(files('video/mp4', 2))[0]).toBe('join-videos');
    expect(sharePresetOrder(files('application/pdf', 1))[0]).toBe('pdf-too-big');
    expect(sharePresetOrder(files('application/pdf', 2))[0]).toBe('combine-documents');
    expect(sharePresetOrder(files('audio/mp4', 1))[0]).toBe('audio-to-text');
    expect(sharePresetOrder(files('audio/mp4', 2))[0]).toBe('merge-recordings');
  });

  it('only lists presets that exist and can take those files', () => {
    for (const [mime, n] of [
      ['image/jpeg', 1],
      ['image/jpeg', 3],
      ['video/mp4', 1],
      ['video/mp4', 3],
      ['application/pdf', 1],
      ['application/pdf', 3],
      ['audio/mp4', 1],
      ['audio/mp4', 3],
    ] as const) {
      const infos = files(mime, n);
      const order = sharePresetOrder(infos);
      expect(order.length).toBeGreaterThan(0);
      expect(order.length).toBeLessThanOrEqual(5);
      for (const id of order) {
        const preset = presetById(id);
        expect(preset, id).toBeDefined();
        expect(shareFit(presetWorkflow(preset!, 'zh', id), infos).ok, `${id} ${mime} ×${n}`).toBe(
          true,
        );
      }
    }
  });

  it('has no order for mixed kinds or other files', () => {
    expect(sharePresetOrder([...files('image/jpeg', 1), ...files('application/pdf', 1)])).toEqual(
      [],
    );
    expect(sharePresetOrder(files('application/zip', 1))).toEqual([]);
    expect(sharePresetOrder([])).toEqual([]);
  });
});
