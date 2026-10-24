import {
  RunCancelled,
  RunError,
  planVideoConvert,
  planVideoQuality,
  planVideoSize,
  type ActionImpl,
  type RunItem,
  type VideoPlan,
  type VideoQuality,
  type VideoSource,
} from '@morph/core';

import type { MediaInfo, MediaOutput, MediaPlatform, VideoEncode } from '../platform';
import { MB, displayName, fileItems, freshName, type RunServices } from './helpers';

// 视频工具的动作实现（D-143）：码率和分辨率在 core/media.ts 里算，编码交给原生模块 morph-media。
// 输出一律是 MP4（H.264 + AAC）。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

/** 压完还超过目标时最多再压几次。 */
const MAX_RETRIES = 2;

/** 剩余空间至少留这么多给系统。 */
const SPARE_BYTES = 200 * MB;

function mediaOf(ctx: Ctx): MediaPlatform {
  const media = ctx.services.files.media;
  if (!media) throw new RunError('needsFullApp');
  return media;
}

const PC_VIDEO_FORMATS = ['mkv', 'webm', 'avi', 'wmv', 'flv'];

/** 原生模块的错误 → 给用户看的错误。 */
export function mediaError(e: unknown, item: RunItem): Error {
  if (e instanceof RunError || e instanceof RunCancelled) return e;
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'ERR_MEDIA_CANCELLED':
      return new RunCancelled();
    case 'ERR_MEDIA_UNSUPPORTED':
      // 电脑上常见、手机系统常常打不开的格式（iPhone 不认 MKV、WEBM、AVI，D-185）：说清是格式的问题。
      return PC_VIDEO_FORMATS.includes(item.ext.toLowerCase())
        ? new RunError('formatUnsupported', {
            name: displayName(item),
            format: item.ext.toUpperCase(),
          })
        : new RunError('mediaUnsupported', { name: displayName(item) });
    case 'ERR_MEDIA_INTERRUPTED':
      return new RunError('interrupted');
    case 'ERR_NOT_IMPLEMENTED':
      return new RunError('unsupportedAction', { action: String(e) });
    default:
      return new RunError('unexpected', { detail: String((e as Error)?.message ?? e) });
  }
}

/** 剩余空间够不够写 bytes 这么大的文件（读不到剩余空间时放行）。 */
export function checkSpace(ctx: Ctx, bytes: number): void {
  const free = ctx.services.files.freeDiskBytes();
  if (free === null || free - SPARE_BYTES >= bytes) return;
  const gb = Math.ceil(((bytes + SPARE_BYTES - free) / 1024 / MB) * 10) / 10;
  throw new RunError('notEnoughSpace', { gb });
}

async function probe(media: MediaPlatform, item: RunItem): Promise<MediaInfo> {
  try {
    const info = await media.probe(item.uri);
    if (!info.hasVideo) throw new RunError('mediaUnsupported', { name: displayName(item) });
    return info;
  } catch (e) {
    throw mediaError(e, item);
  }
}

const sourceOf = (item: RunItem, info: MediaInfo): VideoSource => ({
  durationMs: info.durationMs || item.durationMs || 0,
  size: info.size || item.size,
  hasAudio: info.hasAudio,
  ...(info.width ? { width: info.width } : {}),
  ...(info.height ? { height: info.height } : {}),
  ...(info.videoBitrateKbps ? { videoKbps: info.videoBitrateKbps } : {}),
});

/** 计划 → 编码要求：短边不比原视频小时不缩放。 */
function encodeOf(plan: VideoPlan, info: MediaInfo): VideoEncode {
  const original = info.width && info.height ? Math.min(info.width, info.height) : Infinity;
  return {
    videoKbps: plan.videoKbps,
    audioKbps: info.hasAudio ? plan.audioKbps : 0,
    maxFps: plan.maxFps,
    ...(plan.shortSide < original ? { shortSide: plan.shortSide } : {}),
  };
}

/** 预计大小（字节）：检查空间用。 */
const estimate = (plan: VideoPlan, durationMs: number) =>
  ((plan.videoKbps + plan.audioKbps) * 1000 * (durationMs / 1000)) / 8;

/**
 * 逐个处理视频，进度按全部视频合起来的百分比报。
 * work 返回新的临时文件，或 null（原样交给下一步）。
 */
async function eachVideo(
  input: Parameters<Impl>[0],
  ctx: Ctx,
  work: (
    item: RunItem,
    media: MediaPlatform,
    job: { progress(f: number): void; isCancelled(): boolean },
  ) => Promise<MediaOutput | null>,
) {
  const items = fileItems(input);
  const media = mediaOf(ctx);
  const out: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    ctx.throwIfCancelled();
    // 超了重压时原生进度会从 0 重新开始：显示的进度只增不减。
    let shown = 0;
    const job = {
      progress: (f: number) => {
        shown = Math.max(shown, Math.min(1, f));
        ctx.progress(Math.round(((i + shown) / items.length) * 100), 100, 'percent');
      },
      isCancelled: () => {
        try {
          ctx.throwIfCancelled();
          return false;
        } catch {
          return true;
        }
      },
    };
    job.progress(0);
    let result: MediaOutput | null;
    try {
      result = await work(item, media, job);
    } catch (e) {
      throw mediaError(e, item);
    }
    out.push(
      result
        ? {
            uri: result.uri,
            name: item.name,
            ext: result.ext || 'mp4',
            mimeType: result.ext === 'mov' ? 'video/quicktime' : 'video/mp4',
            size: result.size,
            durationMs: result.info.durationMs,
            ...(result.info.width ? { width: result.info.width } : {}),
            ...(result.info.height ? { height: result.info.height } : {}),
            ...(item.takenAt !== undefined ? { takenAt: item.takenAt } : {}),
          }
        : item,
    );
  }
  ctx.progress(100, 100, 'percent');
  return { type: 'video' as const, items: out };
}

