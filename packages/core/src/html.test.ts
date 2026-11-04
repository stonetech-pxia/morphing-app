import { describe, expect, it } from 'vitest';

import type { DataRecord } from './data';
import {
  escapeHtml,
  recordsToHtml,
  reportAttachmentNotes,
  reportAttachments,
  reportAttachmentsToHtml,
  textToHtml,
} from './html';
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

describe('report attachments (D-425)', () => {
  const claims: Collection = {
    id: 'c',
    name: 'Claims',
    fields: [
      { id: 'note', name: 'Note', type: 'text' },
      { id: 'amount', name: 'Amount', type: 'money', currency: 'USD' },
      { id: 'receipt', name: 'Receipt', type: 'file' },
      { id: 'extra', name: 'Extra', type: 'file' },
    ],
  };
  const record = (id: string, values: Record<string, unknown>) => ({
    id,
    collectionId: 'c',
    values,
    createdAt: new Date(2026, 10, 3).getTime(),
    updatedAt: 1,
  });
  const opts = { fields: [], locale: 'en' as const, now: new Date(2026, 10, 4) };

  it('lists attachments in record order, with what the reader needs to find the line', () => {
    const list = reportAttachments(
      claims,
      [
        record('a', { note: 'Taxi', amount: 12, receipt: ['f1', 'f2'], extra: ['f3'] }),
        record('b', { note: 'No files' }),
        record('c', { amount: 5, receipt: ['f4'] }),
      ],
      opts,
    );
    expect(list.map((a) => a.assetId)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(list[1]).toMatchObject({ title: 'Taxi', index: 2, total: 3 });
    expect(list[1]!.detail).toContain('12.00');
    // 没有标题的记录：和列表上一样，表名 · 日期。
    expect(list[3]!.title).toMatch(/^Claims · /);
    // 文件 ID 不是用户要看的，也不算印出来的值。
    expect(list[0]!.detail).not.toContain('attachment');
  });

  it('escapes the caption and only ever embeds the given image data', () => {
    const html = reportAttachmentsToHtml(
      [
        {
          attachment: {
            assetId: 'SECRET-ID',
            title: '<img src=x onerror=alert(1)>',
            detail: '<script>',
            index: 1,
            total: 2,
          },
          jpegBase64: 'QUJD',
        },
      ],
      { pageSize: 'a4', locale: 'en' },
    );
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toContain('<script');
    expect(html).toContain('src="data:image/jpeg;base64,QUJD"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain('SECRET-ID');
    expect(html).toContain('attachment 1 of 2');
  });

  it('says on the report what was left out, in full sentences, in each language', () => {
    for (const locale of ['en', 'zh', 'fr'] as const) {
      const notes = reportAttachmentNotes(
        { overLimit: ['A', 'A', 'B'], unreadable: ['C'] },
        locale,
      );
      expect(notes).toHaveLength(2);
      expect(notes[0]).toContain('3');
      expect(notes[0]).toContain('60');
      expect(notes[1]).toContain('C');
    }
    expect(reportAttachmentNotes({ overLimit: [], unreadable: [] }, 'en')).toEqual([]);
    expect(reportAttachmentNotes({ overLimit: [], unreadable: ['C'] }, 'en')[0]).toMatch(
      /^1 attachment could/,
    );
    // 法语 0、1 是单数。
    expect(reportAttachmentNotes({ overLimit: [], unreadable: ['C'] }, 'fr')[0]).toMatch(
      /^1 pièce jointe illisible/,
    );
  });

  it('prints the notes on the report; without notes the page is what it always was', () => {
    const base = {
      template: 'table' as const,
      title: 'T',
      fields: [],
      pageSize: 'a4' as const,
      locale: 'en' as const,
      now: new Date(2026, 10, 4),
    };
    const plain = recordsToHtml(claims, [], base);
    expect(recordsToHtml(claims, [], { ...base, notes: [] })).toBe(plain);
    const noted = recordsToHtml(claims, [], { ...base, notes: ['2 left <out>'] });
    expect(noted).toContain('<p class="note">2 left &lt;out&gt;</p>');
  });
});
