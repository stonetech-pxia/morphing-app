import {
  BUILTIN_TOOLS,
  COMPONENTS,
  type ComponentAI,
  FIELDS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  createDefaultWorkspace,
  createRegistry,
  type Locale,
} from '@morph/core';
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildUserMessage } from './prompt';

// 发给模型的提示词的快照：改了提示词（这里或登记表里的 ai.doc、ai.rule、aiRules）要有意地更新快照，并跑受影响的评测。
// 外观说明和外观规则、只关于一个动作的规则（动作的 aiRules）、风格预设的叫法（said）都从定义生成。
// v34（2026-10-30）：按「数据 · 容器 · 工具」重写，规则 66 → 51 条，加关系规则 R1–R14。

const registry = createRegistry(BUILTIN_TOOLS);

describe('prompt baseline', () => {
  it('system prompt', async () => {
    await expect(buildSystemPrompt(registry)).toMatchFileSnapshot(
      './__snapshots__/system-prompt.txt',
    );
  });

  it('lists every registered look with its doc line and rule', () => {
    const prompt = buildSystemPrompt(registry);
    for (const def of COMPONENTS) {
      const ai = def.ai as ComponentAI;
      expect(prompt).toContain(`\n  - ${def.look} ${ai.doc}`);
      if (ai.rule) expect(prompt).toContain(`\n${ai.rule.n}. ${ai.rule.text}\n`);
    }
  });

  it('lists the rules that belong to one action, and the style names of every theme preset', () => {
    const prompt = buildSystemPrompt(registry);
    const owned = [...registry.actions.values()].flatMap((a) => a.aiRules ?? []);
    expect(owned.length).toBeGreaterThan(0);
    for (const r of owned) expect(prompt).toContain(`\n${r.n}. ${r.text}\n`);
    for (const id of THEME_PRESET_IDS) expect(prompt).toContain(`"${THEME_PRESETS[id].said}"`);
  });

  it('describes every registered field type, stored and computed apart', () => {
    const lines = buildSystemPrompt(registry)
      .split('\n')
      .filter((l) => l.startsWith('  - ') && l.includes(' · '));
    expect(lines).toHaveLength(2);
    const [stored, computed] = lines.map((l) => l.slice(4).split(' · '));
    for (const def of FIELDS)
      expect(def.access === 'write' ? stored : computed).toContain(`${def.type} ${def.ai.doc}`);
  });

  it('lists the 14 relation rules', () => {
    const prompt = buildSystemPrompt(registry);
    for (let i = 1; i <= 14; i++) expect(prompt).toMatch(new RegExp(`\\nR${i}\\. `));
    expect(prompt).not.toContain('\nR15. ');
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
