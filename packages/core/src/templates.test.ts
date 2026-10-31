import { describe, expect, it } from 'vitest';

import type { Locale } from './schema';
import {
  DATA_TEMPLATES,
  FILE_RECORD_PRESETS,
  templateCollectionOp,
  templateOps,
  templateTableName,
} from './templates';
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

// 收件页面「存成记录」的预设表（D-386）：三种语言下都通过校验、都有附件字段、名字和 ID 已被占用时加 -2，
// 字段按创始人定的（2026-10-31）。
describe.each(FILE_RECORD_PRESETS)('file record preset %s', (preset) => {
  it.each(['en', 'zh', 'fr'] as Locale[])(
    'builds a valid table with attachments in %s',
    (locale) => {
      const full = workspace(locale);
      const roomy = apply(
        full,
        [{ op: 'updateContainer', nav: { bar: ['page:home', 'settings'] } }],
        locale,
      );
      for (const config of [full, roomy]) {
        const once = apply(config, templateOps(preset, config, locale), locale);
        const twice = apply(once, templateOps(preset, once, locale), locale);
        for (const result of [once, twice]) {
          const valid = validateWorkspace(result, registry);
          expect(valid.ok ? [] : valid.issues).toEqual([]);
        }
        const added = twice.data.tables.slice(-2);
        expect(added[1]!.id).toBe(`${added[0]!.id}-2`);
        expect(twice.containers.pages.slice(-1)[0]!.id).toMatch(/-2$/);
        for (const table of added) {
          expect(table.fields.filter((f) => f.type === 'file').map((f) => f.id)).toEqual([
            'attachments',
          ]);
          expect(table.name).toBe(templateTableName(preset, locale));
        }
        expect(JSON.stringify(twice)).not.toMatch(/"en":|\$table|\$page/);
      }
    },
  );
});

describe('file record presets', () => {
  it('have the fields the founder chose (zh)', () => {
    const config = workspace('zh');
    const fields = Object.fromEntries(
      FILE_RECORD_PRESETS.map((p) => {
        const op = templateCollectionOp(p, config, 'zh');
        return [p, [op.table.name, ...op.table.fields.map((f) => `${f.name}:${f.type}`)].join(' ')];
      }),
    );
    expect(fields).toEqual({
      purchase: '购物凭证 商家:text 日期:date 金额:money 备注:text 附件:file',
      bill: '账单 出具方:text 到期日:date 金额:money 已付:checkbox 附件:file',
      contract: '合同 名称:text 对方:text 签订日期:date 到期日:date 附件:file',
      reimbursement: '报销 事由:text 日期:date 金额:money 状态:choice 附件:file',
      blank: '我的记录 标题:text 附件:file',
    });
    const status = templateCollectionOp('reimbursement', config, 'zh').table.fields.find(
      (f) => f.id === 'status',
    );
    expect(status?.type === 'choice' && status.options.map((o) => o.label)).toEqual([
      '待提交',
      '已提交',
      '已报销',
    ]);
  });

  it('use the currency of the language, like the budget template', () => {
    for (const [locale, currency] of [
      ['en', 'USD'],
      ['zh', 'CNY'],
      ['fr', 'EUR'],
    ] as const) {
      const fields = templateCollectionOp('purchase', workspace(locale), locale).table.fields;
      expect(fields.find((f) => f.type === 'money')).toMatchObject({ currency });
    }
  });

  it('are not templates the mock AI or the evals know', () => {
    for (const p of FILE_RECORD_PRESETS) expect(DATA_TEMPLATES).not.toContain(p);
  });
});
