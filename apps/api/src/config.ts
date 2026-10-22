import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
  type Registry,
} from '@morph/core';

import { createClaudeProvider, createSdkCompleter, type Completion } from './claude-provider';

// 读取仓库根目录的 .env（见 docs/API_KEY_SETUP.md）。key 只进入进程环境，从不打印。
export function loadRootEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export const DEFAULT_MODEL = 'claude-opus-5-5';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

export interface AIRuntime {
  provider: AIProvider;
  providerName: 'claude' | 'mock';
  model: string | null;
  registry: Registry;
}

export function createAIRuntime(
  env: NodeJS.ProcessEnv,
  onCompletion?: (completion: Completion) => void,
): AIRuntime {
  const registry = createRegistry(BUILTIN_TOOLS);
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { provider: createMockAIProvider(), providerName: 'mock', model: null, registry };
  }
  const model = env.MORPH_AI_MODEL?.trim() || DEFAULT_MODEL;
  const effortEnv = env.MORPH_AI_EFFORT?.trim();
  const effort = EFFORTS.includes(effortEnv as Effort) ? (effortEnv as Effort) : undefined;
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const provider = createClaudeProvider({
    complete: createSdkCompleter(client, { model, effort, registry }),
    registry,
    now: () => new Date(),
    ...(onCompletion ? { onCompletion } : {}),
  });
  return { provider, providerName: 'claude', model, registry };
}
