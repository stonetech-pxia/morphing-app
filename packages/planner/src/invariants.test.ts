import { BUILTIN_TOOLS, createRegistry } from '@morph/core';
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, PROMPT_ROUTES } from './prompt';

// 底线 19（创始人 2026-10-31，对话）：用户要的事都能做到；AI 不能因为「不合理」拒绝做得到的组合，最多提醒一句。
// 串联本身（类型对得上的动作都能串）在 core 的 invariants.test.ts。

const registry = createRegistry(BUILTIN_TOOLS);
const REFUSE = /\b(reject|refuse|decline|leave (it|them) out|drop)\b/i;
const UNREASONABLE =
  /unreasonable|pointless|unnecessary|odd\b|silly|makes? no sense|doesn't make sense|not sensible/i;

describe('底线 19：AI 不拒绝做得到的组合', () => {
  it.each(PROMPT_ROUTES)(
    '%s prompt: no rule refuses a feasible chain for being unreasonable',
    (route) => {
      const prompt = buildSystemPrompt(registry, route);
      const sentences = prompt.split(/(?<=[.!?])\s+|\n/);
      const refusing = sentences.filter(
        (x) => REFUSE.test(x) && UNREASONABLE.test(x) && !/\bnever\b|\bdon't\b|\bnot\b/i.test(x),
      );
      expect(refusing).toEqual([]);
    },
  );

  it('the prompt says steps the user names are built even when they look odd, with at most one note', () => {
    const prompt = buildSystemPrompt(registry);
    expect(prompt).toContain('Steps the user names are always built as they ask');
    expect(prompt).toContain('never reject or leave them out for being unreasonable');
  });
});
