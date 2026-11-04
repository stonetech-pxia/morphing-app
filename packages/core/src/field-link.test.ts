import { describe, expect, it } from 'vitest';

import { createDefaultWorkspace } from './defaults';
import { describeChange } from './describe';
import { fieldLink } from './field-link';
import { formatValue, prepareRecordValues } from './data';
import { prepareOps } from './change';
import { applyOps } from './ops';
import type { Collection, Field } from './schema';
import { registry } from './test-helpers';
import { linkTarget } from './richtext';

// 文字字段的 format（D-422）：只可能出 tel:、mailto:、http(s)://；对不上就不能点。

const field = (format?: 'phone' | 'email' | 'url'): Field => ({
  id: 'v',
  name: 'v',
  type: 'text',
  ...(format ? { format } : {}),
});
const phone = field('phone');
const email = field('email');
const url = field('url');

describe('phone', () => {
  it.each([
    ['+33 6 12 34 56 78', 'tel:+33612345678'],
    ['(021) 1234-5678', 'tel:02112345678'],
    ['（021）1234-5678', 'tel:02112345678'],
    ['(+33) 6 12', 'tel:+33612'],
    ['  110  ', 'tel:110'],
    ['123', 'tel:123'],
  ])('%s opens %s', (value, expected) => {
    expect(fieldLink(phone, value)).toEqual({ kind: 'phone', url: expected });
  });

  it.each([
    '',
    '   ',
    '12',
    '+1',
    '分机 123',
    'Tel: 123456',
    'tel:123456',
    '12+345',
    '123\n456',
    'javascript:alert(1)',
  ])('%j does not open', (value) => {
    expect(fieldLink(phone, value)).toBeNull();
  });
});

describe('email', () => {
  it('opens the address as written', () => {
    expect(fieldLink(email, ' maria@northwind.example.com ')).toEqual({
      kind: 'email',
      url: 'mailto:maria@northwind.example.com',
    });
  });

  it.each([
    '',
    '   ',
    'maria',
    'maria@',
    '@x.com',
    'maria@x',
    'a b@x.com',
    'a@b@x.com',
    'mailto:a@x.com',
    'a@x.com?bcc=evil@y.com',
    'a@x.com?subject=hi',
    'a@x.com\nbcc:evil@y.com',
    'a\n@x.com',
    'a@x.com,b@y.com',
  ])('%j does not open', (value) => {
    expect(fieldLink(email, value)).toBeNull();
  });

  it('a query written before the @ stays part of the address: it adds no header', () => {
    const link = fieldLink(email, 'a?bcc=evil&subject=hi@x.com');
    expect(link?.url).toBe('mailto:a%3Fbcc%3Devil%26subject%3Dhi@x.com');
    expect(link?.url).not.toContain('?');
  });
});

