import { modelEngine, PREFILL_MODEL_PACK } from '@morph/core';
import * as Device from 'expo-device';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
let mockNoNative = false;
const mockOcrUnload = jest.fn(async () => undefined);
jest.mock('../../modules/morph-vision', () => ({
  __esModule: true,
  default: { ocrUnload: () => mockOcrUnload() },
}));
jest.mock('llama.rn', () => ({
  get initLlama() {
    if (mockNoNative) throw new Error('no native module');
    return (p: { model: string; n_ctx: number }) => mockInit(p);
  },
}));

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

describe('加载模型前先放掉文字识别的内存', () => {
  it('文字识别的模型先释放，再加载本机模型', async () => {
    mockOcrUnload.mockClear();
    mockInit.mockClear();
    const session = await openLocalModel(store(true))(new AbortController().signal);
    expect(mockOcrUnload.mock.invocationCallOrder[0]).toBeLessThan(
      mockInit.mock.invocationCallOrder[0]!,
    );
    await session?.release();
  });

  it('释放失败也照样加载', async () => {
    mockOcrUnload.mockImplementationOnce(() => Promise.reject(new Error('busy')));
    const session = await openLocalModel(store(true))(new AbortController().signal);
    expect(session).not.toBeNull();
    await session?.release();
  });

  it('没装模型时不动文字识别', async () => {
    mockOcrUnload.mockClear();
    await openLocalModel(store(false))(new AbortController().signal);
    expect(mockOcrUnload).not.toHaveBeenCalled();
  });
});

