import { describe, expect, it } from 'vitest';

import { PlanSchema } from './ai/types';
import { prepareOps } from './change';
import { OpListSchema } from './ops';
import { apply, registry, workspace } from './test-helpers';
import { issueLines } from './zod-issues';

// 校验的问题文字发给模型修正（D10）：z.union 默认只说 Invalid input，要指到最接近的分支里具体哪里错。

const lines = (ops: unknown) => {
  const r = OpListSchema.safeParse(ops);
  if (r.success) throw new Error('expected a problem');
  return issueLines(r.error);
};
const list = { id: 'l', look: 'list', source: { table: 'expenses' }, show: { title: 'amount' } };
const page = (blocks: unknown[]) => ({
  op: 'addContainer',
  page: { id: 'p', title: 'P', blocks },
});

describe('issueLines', () => {
  it('a new page: points at the block and key inside it', () => {
    expect(lines([page([list, { id: 'x', look: 'list', source: { table: 't' } }])])).toEqual([
      expect.stringMatching(/^0\.page\.blocks\.1\.show: /),
    ]);
    expect(
      lines([
        page([{ ...list, source: { table: 'expenses', filter: [{ field: 'a', op: 'nope' }] } }]),
      ]),
    ).toEqual([expect.stringMatching(/^0\.page\.blocks\.0\.source\.filter\.0\.op: /)]);
  });

  it('an unknown look or field type says which key is wrong', () => {
    expect(lines([page([{ id: 'x', look: 'hologram' }])])).toEqual([
      expect.stringMatching(/^0\.page\.blocks\.0\.look: .*look/),
    ]);
    expect(
      lines([
        {
          op: 'addData',
          table: { id: 't', name: 'T', fields: [{ id: 'a', name: 'A', type: 'nope' }] },
        },
      ]),
    ).toEqual([expect.stringMatching(/^0\.table\.fields\.0\.type: .*type/)]);
  });

  it('a new table: money without a currency', () => {
    expect(
      lines([
        {
          op: 'addData',
          table: { id: 't', name: 'T', fields: [{ id: 'a', name: 'A', type: 'money' }] },
        },
      ]),
    ).toEqual([expect.stringMatching(/^0\.table\.fields\.0\.currency: /)]);
  });

  it('addTool: the branch whose kind matches, with the name that is too long', () => {
    const name = 'x'.repeat(41);
    expect(
      lines([
        {
          op: 'addTool',
          tool: {
            id: 'q',
            kind: 'quickAction',
            name,
            steps: [{ id: 's', action: 'in.photos', params: {} }],
          },
        },
      ]),
    ).toEqual([expect.stringMatching(/^0\.tool\.name: Too big/)]);
    expect(
      lines([
        {
          op: 'addTool',
          tool: {
            id: 'r',
            kind: 'reminder',
            title: 'T',
            enabled: true,
            when: { every: 'day', at: '9am' },
            opens: 'page:home',
          },
        },
      ]),
    ).toEqual([expect.stringMatching(/^0\.tool\.when\.at: time like 09:00/)]);
  });

  it('a string where a union also takes a string is still reported as an id', () => {
    expect(
      lines([{ op: 'addData', table: 'Not An Id', field: { id: 'a', name: 'A', type: 'text' } }]),
    ).toEqual(['0.table: id must be lowercase letters, digits or -']);
  });

  it('updateContainer changes with a key neither page nor block has', () => {
    expect(
      lines([{ op: 'updateContainer', page: 'home', block: 'b', changes: { label: 'x' } }]),
    ).toEqual([expect.stringMatching(/^0\.changes: .*label/)]);
  });

  it('a misspelled do or a wrong kind lists what every branch takes', () => {
    const [line] = lines([page([{ ...list, tools: [{ do: 'creat', table: 'e' }] }])]);
    expect(line).toMatch(/^0\.page\.blocks\.0\.tools\.0\.do: /);
    for (const value of ['"create"', '"set"', '"toggle"']) expect(line).toContain(value);
    expect(lines([{ op: 'addTool', tool: { id: 'q', kind: 'tool', name: 'Q' } }])[0]).toMatch(
      /^0\.tool\.kind: .*"quickAction"\|"reminder"/,
    );
  });

  it('changes picks the branch that has the key', () => {
    expect(
      lines([{ op: 'updateContainer', page: 'home', changes: { icon: 'not-an-icon' } }]),
    ).toEqual([expect.stringMatching(/^0\.changes\.icon: /)]);
  });

  it('text in a record block show.title: says it is a field id, not text', () => {
    const [line] = lines([page([{ ...list, show: { title: 'My Expenses' } }])]);
    expect(line).toContain('0.page.blocks.0.show.title: ');
    expect(line).toContain("record blocks' show.title is a field id");
    expect(line).toContain('use a header block or a page title for text');
  });

  it('plain issues keep their path and message', () => {
    const r = PlanSchema.safeParse({ kind: 'ops', ops: [] });
    if (r.success) throw new Error('expected a problem');
    expect(issueLines(r.error)).toEqual([expect.stringMatching(/^ops: Too small/)]);
  });
});

describe('prepareOps and validateWorkspace report the same way', () => {
  const ctx = { registry, locale: 'en' as const, now: new Date(2026, 10, 3) };
  const base = () =>
    apply(workspace('en'), [
      {
        op: 'addData',
        table: {
          id: 'expenses',
          name: 'E',
          fields: [{ id: 'amount', name: 'A', type: 'number' }],
        },
      },
    ]);

  it('the parse stage keeps the path', () => {
    const r = prepareOps(base(), [page([{ id: 'x', look: 'list', source: { table: 't' } }])], ctx);
    expect(r).toMatchObject({
      ok: false,
      stage: 'parse',
      issues: [expect.stringMatching(/^0\.page\.blocks\.0\.show: /)],
    });
  });

  it('show.title changed to text through changes gets the same explanation', () => {
    const added = prepareOps(base(), [{ op: 'addContainer', page: 'home', block: list }], ctx);
    if (!added.ok) throw new Error(added.issues.join());
    const r = prepareOps(
      added.after,
      [
        {
          op: 'updateContainer',
          page: 'home',
          block: 'l',
          changes: { show: { title: 'My Expenses' } },
        },
      ],
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join()).toContain("record blocks' show.title is a field id");
  });
});
