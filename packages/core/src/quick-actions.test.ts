import { describe, expect, it } from 'vitest';
import {
  CATEGORIZED_INPUTS,
  QUICK_ACTION_KINDS,
  inferQuickActionKind,
  presetKinds,
  workflowKinds,
} from './quick-actions';
import { quickActionListComponent } from './components/quickActionList';
import { WORKFLOW_PRESETS, presetById, presetWorkflow } from './workflows/presets';

describe('quick-action categories', () => {
  it('quickActionList accepts exactly the quick action kinds', () => {
    expect(quickActionListComponent.props.shape.kind.unwrap().options).toEqual([
      ...QUICK_ACTION_KINDS,
    ]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['in.photos', {}, 'image'],
    ['in.photos', { source: 'scanner' }, 'document'],
    ['in.videos', {}, 'video'],
    ['in.audio', {}, 'audio'],
    ...['images', 'videos', 'audio', 'pdf', 'pdfOrImages', 'documents', 'zip', 'any'].map(
      (accept): [string, Record<string, unknown>, string] => [
        'in.files',
        { accept },
        ({ images: 'image', videos: 'video', audio: 'audio' } as Record<string, string>)[accept] ??
          'document',
      ],
    ),
    ['in.text', {}, 'other'],
    ['in.wifi', {}, 'other'],
    ['in.records', {}, 'other'],
  ])('classifies %s %j as %s', (action, params, kind) => {
    expect(
      inferQuickActionKind({
        steps: [{ id: 'pick', action, params }],
      }),
    ).toBe(kind);
  });
  it('handles an empty workflow', () => expect(inferQuickActionKind({ steps: [] })).toBe('other'));
  it('covers every preset and every file category in both languages', () => {
    for (const preset of WORKFLOW_PRESETS) {
      // 第一步是没有归过类的输入动作时，inferQuickActionKind 会悄悄归到「其他」：这里要报出来。
      expect(CATEGORIZED_INPUTS, preset.id).toContain(preset.steps('en')[0]?.action);
      expect(presetKinds(preset).length).toBeGreaterThan(0);
      for (const kind of presetKinds(preset)) expect(QUICK_ACTION_KINDS).toContain(kind);
      expect(inferQuickActionKind({ steps: preset.steps('en') })).toBe(
        inferQuickActionKind({ steps: preset.steps('zh') }),
      );
    }
    for (const kind of QUICK_ACTION_KINDS.filter((k) => k !== 'other'))
      expect(WORKFLOW_PRESETS.some((preset) => presetKinds(preset).includes(kind))).toBe(true);
  });
  it('keeps cross-type membership on saved presets but follows an edited input', () => {
    const preset = presetById('video-sound')!;
    expect(presetKinds(preset)).toEqual(['video', 'audio']);
    const wf = presetWorkflow(preset, 'zh', 'mine');
    expect(workflowKinds(wf)).toEqual(['video', 'audio']);
    wf.steps[0] = { id: 'pick', action: 'in.audio', params: { source: 'files', min: 1, max: 1 } };
    expect(workflowKinds(wf)).toEqual(['audio']);
  });
});
