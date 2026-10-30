import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { quickActionsOf, type Locale, type Workflow, type WorkspaceConfig } from '../schema';
import { registry, workspace } from '../test-helpers';
import { createMockAIProvider } from './mock';

// 翻译（D-171、D-174）：翻译文件做成快捷操作；直接要译文仍按办事拒绝，例子点了能做成翻译快捷操作。

const ai = createMockAIProvider();
const now = new Date(2026, 9, 23, 9, 0);

async function added(input: string, locale: Locale = 'zh', config?: WorkspaceConfig) {
  const base = config ?? workspace(locale);
  const p = await ai.plan(input, { config: base, registry, locale });
  if (p.kind !== 'ops') throw new Error(`expected ops for “${input}”, got ${JSON.stringify(p)}`);
  const prepared = prepareOps(base, p.ops, { registry, locale, now });
  if (!prepared.ok) throw new Error(prepared.issues.join('; '));
  const wf = quickActionsOf(prepared.after).find(
    (w) => !quickActionsOf(base).some((b) => b.id === w.id),
  );
  return wf!;
}

const actions = (wf: Workflow) => wf.steps.map((s) => s.action);
const translateStep = (wf: Workflow) => wf.steps.find((s) => s.action === 'translate.text')!;

describe('mock AI — translation step phrases', () => {
  it('builds a quick action from typed text', async () => {
    const wf = await added('新建一个快捷操作：输入文字，翻译成英文，复制文字');
    expect(actions(wf)).toEqual(['in.text', 'translate.text', 'text.copy']);
    expect(wf.steps[0]).toMatchObject({ ask: ['text'] });
    expect(translateStep(wf).params).toEqual({ from: 'auto', to: 'en' });
  });

  it('reads 提取文字 after a PDF as getting its text, and 转成 PDF after text as text to PDF', async () => {
    const wf = await added('新建一个快捷操作：选 PDF，提取文字，翻译成日文，转成 PDF，分享');
    expect(actions(wf)).toEqual([
      'in.files',
      'pdf.extractText',
      'translate.text',
      'text.toPdf',
      'out.share',
    ]);
    expect(translateStep(wf).params.to).toBe('ja');
  });

  it('knows 翻译 alone, 存成文字 and English phrases', async () => {
    const zh = await added('新建一个快捷操作：选截图，识别文字，翻译，存成文字文件');
    expect(actions(zh)).toEqual(['in.photos', 'ocr.recognize', 'translate.text', 'text.toFile']);
    expect(translateStep(zh)).toMatchObject({ params: { to: 'zh-Hans' }, ask: ['to'] });

    const en = await added(
      'Create a quick action: choose a PDF, get text from PDF, translate into Traditional Chinese, copy text',
      'en',
    );
    expect(actions(en)).toEqual(['in.files', 'pdf.extractText', 'translate.text', 'text.copy']);
    expect(translateStep(en).params.to).toBe('zh-Hant');
  });
});

describe('mock AI — translating a document makes a quick action (D-171)', () => {
  it('turns a contract into PDF → text → translation → PDF → share', async () => {
    const wf = await added('把这份合同翻译成英文');
    expect(wf.name).toBe('合同翻成英文');
    expect(actions(wf)).toEqual([
      'in.files',
      'pdf.extractText',
      'translate.text',
      'text.toPdf',
      'out.share',
    ]);
    expect(translateStep(wf).params).toEqual({ from: 'auto', to: 'en' });
  });

  it('recognizes the text of screenshots first and copies the translation', async () => {
    const wf = await added('帮我把截图翻译成中文');
    expect(actions(wf)).toEqual(['in.photos', 'ocr.recognize', 'translate.text', 'text.copy']);
    expect(wf.steps[1]).toMatchObject({ params: { lang: 'eng' }, ask: ['lang'] });
  });

  it('asks the target language each run when none was said', async () => {
    const wf = await added('Translate this PDF', 'en');
    expect(translateStep(wf)).toMatchObject({ params: { to: 'en' }, ask: ['to'] });
    expect(wf.name.length).toBeLessThanOrEqual(40);
  });

  it('still refuses to translate a sentence, and its examples are accepted', async () => {
    for (const [input, locale] of [
      ['帮我翻译一下这句话：谢谢你的帮助', 'zh'],
      ['“下班了”用英语怎么说', 'zh'],
      ['Translate “good morning” into Japanese', 'en'],
    ] as const) {
      const p = await ai.plan(input, { config: workspace(locale), registry, locale });
      expect(p).toMatchObject({ kind: 'reject', reason: 'errand' });
      if (p.kind !== 'reject') continue;
      expect(p.message).toMatch(/译文|translation/);
      for (const example of p.examples) await added(example, locale);
    }
  });
});
