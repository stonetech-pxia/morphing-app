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

  it('requires protected entries to stay reachable', () => {
    const config = mutate((c) => {
      c.shell.nav = ['page:home', 'tools', 'settings'];
      c.shell.floating = ['ai'];
    });
    expect(issuesOf(config)).toEqual(['protected']);
  });

  it('accepts protected entries as floating buttons', () => {
    const config = mutate((c) => {
      c.shell.nav = ['page:home', 'tools', 'settings'];
      c.shell.floating = ['ai', 'history'];
    });
    expect(issuesOf(config)).toEqual([]);
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
      issuesOf(mutate((c) => (c.workflows[0]!.steps[3]!.params = { nameTemplate: '{eval:1+1}' }))),
    ).toContain('params');
  });

  it('rejects broken data flow between steps', () => {
    // 去掉“选择文件”后，“合并”没有输入。
    expect(issuesOf(mutate((c) => c.workflows[0]!.steps.splice(0, 1)))).toContain('binding');
  });
});
