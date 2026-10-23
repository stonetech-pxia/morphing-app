import type {
  LanguageStatus,
  MorphSpeechModule,
  NativeTranscript,
  SpeechProgressEvent,
  TranscribeOptions,
} from '../../modules/morph-speech';
import { createSpeech, SpeechError, type SpeechPacks } from '../runtime/speech';

// 语音转文字的 App 一侧（D-150、D-151）：用假的原生模块检查语言代码、模型地址、进度、取消和错误码。

class FakeSpeech implements MorphSpeechModule {
  calls: { uri: string; options: TranscribeOptions }[] = [];
  prepared: string[] = [];
  cancelled: string[] = [];
  status: LanguageStatus = 'installed';
  result: NativeTranscript = {
    segments: [{ startMs: 0, endMs: 1000, text: '明天开会,别迟到。' }],
    durationMs: 1000,
  };
  error: { code: string; message: string } | null = null;
  /** transcribe 等到 release 才返回（测取消）。 */
  hold = false;
  private release: (() => void) | null = null;
  private listeners: ((e: SpeechProgressEvent) => void)[] = [];

  constructor(readonly engine: 'system' | 'whisper') {}

  async supportedLanguages() {
    return [];
  }
  async languageStatus() {
    return this.status;
  }
  async prepareLanguage(language: string, taskId: string) {
    this.prepared.push(language);
    this.emit({ taskId, fraction: 0.5 });
  }
  async transcribe(uri: string, options: TranscribeOptions) {
    this.calls.push({ uri, options });
    this.emit({ taskId: options.taskId, fraction: 0.4 });
    this.emit({ taskId: 'someone-else', fraction: 0.9 });
    if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
    if (this.error) throw Object.assign(new Error(this.error.message), { code: this.error.code });
    return this.result;
  }
  cancel(taskId: string) {
    this.cancelled.push(taskId);
    this.error = { code: 'ERR_SPEECH_CANCELLED', message: 'Cancelled' };
    this.release?.();
  }
  async sha256File() {
    return '';
  }
  addListener(_event: 'onProgress', listener: (e: SpeechProgressEvent) => void) {
    this.listeners.push(listener);
    return { remove: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
  emit(e: SpeechProgressEvent) {
    for (const l of this.listeners) l(e);
  }
  get listening() {
    return this.listeners.length;
  }
}

const packs = (installed: string[]): SpeechPacks => ({
  isInstalled: async (id) => installed.includes(id),
  uri: (id, file) => `file:///packs/${id}/${file}`,
});

describe('speech to text', () => {
  it('is not available without the native module (Expo Go)', () => {
    expect(createSpeech(null, packs([]))).toBeNull();
  });

  it('iOS: uses the system locale and tidies the text', async () => {
    const native = new FakeSpeech('system');
    const speech = createSpeech(native, null)!;
    const progress: number[] = [];
    const out = await speech.transcribe('file:///a.m4a', {
      language: 'zh',
      model: 'standard',
      onProgress: (f) => progress.push(f),
    });
    expect(native.calls[0]!.options).toEqual({ taskId: expect.any(String), language: 'zh-CN' });
    expect(out).toEqual({ text: '明天开会，别迟到。', durationMs: 1000 });
    // 只收自己这次的进度；结束后不再监听。
    expect(progress).toEqual([0.4]);
    expect(native.listening).toBe(0);
  });

  it('iOS: a language the system still has to download asks first', async () => {
    const native = new FakeSpeech('system');
    native.status = 'needsDownload';
    const speech = createSpeech(native, null)!;
    expect(await speech.need('ja', 'standard')).toEqual({ kind: 'systemDownload' });
    const progress: number[] = [];
    await speech.prepare('ja', (f) => progress.push(f));
    expect(native.prepared).toEqual(['ja-JP']);
    expect(progress).toEqual([0.5]);
    native.status = 'unsupported';
    expect(await speech.need('vi', 'standard')).toEqual({ kind: 'unsupported' });
  });

  it('Android: needs the model and the speech detector downloaded, then passes their files', async () => {
    const native = new FakeSpeech('whisper');
    expect(await createSpeech(native, packs(['speech-vad']))!.need('zh', 'standard')).toEqual({
      kind: 'pack',
      packId: 'speech-whisper-small',
    });
    expect(await createSpeech(native, packs(['speech-whisper-base']))!.need('en', 'fast')).toEqual({
      kind: 'pack',
      packId: 'speech-whisper-base',
    });
    const speech = createSpeech(native, packs(['speech-vad', 'speech-whisper-base']))!;
    expect(await speech.need('zh-TW', 'fast')).toEqual({ kind: 'ready' });
    await speech.transcribe('content://voice/1', { language: 'zh-TW', model: 'fast' });
    expect(native.calls[0]!.options).toEqual({
      taskId: expect.any(String),
      language: 'zh',
      model: 'file:///packs/speech-whisper-base/model.bin',
      vad: 'file:///packs/speech-vad/vad.bin',
      prompt: '以下是國語的句子。',
    });
  });

  it('cancelling on the run page cancels the native task', async () => {
    jest.useFakeTimers();
    try {
      const native = new FakeSpeech('whisper');
      native.hold = true;
      let cancelled = false;
      const speech = createSpeech(native, packs(['speech-vad', 'speech-whisper-small']))!;
      const run = speech.transcribe('file:///a.wav', {
        language: 'en',
        model: 'standard',
        isCancelled: () => cancelled,
      });
      const failed = expect(run).rejects.toMatchObject({ code: 'cancelled' });
      await jest.advanceTimersByTimeAsync(600);
      expect(native.cancelled).toEqual([]);
      cancelled = true;
      await jest.advanceTimersByTimeAsync(300);
      expect(native.cancelled).toEqual([native.calls[0]!.options.taskId]);
      await failed;
    } finally {
      jest.useRealTimers();
    }
  });

  it('native error codes become speech error codes', async () => {
    const native = new FakeSpeech('system');
    const speech = createSpeech(native, null)!;
    native.error = { code: 'ERR_SPEECH_UNREADABLE_AUDIO', message: 'no audio track' };
    const e = await speech
      .transcribe('file:///a.amr', { language: 'en', model: 'standard' })
      .catch((x) => x);
    expect(e).toBeInstanceOf(SpeechError);
    expect(e.code).toBe('unreadableAudio');
    native.error = { code: 'ERR_SOMETHING_ELSE', message: 'boom' };
    await expect(
      speech.transcribe('file:///a.m4a', { language: 'en', model: 'standard' }),
    ).rejects.toMatchObject({ code: 'failed' });
  });
});
