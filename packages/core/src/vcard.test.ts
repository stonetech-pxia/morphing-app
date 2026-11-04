import { describe, expect, it } from 'vitest';

import { fieldLink } from './field-link';
import type { Field } from './schema';
import {
  contactActions,
  contactCodeValues,
  parseContactCode,
  recordsToVCard,
  recordToVCard,
} from './vcard';

// 名片的两种文字（D-423）：导出的 vCard 别的 App 读得懂，转义、折行都对；值里的换行造不出新的属性；
// 扫到的文字只出字段的值，乱的文字什么都不出。

const FIELDS: Field[] = [
  { id: 'name', name: '姓名', type: 'text' },
  { id: 'job', name: '职位', type: 'text' },
  { id: 'company', name: '公司', type: 'text' },
  { id: 'tel', name: '电话', type: 'text', format: 'phone' },
  { id: 'mail', name: '邮箱', type: 'text', format: 'email' },
  { id: 'site', name: '网站', type: 'text', format: 'url' },
  { id: 'addr', name: '地址', type: 'text' },
  { id: 'note', name: '备注', type: 'note' },
  { id: 'group', name: '分组', type: 'choice', options: [{ id: 'a', label: 'A' }] },
];

const EN_FIELDS: Field[] = [
  { id: 'n', name: 'Name', type: 'text' },
  { id: 'j', name: 'Job title', type: 'text' },
  { id: 'c', name: 'Company', type: 'text' },
  { id: 'a', name: 'Address', type: 'text' },
];

const lines = (text: string | null) => text!.split('\r\n');
/** 按 vCard 规则接回折过的行。 */
const unfold = (text: string | null) => text!.replace(/\r\n[ \t]/g, '').split('\r\n');

describe('record to vCard', () => {
  it('writes name, title and company by what the field is, the rest by format', () => {
    const text = recordToVCard(FIELDS, {
      name: 'Maria Garcia',
      job: 'Sales lead',
      company: 'Acme',
      tel: '+33 6 12 34 56 78',
      mail: 'maria@example.com',
      site: 'www.example.com',
      addr: '1 Rue de la Paix',
    });
    expect(lines(text)).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Maria Garcia',
      'N:Garcia;Maria;;;',
      'ORG:Acme',
      'TITLE:Sales lead',
      'TEL:+33 6 12 34 56 78',
      'EMAIL:maria@example.com',
      'URL:https://www.example.com',
      'ADR:;;1 Rue de la Paix;;;;',
      'END:VCARD',
      '',
    ]);
  });

  it('never writes the note or the group', () => {
    const text = recordToVCard(FIELDS, { name: 'A', note: '私下的话', group: 'a' })!;
    expect(text).not.toContain('私下的话');
    expect(text).not.toContain('NOTE');
  });

  it('keeps Chinese as it is and puts a name without spaces in the family slot', () => {
    expect(unfold(recordToVCard(FIELDS, { name: '张三', company: '北京测试有限公司' }))).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:张三',
      'N:张三;;;;',
      'ORG:北京测试有限公司',
      'END:VCARD',
      '',
    ]);
  });

  it('escapes commas, semicolons and backslashes', () => {
    const text = recordToVCard(FIELDS, { name: 'Doe, John; Jr\\' });
    expect(unfold(text)[2]).toBe('FN:Doe\\, John\\; Jr\\\\');
  });

  it('a value with newlines cannot add a property', () => {
    const text = recordToVCard(FIELDS, {
      name: 'Eve\r\nTEL:+1 900 555\r\nEND:VCARD\nBEGIN:VCARD',
      addr: 'line one\nURL:http://evil.example',
    })!;
    const all = unfold(text);
    expect(all.filter((l) => l.startsWith('TEL'))).toEqual([]);
    expect(all.filter((l) => l.startsWith('URL'))).toEqual([]);
    expect(all.filter((l) => l === 'END:VCARD')).toHaveLength(1);
    expect(all.filter((l) => l === 'BEGIN:VCARD')).toHaveLength(1);
    expect(all[2]).toBe('FN:Eve\\nTEL:+1 900 555\\nEND:VCARD\\nBEGIN:VCARD');
    // 读回来还是一个人的名字，没有多出电话。
    const back = parseContactCode(text)!;
    expect(back.phones).toEqual([]);
    expect(back.urls).toEqual([]);
  });

  it('drops values that do not fit their format, and a website that is not http', () => {
    const text = recordToVCard(FIELDS, {
      name: 'A',
      tel: '分机 123',
      mail: 'a@b.com?bcc=c@d.com',
      site: 'javascript:alert(1)',
    })!;
    expect(unfold(text).filter((l) => /^(TEL|EMAIL|URL)/.test(l))).toEqual([]);
  });

  it('folds long lines at 75 bytes without cutting a character', () => {
    const name = '名'.repeat(120);
    const text = recordToVCard(FIELDS, { name })!;
    const encoder = new TextEncoder();
    for (const line of lines(text)) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(text).not.toContain('\uFFFD');
    expect(unfold(text)[2]).toBe(`FN:${name}`);
    expect(parseContactCode(text)!.name).toBe(name);
  });

  it('uses the company, then the email or phone, when there is no name', () => {
    expect(unfold(recordToVCard(FIELDS, { company: 'Acme' }))[2]).toBe('FN:Acme');
    expect(unfold(recordToVCard(FIELDS, { mail: 'a@b.com' }))[2]).toBe('FN:a@b.com');
    expect(unfold(recordToVCard(FIELDS, { tel: '555 0100' }))[2]).toBe('FN:555 0100');
  });

  it('is null when there is nothing to put on a card', () => {
    expect(recordToVCard(FIELDS, {})).toBeNull();
    expect(recordToVCard(FIELDS, { name: '   ', tel: '分机' })).toBeNull();
    expect(recordToVCard(FIELDS, { note: 'only a note' })).toBeNull();
    expect(recordToVCard([{ id: 'x', name: '金额', type: 'number' }], { x: 3 })).toBeNull();
  });

  it('reads fields by concept in English too, and several records make one file', () => {
    const text = recordsToVCard(EN_FIELDS, [
      { values: { n: 'A', j: 'CTO', c: 'Acme', a: 'Main St' } },
      { values: {} },
      { values: { n: 'B' } },
    ]);
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(text).toContain('TITLE:CTO');
    expect(text).toContain('ADR:;;Main St;;;;');
    expect(recordsToVCard(EN_FIELDS, [{ values: {} }])).toBe('');
  });
});

