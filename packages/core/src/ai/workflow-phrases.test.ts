import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CORE_ACTIONS } from '../registry';
import { BUILTIN_TOOLS } from '../tools';
import { parseStepPhrase, splitStepPhrases } from './workflow-phrases';

// 步骤说法写在各个动作的定义里（D-265），内置规则按动作逐个查：两个动作的说法认同一个短语时，
// 结果就取决于查的先后。这里用说法清单和内置规则测试里出现的短语检查，不能有这种重叠。

const actions = [...CORE_ACTIONS, ...BUILTIN_TOOLS.flatMap((t) => t.actions)];

function fragments(): Set<string> {
  const files = [
    path.resolve(__dirname, '../../../../docs/MOCK_AI_PHRASES.md'),
    ...fs
      .readdirSync(__dirname)
      .filter((f) => /^mock.*\.test\.ts$|^eval-cases\.ts$/.test(f))
      .map((f) => path.join(__dirname, f)),
  ];
  // 清单里没写全的说法（两个动作都可能认的）。
  const all = new Set<string>([
    '合并成一个',
    '合成一个',
    '合并',
    'merge',
    'join',
    'record',
    'save it',
  ]);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const quoted of text.matchAll(/['"`“「]([^'"`\n”」]{1,200})['"`”」]/g))
      for (const part of quoted[1]!.split(/[:：]/))
        for (const p of splitStepPhrases(part))
          all.add(p.replace(/^(?:再|然后|最后|先|接着|and then|then|and)\s*/i, '').trim());
    for (const line of text.split('\n'))
      for (const p of line.split(/[/|、，,；;（）()「」“”]/)) all.add(p.trim());
  }
  return all;
}

describe('step phrases in action definitions', () => {
  it('no phrase is claimed by two actions', () => {
    let matched = 0;
    for (const text of fragments()) {
      const owners = actions.filter((a) => a.phrases?.some((p) => p.match.test(text)));
      if (owners.length > 0) matched++;
      expect(
        owners.map((a) => a.id),
        text,
      ).toHaveLength(Math.min(owners.length, 1));
    }
    expect(matched).toBeGreaterThan(50);
  });

  it('turns a phrase into its action and parameters', () => {
    expect(parseStepPhrase('压到 500KB', 'zh')).toEqual({
      action: 'image.compress',
      params: { maxKB: 500, format: 'jpeg' },
    });
    expect(parseStepPhrase('合并成一个', 'zh')?.action).toBe('audio.merge');
    expect(parseStepPhrase('合并成一个 PDF', 'zh')?.action).toBe('pdf.merge');
    expect(parseStepPhrase('按"合并-日期"命名', 'zh')).toEqual({
      action: 'file.rename',
      params: { template: '合并-{date:YYYY-MM-DD}' },
    });
    expect(parseStepPhrase('翻译', 'fr')).toMatchObject({ action: 'translate.text', ask: ['to'] });
    // 转 Excel（D-272）：语言跟界面语言，默认全部内容。
    expect(parseStepPhrase('表格转 Excel', 'zh')).toEqual({
      action: 'ocr.toExcel',
      params: { lang: 'auto', scope: 'all' },
    });
    expect(parseStepPhrase('convert to an Excel workbook', 'fr')).toEqual({
      action: 'ocr.toExcel',
      params: { lang: 'auto', scope: 'all' },
    });
  });
});
