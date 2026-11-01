import { PREFILL_MODEL_PACK } from '@morph/core';
import * as Device from 'expo-device';

import type { PackStore } from '../packs/store';
import { MODEL_MIN_MEMORY, deviceFitsLocalModel, openLocalModel } from '../runtime/local-model';

// 本机模型在手机上怎么开、怎么关（D-396）：没装、内存不够就不加载；用完释放，还在生成时先停再释放。
// 这里的 llama.rn 是假的；真的 llama.rn 只有模拟器和真机上能验证。

jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 * 1024 * 1024 }));
jest.mock('../packs/expo-pack-fs', () => ({ expoPackFs: { uri: (p: string) => `file:///${p}` } }));

const order: string[] = [];
let finishCompletion: ((r: { text: string }) => void) | null = null;
const context = {
  completion: jest.fn(
    () =>
      new Promise<{ text: string }>((resolve) => {
        finishCompletion = resolve;
      }),
  ),
  stopCompletion: jest.fn(async () => {
    order.push('stop');
    finishCompletion?.({ text: '' });
  }),
  release: jest.fn(async () => {
    order.push('release');
  }),
};
const mockInit = jest.fn(async (_params: { model: string; n_ctx: number }) => context);
jest.mock('llama.rn', () => ({ initLlama: (p: { model: string; n_ctx: number }) => mockInit(p) }));

const store = (installed: boolean) =>
  ({
    isInstalled: async (id: string) => installed && id === PREFILL_MODEL_PACK,
    path: (id: string, file: string) => `${id}/1.0.0/${file}`,
  }) as unknown as PackStore;
const request = {
  prompt: 'p',
  grammar: 'g',
  temperature: 0,
  seed: 42,
  nPredict: 120,
  stop: ['\n'],
};
const setMemory = (bytes: number | null) => {
  (Device as { totalMemory: number | null }).totalMemory = bytes;
};

describe('本机模型（D-396）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    order.length = 0;
    finishCompletion = null;
    setMemory(8 * 1024 * 1024 * 1024);
  });

  it('没下载：不加载，给 null', async () => {
    await expect(openLocalModel(store(false))(new AbortController().signal)).resolves.toBeNull();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('内存不够：不加载，给 null', async () => {
    setMemory(MODEL_MIN_MEMORY - 1);
    expect(deviceFitsLocalModel()).toBe(false);
    await expect(openLocalModel(store(true))(new AbortController().signal)).resolves.toBeNull();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('加载扩展包里的文件，只用 CPU，上下文和 core 截断文字的长度一样', async () => {
    await openLocalModel(store(true))(new AbortController().signal);
    expect(mockInit.mock.calls[0]![0]).toMatchObject({
      model: `file:///${PREFILL_MODEL_PACK}/1.0.0/Qwen3.5-0.8B-Q4_K_M.gguf`,
      n_ctx: 4096,
      n_gpu_layers: 0,
    });
  });

  it('没在生成时 stopCompletion 什么都不返回（真的 llama.rn 就这样）：照样释放，下一次还能加载', async () => {
    context.stopCompletion.mockImplementationOnce(() => undefined as unknown as Promise<void>);
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    await session.release();
    expect(context.release).toHaveBeenCalledTimes(1);
    await expect(open(new AbortController().signal)).resolves.not.toBeNull();
  });

  it('释放失败也不挡下一次加载', async () => {
    context.release.mockImplementationOnce(() => Promise.reject(new Error('busy')));
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    await session.release();
    await expect(open(new AbortController().signal)).resolves.not.toBeNull();
  });

  it('加载期间取消了：加载完马上释放，给 null', async () => {
    const abort = new AbortController();
    mockInit.mockImplementationOnce(async () => {
      abort.abort();
      return context;
    });
    await expect(openLocalModel(store(true))(abort.signal)).resolves.toBeNull();
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('取消：通知原生停下，Promise 结束', async () => {
    const session = (await openLocalModel(store(true))(new AbortController().signal))!;
    const abort = new AbortController();
    const run = session.generate(request, abort.signal);
    abort.abort();
    await expect(run).resolves.toBe('');
    expect(context.stopCompletion).toHaveBeenCalled();
  });

  it('释放：还在生成时先停再释放；下一次加载等释放完', async () => {
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    void session.generate(request, new AbortController().signal);
    const released = session.release();
    const next = open(new AbortController().signal);
    await released;
    await next;
    expect(order).toEqual(['stop', 'release']);
    expect(mockInit).toHaveBeenCalledTimes(2);
  });
});
