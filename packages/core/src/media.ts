// 视频和音频（D-140–D-143）：判断文件是不是视频 / 音频，以及「压到指定大小 / 画质」时的码率和分辨率。
// 真正的编码在 App 的原生模块 morph-media 里，这里只有纯计算，可以在 Node 里测试。

export type MediaKind = 'image' | 'pdf' | 'video' | 'audio' | 'zip' | 'other';

/** 视频、音频的扩展名 → MIME 类型（选择器和分享不一定给出 MIME 类型）。 */
export const MEDIA_MIME_BY_EXT: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  amr: 'audio/amr',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']);

const extOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * 文件是哪一类：先看 MIME 类型，MIME 类型不可靠（空或 application/octet-stream）时看扩展名。
 * nameOrExt 可以是文件名，也可以只是扩展名。
 */
export function mediaKindOf(mimeType: string | null | undefined, nameOrExt = ''): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'zip';
  const ext = nameOrExt.includes('.') ? extOf(nameOrExt) : nameOrExt.toLowerCase();
  const byExt = MEDIA_MIME_BY_EXT[ext];
  if (byExt) return byExt.startsWith('video/') ? 'video' : 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'zip') return 'zip';
  return 'other';
}

export const isVideoFile = (mimeType: string | null | undefined, nameOrExt = '') =>
  mediaKindOf(mimeType, nameOrExt) === 'video';
export const isAudioFile = (mimeType: string | null | undefined, nameOrExt = '') =>
  mediaKindOf(mimeType, nameOrExt) === 'audio';

// ---- 压视频（video.compress）----

export const VIDEO_QUALITIES = ['1080p', '720p', '480p'] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

/** 画质档位：短边像素和视频码率（kbps，H.264、最高 30 帧）。 */
const QUALITY_TIERS: Record<VideoQuality, { shortSide: number; videoKbps: number }> = {
  '1080p': { shortSide: 1080, videoKbps: 5000 },
  '720p': { shortSide: 720, videoKbps: 2500 },
  '480p': { shortSide: 480, videoKbps: 1000 },
};

/** 按码率选短边：码率太低时分辨率也要降，否则画面全是方块。 */
const SIZE_LADDER: readonly { minKbps: number; shortSide: number }[] = [
  { minKbps: 4000, shortSide: 1080 },
  { minKbps: 1800, shortSide: 720 },
  { minKbps: 800, shortSide: 540 },
  { minKbps: 0, shortSide: 360 },
];

/** 视频码率低于这个就看不清了：目标大小算出来更低时直接报错，不浪费时间压。 */
export const MIN_VIDEO_KBPS = 150;

/** 压到指定大小时留的余量：容器开销和硬件编码器的码率误差。 */
export const SIZE_MARGIN = 0.92;

export interface VideoSource {
  durationMs: number;
  size: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  /** 原视频的视频码率（读得到时）：不会把码率往上调。 */
  videoKbps?: number;
}

export interface VideoPlan {
  videoKbps: number;
  /** 0 = 没有声音。 */
  audioKbps: number;
  /** 输出的短边像素；不放大原视频。 */
  shortSide: number;
  maxFps: number;
}

export type VideoCompressPlan =
  | { kind: 'encode'; plan: VideoPlan }
  /** 原文件已经不超过目标大小：原样交给下一步。 */
  | { kind: 'keep' }
  /** 目标太小：minMB 是至少要多大。 */
  | { kind: 'tooSmall'; minMB: number };

const MB = 1024 * 1024;

const shortSideOf = (s: VideoSource) =>
  s.width && s.height ? Math.min(s.width, s.height) : Number.POSITIVE_INFINITY;

function audioKbpsFor(totalKbps: number): number {
  if (totalKbps >= 1000) return 128;
  if (totalKbps >= 300) return 64;
  return 32;
}

/** 按画质档位压：不放大，也不把码率调得比原来高。 */
export function planVideoQuality(source: VideoSource, quality: VideoQuality): VideoPlan {
  const tier = QUALITY_TIERS[quality];
  const shortSide = Math.min(tier.shortSide, shortSideOf(source));
  // 原视频比这一档小时按像素比例降码率。
  const pixelRatio = Number.isFinite(shortSide) ? (shortSide / tier.shortSide) ** 2 : 1;
  let videoKbps = Math.round(tier.videoKbps * Math.min(1, pixelRatio));
  if (source.videoKbps) videoKbps = Math.min(videoKbps, source.videoKbps);
  return {
    videoKbps: Math.max(MIN_VIDEO_KBPS, videoKbps),
    audioKbps: source.hasAudio ? 128 : 0,
    shortSide: Number.isFinite(shortSide) ? shortSide : tier.shortSide,
    maxFps: 30,
  };
}

/**
 * 压到不超过 targetBytes：总码率 = 目标大小 × 8 × 余量 ÷ 时长，减去声音的码率就是视频码率，
 * 再按视频码率选分辨率。factor 用于压完还超时再压一次（按超出的比例降码率）。
 */
export function planVideoSize(
  source: VideoSource,
  targetBytes: number,
  factor = 1,
): VideoCompressPlan {
  if (source.size <= targetBytes && factor === 1) return { kind: 'keep' };
  const seconds = Math.max(source.durationMs, 1) / 1000;
  const totalKbps = ((targetBytes * 8 * SIZE_MARGIN) / seconds / 1000) * factor;
  const audioKbps = source.hasAudio ? audioKbpsFor(totalKbps) : 0;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  if (videoKbps < MIN_VIDEO_KBPS) {
    const minAudio = source.hasAudio ? 32 : 0;
    const bytes = ((MIN_VIDEO_KBPS + minAudio) * 1000 * seconds) / 8 / SIZE_MARGIN;
    return { kind: 'tooSmall', minMB: Math.ceil((bytes / MB) * 10) / 10 };
  }
  const ladder = SIZE_LADDER.find((s) => videoKbps >= s.minKbps)!;
  const capped = source.videoKbps ? Math.min(videoKbps, source.videoKbps) : videoKbps;
  return {
    kind: 'encode',
    plan: {
      videoKbps: capped,
      audioKbps,
      shortSide: Math.min(ladder.shortSide, shortSideOf(source)),
      maxFps: 30,
    },
  };
}

/** 转格式（video.convert）：尽量保持原画质，最高 4K、30 帧以上保留到 60 帧。 */
export function planVideoConvert(source: VideoSource): VideoPlan {
  const shortSide = Math.min(2160, shortSideOf(source));
  const side = Number.isFinite(shortSide) ? shortSide : 1080;
  // H.264 大约每百万像素 6 Mbps（30 帧）能保持原画质。原视频多半是更省的 HEVC，
  // 所以上限是原码率的 1.5 倍，不会越转越大太多。
  const pixels = (side * side * 16) / 9;
  let videoKbps = Math.round((pixels / 1_000_000) * 6000);
  if (source.videoKbps) {
    videoKbps = Math.min(videoKbps, Math.max(Math.round(source.videoKbps * 1.5), 1000));
  }
  return { videoKbps, audioKbps: source.hasAudio ? 192 : 0, shortSide: side, maxFps: 60 };
}
