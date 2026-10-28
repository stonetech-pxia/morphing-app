import type {
  MorphTTSModule,
  SynthesizeOptions,
  SynthesizeResult,
  TTSProgressEvent,
  VoiceStatus,
} from '../../modules/morph-tts';
import { createSpeaker } from '../runtime/expo-tts';

// 文字转语音的 App 一侧（D-270）：用假的原生模块检查输出地址、进度、取消和错误码。

class FakeTTS implements MorphTTSModule {
  calls: { segments: readonly string[]; options: SynthesizeOptions }[] = [];
  cancelled: string[] = [];
  status: VoiceStatus = 'installed';
  result: SynthesizeResult = {
    uri: 'file:///cache/runs/r1/1/notes.wav',
    size: 48044,
    durationMs: 1000,
    sampleRate: 24000,
    channels: 1,
  };
  error: { code: string; message: string } | null = null;
  /** synthesize 等到 release 才返回（测取消）。 */
  hold = false;
  private release: (() => void) | null = null;
  private listeners: ((e: TTSProgressEvent) => void)[] = [];

  async voiceStatus() {
    return this.status;
  }
  async synthesize(segments: readonly string[], options: SynthesizeOptions) {
    this.calls.push({ segments, options });
    this.emit({ taskId: options.taskId, fraction: 0.5 });
    this.emit({ taskId: 'someone-else', fraction: 0.9 });
    if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
    if (this.error) throw Object.assign(new Error(this.error.message), { code: this.error.code });
    return this.result;
  }
  cancel(taskId: string) {
    this.cancelled.push(taskId);
    this.error = { code: 'ERR_TTS_CANCELLED', message: 'Cancelled' };
    this.release?.();
  }
  addListener(_event: 'onProgress', listener: (e: TTSProgressEvent) => void) {
    this.listeners.push(listener);
    return { remove: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
  emit(e: TTSProgressEvent) {
    for (const l of this.listeners) l(e);
  }
  get listening() {
    return this.listeners.length;
  }
}

const runUri = (runId: string, relPath: string) => `file:///cache/runs/${runId}/${relPath}`;

describe('text to speech (app side)', () => {
  it('is missing without the native module (Expo Go)', () => {
    expect(createSpeaker(null, runUri)).toBeNull();
  });

  it('writes into this run’s folder and reports only its own progress', async () => {
    const native = new FakeTTS();
    const speaker = createSpeaker(native, runUri)!;
    const progress: number[] = [];
    const result = await speaker.synthesize(['第一段', '第二段'], {
      voice: 'zh-CN',
      rate: 1.2,
      runId: 'r1',
      relPath: '1/notes.wav',
      onProgress: (f) => progress.push(f),
    });
    expect(native.calls[0]).toEqual({
      segments: ['第一段', '第二段'],
      options: {
        taskId: expect.any(String),
        voice: 'zh-CN',
        rate: 1.2,
        output: 'file:///cache/runs/r1/1/notes.wav',
      },
    });
    expect(progress).toEqual([0.5]);
    expect(result).toEqual(native.result);
    expect(native.listening).toBe(0);
  });

  it('cancelling on the run page cancels the native task, and the promise ends', async () => {
    jest.useFakeTimers();
    try {
      const native = new FakeTTS();
      native.hold = true;
      let cancelled = false;
      const speaker = createSpeaker(native, runUri)!;
      const run = speaker.synthesize(['a'], {
        voice: 'en-US',
        rate: 1,
        runId: 'r1',
        relPath: '1/a.wav',
        isCancelled: () => cancelled,
      });
      const failed = expect(run).rejects.toMatchObject({ code: 'cancelled' });
      await jest.advanceTimersByTimeAsync(600);
      expect(native.cancelled).toEqual([]);
      cancelled = true;
      await jest.advanceTimersByTimeAsync(300);
      expect(native.cancelled).toEqual([native.calls[0]!.options.taskId]);
      await failed;
      expect(native.listening).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['ERR_TTS_NO_VOICE', 'noVoice'],
    ['ERR_TTS_NOT_DOWNLOADED', 'notDownloaded'],
    ['ERR_TTS_UNAVAILABLE', 'unavailable'],
    ['ERR_TTS_CANCELLED', 'cancelled'],
    ['ERR_TTS_FAILED', 'failed'],
    ['SOMETHING_ELSE', 'failed'],
  ])('native error %s becomes %s', async (native_code, code) => {
    const native = new FakeTTS();
    native.error = { code: native_code, message: 'x' };
    const speaker = createSpeaker(native, runUri)!;
    await expect(
      speaker.synthesize(['a'], { voice: 'en-US', rate: 1, runId: 'r', relPath: 'a.wav' }),
    ).rejects.toMatchObject({ code });
  });
});