describe('the buttons of an entry', () => {
  it('takes the first field whose value fits', () => {
    const fields: Field[] = [
      { id: 't1', name: '手机', type: 'text', format: 'phone' },
      { id: 't2', name: '座机', type: 'text', format: 'phone' },
      { id: 'm', name: '邮箱', type: 'text', format: 'email' },
    ];
    expect(contactActions(fields, { t1: '分机', t2: '010 1234', m: 'a@b.com' })).toEqual({
      call: 'tel:0101234',
      message: 'sms:0101234',
      email: 'mailto:a@b.com',
      website: null,
      shareCard: true,
    });
  });

  it('a table without phone or email has no share button, whatever else it holds', () => {
    const fields: Field[] = [
      { id: 'n', name: '姓名', type: 'text' },
      { id: 's', name: '网站', type: 'text', format: 'url' },
    ];
    const a = contactActions(fields, { n: 'A', s: 'example.com' });
    expect(a).toMatchObject({ website: 'https://example.com', shareCard: false });
  });

  it('nothing is valid: nothing to show', () => {
    expect(contactActions(FIELDS, {})).toEqual({
      call: null,
      message: null,
      email: null,
      website: null,
      shareCard: false,
    });
  });

  it('sms follows the same rules as a phone call, only for phone fields', () => {
    const phone: Field = { id: 't', name: 'T', type: 'text', format: 'phone' };
    const mail: Field = { id: 'm', name: 'M', type: 'text', format: 'email' };
    expect(fieldLink(phone, '+33 (6) 12', 'message')?.url).toBe('sms:+33612');
    expect(fieldLink(phone, '分机 123', 'message')).toBeNull();
    expect(fieldLink(phone, 'tel:123?body=x', 'message')).toBeNull();
    expect(fieldLink(mail, 'a@b.com', 'message')).toBeNull();
  });
});

