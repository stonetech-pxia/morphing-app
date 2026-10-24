import { describe, expect, it } from 'vitest';

import { registry, workspace } from '../test-helpers';
import type { Workflow } from '../schema';
import { RunCancelled, RunError, runWorkflow, type ActionImpl, type RunValue } from './engine';

const now = () => new Date(2026, 9, 22, 9, 0);
const merge = () => workspace('zh', { withPdf: true }).workflows[0]!;

const pdfItem = (name: string, size = 10) => ({
  uri: `tmp://${name}`,
  name,
  ext: 'pdf',
  mimeType: 'application/pdf',
  size,
});

/** 假的动作实现：记录调用顺序和收到的参数。 */
function fakeImpls(log: string[]): Record<string, ActionImpl<unknown>> {
  return {
    'in.files': async (_input, params) => {
      log.push(`pick ${JSON.stringify(params)}`);
      return { type: 'pdf', items: [pdfItem('报告'), pdfItem('附录')] };
    },
    'pdf.merge': async (input, _params, ctx) => {
      const items = (input as Extract<RunValue, { items: unknown }>).items;
      items.forEach((_, i) => ctx.progress(i + 1, items.length));
      log.push(`merge ${items.length}`);
      return { type: 'pdf', items: [pdfItem(items[0]!.name, 20)] };
    },
    'file.rename': async (input, params) => {
      log.push(`rename ${String(params.template)}`);
      const value = input as Extract<RunValue, { items: unknown }>;
      return { ...value, items: value.items.map((i) => ({ ...i, name: String(params.template) })) };
    },
    'file.save': async (input, _params, ctx) => {
      ctx.saved.push('asset1');
      log.push('save');
      return input!;
    },
  };
}

function run(workflow: Workflow, overrides: Partial<Parameters<typeof runWorkflow>[0]> = {}) {
  const log: string[] = [];
  const events: string[] = [];
  const records: unknown[] = [];
  const promise = runWorkflow({
    workflow,
    registry,
    impls: fakeImpls(log),
    services: null,
    locale: 'zh',
    now,
    newId: () => 'x',
    askParams: async ({ keys }) => (keys.includes('template') ? { template: '我的合并' } : {}),
    onEvent: (e) => events.push(e.kind === 'step' ? `step ${e.index}` : `${e.done}/${e.total}`),
    record: {
      start: async () => 7,
      finish: async (id, result) => void records.push({ id, ...result }),
    },
    ...overrides,
  });
  return { promise, log, events, records };
}