export const VIDEO_IMPLS: Record<string, Impl> = {
  async 'video.rotate'(input, params, ctx) {
    const { degrees } = params as { degrees: 90 | 180 | 270 };
    return eachVideo(input, ctx, async (item, media, job) => {
      const info = await probe(media, item);
      const plan = planVideoConvert(sourceOf(item, info));
      checkSpace(ctx, Math.max(item.size, estimate(plan, info.durationMs)));
      return media.rotateVideo(
        item.uri,
        degrees,
        encodeOf(plan, info),
        ctx.services.runId,
        freshName(item.name, 'mp4'),
        job,
      );
    });
  },
  async 'video.audio'(input, params, ctx) {
    const { originalVolume, loop } = params as { originalVolume: number; loop: boolean };
    const media = mediaOf(ctx);
    const selected = await ctx.services.files.pickDocuments(['audio/*'], false);
    if (!selected?.[0]) throw new RunCancelled();
    ctx.throwIfCancelled();
    const music = selected[0];
    let musicInfo: MediaInfo;
    try {
      musicInfo = await media.probe(music.uri);
    } catch (e) {
      throw mediaError(e, {
        uri: music.uri,
        name: music.name,
        ext: '',
        mimeType: music.mimeType ?? 'audio/*',
        size: music.size ?? 0,
      });
    }
    if (!musicInfo.hasAudio || !Number.isFinite(musicInfo.durationMs) || musicInfo.durationMs <= 0)
      throw new RunError('mediaUnsupported', { name: music.name });
    const stored = await ctx.services.files.adoptIntoRun(
      music.uri,
      ctx.services.runId,
      freshName('music', 'audio'),
    );
    return eachVideo(input, ctx, async (item, _media, job) => {
      const info = await probe(media, item);
      const plan = { ...planVideoConvert(sourceOf(item, info)), audioKbps: 128 };
      checkSpace(ctx, estimate(plan, info.durationMs));
      return media.mixVideoAudio(
        item.uri,
        stored.uri,
        {
          ...encodeOf(plan, info),
          audioKbps: 128,
          originalVolume,
          loop,
          videoDurationMs: info.durationMs,
          musicDurationMs: musicInfo.durationMs,
        },
        ctx.services.runId,
        freshName(item.name, 'mp4'),
        job,
      );
    });
  },
  async 'video.mute'(input, _params, ctx) {
    return eachVideo(input, ctx, async (item, media, job) => {
      const info = await probe(media, item);
      const plan = { ...planVideoConvert(sourceOf(item, info)), audioKbps: 0 };
      checkSpace(ctx, estimate(plan, info.durationMs));
      return media.encodeVideo(
        item.uri,
        { ...encodeOf(plan, info), audioKbps: 0 },
        ctx.services.runId,
        freshName(item.name, 'mp4'),
        job,
      );
    });
  },
  async 'video.frame'(input, _params, ctx) {
    const media = mediaOf(ctx);
    const items: RunItem[] = [];
    for (const item of fileItems(input)) {
      ctx.throwIfCancelled();
      const info = await probe(media, item);
      items.push({ ...item, durationMs: info.durationMs, width: info.width, height: info.height });
    }
    const times = await ctx.services.ui.open('frameMedia', {
      items,
      loadThumbnails: (i, ms) => media.thumbnails(items[i]!.uri, ms, 160, ctx.services.runId),
    });
    if (!times) throw new RunCancelled();
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      const time = times[i];
      if (
        time === undefined ||
        !Number.isFinite(time) ||
        time < 0 ||
        time >= (item.durationMs ?? 0)
      )
        throw new RunError('mediaUnsupported', { name: displayName(item) });
      try {
        const uri = await media.frame(item.uri, time, ctx.services.runId);
        const size = (await ctx.services.files.readBytes(uri)).length;
        const dimensions = await ctx.services.files.imageSize(uri);
        out.push({
          uri,
          name: `${item.name}-${Math.round(time)}ms`,
          ext: 'jpg',
          mimeType: 'image/jpeg',
          size,
          ...dimensions,
        });
      } catch (e) {
        throw mediaError(e, item);
      }
      ctx.progress(i + 1, items.length);
    }
    ctx.throwIfCancelled();
    return { type: 'images', items: out };
  },
  async 'video.merge'(input, _params, ctx) {
    const items = fileItems(input);
    if (items.length < 2) throw new RunError('tooFew', { min: 2 });
    if (items.length > 10) throw new RunError('tooMany', { max: 10 });
    const media = mediaOf(ctx);
    const infos = [];
    for (const item of items) {
      ctx.throwIfCancelled();
      infos.push(await probe(media, item));
    }
    const first = infos[0]!;
    const width = Math.max(2, Math.round((first.width ?? 1920) / 2) * 2);
    const height = Math.max(2, Math.round((first.height ?? 1080) / 2) * 2);
    const durationMs = infos.reduce((n, info) => n + info.durationMs, 0);
    const plan = planVideoConvert(sourceOf(items[0]!, first));
    const settings = {
      videoKbps: plan.videoKbps,
      audioKbps: infos.some((i) => i.hasAudio) ? 128 : 0,
      maxFps: first.fps && first.fps > 0 ? first.fps : 30,
      width,
      height,
    };
    checkSpace(ctx, estimate({ ...plan, audioKbps: settings.audioKbps }, durationMs));
    try {
      const result = await media.concatVideo(
        items.map((i) => i.uri),
        settings,
        ctx.services.runId,
        freshName(items[0]!.name, 'mp4'),
        {
          progress: (f) => ctx.progress(Math.round(f * 100), 100, 'percent'),
          isCancelled: () => {
            try {
              ctx.throwIfCancelled();
              return false;
            } catch {
              return true;
            }
          },
        },
      );
      ctx.throwIfCancelled();
      return {
        type: 'video',
        items: [
          {
            uri: result.uri,
            name: items[0]!.name,
            ext: 'mp4',
            mimeType: 'video/mp4',
            size: result.size,
            durationMs: result.info.durationMs,
            width: result.info.width ?? width,
            height: result.info.height ?? height,
          },
        ],
      };
    } catch (e) {
      throw mediaError(e, items[0]!);
    }
  },
  async 'video.compress'(input, params, ctx) {
    const { by, maxMB, quality } = params as {
      by: 'size' | 'quality';
      maxMB: number;
      quality: VideoQuality;
    };
    const target = maxMB * MB;
    return eachVideo(input, ctx, async (item, media, job) => {
      const info = await probe(media, item);
      const source = sourceOf(item, info);
      const encode = async (plan: VideoPlan) => {
        checkSpace(ctx, estimate(plan, source.durationMs));
        return media.encodeVideo(
          item.uri,
          encodeOf(plan, info),
          ctx.services.runId,
          freshName(item.name, 'mp4'),
          job,
        );
      };
      if (by === 'quality') return encode(planVideoQuality(source, quality));

      const first = planVideoSize(source, target);
      if (first.kind === 'keep') return null;
      if (first.kind === 'tooSmall') {
        throw new RunError('targetTooSmall', {
          name: displayName(item),
          target: `${maxMB} MB`,
          mb: first.minMB,
        });
      }
      let result = await encode(first.plan);
      // 硬件编码器会略超码率：超了就按超出的比例降一点再压。
      let factor = 1;
      for (let retry = 0; result.size > target && retry < MAX_RETRIES; retry++) {
        factor *= (target / result.size) * 0.95;
        const next = planVideoSize(source, target, factor);
        if (next.kind !== 'encode') break;
        result = await encode(next.plan);
      }
      if (result.size > target) {
        throw new RunError('targetNotMet', {
          name: displayName(item),
          target: `${maxMB} MB`,
          got: `${(result.size / MB).toFixed(1)} MB`,
        });
      }
      return result;
    });
  },

  async 'video.convert'(input, _params, ctx) {
    return eachVideo(input, ctx, async (item, media, job) => {
      const info = await probe(media, item);
      const plan = planVideoConvert(sourceOf(item, info));
      checkSpace(ctx, estimate(plan, info.durationMs));
      return media.encodeVideo(
        item.uri,
        encodeOf(plan, info),
        ctx.services.runId,
        freshName(item.name, 'mp4'),
        job,
      );
    });
  },

  async 'video.trim'(input, _params, ctx) {
    const media = mediaOf(ctx);
    // 剪切界面要知道时长和宽高（分享进来的文件选择器没给）。
    const items: RunItem[] = [];
    for (const item of fileItems(input)) {
      const info = await probe(media, item);
      items.push({
        ...item,
        durationMs: info.durationMs,
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
      });
    }
    const ranges = await ctx.services.ui.open('trimMedia', {
      items,
      loadThumbnails: (i, timesMs) =>
        media.thumbnails(items[i]!.uri, timesMs, 160, ctx.services.runId),
    });
    if (!ranges) throw new RunCancelled();
    let i = 0;
    return eachVideo({ type: 'video', items }, ctx, async (item, _media, job) => {
      const range = ranges[i++];
      if (!range) return null;
      // 选了整段就不用剪。
      const whole = item.durationMs ?? 0;
      if (range.startMs <= 0 && whole > 0 && range.endMs >= whole) return null;
      checkSpace(ctx, item.size * ((range.endMs - range.startMs) / Math.max(whole, 1)));
      return media.trim(item.uri, range, ctx.services.runId, freshName(item.name, 'mp4'), job);
    });
  },
};
