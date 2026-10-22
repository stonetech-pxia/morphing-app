import { describe, expect, it } from 'vitest';

import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import type { WorkspaceConfig } from './schema';

const issuesOf = (config: unknown) => {
  const result = validateWorkspace(config, registry);
  return result.ok ? [] : result.issues.map((i) => i.code);
};

const mutate = (fn: (c: WorkspaceConfig) => void, base = workspace('zh', { withPdf: true })) => {
  const copy = JSON.parse(JSON.stringify(base)) as WorkspaceConfig;
  fn(copy);
  return copy;
};

describe('validateWorkspace', () => {
  it('accepts the default workspace in both languages, with and without the PDF tool', () => {
    for (const locale of ['zh', 'en'] as const) {
      expect(issuesOf(workspace(locale))).toEqual([]);
      expect(issuesOf(workspace(locale, { withPdf: true }))).toEqual([]);
    }
  });

  it('rejects non-whitelisted components and unknown props', () => {
    expect(
      issuesOf(mutate((c) => c.pages[0]!.components.push({ id: 'x', type: 'html' } as never))),
    ).toContain('schema');
    expect(
      issuesOf(
        mutate((c) => Object.assign(c.pages[0]!.components[0]!.props, { onPress: 'alert(1)' })),
      ),
    ).toContain('schema');
  });

  it('rejects a wrong schemaVersion', () => {
    expect(issuesOf(mutate((c) => Object.assign(c, { schemaVersion: 99 })))).toContain('schema');
  });

  it('requires Settings to stay in the nav bar or a floating button', () => {
    const config = mutate((c) => {
      c.shell.nav = ['page:home', 'tools', 'ai'];
      c.shell.floating = ['history'];
    });
    expect(issuesOf(config)).toEqual(['protected']);
    expect(
      issuesOf(
        mutate((c) => {
          c.shell.nav = ['page:home'];
          c.shell.floating = ['settings'];
        }),
      ),
    ).toEqual([]);
  });

  it('allows AI, History and Tools to be left out of the nav entirely', () => {
    const config = mutate((c) => {
      c.shell.nav = ['page:home', 'settings'];
      c.shell.floating = [];
    });
    expect(issuesOf(config)).toEqual([]);
  });

  it('rejects themes whose text would be hard to read', () => {
    expect(issuesOf(mutate((c) => (c.theme.colors = { text: '#D0D0D0' })))).toContain('contrast');
    // 浅色模式下合格的深色背景配深色文字，在“跟随系统”时两种外观都要检查。
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

  it('rejects buttons and shortcuts that open missing pages, and duplicate ids inside groups', () => {
    expect(
      issuesOf(
        mutate((c) =>
          c.pages[0]!.components.push({
            id: 'go',
            type: 'button',
            props: { label: 'Go', target: 'page:nope', variant: 'filled' },
          }),
        ),
      ),
    ).toContain('unknown-page');
    expect(
      issuesOf(
        mutate((c) =>
          c.pages[0]!.components.push({
            id: 'g',
            type: 'group',
            props: { layout: 'row' },
            children: [{ id: 'welcome', type: 'divider', props: {} }],
          }),
        ),
      ),
    ).toContain('duplicate');
  });

  it('rejects unknown icons and groups nested in groups', () => {
    expect(issuesOf(mutate((c) => Object.assign(c.pages[0]!, { icon: 'skull' })))).toContain(
      'schema',
    );
    expect(
      issuesOf(
        mutate((c) =>
          c.pages[0]!.components.push({
            id: 'g',
            type: 'group',
            props: { layout: 'row' },
            children: [
              { id: 'inner', type: 'group', props: { layout: 'row' }, children: [] } as never,
            ],
          }),
        ),
      ),
    ).toContain('schema');
  });

  it('rejects nav entries for missing pages and duplicate ids', () => {
    expect(issuesOf(mutate((c) => (c.shell.nav[0] = 'page:nope')))).toContain('unknown-page');
    expect(
      issuesOf(mutate((c) => c.pages[0]!.components.push({ ...c.pages[0]!.components[0]! }))),
    ).toContain('duplicate');
  });

  it('rejects tool cards and workflows for tools that are not installed', () => {
    const noPdf = workspace();
    expect(
      issuesOf(
        mutate(
          (c) =>
            c.pages[0]!.components.push({
              id: 'card-pdf',
              type: 'toolCard',
              props: { toolId: 'pdf' },
            }),
          noPdf,
        ),
      ),
    ).toContain('unknown-tool');
  });

  it('rejects unregistered actions', () => {
    expect(issuesOf(mutate((c) => (c.workflows[0]!.steps[1]!.action = 'shell.exec')))).toContain(
      'unknown-action',
    );
  });

  it('rejects invalid step params and unsafe name templates', () => {
    expect(
      issuesOf(mutate((c) => (c.workflows[0]!.steps[0]!.params = { min: 5, max: 2 }))),
    ).toContain('params');
    expect(
      issuesOf(mutate((c) => (c.workflows[0]!.steps[2]!.params = { template: '{eval:1+1}' }))),
    ).toContain('params');
  });

  it('rejects broken data flow between steps', () => {
    // 去掉“选择文件”后，第一步不再是输入动作。
    expect(issuesOf(mutate((c) => c.workflows[0]!.steps.splice(0, 1)))).toContain('source');
    // 合并得到 PDF，「存到相册」只接受图片。
    expect(
      issuesOf(
        mutate((c) =>
          c.workflows[0]!.steps.splice(2, 0, {
            id: 'photos',
            action: 'out.saveToPhotos',
            params: {},
          }),
        ),
      ),
    ).toContain('binding');
    // 运行时询问的必须是这个动作的参数。
    expect(issuesOf(mutate((c) => (c.workflows[0]!.steps[2]!.ask = ['nameTemplate'])))).toContain(
      'ask',
    );
  });
});

describe('record workflows', () => {
  const withTable = mutate((c) => {
    c.collections.push({
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
      c.workflows.push({
        id: 'report',
        name: '报销单',
        steps: [
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
