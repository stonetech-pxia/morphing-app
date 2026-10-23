import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
  prepareOps,
} from '@morph/core';

import { OFFLINE_EXAMPLES, aboutCandidates } from '../shell/examples';

// 离线时「可以试试：」里的每一句都必须被内置规则接受，并能通过校验（D-107）。

const registry = createRegistry(BUILTIN_TOOLS);
const mock = createMockAIProvider();

describe('offline examples on the AI page', () => {
  for (const locale of ['zh', 'en'] as const) {
    for (const start of ['starter', 'blank'] as const) {
      it.each(OFFLINE_EXAMPLES[locale])(`${locale}, ${start} workspace: %s`, async (text) => {
        const config =
          start === 'starter'
            ? createStarterWorkspace(locale, registry)
            : createDefaultWorkspace(locale);
        const plan = await mock.plan(text, { config, registry, locale });
        if (plan.kind === 'restorePrevious') return;
        expect(plan.kind).toBe('ops');
        if (plan.kind !== 'ops') return;
        const prepared = prepareOps(config, plan.ops, { registry, locale, now: new Date() });
        expect(prepared.ok ? [] : prepared.issues).toEqual([]);
      });
    }
  }
});

describe('examples about a quick action or shared files (D-124)', () => {
  const visa = { kind: 'workflow', workflowId: 'visa' } as const;

  it('leaves out “put it on the home page” when it is already there', () => {
    expect(aboutCandidates(visa, 'server', 'zh')).toContain('把它放到首页');
    expect(aboutCandidates(visa, 'server', 'zh', { onHome: true })).not.toContain('把它放到首页');
    expect(aboutCandidates(visa, 'mock', 'zh', { onHome: true })).not.toContain('把这个放到首页');
  });

  it('only suggests stitching when there are two photos or more', () => {
    const one = { kind: 'shared', images: 1, pdfs: 0, others: 0 } as const;
    const two = { kind: 'shared', images: 2, pdfs: 0, others: 0 } as const;
    expect(aboutCandidates(one, 'server', 'zh')).not.toContain('拼成一张长图');
    expect(aboutCandidates(two, 'server', 'zh')).toContain('拼成一张长图');
    expect(aboutCandidates(one, 'server', 'en').some((e) => /stitch/i.test(e))).toBe(false);
  });
});
