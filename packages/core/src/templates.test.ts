import { describe, expect, it } from 'vitest';

import type { Locale } from './schema';
import { DATA_TEMPLATES, templateOps } from './templates';
import { apply, fromV33, registry, v33Fixture, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 页面模版（templates/*.json，D-255）：每个模版在三种语言下生成的配置都要通过校验，
// 导航栏有空位、没空位、表和页面 ID 已经被占用时都一样。

describe.each(DATA_TEMPLATES)('template %s', (template) => {
  it.each(['en', 'zh', 'fr'] as Locale[])('builds a valid table and page in %s', (locale) => {
    const full = workspace(locale);
    const roomy = apply(
      full,
      [{ op: 'updateContainer', nav: { bar: ['page:home', 'settings'] } }],
      locale,
    );
    for (const config of [full, roomy]) {
      const once = apply(config, templateOps(template, config, locale), locale);
      const twice = apply(once, templateOps(template, once, locale), locale);
      for (const result of [once, twice]) {
        const valid = validateWorkspace(result, registry);
        expect(valid.ok ? [] : valid.issues).toEqual([]);
      }
      expect(twice.data.tables).toHaveLength(2);
      // 用户看到的文字都换成了这种语言，没有留下 { en, zh, fr } 或占位符。
      expect(JSON.stringify(twice)).not.toMatch(/"en":|\$table|\$page/);
    }
  });

  it('builds the same table and page as the v33 template, migrated (zh)', () => {
    // fixtures/v33/template-<名字>.json：v33 代码在默认工作空间上套用模版的结果（导航栏满了，入口在首页）。
    const expected = fromV33(v33Fixture(`template-${template}`));
    const config = workspace('zh');
    const result = apply(config, templateOps(template, config, 'zh'), 'zh');
    expect(result).toEqual(expected);
  });
});