describe('runWorkflow', () => {
  it('runs the steps in order, passing one typed value and asking where the workflow says', async () => {
    const { promise, log, events, records } = run(merge());
    const result = await promise;
    expect(result).toMatchObject({ status: 'succeeded', saved: ['asset1'] });
    expect(log).toEqual([
      'pick {"accept":"pdf","min":2,"max":20}',
      'merge 2',
      'rename 我的合并',
      'save',
    ]);
    expect(events).toEqual(['step 0', 'step 1', '1/2', '2/2', 'step 2', 'step 3']);
    // 执行记录只有元数据。
    expect(records).toEqual([{ id: 7, status: 'succeeded', outputAssetId: 'asset1' }]);
  });

  it('a cancelled question cancels the run', async () => {
    const { promise, log, records } = run(merge(), { askParams: async () => null });
    expect(await promise).toEqual({ status: 'cancelled' });
    expect(log).toEqual(['pick {"accept":"pdf","min":2,"max":20}', 'merge 2']);
    expect(records).toEqual([{ id: 7, status: 'cancelled' }]);
  });

  it('can be cancelled between steps', async () => {
    const signal = { cancelled: false };
    const impls = fakeImpls([]);
    const { promise } = run(merge(), {
      signal,
      impls: {
        ...impls,
        'pdf.merge': async (input, params, ctx) => {
          signal.cancelled = true;
          return impls['pdf.merge']!(input, params, ctx);
        },
      },
    });
    expect(await promise).toEqual({ status: 'cancelled' });
  });

  it('stops at once even when a step is stuck waiting (e.g. a picker that never appeared)', async () => {
    const signal = { cancelled: false };
    const { promise, records } = run(merge(), {
      signal,
      impls: { ...fakeImpls([]), 'in.files': () => new Promise<RunValue>(() => {}) },
    });
    void Promise.resolve().then(() => (signal.cancelled = true));
    expect(await promise).toEqual({ status: 'cancelled' });
    expect(records).toEqual([{ id: 7, status: 'cancelled' }]);
  });

  it('reports which step failed, and records only the error code', async () => {
    const impls = fakeImpls([]);
    const { promise, records } = run(merge(), {
      impls: {
        ...impls,
        'pdf.merge': async () => {
          throw new RunError('encrypted', { name: '附录.pdf' });
        },
      },
    });
    const result = await promise;
    expect(result).toMatchObject({ status: 'failed', stepIndex: 1 });
    expect(result.status === 'failed' && result.error.detail).toEqual({ name: '附录.pdf' });
    expect(records).toEqual([{ id: 7, status: 'failed', error: 'encrypted' }]);
  });

  it('turns unexpected exceptions and user cancellation inside actions into results', async () => {
    const impls = fakeImpls([]);
    const crash = run(merge(), {
      impls: {
        ...impls,
        'in.files': async () => {
          throw new Error('boom');
        },
      },
    });
    expect(await crash.promise).toMatchObject({ status: 'failed', error: { code: 'unexpected' } });
    const cancel = run(merge(), {
      impls: {
        ...impls,
        'in.files': async () => {
          throw new RunCancelled();
        },
      },
    });
    expect(await cancel.promise).toEqual({ status: 'cancelled' });
  });

  it('re-checks the workflow before running anything', async () => {
    const broken = { ...merge(), steps: merge().steps.slice(1) };
    const { promise, log } = run(broken);
    expect(await promise).toMatchObject({ status: 'failed', error: { code: 'invalidWorkflow' } });
    expect(log).toEqual([]);
  });

  it('re-parses parameters before each step', async () => {
    const wf = merge();
    wf.steps[0]!.params = { accept: 'pdf', min: 5, max: 2 };
    expect(await run(wf).promise).toMatchObject({ error: { code: 'invalidWorkflow' } });
  });

  it('pauses for an extension pack and cancels when the user declines', async () => {
    const wf = merge();
    const original = registry.actions.get('pdf.merge')!;
    const asked: string[] = [];
    (original as { pack?: string }).pack = 'pdfview';
    try {
      const { promise } = run(wf, {
        ensurePack: async (id) => (asked.push(id), false),
      });
      expect(await promise).toEqual({ status: 'cancelled' });
      expect(asked).toEqual(['pdfview']);
    } finally {
      delete (original as { pack?: string }).pack;
    }
  });

  it('asks the parameters first, then ensures the pack they need (OCR language)', async () => {
    const wf: Workflow = {
      id: 'ocr',
      name: 'OCR',
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
        { id: 'read', action: 'ocr.recognize', params: { lang: 'eng' }, ask: ['lang'] },
      ],
    };
    const order: string[] = [];
    const { promise } = run(wf, {
      impls: {
        'in.photos': async () => ({ type: 'images', items: [pdfItem('scan')] }),
        'ocr.recognize': async (_input, params) => ({
          type: 'text',
          text: String(params.lang),
          name: 'scan',
        }),
      },
      askParams: async () => (order.push('ask'), { lang: 'chi_sim' }),
      ensurePack: async (id) => (order.push(id), true),
    });
    expect(await promise).toMatchObject({ value: { type: 'text', text: 'chi_sim' } });
    expect(order).toEqual(['ask', 'ocr-chi-sim']);
  });

  it('does not ask for a pack when the platform runs the action natively (iOS Vision)', async () => {
    const wf: Workflow = {
      id: 'ocr',
      name: 'OCR',
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'scanner', min: 1, max: 5 } },
        { id: 'read', action: 'ocr.recognize', params: { lang: 'jpn' } },
      ],
    };
    const asked: string[] = [];
    const { promise } = run(wf, {
      impls: {
        'in.photos': async () => ({ type: 'images', items: [pdfItem('scan')] }),
        'ocr.recognize': async () => ({ type: 'text', text: '日本語', name: 'scan' }),
      },
      ensurePack: async (id) => (asked.push(id), true),
      packNotNeeded: (id, params) => id === 'ocr.recognize' && params.lang === 'jpn',
    });
    expect(await promise).toMatchObject({ status: 'succeeded', value: { text: '日本語' } });
    expect(asked).toEqual([]);
  });

  it('always asks for passwords and hands them only to that step, never into the params (D-193)', async () => {
    const wf: Workflow = {
      id: 'wifi',
      name: 'Wi-Fi',
      steps: [
        {
          id: 'wifi',
          action: 'in.wifi',
          params: { network: 'Home', security: 'WPA', hidden: false },
        },
      ],
    };
    const asked: string[][] = [];
    let seen: { params: Record<string, unknown>; secrets: Record<string, string> } | null = null;
    const { promise } = run(wf, {
      impls: {
        'in.wifi': async (_input, params, ctx) => {
          seen = { params, secrets: { ...ctx.secrets } };
          return { type: 'text', text: 'x', name: 'x' };
        },
      },
      askParams: async ({ keys }) => (asked.push([...keys]), { password: 'secret123' }),
    });
    expect(await promise).toMatchObject({ status: 'succeeded' });
    expect(asked).toEqual([['password']]);
    expect(seen).toEqual({
      params: { network: 'Home', security: 'WPA', hidden: false },
      secrets: { password: 'secret123' },
    });
    // 配置里存不进密码：参数结构里没有这个键。
    expect(
      registry.actions.get('in.wifi')!.params.safeParse({
        network: 'Home',
        security: 'WPA',
        hidden: false,
        password: 'secret123',
      }).success,
    ).toBe(false);
  });
});
