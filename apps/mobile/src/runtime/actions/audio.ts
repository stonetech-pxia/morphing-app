import {
  RunCancelled,
  RunError,
  SPEECH_LANGUAGE_NAMES,
  audioSourceKbps,
  planAudioConvert,
  planAudioQuality,
  planAudioSize,
  estimateAudioBytes,
  planVideoConvert,
  speechToSrt,
  type ActionImpl,
  type AudioFormat,
  type AudioPlan,
  type AudioQuality,
  type AudioSource,
  type RunItem,
  type RunValue,
  type SpeechLanguage,
  type SpeechModel,
} from '@morph/core';

import { t } from '../../i18n';
import type { MediaInfo, MediaOutput, MediaPlatform } from '../platform';
import { SpeechError } from '../speech';
import { MB, displayName, fileItems, freshName, writeItem, type RunServices } from './helpers';
import { checkSpace, mediaError } from './video';

// 音频工具的动作实现（D-150–D-155）：码率、声道在 core/audio.ts 里算，编码交给原生模块 morph-media，
// 语音转文字交给 morph-speech（iOS 系统识别，Android whisper.cpp）。识别出的文字只留在本机（D-036）。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

/** 压完还超过目标时最多再压几次。 */
const MAX_RETRIES = 2;
/** 剪一段界面的波形有多少根。 */
const WAVEFORM_BUCKETS = 120;

const audioMime = (ext: string) =>
  ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

function mediaOf(ctx: Ctx): MediaPlatform {
  const media = ctx.services.files.media;
  if (!media) throw new RunError('needsFullApp');
  return media;
}

async function probeAudio(media: MediaPlatform, item: RunItem): Promise<MediaInfo> {
  let info: MediaInfo;
  try {
    info = await media.probe(item.uri);
  } catch (e) {
    throw mediaError(e, item);
  }
  if (!info.hasAudio) {
    throw new RunError(info.hasVideo ? 'noAudio' : 'mediaUnsupported', { name: displayName(item) });
  }
  return info;
}

const sourceOf = (item: RunItem, info: MediaInfo): AudioSource => ({
  durationMs: info.durationMs || item.durationMs || 0,
  size: info.hasVideo ? 0 : info.size || item.size,
  ...(info.channels ? { channels: info.channels } : {}),
  ...(info.sampleRate ? { sampleRate: info.sampleRate } : {}),
  ...(info.audioBitrateKbps ? { kbps: info.audioBitrateKbps } : {}),
});

const encodeOf = (plan: AudioPlan, range?: { startMs: number; endMs: number }) => ({
  format: plan.format,
  bitrateKbps: plan.bitrateKbps,
  channels: plan.channels,
  sampleRate: plan.sampleRate,
  ...(range ? { range } : {}),
});

const audioItem = (item: RunItem, result: MediaOutput, name = item.name): RunItem => ({
  uri: result.uri,
  name,
  ext: result.ext || 'm4a',
  mimeType: audioMime(result.ext),
  size: result.size,
  durationMs: result.info.durationMs,
  ...(item.takenAt !== undefined ? { takenAt: item.takenAt } : {}),
});

