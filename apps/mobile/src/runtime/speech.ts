import {
  SPEECH_MODEL_FILE,
  SPEECH_MODEL_PACKS,
  SPEECH_VAD_FILE,
  SPEECH_VAD_PACK,
  SYSTEM_SPEECH_LOCALES,
  tidyTranscript,
  whisperLanguage,
  whisperPrompt,
  type SpeechLanguage,
  type SpeechModel,
} from '@morph/core';

import type { MorphSpeechModule } from '../../modules/morph-speech';

// 语音转文字的 App 一侧（D-150、D-151）：把原生模块 MorphSpeech 包成和平台无关的接口。
// iOS 用系统识别，第一次用某种语言时可能要由系统下载识别模型；Android 用 whisper，模型是下载内容。
// 文字只留在本机（D-036）。

/** 识别前还缺什么。 */
export type SpeechNeed =
  | { kind: 'ready' }
  /** iOS：系统要先下载这种语言的识别模型（苹果提供、所有 App 共用，大小系统不告诉我们）。 */
  | { kind: 'systemDownload' }
  /** Android：要先下载 whisper 模型（连同语音检测模型）。 */
  | { kind: 'pack'; packId: string }
  | { kind: 'unsupported' };

export type SpeechErrorCode =
  | 'unsupportedLanguage'
  | 'needsDownload'
  | 'notAuthorized'
  | 'unreadableAudio'
  | 'model'
  | 'cancelled'
  /** 这台设备上系统识别用不了（iOS 模拟器：模型「已安装」但没有能用的音频格式）。 */
  | 'unavailable'
  | 'failed';

export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const NATIVE_CODES: Record<string, SpeechErrorCode> = {
  ERR_SPEECH_UNSUPPORTED_LANGUAGE: 'unsupportedLanguage',
  ERR_SPEECH_NEEDS_DOWNLOAD: 'needsDownload',
  ERR_SPEECH_NOT_AUTHORIZED: 'notAuthorized',
  ERR_SPEECH_UNREADABLE_AUDIO: 'unreadableAudio',
  ERR_SPEECH_MODEL: 'model',
  ERR_SPEECH_CANCELLED: 'cancelled',
  ERR_SPEECH_UNAVAILABLE: 'unavailable',
};

export interface SpeechPacks {
  isInstalled(id: string): Promise<boolean>;
  /** 已下载内容里一个文件的本机地址。 */
  uri(id: string, file: string): string;
}

export interface TranscribeRequest {
  language: SpeechLanguage;
  /** Android 用哪个模型；iOS 不管。 */
  model: SpeechModel;
  /** 0–1。 */
  onProgress?: (fraction: number) => void;
  /** 运行页点了「取消」（每 0.3 秒看一次）。 */
  isCancelled?: () => boolean;
}

export interface SpeechTranscript {
  text: string;
  durationMs: number;
}

export interface SpeechPlatform {
  readonly engine: 'system' | 'whisper';
  need(language: SpeechLanguage, model: SpeechModel): Promise<SpeechNeed>;
  /** iOS：让系统下载识别模型（只能在用户确认后调用）。 */
  prepare(language: SpeechLanguage, onProgress?: (fraction: number) => void): Promise<void>;
  transcribe(uri: string, request: TranscribeRequest): Promise<SpeechTranscript>;
}

const CANCEL_POLL_MS = 300;

let nextTask = 0;
const newTaskId = () => `speech-${Date.now()}-${nextTask++}`;

function asSpeechError(e: unknown): SpeechError {
  if (e instanceof SpeechError) return e;
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return new SpeechError((code && NATIVE_CODES[code]) || 'failed', message);
}

/** 没有原生模块（Expo Go、测试）时为 null。 */
export function createSpeech(
  native: MorphSpeechModule | null,
  packs: SpeechPacks | null,
): SpeechPlatform | null {
  if (!native) return null;
  const nativeLanguage = (language: SpeechLanguage) =>
    native.engine === 'system' ? SYSTEM_SPEECH_LOCALES[language] : whisperLanguage(language);

  return {
    engine: native.engine,

    async need(language, model) {
      const status = await native.languageStatus(nativeLanguage(language));
      if (status === 'unsupported') return { kind: 'unsupported' };
      if (native.engine === 'system') {
        return status === 'needsDownload' ? { kind: 'systemDownload' } : { kind: 'ready' };
      }
      const packId = SPEECH_MODEL_PACKS[model];
      if (!packs) return { kind: 'unsupported' };
      const ready = (await packs.isInstalled(packId)) && (await packs.isInstalled(SPEECH_VAD_PACK));
      return ready ? { kind: 'ready' } : { kind: 'pack', packId };
    },

    async prepare(language, onProgress) {
      const taskId = newTaskId();
      const sub = native.addListener('onProgress', (e) => {
        if (e.taskId === taskId) onProgress?.(e.fraction);
      });
      try {
        await native.prepareLanguage(nativeLanguage(language), taskId);
      } catch (e) {
        throw asSpeechError(e);
      } finally {
        sub.remove();
      }
    },

    async transcribe(uri, { language, model, onProgress, isCancelled }) {
      const taskId = newTaskId();
      const whisper = native.engine === 'whisper';
      if (whisper && !packs) throw new SpeechError('model', 'no downloads');
      const sub = native.addListener('onProgress', (e) => {
        if (e.taskId === taskId) onProgress?.(e.fraction);
      });
      const poll = isCancelled
        ? setInterval(() => {
            if (isCancelled()) native.cancel(taskId);
          }, CANCEL_POLL_MS)
        : null;
      try {
        const result = await native.transcribe(uri, {
          taskId,
          language: nativeLanguage(language),
          ...(whisper && {
            model: packs!.uri(SPEECH_MODEL_PACKS[model], SPEECH_MODEL_FILE),
            vad: packs!.uri(SPEECH_VAD_PACK, SPEECH_VAD_FILE),
            prompt: whisperPrompt(language),
          }),
        });
        return { text: tidyTranscript(result.segments, language), durationMs: result.durationMs };
      } catch (e) {
        throw asSpeechError(e);
      } finally {
        if (poll) clearInterval(poll);
        sub.remove();
      }
    },
  };
}
