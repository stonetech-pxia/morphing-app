import { describe, expect, it } from 'vitest';

import type { DataRecord } from './data';
import { escapeHtml, recordsToHtml, textToHtml } from './html';
import type { Collection } from './schema';

const expenses: Collection = {
  id: 'expenses',
  name: '报销',
  fields: [
    { id: 'item', name: '项目', type: 'text' },
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    { id: 'day', name: '日期', type: 'date' },
  ],
};
const record = (id: string, values: Record<string, unknown>): DataRecord => ({
  id,
  collectionId: 'expenses',
  values,
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
});
const records = [
  record('a', { item: '<script>alert(1)</script>', amount: 12.5, day: '2026-10-01' }),
  record('b', { item: '出租车 & 地铁', amount: 30, day: '2026-10-02' }),
];
const now = new Date(2026, 9, 22);

describe('HTML templates', () => {
  it('escapes everything the user wrote', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    const html = textToHtml('第一段\n第二行 <b>\n\n第二段', { fontSize: 12, pageSize: 'a4' });
    expect(html).toContain('<p>第一段<br>第二行 &lt;b&gt;</p>');
    expect(html).toContain('<p>第二段</p>');
    expect(html).toContain('size: 595pt 842pt');
    expect(html).not.toMatch(/<script/i);
  });

  it('renders records as a table with only the chosen fields, escaped, and a total on receipts', () => {
    const html = recordsToHtml(expenses, records, {
      template: 'receipt',
      title: '十月报销',
      fields: ['item', 'amount', 'nope'],
      pageSize: 'letter',
      locale: 'zh',
      now,
    });
    expect(html).toContain('<h1>十月报销</h1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('出租车 &amp; 地铁');
    expect(html).toContain('<th class="num">金额</th>');
    expect(html).not.toContain('日期');
    expect(html).toContain('合计 · 金额：<strong>¥42.50</strong>');
    expect(html).toContain('2 条 · 2026-10-22');
  });

  it('renders cards with every field when none are chosen', () => {
    const html = recordsToHtml(expenses, records, {
      template: 'cards',
      title: '',
      fields: [],
      pageSize: 'a4',
      locale: 'en',
      now,
    });
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).toContain('<h1>报销</h1>');
    expect(html).toContain('<span class="k">日期</span><span class="v">2026-10-02</span>');
  });
});
