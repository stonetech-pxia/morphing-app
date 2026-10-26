import { describe, expect, it } from 'vitest';

import { createDefaultWorkspace } from './defaults';
import { applyOps } from './ops';
import { createRegistry } from './registry';
import { replaceText, splitOrJoinLines, tidyText, extractText } from './text-ops';
import { BUILTIN_TOOLS } from './tools';
import { REDACTED_TEXT, redactForAI } from './workflow/redact';

// OCR 出来的文字常见的样子：行尾空格、全角空格、连续空行、Windows 换行。
const OCR = '  合同编号  A-17 \r\n\r\n\r\n甲方：　张三  \r\n\t乙方： 李四\r\n\r\n';

describe('tidyText', () => {
  it('removes extra spaces and keeps one blank line between paragraphs', () => {
    expect(tidyText(OCR, 'single', true)).toBe('合同编号 A-17\n\n甲方： 张三\n乙方： 李四');
  });
  it('can drop every blank line, or leave the spaces alone', () => {
    expect(tidyText(OCR, 'remove', true)).toBe('合同编号 A-17\n甲方： 张三\n乙方： 李四');
    expect(tidyText('a  b\n\n\nc', 'keep', false)).toBe('a  b\n\n\nc');
  });
});

describe('replaceText', () => {
  it('replaces the literal words everywhere, never as a pattern', () => {
    expect(replaceText('Price (USD): 1.5 USD', '(USD)', '(EUR)', false)).toEqual({
      text: 'Price (EUR): 1.5 USD',
      count: 1,
    });
    expect(replaceText('a.b.c', '.', '-', false).text).toBe('a-b-c');
    expect(replaceText('ACME and acme', 'acme', 'Foo', true)).toEqual({
      text: 'Foo and Foo',
      count: 2,
    });
    expect(replaceText('abc', '', 'x', false)).toEqual({ text: 'abc', count: 0 });
  });
});

describe('extractText and lines', () => {
  it('lists every e-mail address on its own line', () => {
    expect(extractText('Write to a@b.co or c@d.org.', 'email', 'en')).toBe('a@b.co\nc@d.org');
  });
  it('splits at Chinese and Latin commas, and joins lines back', () => {
    expect(splitOrJoinLines('苹果，香蕉、梨, kiwi', 'split', 'comma')).toBe('苹果\n香蕉\n梨\nkiwi');
    expect(splitOrJoinLines('第一行\n\n  第二行 ', 'join', 'none')).toBe('第一行第二行');
    expect(splitOrJoinLines('a\nb', 'join', 'comma')).toBe('a, b');
  });
});

describe('text.replace words are private', () => {
  it('AI sees placeholders, and sending them back keeps the user’s words', () => {
    const registry = createRegistry(BUILTIN_TOOLS);
    const ctx = { registry, locale: 'zh' as const };
    const added = applyOps(
      createDefaultWorkspace('zh'),
      [
        {
          op: 'addWorkflow',
          workflow: {
            id: 'fix',
            name: '改名字',
            steps: [
              { id: 'in', action: 'in.text', params: { text: '' }, ask: ['text'] },
              {
                id: 'rep',
                action: 'text.replace',
                params: { find: '王小明', replaceWith: '张三', ignoreCase: false },
              },
            ],
          },
        },
      ],
      ctx,
    );
    if (!added.ok) throw new Error(added.error);
    const seen = redactForAI(added.config, registry).workflows.find((w) => w.id === 'fix')!;
    expect(seen.steps[1]!.params).toEqual({
      find: REDACTED_TEXT,
      replaceWith: REDACTED_TEXT,
      ignoreCase: false,
    });
    const back = applyOps(
      added.config,
      [{ op: 'updateWorkflow', workflowId: 'fix', steps: seen.steps }],
      ctx,
    );
    if (!back.ok) throw new Error(back.error);
    expect(back.config.workflows.find((w) => w.id === 'fix')!.steps[1]!.params).toMatchObject({
      find: '王小明',
      replaceWith: '张三',
    });
  });
});
