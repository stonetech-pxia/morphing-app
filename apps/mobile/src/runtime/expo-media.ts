import { Directory, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import MorphMedia, { type MediaResult } from '../../modules/morph-media';
import type { MediaInfo, MediaJob, MediaOutput, MediaPlatform } from './platform';

// MediaPlatform 的实现：本地 Expo 模块 MorphMedia（iOS AVFoundation、Android Media3，D-141）。
// 没有这个模块（Expo Go）时为 null。处理期间屏幕不灭：iOS 不让后台用视频编码器（D-148）。

/** 多久看一次「停止」。 */
const CANCEL_POLL_MS = 200;

let jobCounter = 0;

const extOf = (uri: string) => /\.([^./]+)$/.exec(uri)?.[1]?.toLowerCase() ?? '';

function output(result: MediaResult): MediaOutput {
  return {
    uri: result.uri,
    ext: extOf(result.uri),
    size: result.size,
    info: result.info as MediaInfo,
  };
}

export function expoMedia(
  runFileUri: (runId: string, relPath: string) => string,
): MediaPlatform | null {
  const native = MorphMedia;
  if (!native) return null;

  /** 跑一个原生任务：转发进度，轮询取消，期间屏幕不灭。 */
  async function run<T>(job: MediaJob, start: (jobId: string) => Promise<T>): Promise<T> {
    const jobId = `media-${Date.now()}-${++jobCounter}`;
    const subscription = native!.addListener('progress', (event) => {
      if (event.jobId === jobId) job.progress(event.progress);
    });
    const timer = setInterval(() => {
      if (job.isCancelled()) native!.cancel(jobId);
    }, CANCEL_POLL_MS);
    await activateKeepAwakeAsync(jobId).catch(() => undefined);
    try {
      return await start(jobId);
    } finally {
      clearInterval(timer);
      subscription.remove();
      void deactivateKeepAwake(jobId).catch(() => undefined);
    }
  }

  return {
    probe: async (uri) => (await native.probe(uri)) as MediaInfo,

    async encodeVideo(uri, settings, runId, relPath, job) {
      const out = runFileUri(runId, relPath);
      const result = await run(job, (jobId) =>
        native.transcode(jobId, uri, out, {
          container: 'mp4',
          video: {
            codec: 'h264',
            bitrateKbps: settings.videoKbps,
            maxFps: settings.maxFps,
            toSdr: true,
            ...(settings.shortSide ? { maxShortSide: settings.shortSide } : {}),
          },
          audio:
            settings.audioKbps > 0 ? { codec: 'aac', bitrateKbps: settings.audioKbps } : 'drop',
          ...(settings.range ? { range: settings.range } : {}),
        }),
      );
      return output(result);
    },

    async trim(uri, range, runId, relPath, job) {
      const out = runFileUri(runId, relPath);
      return output(await run(job, (jobId) => native.trim(jobId, uri, out, range)));
    },

    async thumbnails(uri, timesMs, maxSide, runId) {
      const dir = new Directory(Paths.cache, 'runs', runId, 'frames');
      dir.create({ idempotent: true, intermediates: true });
      return native.thumbnails(uri, timesMs, maxSide, dir.uri);
    },
  };
}
