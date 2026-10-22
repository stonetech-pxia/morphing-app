import type { Localized } from '@morph/core';

// 可选模型与价格（美元 / 百万 token）。价格以官方定价页为准：
// https://platform.claude.com/docs/en/about-claude/pricing
// costPerChange 来自 2026-10-22 评测集实测的平均值（系统提示词已缓存）。

export const DEFAULT_MODEL = 'claude-opus-5-5';

export interface ModelInfo {
  id: string;
  name: string;
  price: { input: number; output: number; cacheRead: number };
  costPerChange: number;
  note: Localized;
}

export const MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    price: { input: 4, output: 20, cacheRead: 0.2 },
    costPerChange: 0.005,
    note: { zh: '能力最强（默认）', en: 'Most capable (default)' },
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    price: { input: 2, output: 10, cacheRead: 0.2 },
    costPerChange: 0.003,
    note: { zh: '速度与能力均衡', en: 'Balanced speed and capability' },
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    price: { input: 0.1, output: 0.5, cacheRead: 0.01 },
    costPerChange: 0.0002,
    note: { zh: '最便宜', en: 'Lowest cost' },
  },
];

/** 服务端拒答回退（refusal fallback）：Haiku 5.5 不支持，其余当前模型默认开启。 */
export const supportsServerFallback = (model: string) => /^claude-(opus|sonnet|fable)-/.test(model);
