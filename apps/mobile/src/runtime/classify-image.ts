import { VISION_ERRORS, type MorphVisionModule } from '../../modules/morph-vision';
import type { ImageLabel } from './platform';

// VisionPlatform.classifyImage 的 JS 部分（照片里是什么，没有文字的照片做推荐用，还没接进推荐）：
// 给原生任务一个 taskId，signal 取消时马上结束 Promise 并通知原生停下；两个平台的结果统一整理一遍。

/** 默认最多几个标签。 */
export const CLASSIFY_MAX_RESULTS = 10;
/** 默认只要不低于这个置信度的（ML Kit 自己默认 0.5，低一点留给推荐那边再定）。 */
export const CLASSIFY_MIN_CONFIDENCE = 0.1;

type NativeClassifier = Required<Pick<MorphVisionModule, 'classifyImage'>> &
  Pick<MorphVisionModule, 'cancelClassify'>;

let taskCounter = 0;

const cancelledError = () => Object.assign(new Error('Cancelled'), { code: 'cancelled' });

/** 去掉不是数字的，置信度限制在 0–1，同一个标签留最高的，从高到低，过滤门槛、截个数。 */
export function tidyLabels(
  labels: readonly { id: string; confidence: number }[],
  maxResults: number,
  minConfidence: number,
): ImageLabel[] {
  const best = new Map<string, number>();
  for (const { id, confidence } of labels) {
    if (!id || !Number.isFinite(confidence)) continue;
    const c = Math.min(1, Math.max(0, confidence));
    if (c < minConfidence) continue;
    best.set(id, Math.max(best.get(id) ?? 0, c));
  }
  return [...best]
    .map(([id, confidence]) => ({ id, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, maxResults));
}

export async function classifyImageWith(
  native: NativeClassifier,
  uri: string,
  options: { maxResults?: number; minConfidence?: number; signal?: AbortSignal } = {},
): Promise<ImageLabel[]> {
  const {
    maxResults = CLASSIFY_MAX_RESULTS,
    minConfidence = CLASSIFY_MIN_CONFIDENCE,
    signal,
  } = options;
  if (signal?.aborted) throw cancelledError();
  const taskId = `classify-${Date.now()}-${++taskCounter}`;
  const work = native.classifyImage(taskId, uri, { maxResults, minConfidence }).catch((e) => {
    throw (e as { code?: string }).code === VISION_ERRORS.cancelled ? cancelledError() : e;
  });
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      native.cancelClassify?.(taskId);
      reject(cancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const { labels } = await Promise.race([work, aborted]);
    return tidyLabels(labels, maxResults, minConfidence);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // 取消以后原生那边晚到的结果或错误没人再等。
    work.catch(() => undefined);
  }
}