/** 一个任务：进度按全部文件合起来的百分比报，只增不减；取消看运行页的「停止」。 */
function jobFor(ctx: Ctx, index: number, total: number) {
  let shown = 0;
  return {
    progress: (f: number) => {
      shown = Math.max(shown, Math.min(1, f));
      ctx.progress(Math.round(((index + shown) / total) * 100), 100, 'percent');
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
}

/** 逐个处理音频（或视频的声音）。work 返回新的临时文件，或 null（原样交给下一步）。 */
async function eachAudio(
  input: RunValue | null,
  ctx: Ctx,
  work: (
    item: RunItem,
    info: MediaInfo,
    media: MediaPlatform,
    job: ReturnType<typeof jobFor>,
  ) => Promise<MediaOutput | null>,
): Promise<RunValue> {
  const items = fileItems(input);
  const media = mediaOf(ctx);
  const out: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    ctx.throwIfCancelled();
    const job = jobFor(ctx, i, items.length);
    job.progress(0);
    const info = await probeAudio(media, item);
    let result: MediaOutput | null;
    try {
      result = await work(item, info, media, job);
    } catch (e) {
      throw mediaError(e, item);
    }
    out.push(result ? audioItem(item, result) : item);
  }
  ctx.progress(100, 100, 'percent');
  return { type: 'audio', items: out };
}

/** 已经是这种格式（M4A 里是 AAC、WAV 或 MP3）：不用再转。 */
function alreadyIn(item: RunItem, info: MediaInfo, format: AudioFormat): boolean {
  if (info.hasVideo) return false;
  if (format === 'wav') return item.ext === 'wav';
  if (format === 'mp3') return item.ext === 'mp3';
  return item.ext === 'm4a' && /^(aac|mp4a)/i.test(info.audioCodec ?? '');
}

/** 语音转文字的错误 → 给用户看的错误。 */
function speechError(e: unknown, item: RunItem, ctx: Ctx, language: SpeechLanguage): Error {
  if (e instanceof RunError || e instanceof RunCancelled) return e;
  const { locale } = ctx;
  const lang = SPEECH_LANGUAGE_NAMES[language][locale];
  if (!(e instanceof SpeechError)) {
    return new RunError('unexpected', { detail: String((e as Error)?.message ?? e) });
  }
  switch (e.code) {
    case 'cancelled':
      return new RunCancelled();
    case 'unreadableAudio':
      return new RunError('mediaUnsupported', { name: displayName(item) });
    case 'notAuthorized':
      return new RunError('permissionDenied', { what: 'speech' });
    case 'unsupportedLanguage':
      return new RunError('unsupportedAction', {
        action: t(locale, 'speechLangUnsupported', { lang }),
      });
    case 'unavailable':
      return new RunError('unsupportedAction', { action: t(locale, 'speechUnavailable') });
    case 'needsDownload':
    case 'model':
      return new RunError('packFailed', { detail: t(locale, 'speechDownloadFailed', { lang }) });
    default:
      return new RunError('unexpected', { detail: e.message });
  }
}

async function prepareSpeech(ctx: Ctx, language: SpeechLanguage, model: SpeechModel) {
  const { locale } = ctx;
  const speech = ctx.services.files.speech;
  if (!speech) throw new RunError('needsFullApp');
  const lang = SPEECH_LANGUAGE_NAMES[language][locale];

  const need = await speech.need(language, model);
  if (need.kind === 'unsupported') {
    throw new RunError('unsupportedAction', {
      action: t(locale, 'speechLangUnsupported', { lang }),
    });
  }
  // iPhone：系统要先下载这种语言的识别模型，下载前问一句（D-064、D-112）。
  if (need.kind === 'systemDownload') {
    const ok = await ctx.services.ui.confirm(
      t(locale, 'speechDownloadAsk', { lang }),
      t(locale, 'speechDownload'),
      t(locale, 'cancel'),
      t(locale, 'speechDownloadBody'),
    );
    if (!ok) throw new RunCancelled();
    try {
      await speech.prepare(language, (f) => ctx.progress(Math.round(f * 100), 100, 'percent'));
    } catch {
      throw new RunError('packFailed', { detail: t(locale, 'speechDownloadFailed', { lang }) });
    }
  }
  // Android：模型由执行器在这一步之前按 packFor 确认下载；还没有说明下载失败了。
  if (need.kind === 'pack') {
    throw new RunError('packFailed', { detail: t(locale, 'speechDownloadFailed', { lang }) });
  }

  return speech;
}

async function processSound(
  input: Parameters<Impl>[0],
  params: Parameters<Impl>[1],
  ctx: Ctx,
  denoise: boolean,
): Promise<RunValue> {
  if (!input || (input.type !== 'audio' && input.type !== 'video'))
    throw new RunError('wrongType', { kind: 'audio/video' });
  const media = mediaOf(ctx);
  const out: RunItem[] = [];
  for (const [i, item] of input.items.entries()) {
    ctx.throwIfCancelled();
    const info = await probeAudio(media, item);
    const video =
      input.type === 'video'
        ? planVideoConvert({
            durationMs: info.durationMs,
            size: item.size,
            hasAudio: info.hasAudio,
            width: info.width,
            height: info.height,
            videoKbps: info.videoBitrateKbps,
          })
        : undefined;
    const pcmBytes =
      (info.durationMs / 1000) *
      Math.max(48000 * 2 * 4, (info.sampleRate ?? 48000) * (info.channels ?? 2) * 2);
    checkSpace(
      ctx,
      pcmBytes +
        (video
          ? ((video.videoKbps + video.audioKbps) * info.durationMs) / 8
          : info.durationMs * 24),
    );
    let shown = 0;
    try {
      const result = await (denoise ? media.denoise.bind(media) : media.volume.bind(media))(
        item.uri,
        {
          automatic: params.mode === 'normal',
          db: Number(params.db ?? 0),
          ...(video
            ? {
                video: {
                  videoKbps: video.videoKbps,
                  audioKbps: video.audioKbps,
                  maxFps: video.maxFps,
                },
              }
            : {}),
        },
        ctx.services.runId,
        freshName(item.name, video ? 'mp4' : 'm4a'),
        {
          progress: (f) => {
            shown = Math.max(shown, Math.min(1, f));
            ctx.progress(Math.round(((i + shown) / input.items.length) * 100), 100, 'percent');
          },
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
      out.push({
        ...item,
        uri: result.uri,
        ext: result.ext,
        mimeType: video ? 'video/mp4' : 'audio/mp4',
        size: result.size,
        durationMs: result.info.durationMs,
        ...(result.info.width ? { width: result.info.width } : {}),
        ...(result.info.height ? { height: result.info.height } : {}),
      });
    } catch (e) {
      throw mediaError(e, item);
    }
  }
  ctx.throwIfCancelled();
  return { type: input.type, items: out };
}

export const AUDIO_IMPLS: Record<string, Impl> = {
  async 'video.subtitles'(input, params, ctx) {
    if (input?.type !== 'video') throw new RunError('wrongType', { kind: 'video' });
    const language = params.lang as SpeechLanguage;
    const model = params.model as SpeechModel;
    const speech = await prepareSpeech(ctx, language, model);
    const media = mediaOf(ctx);
    const out: RunItem[] = [];
    for (const [i, item] of input.items.entries()) {
      ctx.throwIfCancelled();
      const info = await probeAudio(media, item);
      checkSpace(
        ctx,
        (info.durationMs / 1000) *
          Math.max(48000 * 2 * 4, (info.sampleRate ?? 48000) * (info.channels ?? 2) * 2),
      );
      const job = jobFor(ctx, i, input.items.length);
      let audio: MediaOutput;
      try {
        audio = await media.speechAudio(
          item.uri,
          ctx.services.runId,
          freshName(`${item.name}-speech`, 'wav'),
          { isCancelled: job.isCancelled, progress: (f) => job.progress(f * 0.2) },
        );
      } catch (error) {
        throw mediaError(error, item);
      }
      ctx.throwIfCancelled();
      let segments;
      try {
        ({ segments } = await speech.transcribe(audio.uri, {
          language,
          model,
          timed: true,
          onProgress: (f) => job.progress(0.2 + f * 0.8),
          isCancelled: job.isCancelled,
        }));
      } catch (error) {
        throw speechError(error, item, ctx, language);
      }
      if (!segments)
        throw new RunError('unsupportedAction', { action: t(ctx.locale, 'subtitlesNeedApp') });
      const srt = speechToSrt(segments, language, info.durationMs);
      if (!srt) throw new RunError('noSpeech', { name: displayName(item) });
      ctx.throwIfCancelled();
      out.push(
        await writeItem(ctx.services, new TextEncoder().encode(srt), {
          name: item.name,
          ext: 'srt',
          mimeType: 'application/x-subrip',
        }),
      );
    }
    ctx.progress(100, 100, 'percent');
    return { type: 'files', items: out };
  },

  'audio.volume': (input, params, ctx) => processSound(input, params, ctx, false),
  'audio.denoise': (input, params, ctx) => processSound(input, params, ctx, true),
  async 'audio.compress'(input, params, ctx) {
    const { by, maxMB, quality } = params as {
      by: 'size' | 'quality';
      maxMB: number;
      quality: AudioQuality;
    };
    const target = maxMB * MB;
    return eachAudio(input, ctx, async (item, info, media, job) => {
      const source = sourceOf(item, info);
      const encode = (plan: AudioPlan) => {
        checkSpace(ctx, estimateAudioBytes(plan, source.durationMs));
        return media.encodeAudio(
          item.uri,
          encodeOf(plan),
          ctx.services.runId,
          freshName(item.name, 'm4a'),
          job,
        );
      };
      if (by === 'quality') return encode(planAudioQuality(source, quality));

      const first = planAudioSize(source, target);
      if (first.kind === 'keep') return null;
      if (first.kind === 'tooSmall') {
        throw new RunError('audioTooSmall', {
          name: displayName(item),
          target: `${maxMB} MB`,
          mb: first.minMB,
        });
      }
      let result = await encode(first.plan);
      // 编码器会略超码率：超了就按超出的比例降一点再压。
      let factor = 1;
      for (let retry = 0; result.size > target && retry < MAX_RETRIES; retry++) {
        factor *= (target / result.size) * 0.95;
        const next = planAudioSize(source, target, factor);
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

  async 'audio.convert'(input, params, ctx) {
    const format = params.format as AudioFormat;
    return eachAudio(input, ctx, async (item, info, media, job) => {
      if (alreadyIn(item, info, format)) return null;
      const plan = planAudioConvert(sourceOf(item, info), format);
      checkSpace(ctx, estimateAudioBytes(plan, info.durationMs));
      return media.encodeAudio(
        item.uri,
        encodeOf(plan),
        ctx.services.runId,
        freshName(item.name, format),
        job,
      );
    });
  },

  async 'audio.fromVideo'(input, params, ctx) {
    const format = params.format as AudioFormat;
    return eachAudio(input, ctx, async (item, info, media, job) => {
      const plan = planAudioConvert(sourceOf(item, info), format);
      checkSpace(ctx, estimateAudioBytes(plan, info.durationMs));
      return media.encodeAudio(
        item.uri,
        encodeOf(plan),
        ctx.services.runId,
        freshName(item.name, format),
        job,
      );
    });
  },

  async 'audio.trim'(input, _params, ctx) {
    const media = mediaOf(ctx);
    // 剪切界面要知道时长（分享进来的文件选择器没给）；波形由界面打开后再读。
    const items: RunItem[] = [];
    const infos: MediaInfo[] = [];
    for (const item of fileItems(input)) {
      const info = await probeAudio(media, item);
      infos.push(info);
      items.push({ ...item, durationMs: info.durationMs });
    }
    const ranges = await ctx.services.ui.open('trimMedia', {
      items,
      loadWaveform: (i) => media.waveform(items[i]!.uri, WAVEFORM_BUCKETS),
    });
    if (!ranges) throw new RunCancelled();
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      const range = ranges[i];
      const whole = item.durationMs ?? 0;
      // 选了整段就不用剪。
      if (!range || (range.startMs <= 0 && whole > 0 && range.endMs >= whole)) {
        out.push(item);
        continue;
      }
      // 重新编码成 M4A：哪种格式都能剪，准确到毫秒（不重新编码的剪切只适合 M4A，开头会对不准）。
      const plan = planAudioConvert(sourceOf(item, infos[i]!), 'm4a');
      checkSpace(ctx, estimateAudioBytes(plan, range.endMs - range.startMs));
      let result: MediaOutput;
      try {
        result = await media.encodeAudio(
          item.uri,
          encodeOf(plan, range),
          ctx.services.runId,
          freshName(item.name, 'm4a'),
          jobFor(ctx, i, items.length),
        );
      } catch (e) {
        throw mediaError(e, item);
      }
      out.push(audioItem(item, result));
    }
    ctx.progress(100, 100, 'percent');
    return { type: 'audio', items: out };
  },

  async 'audio.merge'(input, _params, ctx) {
    const items = fileItems(input);
    if (items.length <= 1) return input!;
    const media = mediaOf(ctx);
    const infos: MediaInfo[] = [];
    for (const item of items) infos.push(await probeAudio(media, item));
    const sources = items.map((item, i) => sourceOf(item, infos[i]!));
    const durationMs = sources.reduce((sum, s) => sum + s.durationMs, 0);
    // 有一段是立体声就用立体声；码率按最好的那段（最高 192 kbps）。Android 读 M4A 常常没有码率，
    // 按大小和时长算（否则两段语音备忘会按 128 kbps 合成，变大好几倍）。
    const plan = planAudioConvert(
      {
        durationMs,
        size: 0,
        channels: Math.max(...sources.map((s) => s.channels ?? 2)),
        kbps: Math.max(...sources.map((s) => audioSourceKbps(s) || 128)),
      },
      'm4a',
    );
    checkSpace(ctx, estimateAudioBytes(plan, durationMs));
    const first = items[0]!;
    const name = t(ctx.locale, 'audioMerged', { name: first.name, n: items.length - 1 });
    let result: MediaOutput;
    try {
      result = await media.concatAudio(
        items.map((it) => it.uri),
        encodeOf(plan),
        ctx.services.runId,
        freshName(name, 'm4a'),
        jobFor(ctx, 0, 1),
      );
    } catch (e) {
      throw mediaError(e, first);
    }
    ctx.progress(100, 100, 'percent');
    return { type: 'audio', items: [audioItem(first, result, name)] };
  },

  async 'audio.transcribe'(input, params, ctx) {
    const items = fileItems(input);
    const language = params.lang as SpeechLanguage;
    const model = params.model as SpeechModel;
    const speech = await prepareSpeech(ctx, language, model);

    const parts: { name: string; text: string }[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      const job = jobFor(ctx, i, items.length);
      job.progress(0);
      let text: string;
      try {
        ({ text } = await speech.transcribe(item.uri, {
          language,
          model,
          onProgress: job.progress,
          isCancelled: job.isCancelled,
        }));
      } catch (e) {
        throw speechError(e, item, ctx, language);
      }
      if (text.trim()) parts.push({ name: displayName(item), text: text.trim() });
    }
    if (parts.length === 0) throw new RunError('noSpeech', { name: displayName(items[0]!) });
    ctx.progress(100, 100, 'percent');
    // 几段录音时每段前面写上文件名。文字只留在本机：复制、存成文件、排成 PDF，绝不发给 AI。
    const text =
      items.length === 1
        ? parts[0]!.text
        : parts.map((p) => `【${p.name}】\n${p.text}`).join('\n\n');
    return { type: 'text', text, name: items[0]!.name };
  },
};
