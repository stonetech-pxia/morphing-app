import {
  PREFILL_MODEL_FILE,
  PREFILL_MODEL_PACK,
  type ModelSession,
  type OpenModel,
} from '@morph/core';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { expoPackFs } from '../packs/expo-pack-fs';
import type { PackStore } from '../packs/store';

// 新记录表单的本机模型（D-396）在手机上怎么跑：llama.rn，只用 CPU，用完就释放，不常驻。
// 模型结果只进候选；这里不联网（下载走扩展包，用户在「设置 → 数据」点了才下载）。
// 没装、内存不够、加载失败时给 null 或报错，引擎安静退回只有规则。

/**
 * 设备总内存至少这么多才加载。手机上的进程峰值估计约 3.2 GB（0.8B 没量过，按 2B、4B 实测换算：
 * 2.84 GB + 文件大小的 0.75 倍）；11 GB 的三星跑 3.8 GB 时整机还剩 1.9 GB。6 GB 的手机剩不下多少，
 * iOS 单个 App 的上限也大约是总内存的一半；8 GB 的机器系统报出来常常不足 8，所以写 7。
 */
export const MODEL_MIN_MEMORY = 7 * 1024 * 1024 * 1024;

/** 上下文长度：和 2B、4B 真机测量一样；文字由 core 按这个长度截断。 */
const CONTEXT = 4096;
/** 三星上测过 6 线程。iPhone 大核少，没测过，先用 4。 */
const threads = () => (Platform.OS === 'android' ? 6 : 4);

/** totalMemory 拿不到（Expo Go、部分模拟器）时算够：加载失败也只是退回规则。 */
export const deviceFitsLocalModel = () =>
  Device.totalMemory === null || Device.totalMemory >= MODEL_MIN_MEMORY;

/** 原生调用可能抛错、拒绝，也可能什么都不返回（没在生成时的 stopCompletion）：都不当回事。 */
async function quietly(call: () => unknown): Promise<void> {
  try {
    await call();
  } catch {
    // 释放的路上出错也要接着走完。
  }
}

// 同一时间只有一个模型在内存里：上一个释放完才加载下一个（用户换附件时会连着来）。它不会拒绝。
let releasing: Promise<void> = Promise.resolve();

export function openLocalModel(store: PackStore): OpenModel {
  return async (signal) => {
    if (!(await store.isInstalled(PREFILL_MODEL_PACK)) || !deviceFitsLocalModel()) return null;
    await releasing;
    if (signal.aborted) return null;
    // 原生模块只在真的要用时才加载：Expo Go 里没有它，这里报错就退回规则。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initLlama } = require('llama.rn') as typeof import('llama.rn');
    const context = await initLlama({
      model: expoPackFs.uri(store.path(PREFILL_MODEL_PACK, PREFILL_MODEL_FILE)),
      n_ctx: CONTEXT,
      n_threads: threads(),
      n_gpu_layers: 0,
      devices: ['CPU'],
      no_gpu_devices: true,
      use_mlock: false,
    });
    if (signal.aborted) {
      await quietly(() => context.release());
      return null;
    }
    let running: Promise<unknown> = Promise.resolve();
    const session: ModelSession = {
      async generate(request, stop) {
        const onAbort = () => void quietly(() => context.stopCompletion());
        stop.addEventListener('abort', onAbort);
        try {
          const work = context.completion({
            prompt: request.prompt,
            grammar: request.grammar,
            temperature: request.temperature,
            seed: request.seed,
            n_predict: request.nPredict,
            stop: [...request.stop],
          });
          running = work.catch(() => undefined);
          return (await work).text;
        } finally {
          stop.removeEventListener('abort', onAbort);
        }
      },
      release() {
        // 还在生成时先停、等它结束再释放，否则原生那边还在用这块内存。
        const done = (async () => {
          await quietly(() => context.stopCompletion());
          await running;
          await quietly(() => context.release());
        })();
        releasing = done;
        return done;
      },
    };
    return session;
  };
}
