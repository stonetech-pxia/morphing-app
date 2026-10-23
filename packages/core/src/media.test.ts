import { describe, expect, it } from 'vitest';

import {
  MIN_VIDEO_KBPS,
  SIZE_MARGIN,
  isAudioFile,
  isVideoFile,
  mediaKindOf,
  planVideoConvert,
  planVideoQuality,
  planVideoSize,
  type VideoSource,
} from './media';

const MB = 1024 * 1024;

/** iPhone 拍的 1 分钟 1080p 视频，约 120 MB。 */
const phone: VideoSource = {
  durationMs: 60_000,
  size: 120 * MB,
  width: 1920,
  height: 1080,
  hasAudio: true,
  videoKbps: 15_000,
};

describe('mediaKindOf', () => {
  it('uses the MIME type, then the extension when the MIME type is missing', () => {
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaKindOf('audio/mp4')).toBe('audio');
    expect(mediaKindOf('image/heic')).toBe('image');
    expect(mediaKindOf('application/pdf')).toBe('pdf');
    expect(mediaKindOf('application/x-zip-compressed')).toBe('zip');
    expect(mediaKindOf('application/octet-stream', 'clip.MOV')).toBe('video');
    expect(mediaKindOf(null, 'memo.m4a')).toBe('audio');
    expect(mediaKindOf('', 'mp3')).toBe('audio');
    expect(mediaKindOf(undefined, 'scan.pdf')).toBe('pdf');
    expect(mediaKindOf('application/octet-stream', 'notes.docx')).toBe('other');
    expect(isVideoFile(null, 'a.mp4')).toBe(true);
    expect(isAudioFile('audio/x-caf')).toBe(true);
    expect(isAudioFile('video/mp4')).toBe(false);
  });
});

describe('planVideoSize', () => {
  it('keeps a video that is already small enough', () => {
    expect(planVideoSize({ ...phone, size: 15 * MB }, 20 * MB)).toEqual({ kind: 'keep' });
  });

  it('fits the bitrate to the target and lowers the resolution with it', () => {
    const plan = planVideoSize(phone, 20 * MB);
    expect(plan.kind).toBe('encode');
    if (plan.kind !== 'encode') return;
    // 20 MB × 8 × 0.92 ÷ 60 秒 ≈ 2572 kbps，减去 128 kbps 声音。
    const total = (20 * MB * 8 * SIZE_MARGIN) / 60 / 1000;
    expect(plan.plan.audioKbps).toBe(128);
    expect(plan.plan.videoKbps).toBe(Math.floor(total - 128));
    expect(plan.plan.shortSide).toBe(720);
    expect(plan.plan.maxFps).toBe(30);
    // 预计大小不超过目标。
    const bytes = ((plan.plan.videoKbps + plan.plan.audioKbps) * 1000 * 60) / 8;
    expect(bytes).toBeLessThan(20 * MB);
  });

  it('goes down to 360p and lower audio for long videos', () => {
    const long = { ...phone, durationMs: 10 * 60_000, size: 1200 * MB };
    expect(planVideoSize(long, 120 * MB)).toMatchObject({
      kind: 'encode',
      plan: { shortSide: 540, audioKbps: 128 },
    });
    expect(planVideoSize(long, 50 * MB)).toMatchObject({
      kind: 'encode',
      plan: { shortSide: 360, audioKbps: 64 },
    });
  });

  it('never raises the bitrate or the resolution of the original', () => {
    const low = { ...phone, width: 640, height: 360, videoKbps: 900, size: 30 * MB };
    const plan = planVideoSize(low, 25 * MB);
    expect(plan).toMatchObject({ kind: 'encode', plan: { shortSide: 360, videoKbps: 900 } });
  });

  it('refuses a target that would make the picture unwatchable and says how small it can go', () => {
    const long = { ...phone, durationMs: 8 * 60_000, size: 900 * MB };
    const plan = planVideoSize(long, 10 * MB);
    expect(plan.kind).toBe('tooSmall');
    if (plan.kind !== 'tooSmall') return;
    // 至少要视频 150 kbps + 声音 32 kbps。
    const min = ((MIN_VIDEO_KBPS + 32) * 1000 * 480) / 8 / SIZE_MARGIN / MB;
    expect(plan.minMB).toBeGreaterThanOrEqual(min);
    expect(plan.minMB).toBeLessThan(min + 0.2);
    expect(planVideoSize(long, plan.minMB * MB).kind).toBe('encode');
  });

  it('a second pass with a factor lowers the bitrate', () => {
    const first = planVideoSize(phone, 20 * MB);
    const second = planVideoSize(phone, 20 * MB, 0.85);
    if (first.kind !== 'encode' || second.kind !== 'encode') throw new Error('expected encode');
    expect(second.plan.videoKbps).toBeLessThan(first.plan.videoKbps);
  });

  it('videos without sound spend everything on the picture', () => {
    const plan = planVideoSize({ ...phone, hasAudio: false }, 20 * MB);
    expect(plan).toMatchObject({ kind: 'encode', plan: { audioKbps: 0 } });
  });
});

describe('planVideoQuality', () => {
  it('uses the tier but never upscales or raises the bitrate', () => {
    expect(planVideoQuality(phone, '720p')).toEqual({
      videoKbps: 2500,
      audioKbps: 128,
      shortSide: 720,
      maxFps: 30,
    });
    expect(planVideoQuality(phone, '1080p').shortSide).toBe(1080);
    const small = { ...phone, width: 854, height: 480, videoKbps: 800 };
    expect(planVideoQuality(small, '1080p')).toMatchObject({ shortSide: 480, videoKbps: 800 });
  });
});

describe('planVideoConvert', () => {
  it('keeps the resolution (up to 4K) and roughly the quality', () => {
    const plan = planVideoConvert(phone);
    expect(plan.shortSide).toBe(1080);
    expect(plan.maxFps).toBe(60);
    expect(plan.videoKbps).toBeLessThanOrEqual(phone.videoKbps! * 1.5);
    expect(planVideoConvert({ ...phone, width: 3840, height: 2160 }).shortSide).toBe(2160);
    expect(planVideoConvert({ ...phone, width: 7680, height: 4320 }).shortSide).toBe(2160);
  });
});
