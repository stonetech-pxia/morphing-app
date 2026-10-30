import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';
import type { Collection, QuickAction, WorkspaceConfig } from './schema';

const issuesOf = (config: unknown) => {
  const result = validateWorkspace(config, registry);
  return result.ok ? [] : result.issues.map((i) => i.code);
};
const messagesOf = (config: unknown) => {
  const result = validateWorkspace(config, registry);
  return result.ok ? '' : result.issues.map((i) => i.message).join('\n');
};

/** 默认工作空间加上 PDF 工具包（v33 代码存下来的，迁移到 v34）。 */
const withPdf = () => fromV33(v33Fixture('setup-pdf-zh'));

const mutate = (fn: (c: WorkspaceConfig) => void, base = withPdf()) => {
  const copy = JSON.parse(JSON.stringify(base)) as WorkspaceConfig;
  fn(copy);
  return copy;
};
const home = (c: WorkspaceConfig) => c.containers.pages[0]!;
const merge = (c: WorkspaceConfig) => c.tools.find((t) => t.id === 'pdf-merge') as QuickAction;

describe('validateWorkspace', () => {
  it('accepts every v33 configuration once migrated (defaults, starters, templates, samples, eval setups)', () => {
    const names = readdirSync(join(__dirname, 'fixtures', 'v33'))
      // coverage-*：只给读取器用的覆盖面配置，故意超出上限。
      .filter((f) => f.endsWith('.json') && !f.startsWith('coverage-'))
      .map((f) => f.replace('.json', ''));
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const result = validateWorkspace(fromV33(v33Fixture(name)), registry, {
        unknownComponents: 'keep',
      });
      expect({ name, issues: result.ok ? [] : result.issues }).toEqual({ name, issues: [] });
    }
  });

  it('rejects non-whitelisted looks and unknown keys', () => {
    expect(
      issuesOf(mutate((c) => home(c).blocks.push({ id: 'x', look: 'html' } as never))),
    ).toContain('schema');
    expect(
      issuesOf(mutate((c) => Object.assign(home(c).blocks[0]!, { onPress: 'alert(1)' }))),
    ).toContain('schema');
  });

  it('needs an icon for an icon-only button (D-230)', () => {
    const button = (show: Record<string, unknown>) =>
      mutate((c) =>
        home(c).blocks.push({
          id: 'b',
          look: 'button',
          show: { label: 'AI', ...show },
          opens: 'ai',
        } as never),
      );
    expect(issuesOf(button({ variant: 'icon' }))).toContain('schema');
    expect(issuesOf(button({ variant: 'icon', icon: 'sparkles' }))).toEqual([]);
    expect(issuesOf(button({ variant: 'filled', icon: 'sparkles' }))).toEqual([]);
  });

  it('a button opens something or has one record tool', () => {
    const button = (extra: Record<string, unknown>) =>
      mutate((c) =>
        home(c).blocks.push({
          id: 'b',
          look: 'button',
          show: { label: 'Go', variant: 'filled' },
          ...extra,
        } as never),
      );
    expect(messagesOf(button({}))).toMatch(/a button needs opens .* or tools/);
    expect(
      messagesOf(button({ opens: 'settings', tools: [{ do: 'create', table: 'x', ask: 'all' }] })),
    ).toMatch(/either opens something or has a tool, not both/);
  });

  it('rejects a wrong schemaVersion', () => {
    expect(issuesOf(mutate((c) => Object.assign(c, { schemaVersion: 33 })))).toContain('schema');
  });

  it('requires Settings to stay in the nav bar or a floating button', () => {
    const config = mutate((c) => {
      c.nav.bar = ['page:home', 'tools', 'ai'];
      c.nav.floating = ['history'];
    });
    expect(issuesOf(config)).toEqual(['protected']);
    expect(
      issuesOf(
        mutate((c) => {
          c.nav.bar = ['page:home'];
          c.nav.floating = ['settings'];
        }),
      ),
    ).toEqual([]);
  });

  it('allows AI, History and Tools to be left out of the nav entirely', () => {
    const config = mutate((c) => {
      c.nav.bar = ['page:home', 'settings'];
      c.nav.floating = [];
    });
    expect(issuesOf(config)).toEqual([]);
  });

  it('rejects themes whose text would be hard to read', () => {
    expect(issuesOf(mutate((c) => (c.theme.colors = { text: '#D0D0D0' })))).toContain('contrast');
    expect(
      issuesOf(
        mutate((c) => {
          c.theme.mode = 'dark';
          c.theme.colors = { background: '#FFFFFF' };
        }),
      ),
    ).toContain('contrast');
    expect(
      issuesOf(
        mutate((c) => {
          c.theme.mode = 'light';
          c.theme.colors = { background: '#10233F', surface: '#18304F', text: '#F5F7FA' };
        }),
      ),
    ).toEqual([]);
  });

  it('rejects buttons and entries that open missing pages, and duplicate ids inside groups', () => {
    expect(
      issuesOf(
        mutate((c) =>
          home(c).blocks.push({
            id: 'go',
            look: 'button',
            show: { label: 'Go', variant: 'filled' },
            opens: 'page:nope',
          }),
        ),
      ),
    ).toContain('unknown-page');
    expect(
      issuesOf(
        mutate((c) =>
          home(c).blocks.push({
            id: 'g',
            look: 'group',
            show: { layout: 'row' },
            children: [{ id: home(c).blocks[0]!.id, look: 'divider' }],
          }),
        ),
      ),
    ).toContain('duplicate');
  });

  it('allows one group inside a group, not two (Q3)', () => {
    const nest = (depth: number) => {
      let inner: Record<string, unknown> = { id: 'leaf', look: 'divider' };
      for (let d = depth; d > 0; d--)
        inner = { id: `g${d}`, look: 'group', show: { layout: 'row' }, children: [inner] };
      return mutate((c) => home(c).blocks.push(inner as never));
    };
    expect(issuesOf(nest(2))).toEqual([]);
    expect(issuesOf(nest(3))).toContain('schema');
    expect(issuesOf(mutate((c) => Object.assign(home(c), { icon: 'skull' })))).toContain('schema');
  });

  it('rejects nav entries for missing pages and duplicate ids', () => {
    expect(issuesOf(mutate((c) => (c.nav.bar[0] = 'page:nope')))).toContain('unknown-page');
    expect(
      issuesOf(mutate((c) => home(c).blocks.push({ ...home(c).blocks[0]! } as never))),
    ).toContain('duplicate');
  });

  it('rejects package entries and quick actions for packages that are not installed', () => {
    const noPdf = fromV33(v33Fixture('default-zh'));
    expect(
      issuesOf(
        mutate(
          (c) => home(c).blocks.push({ id: 'card-pdf', look: 'entry', opens: 'package:pdf' }),
          noPdf,
        ),
      ),
    ).toContain('unknown-tool');
    expect(
      issuesOf(mutate((c) => c.tools.push({ ...merge(c), id: 'mine', package: 'image' }))),
    ).toContain('unknown-tool');
  });

  it('a package owns its page; a page of a package that is not installed is rejected', () => {
    expect(issuesOf(mutate((c) => (c.packages[0]!.page = 'home')))).toContain('tool-page');
    expect(issuesOf(mutate((c) => (c.packages = [])))).toContain('tool-page');
  });

  it('quick actions and reminders share one id space', () => {
    expect(
      messagesOf(
        mutate((c) =>
          c.tools.push({
            id: 'pdf-merge',
            kind: 'reminder',
            title: 'Merge',
            enabled: true,
            when: { every: 'day', at: '09:00' },
            opens: 'page:home',
          }),
        ),
      ),
    ).toMatch(/duplicate|quick action or reminder pdf-merge/);
  });

  it('opens tool:<id> must be a quick action or a built-in preset, never a reminder (rule 13)', () => {
    const button = (opens: string, extra: (c: WorkspaceConfig) => void = () => {}) =>
      mutate((c) => {
        extra(c);
        home(c).blocks.push({
          id: 'b',
          look: 'button',
          show: { label: 'Go', variant: 'filled' },
          opens,
        } as never);
      });
    expect(issuesOf(button('tool:pdf-merge'))).toEqual([]);
    expect(issuesOf(button('tool:visa-photo'))).toEqual([]);
    expect(issuesOf(button('tool:nope'))).toEqual(['unknown-workflow']);
    expect(
      messagesOf(
        button('tool:wake', (c) =>
          c.tools.push({
            id: 'wake',
            kind: 'reminder',
            title: 'Wake',
            enabled: true,
            when: { every: 'day', at: '07:00' },
            opens: 'page:home',
          }),
        ),
      ),
    ).toMatch(/opens wake, which is a reminder/);
  });

  it('an action block runs a quick action (or a preset), a picker only the kernel pickers', () => {
    const block = (look: string, tool: string) =>
      mutate((c) => home(c).blocks.push({ id: 'x', look, tools: [{ tool }] } as never));
    expect(issuesOf(block('action', 'pdf-merge'))).toEqual([]);
    expect(issuesOf(block('action', 'visa-photo'))).toEqual([]);
    expect(issuesOf(block('action', 'gone'))).toEqual(['unknown-workflow']);
    expect(messagesOf(block('action', '$pick.media'))).toMatch(/can't use \$pick\.media/);
    expect(issuesOf(block('picker', '$pick.files'))).toEqual([]);
    expect(messagesOf(block('picker', 'pdf-merge'))).toMatch(/can't run a quick action/);
  });

  it('the files block filters $files on its automatic fields only', () => {
    const files = (filter: unknown, sort?: unknown) =>
      mutate((c) =>
        home(c).blocks.push({
          id: 'f',
          look: 'files',
          show: { title: 'PDFs' },
          source: { table: '$files', filter, limit: 5, ...(sort ? { sort } : {}) },
        } as never),
      );
    expect(issuesOf(files([{ field: 'kind', op: 'is', value: 'pdf' }]))).toEqual([]);
    expect(issuesOf(files([{ field: 'createdAt', op: 'inPeriod', value: 'thisMonth' }]))).toEqual(
      [],
    );
    expect(messagesOf(files([{ field: 'kind', op: 'is', value: 'movie' }]))).toMatch(
      /\$files filter on kind: value does not match/,
    );
    expect(messagesOf(files([{ field: 'title', op: 'isEmpty' }]))).toMatch(
      /filter field title is not a field of files/,
    );
    expect(messagesOf(files([], { field: 'kind', direction: 'asc' }))).toMatch(
      /sorted by name, size or createdAt/,
    );
  });

  it('the phone home screen holds at most 4 quick actions, all from tools[] (D-271)', () => {
    const ids = ['pdf-merge', 'pdf-combine', 'pdf-images', 'pdf-document'];
    expect(issuesOf(mutate((c) => (c.nav.phoneHomeScreen = ids)))).toEqual([]);
    const five = messagesOf(mutate((c) => (c.nav.phoneHomeScreen = [...ids, 'pdf-compress'])));
    expect(five).toMatch(/at most 4 quick actions can be on the phone home screen/);
    expect(five).toMatch(/take one off first/);
    expect(messagesOf(mutate((c) => (c.nav.phoneHomeScreen = ['nope'])))).toMatch(
      /nope is not a quick action in tools/,
    );
  });

  it('a page for one entry (page.of) is never opened from the nav, a button, an entry or a reminder', () => {
    const table: Collection = {
      id: 'tasks',
      name: 'Tasks',
      fields: [{ id: 'title', name: 'Title', type: 'text' }],
    };
    const withTask = mutate((c) => {
      c.data.tables.push(table);
      c.containers.pages.push({ id: 'task', title: 'Task', of: 'tasks', blocks: [] });
    });
    expect(issuesOf(withTask)).toEqual([]);
    expect(issuesOf(mutate((c) => (c.nav.bar[1] = 'page:task'), withTask))).toEqual([
      'record-page',
    ]);
    expect(
      issuesOf(
        mutate(
          (c) =>
            home(c).blocks.push({
              id: 'e',
              look: 'entry',
              show: { title: 'T', icon: 'star' },
              opens: 'page:task',
            }),
          withTask,
        ),
      ),
    ).toEqual(['record-page']);
    expect(
      messagesOf(
        mutate(
          (c) =>
            c.tools.push({
              id: 'r',
              kind: 'reminder',
              title: 'R',
              enabled: true,
              when: { every: 'day', at: '09:00' },
              opens: 'page:task',
            }),
          withTask,
        ),
      ),
    ).toMatch(/opens page task, which shows one entry of tasks/);
    expect(
      issuesOf(mutate((c) => Object.assign(c.containers.pages.at(-1)!, { of: 'gone' }), withTask)),
    ).toEqual(['record-page']);
  });

  it('checks the desk above/below blocks like page blocks', () => {
    expect(
      issuesOf(
        mutate((c) => {
          c.containers.desk = {
            above: [
              {
                id: 'go',
                look: 'button',
                show: { label: 'Go', variant: 'filled' },
                opens: 'page:nope',
              },
            ],
          };
        }),
      ),
    ).toEqual(['unknown-page']);
    expect(
      issuesOf(
        mutate((c) => {
          c.containers.desk = {
            below: [
              {
                id: 'f',
                look: 'files',
                show: { title: 'x' },
                source: { table: '$files', limit: 3 },
              },
            ] as never,
          };
        }),
      ),
    ).toContain('schema');
  });

  it('rejects unregistered actions', () => {
    expect(issuesOf(mutate((c) => (merge(c).steps[1]!.action = 'shell.exec')))).toContain(
      'unknown-action',
    );
  });

  it('rejects invalid step params and unsafe name templates', () => {
    expect(issuesOf(mutate((c) => (merge(c).steps[0]!.params = { min: 5, max: 2 })))).toContain(
      'params',
    );
    expect(
      issuesOf(mutate((c) => (merge(c).steps[2]!.params = { template: '{eval:1+1}' }))),
    ).toContain('params');
  });

  it('rejects broken data flow between steps', () => {
    // 去掉「选择文件」后，第一步不再是输入动作。
    expect(issuesOf(mutate((c) => merge(c).steps.splice(0, 1)))).toContain('source');
    // 合并得到 PDF，「存到相册」只接受图片。
    expect(
      issuesOf(
        mutate((c) =>
          merge(c).steps.splice(2, 0, { id: 'photos', action: 'out.saveToPhotos', params: {} }),
        ),
      ),
    ).toContain('binding');
    // 运行时询问的必须是这个动作的参数。
    expect(issuesOf(mutate((c) => (merge(c).steps[2]!.ask = ['nameTemplate'])))).toContain('ask');
  });
});

describe('record quick actions', () => {
  const withTable = mutate((c) => {
    c.data.tables.push({
      id: 'expenses',
      name: '报销',
      fields: [
        { id: 'item', name: '项目', type: 'text' },
        { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
      ],
    });
  });
  const report = (collectionId: string, fields: string[]) =>
    mutate((c) => {
      c.tools.push({
        id: 'report',
        kind: 'quickAction',
        name: '报销单',
        steps: [
          // 动作目录的参数名仍是 collectionId（不是配置结构）。
          { id: 'read', action: 'in.records', params: { collectionId, period: 'thisMonth' } },
          {
            id: 'pdf',
            action: 'print.records',
            params: { template: 'receipt', title: '', fields, pageSize: 'a4' },
          },
        ],
      });
    }, withTable);

  it('accepts a report on an existing table and its fields', () => {
    expect(issuesOf(report('expenses', ['item', 'amount', 'createdAt']))).toEqual([]);
  });

  it('rejects a missing table or a field the table does not have', () => {
    expect(issuesOf(report('trips', []))).toEqual(['data']);
    expect(issuesOf(report('expenses', ['item', 'price']))).toEqual(['data']);
  });
});
