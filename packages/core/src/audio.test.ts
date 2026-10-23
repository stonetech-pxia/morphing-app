import { describe, expect, it } from 'vitest';

import {
  estimateAudioBytes,
  MIN_AUDIO_KBPS,
  planAudioConvert,
  planAudioQuality,
  planAudioSize,
} from './audio';
import { shareFitsInput } from './share';
import { apply, registry, workspace } from './test-helpers';
import { AUDIO_ACTIONS, audioTool, audioWorkflows } from './tools/audio';
import { workflowProblems } from './workflow/check';

const MB = 1024 * 1024;
const minutes = (n: number) => n * 60_000;

describe('planAudioSize', () => {
  it('keeps a recording that is already small enough', () => {
    expect(planAudioSize({ durationMs: minutes(1), size: 1 * MB }, 2 * MB)).toEqual({
      kind: 'keep',
    });
  });

  it('picks a bitrate from the duration, with a margin', () => {
    // 10 分钟压到 5 MB：5 MB × 8 × 0.94 ÷ 600 秒 ≈ 65.7 kbps → 单声道 44.1 kHz。
    const plan = planAudioSize({ durationMs: minutes(10), size: 20 * MB }, 5 * MB);
    expect(plan).toEqual({
      kind: 'encode',
      plan: { format: 'm4a', bitrateKbps: 66, channels: 1, sampleRate: 44100 },
    });
    if (plan.kind === 'encode') {
      expect(estimateAudioBytes(plan.plan, minutes(10))).toBeLessThan(5 * MB);
    }
  });

  it('uses stereo only with enough bitrate, and never more than 192 kbps', () => {
    const big = planAudioSize({ durationMs: minutes(3), size: 50 * MB }, 20 * MB);
    expect(big).toMatchObject({ plan: { bitrateKbps: 192, channels: 2 } });
    const mono = planAudioSize({ durationMs: minutes(3), size: 50 * MB, channels: 1 }, 20 * MB);
    expect(mono).toMatchObject({ plan: { channels: 1 } });
  });

  it('drops to 22 kHz mono for very low bitrates', () => {
    const plan = planAudioSize({ durationMs: minutes(60), size: 60 * MB }, 15 * MB);
    expect(plan).toMatchObject({ plan: { channels: 1, sampleRate: 22050 } });
  });

  it('says how big it has to be when the target is too small to understand', () => {
    const plan = planAudioSize({ durationMs: minutes(60), size: 60 * MB }, 2 * MB);
    expect(plan.kind).toBe('tooSmall');
    if (plan.kind === 'tooSmall') {
      // 60 分钟 × 24 kbps ÷ 0.94 ≈ 10.96 MB
      expect(plan.minMB).toBe(11);
      expect(planAudioSize({ durationMs: minutes(60), size: 60 * MB }, plan.minMB * MB).kind).toBe(
        'encode',
      );
    }
  });

  it('a retry factor lowers the bitrate further', () => {
    const first = planAudioSize({ durationMs: minutes(10), size: 20 * MB }, 5 * MB);
    const retry = planAudioSize({ durationMs: minutes(10), size: 20 * MB }, 5 * MB, 0.9);
    expect(retry).toMatchObject({ kind: 'encode' });
    if (first.kind === 'encode' && retry.kind === 'encode') {
      expect(retry.plan.bitrateKbps).toBeLessThan(first.plan.bitrateKbps);
    }
  });
});

describe('planAudioQuality', () => {
  it('never raises the bitrate of the original', () => {
    const plan = planAudioQuality({ durationMs: minutes(1), size: 0.5 * MB, kbps: 64 }, 'high');
    expect(plan.bitrateKbps).toBe(64);
    expect(plan.channels).toBe(1);
  });

  it('voice is mono and small', () => {
    expect(planAudioQuality({ durationMs: minutes(1), size: 2 * MB, kbps: 256 }, 'voice')).toEqual({
      format: 'm4a',
      bitrateKbps: 48,
      channels: 1,
      sampleRate: 22050,
    });
  });

  it('works out the original bitrate from the size when it is not known', () => {
    // 1 分钟 0.9 MB ≈ 126 kbps → 「高」也只用原来的码率。
    const plan = planAudioQuality({ durationMs: minutes(1), size: 0.9 * MB }, 'high');
    expect(plan.bitrateKbps).toBe(126);
    expect(plan.bitrateKbps).toBeGreaterThanOrEqual(MIN_AUDIO_KBPS);
  });
});

describe('planAudioConvert', () => {
  it('M4A keeps the quality, WAV keeps channels and sample rate', () => {
    expect(planAudioConvert({ durationMs: 1000, size: 0, kbps: 320, channels: 2 }, 'm4a')).toEqual({
      format: 'm4a',
      bitrateKbps: 192,
      channels: 2,
      sampleRate: 44100,
    });
    expect(
      planAudioConvert({ durationMs: 1000, size: 0, channels: 1, sampleRate: 48000 }, 'wav'),
    ).toEqual({ format: 'wav', bitrateKbps: 0, channels: 1, sampleRate: 48000 });
    expect(
      estimateAudioBytes({ format: 'wav', bitrateKbps: 0, channels: 2, sampleRate: 44100 }, 1000),
    ).toBe(176_444);
  });
});

describe('audio tool', () => {
  it('its quick actions pass the static checks and it installs', () => {
    for (const locale of ['zh', 'en'] as const) {
      for (const wf of audioWorkflows(locale)) expect(workflowProblems(wf, registry)).toEqual([]);
    }
    const config = apply(workspace(), [{ op: 'installTool', toolId: 'audio' }]);
    expect(config.workflows.filter((w) => w.toolId === 'audio')).toHaveLength(7);
    expect(audioTool.actions).toBe(AUDIO_ACTIONS);
  });

  it('speech to text downloads the chosen model on Android', () => {
    const action = AUDIO_ACTIONS.find((a) => a.id === 'audio.transcribe')!;
    expect(action.packFor!({ lang: 'zh', model: 'standard' })).toBe('speech-whisper-small');
    expect(action.packFor!({ lang: 'zh', model: 'fast' })).toBe('speech-whisper-base');
  });

  it('audio actions take audio, not other files', () => {
    const steps = [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
      {
        id: 'run',
        action: 'audio.compress',
        params: { by: 'size', maxMB: 2, quality: 'standard' },
      },
    ];
    expect(workflowProblems({ id: 'x', name: 'x', steps }, registry)).toEqual([
      expect.objectContaining({ code: 'binding' }),
    ]);
  });

  it('shared recordings fill in.audio, whichever source it has', () => {
    const files = [{ name: 'memo.m4a', mimeType: 'audio/mp4', size: 1000 }];
    expect(shareFitsInput('in.audio', { source: 'record', min: 1, max: 1 }, files)).toMatchObject({
      ok: true,
    });
    expect(
      shareFitsInput('in.audio', { source: 'files', min: 1, max: 10 }, [
        { name: 'a.jpg', mimeType: 'image/jpeg', size: 1 },
      ]),
    ).toMatchObject({ ok: false, reason: 'type' });
  });
});
