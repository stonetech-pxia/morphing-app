import { describe, expect, it } from 'vitest';

import type { Locale } from './schema';
import { DATA_TEMPLATES, templateOps } from './templates';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 页面模版（templates/*.json，D-255）：每个模版在三种语言下生成的配置都要通过校验，
// 导航栏有空位、没空位、表和页面 ID 已经被占用时都一样。

describe.each(DATA_TEMPLATES)('template %s', (template) => {
  it.each(['en', 'zh', 'fr'] as Locale[])('builds a valid table and page in %s', (locale) => {
    const full = workspace(locale);
    const roomy = apply(full, [{ op: 'setNavItems', items: ['page:home', 'settings'] }], locale);
    for (const config of [full, roomy]) {
      const once = apply(config, templateOps(template, config, locale), locale);
      const twice = apply(once, templateOps(template, once, locale), locale);
      for (const result of [once, twice]) {
        const valid = validateWorkspace(result, registry);
        expect(valid.ok ? [] : valid.issues).toEqual([]);
      }
      expect(twice.collections).toHaveLength(2);
      // 用户看到的文字都换成了这种语言，没有留下 { en, zh, fr } 或占位符。
      expect(JSON.stringify(twice)).not.toMatch(/"en":|\$collection|\$page/);
    }
  });
});
