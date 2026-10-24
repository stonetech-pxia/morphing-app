import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// 本地 Expo 模块 MorphSpeech（D-150、D-151）：在本机把录音转成文字，不上传。
// iOS 是 ios/MorphSpeechModule.swift：iOS 26 起用系统的 SpeechAnalyzer（SpeechTranscriber），
// 更早的系统退回 SFSpeechRecognizer（只用本机识别）。Android 系统不能识别音频文件，
// android/… 里编进了 whisper.cpp（MIT），模型是第一次用时下载的下载内容（core/packs.ts 的 speech-whisper-*）。
// Expo Go 和测试里是 null，调用方报「要在正式版 Morph 里用」。识别出的文字只返回给 App，不写日志。

export type SpeechEngine = 'system' | 'whisper';

/**
 * 一种语言在这台设备上能不能识别（只对 engine 为 system 有意义；whisper 的模型由下载内容管理，总是 installed）：
 * installed 可以直接识别；needsDownload 系统要先下载这种语言的识别模型（由苹果提供，prepareLanguage）；
 * unsupported 这台设备不支持。
 */
export type LanguageStatus = 'installed' | 'needsDownload' | 'unsupported';

export interface TranscribeOptions {
  /** 用于进度事件和取消。 */
  taskId: string;
  /** system：BCP 47（zh-CN、en-US）；whisper：whisper 的语言代码（zh、en）。 */
  language: string;
  /** whisper 模型文件（file:// 地址或绝对路径），只有 whisper 需要。 */
  model?: string;
  /** whisper 的语音检测模型（跳过没人说话的部分），只有 whisper 用。 */
  vad?: string;
  /** whisper 的提示词：中文用简体的句子，不然常常输出繁体。 */
  prompt?: string;
  /** 只给测试用：iOS 26 起也走 SFSpeechRecognizer，用来在新系统上检查旧系统的那条路。 */
  legacy?: boolean;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface NativeTranscript {
  segments: TranscriptSegment[];
  durationMs: number;
}

export interface SpeechProgressEvent {
  taskId: string;
  /** 0–1。 */
  fraction: number;
}

export interface MorphSpeechModule {
  readonly engine: SpeechEngine;
  /** 能识别的语言（system：BCP 47，下划线换成连字符；whisper：语言代码）。 */
  supportedLanguages(): Promise<string[]>;
  languageStatus(language: string): Promise<LanguageStatus>;
  /**
   * 系统下载这种语言的识别模型（iOS 26 起，由苹果提供、所有 App 共用）；已经有了就直接返回。
   * 只能在用户确认后调用。进度用 taskId 发 onProgress。
   */
  prepareLanguage(language: string, taskId: string): Promise<void>;
  /**
   * 识别一个音频文件（m4a、wav、mp3、aac、caf…；Android 上系统能解码的都行）。
   * 错误码：ERR_SPEECH_UNSUPPORTED_LANGUAGE、ERR_SPEECH_NEEDS_DOWNLOAD、ERR_SPEECH_NOT_AUTHORIZED、
   * ERR_SPEECH_UNREADABLE_AUDIO（打不开 / 没有声音轨）、ERR_SPEECH_MODEL（模型文件坏了）、ERR_SPEECH_CANCELLED、
   * ERR_SPEECH_UNAVAILABLE（这台设备上系统识别用不了，例如 iOS 模拟器）。
   */
  transcribe(uri: string, options: TranscribeOptions): Promise<NativeTranscript>;
  /** 取消一次识别：transcribe 以 ERR_SPEECH_CANCELLED 结束。 */
  cancel(taskId: string): void;
  /** 边读边算文件的 SHA-256（下载的模型有几百 MB，不能整份读进 JS）。 */
  sha256File(uri: string): Promise<string>;
  addListener(event: 'onProgress', listener: (e: SpeechProgressEvent) => void): EventSubscription;
}

export default requireOptionalNativeModule<MorphSpeechModule>('MorphSpeech');
