import { classifyImageWith, tidyLabels } from '../runtime/classify-image';

// 原生图像分类的 JS 部分：取消时 Promise 一定结束（原生那边可能一直不回），两个平台的结果统一整理。

/** 假的原生模块：classifyImage 一直挂着，直到测试自己 resolve / reject。 */
function hangingNative() {
  const pending: {
    taskId: string;
    resolve: (v: {
      labels: { id: string; confidence: number }[];
      width: number;
      height: number;
    }) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const cancelled: string[] = [];
  const options: unknown[] = [];
  return {
    pending,
    cancelled,
    options,
    native: {
      classifyImage: (
        taskId: string,
        _uri: string,
        o: { maxResults: number; minConfidence: number },
      ) =>
        new Promise<{
          labels: { id: string; confidence: number }[];
          width: number;
          height: number;
        }>((resolve, reject) => {
          options.push(o);
          pending.push({ taskId, resolve, reject });
        }),
      cancelClassify: (taskId: string) => {
        cancelled.push(taskId);
      },
    },
  };
}

describe('classifyImageWith', () => {
  it('passes the defaults and returns tidy labels', async () => {
    const fake = hangingNative();
    const result = classifyImageWith(fake.native, 'file:///cache/runs/r1/photo.jpg');
    expect(fake.options).toEqual([{ maxResults: 10, minConfidence: 0.1 }]);
    fake.pending[0]!.resolve({
      labels: [
        { id: 'Paper', confidence: 0.4 },
        { id: 'Selfie', confidence: 0.92 },
      ],
      width: 768,
      height: 1024,
    });
    expect(await result).toEqual([
      { id: 'Selfie', confidence: 0.92 },
      { id: 'Paper', confidence: 0.4 },
    ]);
  });

  it('ends the promise as soon as the signal aborts, even if the native task never answers', async () => {
    const fake = hangingNative();
    const controller = new AbortController();
    const result = classifyImageWith(fake.native, 'file:///photo.heic', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    // 也通知原生停下，用的是这次的 taskId。
    expect(fake.cancelled).toEqual([fake.pending[0]!.taskId]);
    // 原生晚到的错误没人等，不会变成未处理的 Promise 错误。
    fake.pending[0]!.reject(
      Object.assign(new Error('Cancelled'), { code: 'ERR_VISION_CANCELLED' }),
    );
  });

  it('does not start the native task when the signal is already aborted', async () => {
    const fake = hangingNative();
    const controller = new AbortController();
    controller.abort();
    await expect(
      classifyImageWith(fake.native, 'file:///photo.jpg', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fake.pending).toHaveLength(0);
  });

  it('turns the native cancelled code into cancelled and keeps other errors', async () => {
    const fake = hangingNative();
    const first = classifyImageWith(fake.native, 'file:///a.jpg');
    fake.pending[0]!.reject(
      Object.assign(new Error('Cancelled'), { code: 'ERR_VISION_CANCELLED' }),
    );
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });

    const second = classifyImageWith(fake.native, 'content://media/external/images/1');
    fake.pending[1]!.reject(new Error('Vision failed: unreadable image'));
    await expect(second).rejects.toThrow('unreadable image');
  });

  it('gives every task its own id, and an abort after the answer changes nothing', async () => {
    const fake = hangingNative();
    const controller = new AbortController();
    const a = classifyImageWith(fake.native, 'file:///a.jpg', { signal: controller.signal });
    const b = classifyImageWith(fake.native, 'file:///b.jpg');
    expect(fake.pending[0]!.taskId).not.toBe(fake.pending[1]!.taskId);
    fake.pending[0]!.resolve({ labels: [], width: 1, height: 1 });
    expect(await a).toEqual([]);
    controller.abort();
    expect(fake.cancelled).toEqual([]);
    fake.pending[1]!.resolve({ labels: [], width: 1, height: 1 });
    await b;
  });
});

describe('tidyLabels', () => {
  it('clamps, drops bad values, keeps the best of duplicates, sorts and limits', () => {
    expect(
      tidyLabels(
        [
          { id: 'document', confidence: 0.5 },
          { id: 'document', confidence: 0.7 },
          { id: 'people', confidence: 1.3 },
          { id: 'food', confidence: Number.NaN },
          { id: '', confidence: 0.9 },
          { id: 'sky', confidence: 0.05 },
          { id: 'screenshot', confidence: 0.3 },
        ],
        2,
        0.1,
      ),
    ).toEqual([
      { id: 'people', confidence: 1 },
      { id: 'document', confidence: 0.7 },
    ]);
  });
});
