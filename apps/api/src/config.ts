import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, MODELS } from '@morph/planner';

import { createSdkRelay } from './claude-provider';
import type { Price, Relay } from './server';

// 读取仓库根目录的 .env（见 docs/API_KEY_SETUP.md）。key 只进入进程环境，从不打印。
export function loadRootEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

export interface RelayRuntime {
  /** 没配置 ANTHROPIC_API_KEY 时为 null。 */
  relay: Relay | null;
  model: string;
  price: Price;
}

export function createRelayRuntime(env: NodeJS.ProcessEnv): RelayRuntime {
  const model = env.MORPH_AI_MODEL?.trim() || DEFAULT_MODEL;
  // 限额按金额算，所以只能用已知价格的模型。
  const price = MODELS.find((m) => m.id === model)?.price;
  if (!price) throw new Error(`不知道 ${model} 的价格，请在 packages/planner/src/models.ts 里加上`);
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { relay: null, model, price };
  const effortEnv = env.MORPH_AI_EFFORT?.trim();
  const effort = EFFORTS.includes(effortEnv as Effort) ? (effortEnv as Effort) : undefined;
  const relay = createSdkRelay(new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }), {
    model,
    maxTokens: Number(env.MORPH_MAX_OUTPUT_TOKENS ?? 16_000),
    effort,
  });
  return { relay, model, price };
}
