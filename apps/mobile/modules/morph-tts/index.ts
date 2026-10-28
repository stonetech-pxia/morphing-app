import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// 本地 Expo 模块 MorphTTS（D-268）：用系统自带的声音在本机把文字读成音频文件，不上传。
// iOS 是 ios/MorphTTSModule.swift（AVSpeechSynthesizer.write），Android 是 android/…/MorphTTSModule.kt
// （TextToSpeech.synthesizeToFile，每段一个 WAV，再接成一个）。只出文件，不播放。
// Expo Go 和测试里是 null，调用方报「要在正式版 Morph 里用」。文字只交给系统朗读，不写日志。

/**
 * 一种声音在这台设备上：installed 能用；notDownloaded 系统认这种语言，但声音数据还没下载（Android，
 * 要到系统的「文字转语音」设置里下载）；unsupported 没有这种语言的声音；noEngine 没有朗读引擎（Android）。
 */
export type VoiceStatus = 'installed' | 'notDownloaded' | 'unsupported' | 'noEngine';

export interface SynthesizeOptions {
  /** 用于进度事件和取消。 */
  taskId: string;
  /** 声音的地区代码（BCP 47：zh-CN、en-US）。 */
  voice: string;
  /** 1 是正常语速，0.5–2。 */
  rate: number;
  /** 输出的 WAV（file:// 地址），在本次运行的临时目录里；已有的会被覆盖。 */
  output: string;
}

export interface SynthesizeResult {
  uri: string;
  size: number;
  durationMs: number;
  sampleRate: number;
  channels: number;
}

export interface TTSProgressEvent {
  taskId: string;
  /** 0–1（按读完的段数）。 */
  fraction: number;
}

export interface MorphTTSModule {
  voiceStatus(voice: string): Promise<VoiceStatus>;
  /**
   * 几段文字按顺序读成一个 16 位 PCM 的 WAV。中间文件（Android 每段一个 WAV）成功失败都删掉；
   * 失败或取消时输出文件也删掉。
   * 错误码：ERR_TTS_NO_VOICE、ERR_TTS_NOT_DOWNLOADED、ERR_TTS_UNAVAILABLE（没有朗读引擎）、
   * ERR_TTS_CANCELLED、ERR_TTS_FAILED。
   */
  synthesize(segments: readonly string[], options: SynthesizeOptions): Promise<SynthesizeResult>;
  /** 取消一次朗读：synthesize 以 ERR_TTS_CANCELLED 结束。 */
  cancel(taskId: string): void;
  addListener(event: 'onProgress', listener: (e: TTSProgressEvent) => void): EventSubscription;
}

export default requireOptionalNativeModule<MorphTTSModule>('MorphTTS');
