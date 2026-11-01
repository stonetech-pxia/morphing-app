import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { componentLabel } from './describe';
import { COMPONENTS, type Component, type Locale, type WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 每个登记的组件都要满足的事（新增组件时这里会自动检查它，见 docs/COMPONENTS.md）。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];

/**
 * 外观 example 能引用的东西：数据表 expenses（记账模版的表，加一个勾选字段 paid 给清单的例子用）、
 * 已添加的工具包 pdf 和它的快捷操作。
 */
function fixture(locale: Locale): WorkspaceConfig {
  const config = workspace(locale, { withPdf: true });
  const expenses = fromV33(v33Fixture('template-budget')).data.tables[0]!;
  const paid = { id: 'paid', name: 'Paid', type: 'checkbox' as const };
  return { ...config, data: { tables: [{ ...expenses, fields: [...expenses.fields, paid] }] } };
}

function withExample(config: WorkspaceConfig, def: (typeof COMPONENTS)[number]): WorkspaceConfig {
  const block = { id: 'example', look: def.look, ...def.example } as Component;
  const [home, ...rest] = config.containers.pages;
  return {
    ...config,
    containers: {
      ...config.containers,
      pages: [{ ...home!, blocks: [...home!.blocks, block] }, ...rest],
    },
  };
}

/** 文字属性在结构里的长度上限（可以不写的先拆掉 optional）。 */
function maxLength(props: z.ZodObject, prop: string): number | null | undefined {
  const schema = props.shape[prop] as z.ZodType | undefined;
  if (!schema) return undefined;
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  return inner instanceof z.ZodString ? inner.maxLength : undefined;
}

describe.each(COMPONENTS.map((d) => [d.look, d] as const))('look %s', (_type, def) => {
  it.each(LOCALES)('its example passes structure and reference checks in %s', (locale) => {
    const result = validateWorkspace(withExample(fixture(locale), def), registry);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(LOCALES)('has a change description in %s', (locale) => {
    const config = withExample(fixture(locale), def);
    const component = config.containers.pages[0]!.blocks.at(-1)!;
    const label = componentLabel(component, config, { registry, locale, now: new Date() });
    expect(label.trim()).not.toBe('');
  });

  it('lists only text props that exist in show, with the same length limit', () => {
    const show = (def.shape as z.ZodRawShape).show as z.ZodType | undefined;
    const inner = show instanceof z.ZodOptional ? show.unwrap() : show;
    for (const field of def.edit.text) {
      expect(inner).toBeInstanceOf(z.ZodObject);
      const props = inner as z.ZodObject;
      expect({ prop: field.prop, max: maxLength(props, field.prop) }).toEqual({
        prop: field.prop,
        max: field.max,
      });
      // 入口的标题结构上可以不写（工具包的入口按工具包现取），长按编辑按种类列（entryEditableText）。
      if (def.look === 'entry' && field.prop === 'title') continue;
      const shape = props.shape as Record<string, z.ZodType>;
      const optional = shape[field.prop] instanceof z.ZodOptional;
      expect({ prop: field.prop, optional }).toEqual({
        prop: field.prop,
        optional: field.optional ?? false,
      });
    }
  });

  it('has a doc line for the AI, and its rule (if any) does not clash', () => {
    expect(def.ai.doc.trim()).not.toBe('');
    if (def.ai.docAfter) expect(COMPONENTS.map((d) => d.look)).toContain(def.ai.docAfter);
    const numbers = COMPONENTS.flatMap((d) => (d.ai.rule ? [d.ai.rule.n] : []));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