describe('url', () => {
  it.each([
    ['www.x.com', 'https://www.x.com'],
    ['x.com', 'https://x.com'],
    ['x.com/a?b=1#c', 'https://x.com/a?b=1#c'],
    ['x.com:8080/a', 'https://x.com:8080/a'],
    ['http://x.com', 'http://x.com'],
    ['https://x.com/a', 'https://x.com/a'],
    ['HTTPS://x.com', 'https://x.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('%s opens %s', (value, expected) => {
    expect(fieldLink(url, value)).toEqual({ kind: 'url', url: expected });
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'JaVaScRiPt:alert(1)',
    'javascript://x.com/%0aalert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'tel:12345',
    'mailto:a@x.com',
    'ftp://x.com',
    'http:x.com',
    'http:/x.com',
    '//x.com',
    'https://',
    '3.14',
    'hello',
    'a b.com',
    'x.com/a b',
    'x.com\n/a',
    // 看着是一个网站，其实去另一个：不去掉、不猜，不能点。
    'https://x.com@evil.com',
    'https://x.com:pw@evil.com',
    'x.com@evil.com',
    'https://x.com\\@evil.com',
    'https://x%2ecom',
    'https://-x.com',
  ])('%j does not open', (value) => {
    expect(fieldLink(url, value)).toBeNull();
  });

  it('the confirmation names the host for http as well as https', () => {
    expect(linkTarget('http://x.com/a')).toBe('x.com');
    expect(linkTarget('https://x.com:8080/a')).toBe('x.com:8080');
  });
});

describe('a field without format', () => {
  it('never opens, even for something that looks like a link', () => {
    for (const value of ['+33 6 12 34 56 78', 'a@x.com', 'https://x.com'])
      expect(fieldLink(field(), value)).toBeNull();
  });

  it('a value that is not text does not open', () => {
    for (const value of [undefined, null, 123, { a: 1 }])
      expect(fieldLink(phone, value)).toBeNull();
  });

  it('another field type does not open', () => {
    expect(fieldLink({ id: 'n', name: 'n', type: 'note' }, 'https://x.com')).toBeNull();
  });
});

describe('format stays a text field', () => {
  const collection: Collection = { id: 't', name: 't', fields: [phone] };

  it('saving does not check the format', () => {
    for (const value of ['分机 123', 'not a phone', '12'])
      expect(prepareRecordValues(collection, { v: value }, null, new Date())).toEqual({
        ok: true,
        values: { v: value },
      });
  });

  it('the text limits still apply', () => {
    const r = prepareRecordValues(collection, { v: 'x'.repeat(201) }, null, new Date());
    expect(r.ok).toBe(false);
  });

  it('shows the value as written', () => {
    expect(formatValue(phone, '+33 6 12', 'en')).toBe('+33 6 12');
  });

  const ctx = { registry, locale: 'en' as const, now: new Date(2026, 10, 4) };
  const withTable = () => {
    const r = applyOps(
      createDefaultWorkspace('en'),
      [{ op: 'addData', table: { id: 't', name: 'T', fields: [field()] } }],
      ctx,
    );
    if (!r.ok) throw new Error(r.error);
    return r.config;
  };

  it('an existing text field switches through the field-change op, and back', () => {
    const on = applyOps(
      withTable(),
      [{ op: 'updateData', table: 't', field: 'v', changes: { format: 'url' } }],
      ctx,
    );
    if (!on.ok) throw new Error(on.error);
    expect(on.config.data.tables.find((t) => t.id === 't')?.fields[0]).toMatchObject({
      type: 'text',
      format: 'url',
    });
    const off = applyOps(
      on.config,
      [{ op: 'updateData', table: 't', field: 'v', changes: { format: null } }],
      ctx,
    );
    if (!off.ok) throw new Error(off.error);
    expect(off.config.data.tables.find((t) => t.id === 't')?.fields[0]).toEqual(field());
  });

  it('turning it into a long text drops format, a long text cannot have one', () => {
    const on = applyOps(
      withTable(),
      [{ op: 'updateData', table: 't', field: 'v', changes: { format: 'url' } }],
      ctx,
    );
    if (!on.ok) throw new Error(on.error);
    const note = applyOps(
      on.config,
      [{ op: 'updateData', table: 't', field: 'v', changes: { type: 'note' } }],
      ctx,
    );
    if (!note.ok) throw new Error(note.error);
    expect(note.config.data.tables.find((t) => t.id === 't')?.fields[0]).toEqual({
      id: 'v',
      name: 'v',
      type: 'note',
    });
    expect(
      prepareOps(
        note.config,
        [{ op: 'updateData', table: 't', field: 'v', changes: { format: 'url' } }],
        ctx,
      ).ok,
    ).toBe(false);
  });

  it('a format that does not exist is refused', () => {
    expect(
      prepareOps(
        withTable(),
        [{ op: 'updateData', table: 't', field: 'v', changes: { format: 'fax' } }],
        ctx,
      ).ok,
    ).toBe(false);
  });

  it('the change log says what changed', () => {
    const before = withTable();
    const op = { op: 'updateData', table: 't', field: 'v', changes: { format: 'phone' } } as const;
    const on = applyOps(before, [op], ctx);
    if (!on.ok) throw new Error(on.error);
    expect(describeChange([op], on.config, [], ctx)).toEqual(
      expect.arrayContaining([expect.stringContaining('format → phone')]),
    );
  });
});
