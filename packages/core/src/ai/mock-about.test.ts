import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import type { Locale, WorkspaceConfig } from '../schema';
import { apply, registry, workspace } from '../test-helpers';
import { WORKFLOW_PRESETS, presetWorkflow } from '../workflows/presets';
import { createMockAIProvider } from './mock';
import type { Plan, PlanAbout } from './types';

// AI 只改 App（D-113）：办事类请求的拒绝（D-128），和从快捷操作打开时「这个」指的是它（D-124）。

const ai = createMockAIProvider();
const now = new Date(2026, 9, 23, 9, 0);

const plan = (
  input: string,
  config: WorkspaceConfig,
  about?: PlanAbout,
  locale: Locale = 'zh',
): Promise<Plan> => ai.plan(input, { config, registry, locale, ...(about ? { about } : {}) });

const withVisa = () =>
  apply(workspace('zh', { withPdf: true }), [
    { op: 'addWorkflow', workflow: presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', 'visa-photo') },
  ]);
const aboutVisa: PlanAbout = { kind: 'workflow', workflowId: 'visa-photo' };

describe('mock AI — errands (D-113)', () => {
  it.each([
    '帮我写一封请假邮件',
    '写一段朋友圈文案，配上这几张照片',
    '把这份合同翻译成英文',
    '总结一下这个 PDF',
    '这份合同讲了什么',
    '帮我查一下签证要多少钱',
  ])('rejects “%s” as an errand with quick action examples', async (input) => {
    const p = await plan(input, workspace('zh'));
    expect(p).toMatchObject({ kind: 'reject', reason: 'errand' });
    if (p.kind !== 'reject') return;
    expect(p.message).toContain('只会修改这个 App');
    expect(p.examples.length).toBeGreaterThan(0);
    // 例子都是内置规则认得的句子。
    for (const example of p.examples) {
      expect((await plan(example, workspace('zh'))).kind).toBe('ops');
    }
  });

  it.each(['Write an email to my landlord', 'Translate this PDF', 'What does this contract say?'])(
    'rejects “%s” in English',
    async (input) => {
      const p = await plan(input, workspace('en'), undefined, 'en');
      expect(p).toMatchObject({ kind: 'reject', reason: 'errand' });
      if (p.kind === 'reject') {
        for (const example of p.examples) {
          expect((await plan(example, workspace('en'), undefined, 'en')).kind).toBe('ops');
        }
      }
    },
  );

  it('says to tap a quick action instead of running it', async () => {
    const p = await plan('现在帮我运行签证照片', withVisa());
    expect(p).toMatchObject({ kind: 'reject', reason: 'errand' });
    if (p.kind === 'reject') expect(p.message).toContain('点一下');
  });

  it('still changes the app when the words look similar', async () => {
    expect((await plan('新建一个叫「翻译笔记」的页面', workspace('zh'))).kind).toBe('ops');
    expect((await plan('新建一个叫「写作」的页面', workspace('zh'))).kind).toBe('ops');
    expect((await plan('添加签证照片快捷操作', workspace('zh'))).kind).toBe('ops');
  });
});

describe('mock AI — opened from a quick action (D-124)', () => {
  async function change(input: string, about: PlanAbout = aboutVisa) {
    const config = withVisa();
    const p = await plan(input, config, about);
    if (p.kind !== 'ops') throw new Error(`expected ops for “${input}”, got ${JSON.stringify(p)}`);
    const prepared = prepareOps(config, p.ops, { registry, locale: 'zh', now });
    if (!prepared.ok) throw new Error(prepared.issues.join('; '));
    return prepared.after;
  }

  it('reads 这个 / 它 as that quick action', async () => {
    const size = await change('把这个的大小改成 200KB');
    const photo = size.workflows.find((w) => w.id === 'visa-photo')!.steps[1]!;
    expect(photo.params).toMatchObject({ maxKB: 200 });

    const named = await change('把它改名为美签照片');
    expect(named.workflows.find((w) => w.id === 'visa-photo')!.name).toBe('美签照片');

    const home = await change('把这个放到首页');
    expect(
      home.pages[0]!.components.some(
        (c) => c.type === 'workflowRunner' && c.props.workflowId === 'visa-photo',
      ),
    ).toBe(true);
  });

  it('needs the context to know what 这个 is', async () => {
    const p = await plan('把这个改名为美签照片', withVisa());
    expect(p.kind).toBe('reject');
  });
});
