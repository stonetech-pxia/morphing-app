// 音频（D-152、D-153）：「压到指定大小 / 音质」「转格式」时的码率、声道和采样率。
// 真正的编码在 App 的原生模块 morph-media 里（iOS AVFoundation、Android Media3），这里只有纯计算。
// 输出默认 M4A（AAC），微信、邮件、电脑和所有手机都能放；也能输出 WAV（不压缩）。不做 MP3（P-020）。

export const AUDIO_QUALITIES = ['high', 'standard', 'voice'] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];

export const AUDIO_FORMATS = ['m4a', 'wav'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** 编码要求（交给原生模块）。WAV 只用 channels / sampleRate。 */
export interface AudioPlan {
  format: AudioFormat;
  bitrateKbps: number;
  channels: 1 | 2;
  sampleRate: number;
}

/** 音质档位：高（音乐）、标准、语音（录音、讲课，单声道）。 */
export const AUDIO_QUALITY_PLANS: Record<AudioQuality, Omit<AudioPlan, 'format'>> = {
  high: { bitrateKbps: 192, channels: 2, sampleRate: 44100 },
  standard: { bitrateKbps: 128, channels: 2, sampleRate: 44100 },
  voice: { bitrateKbps: 48, channels: 1, sampleRate: 22050 },
};

/** 再低 AAC 就听不清了：目标大小算出来更低时直接报错，告诉用户至少要多大。 */
export const MIN_AUDIO_KBPS = 24;
/** 压到指定大小时最高用到的码率（再高听不出区别）。 */
export const MAX_AUDIO_KBPS = 192;
/** 容器开销和编码器的码率误差。 */
export const AUDIO_SIZE_MARGIN = 0.94;

export interface AudioSource {
  durationMs: number;
  size: number;
  channels?: number;
  sampleRate?: number;
  /** 原来的码率（读不到时按大小和时长算）。 */
  kbps?: number;
}

export type AudioSizePlan =
  { kind: 'keep' } | { kind: 'encode'; plan: AudioPlan } | { kind: 'tooSmall'; minMB: number };

const MB = 1024 * 1024;

const sourceKbps = (s: AudioSource) =>
  s.kbps && s.kbps > 0
    ? s.kbps
    : s.durationMs > 0
      ? (s.size * 8) / (s.durationMs / 1000) / 1000
      : 0;

/** 码率 → 声道和采样率：立体声要 96 kbps 以上，太低时单声道、22.05 kHz（AAC 编码器的要求）。 */
function shapeFor(kbps: number, sourceChannels: number): Omit<AudioPlan, 'format'> {
  const stereo = kbps >= 96 && sourceChannels !== 1;
  return {
    bitrateKbps: Math.round(kbps),
    channels: stereo ? 2 : 1,
    sampleRate: kbps >= 48 ? 44100 : 22050,
  };
}

/**
 * 压到不超过 targetBytes：本来就不超过时原样留着；按时长算码率，最高 192 kbps；
 * 低于 24 kbps 时报错（带「至少 X MB」）。
 */
export function planAudioSize(source: AudioSource, targetBytes: number, factor = 1): AudioSizePlan {
  if (factor === 1 && source.size > 0 && source.size <= targetBytes) return { kind: 'keep' };
  const seconds = Math.max(source.durationMs / 1000, 0.1);
  const kbps = Math.min(
    MAX_AUDIO_KBPS,
    ((targetBytes * 8 * AUDIO_SIZE_MARGIN) / seconds / 1000) * factor,
  );
  if (kbps < MIN_AUDIO_KBPS) {
    const minBytes = (MIN_AUDIO_KBPS * 1000 * seconds) / 8 / AUDIO_SIZE_MARGIN;
    return { kind: 'tooSmall', minMB: Math.ceil((minBytes / MB) * 10) / 10 };
  }
  return { kind: 'encode', plan: { format: 'm4a', ...shapeFor(kbps, source.channels ?? 2) } };
}

/** 按音质：不比原来的码率高（压小不会变大）；单声道的原文件不升成立体声。 */
export function planAudioQuality(source: AudioSource, quality: AudioQuality): AudioPlan {
  const tier = AUDIO_QUALITY_PLANS[quality];
  const original = sourceKbps(source);
  const kbps =
    original > 0
      ? Math.max(MIN_AUDIO_KBPS, Math.min(tier.bitrateKbps, original))
      : tier.bitrateKbps;
  const shape = shapeFor(kbps, source.channels ?? 2);
  return {
    format: 'm4a',
    bitrateKbps: shape.bitrateKbps,
    channels: tier.channels === 1 ? 1 : shape.channels,
    sampleRate: Math.min(tier.sampleRate, shape.sampleRate),
  };
}

/**
 * 转格式（剪一段、合成、从视频取声音也用它）：M4A 尽量保持原来的音质（码率不超过 192 kbps）；
 * WAV 是不压缩的 16 位 PCM，保持原来的声道（最多 2 个）和采样率。
 */
export function planAudioConvert(source: AudioSource, format: AudioFormat): AudioPlan {
  const channels: 1 | 2 = source.channels === 1 ? 1 : 2;
  if (format === 'wav') {
    const sampleRate = source.sampleRate ? Math.min(48000, source.sampleRate) : 44100;
    return { format, bitrateKbps: 0, channels, sampleRate };
  }
  const original = sourceKbps(source);
  const kbps = original > 0 ? Math.min(MAX_AUDIO_KBPS, Math.max(96, original)) : 160;
  return { format, ...shapeFor(kbps, channels) };
}

/** 预计大小（字节）：检查剩余空间用。 */
export function estimateAudioBytes(plan: AudioPlan, durationMs: number): number {
  const seconds = durationMs / 1000;
  if (plan.format === 'wav') return plan.sampleRate * plan.channels * 2 * seconds + 44;
  return (plan.bitrateKbps * 1000 * seconds) / 8;
}
