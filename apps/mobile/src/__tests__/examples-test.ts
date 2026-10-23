import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
  prepareOps,
} from '@morph/core';

import { OFFLINE_EXAMPLES } from '../shell/examples';

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
