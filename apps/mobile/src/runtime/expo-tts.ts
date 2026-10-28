import type { MorphTTSModule } from '../../modules/morph-tts';
import type { SpeakErrorCode, SpeakPlatform } from './platform';

// SpeakPlatform 的实现：本地 Expo 模块 MorphTTS（D-270）。没有这个模块（Expo Go、测试）时为 null。
// 取消和语音转文字一样：每 0.3 秒看一次运行页的「停止」，交给原生模块停掉系统朗读。

const CANCEL_POLL_MS = 300;

/** 原生模块的错误码 → 平台错误码。 */
const CODES: Record<string, SpeakErrorCode> = {
  ERR_TTS_NO_VOICE: 'noVoice',
  ERR_TTS_NOT_DOWNLOADED: 'notDownloaded',
  ERR_TTS_UNAVAILABLE: 'unavailable',
  ERR_TTS_CANCELLED: 'cancelled',
};

function rethrow(e: unknown): never {
  const code = CODES[String((e as { code?: string })?.code)] ?? 'failed';
  throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { code });
}

let nextTask = 0;
const newTaskId = () => `tts-${Date.now()}-${nextTask++}`;

export function createSpeaker(
  native: MorphTTSModule | null,
  runUri: (runId: string, relPath: string) => string,
): SpeakPlatform | null {
  if (!native) return null;
  return {
    voiceStatus: (voice) => native.voiceStatus(voice),

    async synthesize(segments, { voice, rate, runId, relPath, onProgress, isCancelled }) {
      const taskId = newTaskId();
      const sub = native.addListener('onProgress', (e) => {
        if (e.taskId === taskId) onProgress?.(e.fraction);
      });
      const poll = isCancelled
        ? setInterval(() => {
            if (isCancelled()) native.cancel(taskId);
          }, CANCEL_POLL_MS)
        : null;
      try {
        return await native.synthesize(segments, {
          taskId,
          voice,
          rate,
          output: runUri(runId, relPath),
        });
      } catch (e) {
        return rethrow(e);
      } finally {
        if (poll) clearInterval(poll);
        sub.remove();
      }
    },
  };
}