describe('识别出的文字不进系统日志（底线 1、2）', () => {
  it('llama.rn 不打印提示词的 token；Android 从源码编译，补丁才生效', () => {
    const root = join(__dirname, '../../../..');
    const completion = readFileSync(
      join(root, 'node_modules/llama.rn/cpp/rn-completion.cpp'),
      'utf8',
    );
    expect(completion).not.toContain('": prompt_tokens = "');
    const app = readFileSync(join(root, 'apps/mobile/app.json'), 'utf8');
    expect(app).toContain('./plugins/with-llama-from-source');
  });
});

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
    const session = await openLocalModel(store(true))(new AbortController().signal);
    await session?.release();
    expect(mockInit.mock.calls[0]![0]).toMatchObject({
      model: `file:///${PREFILL_MODEL_PACK}/1.0.0/Qwen3.5-2B-Q4_K_M.gguf`,
      no_extra_bufts: true,
      n_ctx: 4096,
      n_gpu_layers: 0,
    });
  });

  it.each([
    ['内存大的手机：重排权重，快', 11 * 1024 * 1024 * 1024, false],
    ['正好 10 GB：重排', 10 * 1024 * 1024 * 1024, false],
    ['内存小的手机：不重排，省内存', 8 * 1024 * 1024 * 1024, true],
    ['拿不到内存：按小的算', null, true],
  ])('%s', async (_name, bytes, expected) => {
    setMemory(bytes);
    const session = await openLocalModel(store(true))(new AbortController().signal);
    await session?.release();
    expect(mockInit.mock.calls.at(-1)![0]).toMatchObject({ no_extra_bufts: expected });
    setMemory(8 * 1024 * 1024 * 1024);
  });

  it('没在生成时 stopCompletion 什么都不返回（真的 llama.rn 就这样）：照样释放，下一次还能加载', async () => {
    context.stopCompletion.mockImplementationOnce(() => undefined as unknown as Promise<void>);
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    await session.release();
    expect(context.release).toHaveBeenCalledTimes(1);
    const next = await open(new AbortController().signal);
    expect(next).not.toBeNull();
    await next?.release();
  });

  it('释放失败也不挡下一次加载', async () => {
    context.release.mockImplementationOnce(() => Promise.reject(new Error('busy')));
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    await session.release();
    const next = await open(new AbortController().signal);
    expect(next).not.toBeNull();
    await next?.release();
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
    await session.release();
  });

  it('释放：还在生成时先停再释放；下一次加载等释放完', async () => {
    const open = openLocalModel(store(true));
    const session = (await open(new AbortController().signal))!;
    void session.generate(request, new AbortController().signal);
    const released = session.release();
    const next = open(new AbortController().signal);
    await released;
    const second = await next;
    expect(order).toEqual(['stop', 'release']);
    expect(mockInit).toHaveBeenCalledTimes(2);
    await second?.release();
  });

  describe('任何时候最多一个模型在加载或在内存里', () => {
    // 假的加载：要等测试放行；数着同时有几个（加载中 + 没释放的）。
    let live = 0;
    let peak = 0;
    let loads: (() => void)[] = [];
    const loadOne = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise<void>((resolve) => loads.push(resolve));
      return {
        ...context,
        release: jest.fn(async () => {
          await Promise.resolve();
          live--;
        }),
      };
    };
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    /** 放行正在加载的，直到 done 结束。 */
    const finishLoads = async (done: Promise<unknown>) => {
      let over = false;
      void done.finally(() => {
        over = true;
      });
      for (let i = 0; i < 200 && !over; i++) {
        loads.shift()?.();
        await settle();
      }
      expect(over).toBe(true);
    };

    beforeEach(() => {
      live = 0;
      peak = 0;
      loads = [];
      mockInit.mockImplementation(loadOne as never);
    });
    afterEach(() => {
      mockInit.mockImplementation(async () => context);
    });

    it('加载中取消再开：等上一个加载完、释放完才加载下一个', async () => {
      const open = openLocalModel(store(true));
      const a = new AbortController();
      const first = open(a.signal);
      await settle();
      expect(mockInit).toHaveBeenCalledTimes(1);
      a.abort();
      const second = open(new AbortController().signal);
      await settle();
      expect(mockInit).toHaveBeenCalledTimes(1);
      await finishLoads(Promise.all([first, second]));
      await expect(first).resolves.toBeNull();
      const session = await second;
      expect(session).not.toBeNull();
      expect(mockInit).toHaveBeenCalledTimes(2);
      expect(peak).toBe(1);
      await session?.release();
      expect(live).toBe(0);
    });

    it('连续开关多次：中间取消的不加载，只留最后一个，同时只有一个', async () => {
      const open = openLocalModel(store(true));
      const runs: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        const stop = new AbortController();
        runs.push(open(stop.signal));
        await settle();
        stop.abort();
      }
      const lastRun = open(new AbortController().signal);
      await finishLoads(Promise.all([...runs, lastRun]));
      const session = await lastRun;
      expect(session).not.toBeNull();
      expect(peak).toBe(1);
      // 第一个已经在加载，取消的轮到时不再加载，最后一个加载。
      expect(mockInit).toHaveBeenCalledTimes(2);
      await session?.release();
      expect(live).toBe(0);
    });

    it('关了表单马上开新的：上一个还在生成时也等它释放完', async () => {
      const open = openLocalModel(store(true));
      const opening = open(new AbortController().signal);
      await finishLoads(opening);
      const session = (await opening)!;
      void session.generate(request, new AbortController().signal);
      const released = session.release();
      const next = open(new AbortController().signal);
      await finishLoads(Promise.all([released, next]));
      expect(peak).toBe(1);
      await (await next)?.release();
    });

    it('通过引擎走：加载中取消马上给结果，新的一次等上一个释放，同时只有一个', async () => {
      context.completion.mockImplementationOnce(async () => ({ text: 'null' }));
      const engine = modelEngine(openLocalModel(store(true)));
      const input = {
        // 公司字段规则有候选也问模型（店名有候选就不问了，D-404）。
        fields: [{ id: 'merchant', name: 'Company', type: 'text' as const }],
        pages: [
          {
            width: 100,
            height: 100,
            lines: [{ text: 'Acme Coffee', x: 0, y: 0, width: 50, height: 10 }],
          },
        ],
        locale: 'en' as const,
      };
      const a = new AbortController();
      const first = engine(input, a.signal);
      await settle();
      a.abort();
      await first; // 取消一定要让 Promise 结束，不等加载。
      const second = engine(input, new AbortController().signal);
      await settle();
      expect(mockInit).toHaveBeenCalledTimes(1);
      await finishLoads(second);
      await settle();
      expect(peak).toBe(1);
      expect(live).toBe(0);
    });

    it('加载失败也不挡下一个', async () => {
      mockInit.mockImplementationOnce(() => Promise.reject(new Error('no memory')));
      const open = openLocalModel(store(true));
      await expect(open(new AbortController().signal)).rejects.toThrow('no memory');
      const next = open(new AbortController().signal);
      await finishLoads(next);
      expect(await next).not.toBeNull();
      await (await next)?.release();
    });

    it('原生模块加载不了（Expo Go）也不挡下一个', async () => {
      const open = openLocalModel(store(true));
      mockNoNative = true;
      await expect(open(new AbortController().signal)).rejects.toThrow('no native module');
      mockNoNative = false;
      const next = open(new AbortController().signal);
      await finishLoads(next);
      expect(await next).not.toBeNull();
      await (await next)?.release();
    });

    it('释放两次只释放一回，不把排队的人放进来', async () => {
      const open = openLocalModel(store(true));
      const opening = open(new AbortController().signal);
      await finishLoads(opening);
      const session = (await opening)!;
      await Promise.all([session.release(), session.release()]);
      expect(live).toBe(0);
    });
  });
});
