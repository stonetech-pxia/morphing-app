import {
  BUILTIN_TOOLS,
  COMPONENTS,
  FIELDS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  createDefaultWorkspace,
  createRegistry,
  type Locale,
} from '@morph/core';
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildUserMessage } from './prompt';

// 组件登记表重构的基线（2026-10-27）：发给模型的提示词必须逐字不变。
// 组件说明和组件规则改为从登记表生成后，这里保证生成结果和原来手写的一样（不用重跑评测）。
// 架构清理（2026-10-27）：只关于一个动作的规则（动作的 aiRules）和风格预设的叫法（said）也从定义生成。

const registry = createRegistry(BUILTIN_TOOLS);

describe('prompt baseline', () => {
  it('system prompt', async () => {
    await expect(buildSystemPrompt(registry)).toMatchFileSnapshot(
      './__snapshots__/system-prompt.txt',
    );
  });

  it('lists every registered component with its doc line and rule', () => {
    const prompt = buildSystemPrompt(registry);
    for (const def of COMPONENTS) {
      expect(prompt).toContain(`\n  - ${def.type} ${def.ai.doc}\n`);
      if (def.ai.rule) expect(prompt).toContain(`\n${def.ai.rule.n}. ${def.ai.rule.text}\n`);
    }
  });

  it('lists the rules that belong to one action, and the style names of every theme preset', () => {
    const prompt = buildSystemPrompt(registry);
    const owned = [...registry.actions.values()].flatMap((a) => a.aiRules ?? []);
    expect(owned.length).toBeGreaterThan(0);
    for (const r of owned) expect(prompt).toContain(`\n${r.n}. ${r.text}\n`);
    for (const id of THEME_PRESET_IDS) expect(prompt).toContain(`"${THEME_PRESETS[id].said}"`);
  });

  it('describes every registered field type', () => {
    const prompt = buildSystemPrompt(registry);
    const line = prompt.split('\n').find((l) => l.startsWith('  - ') && l.includes(' · '))!;
    for (const def of FIELDS)
      expect(line.slice(4).split(' · ')).toContain(`${def.type} ${def.ai.doc}`);
  });

  it('numbers the rules 1..N, component rules included, without gaps', () => {
    const section = buildSystemPrompt(registry).split('## Rules\n')[1]!.split('\n\n')[0]!;
    const numbers = section.split('\n').map((line) => parseInt(line, 10));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  for (const locale of ['en', 'zh', 'fr'] as Locale[]) {
    it(`user message in ${locale}`, async () => {
      const message = buildUserMessage(createDefaultWorkspace(locale), 'make it green', locale);
      await expect(message).toMatchFileSnapshot(`./__snapshots__/user-message-${locale}.txt`);
    });
  }
});