describe('reading a code', () => {
  it('reads a real-shaped vCard 3.0 with CRLF and folded lines', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Garcia;Maria;;Dr;',
      'FN:Maria Garcia',
      'ORG:Acme\\, Inc.;Sales',
      'TITLE:Head of',
      '  Sales',
      'TEL;TYPE=WORK,VOICE:+33 1 23 45 67 89',
      'item1.TEL;TYPE="cell":tel:+33612345678',
      'EMAIL;TYPE=INTERNET:maria@example.com',
      'URL:https\\://example.com/a',
      'ADR;TYPE=WORK:;;1 Rue de la Paix;Paris;;75002;France',
      'PHOTO;ENCODING=b;TYPE=JPEG:AAAA',
      'END:VCARD',
      'TEL:+1 999 999',
    ].join('\r\n');
    expect(parseContactCode(text)).toEqual({
      name: 'Maria Garcia',
      title: 'Head of Sales',
      company: 'Acme, Inc.',
      address: '1 Rue de la Paix, Paris, 75002, France',
      phones: ['+33 1 23 45 67 89', '+33612345678'],
      emails: ['maria@example.com'],
      urls: ['https://example.com/a'],
    });
  });

  it('reads LF-only cards, and N when there is no FN (Chinese has no space)', () => {
    expect(parseContactCode('BEGIN:VCARD\nN:张;三;;;\nTEL:13800000000\nEND:VCARD')).toEqual({
      name: '张三',
      phones: ['13800000000'],
      emails: [],
      urls: [],
    });
    expect(parseContactCode('BEGIN:VCARD\nN:Doe;John\nEND:VCARD')?.name).toBe('John Doe');
  });

  it('skips encoded values instead of guessing', () => {
    expect(
      parseContactCode(
        'BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0\nEMAIL:a@b.com\nEND:VCARD',
      ),
    ).toEqual({ phones: [], emails: ['a@b.com'], urls: [] });
  });

  it('never keeps a link that is not http(s) or a phone with letters', () => {
    const code = parseContactCode(
      'BEGIN:VCARD\nFN:A\nURL:javascript:alert(1)\nTEL:call me\nEMAIL:mailto:a@b.com\nEND:VCARD',
    )!;
    expect(code).toEqual({ name: 'A', phones: [], emails: [], urls: [] });
  });

  it('reads a MeCard', () => {
    expect(
      parseContactCode(
        'MECARD:N:Doe,John;ORG:Acme\\, Inc.;TEL:+1 555 0100;EMAIL:j@example.com;URL:http\\://example.com;ADR:1 Main St\\, City;NOTE:x;;',
      ),
    ).toEqual({
      name: 'John Doe',
      company: 'Acme, Inc.',
      address: '1 Main St, City',
      phones: ['+1 555 0100'],
      emails: ['j@example.com'],
      urls: ['http://example.com'],
    });
    expect(parseContactCode('MECARD:N:李,四;;')?.name).toBe('李四');
  });

  it('a web address is only a website', () => {
    expect(parseContactCode(' https://example.com/me ')).toEqual({
      phones: [],
      emails: [],
      urls: ['https://example.com/me'],
    });
    expect(parseContactCode('www.example.com')?.urls).toEqual(['www.example.com']);
  });

  it.each([
    '',
    '   ',
    'hello world',
    '13800000000',
    'tel:13800000000',
    'mailto:a@b.com',
    'WIFI:T:WPA;S:x;P:y;;',
    'javascript:alert(1)',
    'BEGIN:VCARD',
    'BEGIN:VCARD\nEND:VCARD',
    'MECARD:;;',
    'x'.repeat(9000),
    '\u0000\u0001',
  ])('anything else is ignored: %j', (text) => {
    expect(parseContactCode(text)).toBeNull();
  });

  it('maps values onto the fields of the table', () => {
    const code = parseContactCode(
      'BEGIN:VCARD\nFN:A\nTITLE:CTO\nORG:Acme\nTEL:555 0100\nEMAIL:a@b.com\nURL:example.com\nADR:;;Street;;;;\nEND:VCARD',
    )!;
    expect(contactCodeValues(FIELDS, code)).toEqual({
      name: ['A'],
      job: ['CTO'],
      company: ['Acme'],
      tel: ['555 0100'],
      mail: ['a@b.com'],
      site: ['example.com'],
      addr: ['Street'],
    });
    expect(
      contactCodeValues([{ id: 'x', name: '金额', type: 'money', currency: 'CNY' }], code),
    ).toEqual({});
  });

  it('what we export reads back the same', () => {
    const values = {
      name: '王, 小明',
      job: 'R&D; 主管',
      company: '北京\\测试',
      tel: '+86 138 0000 0000',
      mail: 'x@example.cn',
      site: 'https://example.cn/a?b=1',
      addr: '北京市，海淀区\n中关村 1 号',
    };
    const code = parseContactCode(recordToVCard(FIELDS, values)!)!;
    expect(contactCodeValues(FIELDS, code)).toEqual({
      name: ['王, 小明'],
      job: ['R&D; 主管'],
      company: ['北京\\测试'],
      tel: ['+86 138 0000 0000'],
      mail: ['x@example.cn'],
      site: ['https://example.cn/a?b=1'],
      addr: ['北京市，海淀区 中关村 1 号'],
    });
  });
});

describe('记录 → vCard 的分号', () => {
  it('值里的分号要转义，否则公司名会被拆成两段（RFC 2426）', () => {
    const fields = [{ id: 'company', name: 'Company', type: 'text' }] as Field[];
    const card = recordToVCard(fields, { company: 'Acme; Sons' })!;
    expect(card).toContain('ORG:Acme\\; Sons');
    expect(parseContactCode(card)).not.toBeNull();
  });
});
