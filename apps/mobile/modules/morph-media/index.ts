import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// 本地 Expo 模块 MorphMedia（D-141）：在本机处理视频和音频，只用系统框架和官方库。
// iOS 是 ios/MorphMediaModule.swift（AVFoundation），Android 是 android/…/MorphMediaModule.kt
// （Jetpack Media3 Transformer，Apache-2.0）。Expo Go 和测试里是 null，视频动作报 needsFullApp。
//
// 接口按「视频 + 音频」设计（和音频工具共用）：这一批实现 probe、transcode（mp4 + H.264，声音 AAC 或去掉）、
// trim、thumbnails、cancel 和进度事件；m4a / wav、只要声音（video: 'drop'）、PCM、concat、waveform
// 由音频工具补上，没实现的组合原生端抛 ERR_NOT_IMPLEMENTED。
// 地址：file://（iOS、Android）或 content://（Android 分享进来的文件）。输出总是 file://。

export type MediaKind = 'video' | 'audio';

export interface MediaInfo {
  kind: MediaKind;
  durationMs: number;
  size: number;
  hasVideo: boolean;
  hasAudio: boolean;
  // 视频（width / height 是画面摆正之后的宽高）
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  fps?: number;
  hdr?: boolean;
  videoCodec?: string;
  videoBitrateKbps?: number;
  // 声音（视频的音轨或音频文件）
  audioCodec?: string;
  audioBitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface VideoSettings {
  speed?: number;
  aspectRatio?: number;
  codec: 'h264';
  bitrateKbps?: number;
  /** 缩小到这个短边像素；只在比原视频小时给（原生端不检查，不放大由调用方保证）。 */
  maxShortSide?: number;
  maxFps?: number;
  /** 拼接时统一输出画布，尺寸必须为正偶数。 */
  width?: number;
  height?: number;
  /** HDR 转成普通画面（BT.709）。H.264 输出总是转。 */
  toSdr?: boolean;
}

export interface AudioSettings {
  /** mp3：编进 App 的 LAME（D-183）。 */
  codec: 'aac' | 'pcm' | 'mp3';
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: 1 | 2;
}

export interface TranscodeOptions {
  container: 'mp4' | 'm4a' | 'wav' | 'mp3';
  /** 'drop'：只要声音（音频转格式、从视频取声音）。 */
  video: VideoSettings | 'drop';
  /** 'drop'：去掉声音。 */
  audio: AudioSettings | 'drop';
  /** 只要其中一段（重新编码，准确到帧）。 */
  range?: TimeRange;
}

export interface MediaResult {
  /** 实际写出的文件（扩展名可能和请求的不同，例如剪切时 MP4 放不下原来的声音改成 MOV）。 */
  uri: string;
  size: number;
  info: MediaInfo;
}

export interface GifResult {
  uri: string;
  size: number;
  width: number;
  height: number;
  frames: number;
}

/** 原生端的错误码（error.code）。 */
export const MEDIA_ERRORS = {
  /** 系统打不开（格式不支持、有版权保护、没有画面和声音）。 */
  unsupported: 'ERR_MEDIA_UNSUPPORTED',
  /** cancel(jobId) 取消了。 */
  cancelled: 'ERR_MEDIA_CANCELLED',
  /** 处理时切到了别的 App（iOS 不让后台用视频编码器）。 */
  interrupted: 'ERR_MEDIA_INTERRUPTED',
  /** 这一批还没实现的组合。 */
  notImplemented: 'ERR_NOT_IMPLEMENTED',
  /** 其他编码 / 写文件失败。 */
  failed: 'ERR_MEDIA_FAILED',
} as const;

export interface MorphMediaModule {
  probe(uri: string): Promise<MediaInfo>;
  /** 压缩、转格式、取声音都走这一个。jobId 用来取消和对应进度事件。 */
  transcode(
    jobId: string,
    uri: string,
    output: string,
    options: TranscodeOptions,
  ): Promise<MediaResult>;
  rotate?(
    jobId: string,
    uri: string,
    output: string,
    degrees: number,
    options: TranscodeOptions,
  ): Promise<MediaResult>;
  mixAudio?(
    jobId: string,
    uri: string,
    music: string,
    output: string,
    options: TranscodeOptions & {
      originalVolume: number;
      loop: boolean;
      videoDurationMs: number;
      musicDurationMs: number;
    },
  ): Promise<MediaResult>;
  /** 不重新编码地剪一段（视频和音频都能用）。 */
  trim(jobId: string, uri: string, output: string, range: TimeRange): Promise<MediaResult>;
  /** 保存最接近时间点的一帧，原尺寸 JPEG，已摆正。旧开发构建缺此方法。 */
  frame?(uri: string, timeMs: number, directory: string): Promise<string>;
  /** 按时间取画面（已摆正，长边不超过 maxSide），写成 JPEG 放进 directory，返回文件地址。 */
  thumbnails(
    uri: string,
    timesMs: readonly number[],
    maxSide: number,
    directory: string,
  ): Promise<string[]>;
  /** 动图（D-184）：整段视频按 fps 取画面（宽度不超过 width）写成 GIF。 */
  videoGif(
    jobId: string,
    uri: string,
    output: string,
    options: { width: number; fps: number },
  ): Promise<GifResult>;
  /** 动图（D-184）：几张图片（长边缩到 maxSide，按第一张的尺寸居中摆放）写成 GIF，每张停 delayMs。 */
  imagesGif(
    jobId: string,
    uris: readonly string[],
    output: string,
    options: { delayMs: number; maxSide: number },
  ): Promise<GifResult>;
  cancel(jobId: string): void;
  addListener(
    event: 'progress',
    listener: (event: { jobId: string; progress: number }) => void,
  ): EventSubscription;
  // ---- 音频工具以后实现（调用方先判断方法是否存在）----
  /** 几段按顺序合成一段：输入格式、采样率可以不同，统一重新编码。 */
  concat?(
    jobId: string,
    uris: readonly string[],
    output: string,
    options: TranscodeOptions,
  ): Promise<MediaResult>;
  /** 0–1 的峰值数组，剪一段界面画波形用。 */
  waveform?(uri: string, buckets: number, range?: TimeRange): Promise<number[]>;
}

export default requireOptionalNativeModule<MorphMediaModule>('MorphMedia');
