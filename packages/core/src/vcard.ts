import { fieldLink, formatLink } from './field-link';
import type { TextFormat } from './fields/text';
import { conceptOf } from './prefill/concepts';
import { withDocKind } from './prefill/doc-context';
import type { Field } from './schema';

// 名片的两种文字（D-423）：记录 → vCard 3.0；扫到的 vCard / MeCard / 网址 → 字段的候选。纯函数，只在本机。
// 姓名、职位、公司、地址按字段是什么（conceptOf，和名片表同一份词典），电话、邮箱、网址按 format。
// 不写照片、备注、分组；值对不上 format 的不写（点不了的电话也拨不了），网址只可能是 http(s)。

type Slot = 'name' | 'title' | 'company' | 'address' | TextFormat;

const SLOT_OF_CONCEPT: Readonly<Record<string, Slot>> = {
  name: 'name',
  jobTitle: 'title',
  company: 'company',
  address: 'address',
  phone: 'phone',
  email: 'email',
  website: 'url',
};

function slotOf(field: Field): Slot | null {
  if (field.type === 'text' && field.format) return field.format;
  if (field.type !== 'text' && field.type !== 'note') return null;
  // 职位、网址两个概念只在名片规则下认（D-421）。
  const concept = withDocKind('card', () => conceptOf(field));
  return concept === null ? null : (SLOT_OF_CONCEPT[concept] ?? null);
}

// ---- 记录 → vCard ----

/** 换行统一成 \n，别的控制字符去掉。 */
function tidy(value: string): string {
  return value
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\p{Cc}/gu, ''))
    .join('\n')
    .trim();
}

/** RFC 2426 的转义。换行变成字面的 \n，所以值里的换行造不出新的一行（例如假的 TEL）。 */
const escapeValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

const utf8Bytes = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
};

/** 一行不超过 75 个字节（RFC 2425），续行以空格开头；不会把一个字切成两半。 */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = utf8Bytes(ch);
    if (bytes + n > 75) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n');
}

/** N 是必须的：有空格时最后一段算姓（Maria Garcia），没有空格（中文）整个放在姓那一格。 */
function structuredName(name: string): string {
  const parts = name.split(/\s+/);
  const family = parts.pop()!;
  return `${escapeValue(family)};${escapeValue(parts.join(' '))};;;`;
}

/**
 * 一条记录的 vCard 3.0（CRLF、UTF-8 文字）。这张表没有名片内容（姓名、公司、电话、邮箱……都空）时是 null。
 * FN 必须有：没有姓名时用公司、邮箱或电话。
 */
export function recordToVCard(
  fields: readonly Field[],
  values: Readonly<Record<string, unknown>>,
): string | null {
  const one: Partial<Record<Slot, string>> = {};
  const many: Record<TextFormat, string[]> = { phone: [], email: [], url: [] };
  for (const field of fields) {
    const slot = slotOf(field);
    const raw = values[field.id];
    if (!slot || typeof raw !== 'string') continue;
    const value = tidy(raw);
    if (!value) continue;
    if (slot === 'phone' || slot === 'email' || slot === 'url') {
      const link = fieldLink(field, value);
      if (link) many[slot].push(slot === 'url' ? link.url : value);
    } else one[slot] ??= value;
  }
  const fn = one.name ?? one.company ?? many.email[0] ?? many.phone[0];
  if (fn === undefined && many.url.length === 0 && !one.title && !one.address) return null;
  const shown = fn ?? one.title ?? one.address ?? many.url[0]!;
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeValue(shown)}`,
    `N:${one.name ? structuredName(one.name) : ';;;;'}`,
    ...(one.company ? [`ORG:${escapeValue(one.company)}`] : []),
    ...(one.title ? [`TITLE:${escapeValue(one.title)}`] : []),
    ...many.phone.map((v) => `TEL:${escapeValue(v)}`),
    ...many.email.map((v) => `EMAIL:${escapeValue(v)}`),
    ...many.url.map((v) => `URL:${escapeValue(v)}`),
    ...(one.address ? [`ADR:;;${escapeValue(one.address)};;;;`] : []),
    'END:VCARD',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** 几条记录合成一个 .vcf 的文字；没有一条有名片内容时是空的。 */
export function recordsToVCard(
  fields: readonly Field[],
  records: readonly { values: Readonly<Record<string, unknown>> }[],
): string {
  return records.flatMap((r) => recordToVCard(fields, r.values) ?? []).join('');
}

// ---- 记录页顶部的按钮 ----

export interface ContactActions {
  call: string | null;
  message: string | null;
  email: string | null;
  website: string | null;
  /** 这张表有电话或邮箱字段，这条也有名片内容。 */
  shareCard: boolean;
}

/** 记录页顶部哪些按钮有效（D-423）：只看 format，第一个值对得上的字段。 */
export function contactActions(
  fields: readonly Field[],
  values: Readonly<Record<string, unknown>>,
): ContactActions {
  const first = (format: TextFormat, as?: 'message') => {
    for (const f of fields) {
      if (f.type !== 'text' || f.format !== format) continue;
      const link = fieldLink(f, values[f.id], as);
      if (link) return link.url;
    }
    return null;
  };
  return {
    call: first('phone'),
    message: first('phone', 'message'),
    email: first('email'),
    website: first('url'),
    shareCard:
      fields.some((f) => f.type === 'text' && (f.format === 'phone' || f.format === 'email')) &&
      recordToVCard(fields, values) !== null,
  };
}

// ---- 扫到的文字 → 字段的候选 ----

export interface ContactCode {
  name?: string;
  title?: string;
  company?: string;
  address?: string;
  phones: string[];
  emails: string[];
  urls: string[];
}

/** 字段放不下的值（文字字段最多 200 字）不算；一种最多留几个值。 */
const MAX_VALUE = 200;
const MAX_VALUES = 5;
/** 二维码最多约 3 KB，多的不是名片。 */
const MAX_TEXT = 8000;

const oneLine = (value: string) => tidy(value).replace(/\s*\n\s*/g, ' ');

function addValue(list: string[], format: TextFormat, value: string): void {
  const v = oneLine(value);
  if (
    v.length <= MAX_VALUE &&
    list.length < MAX_VALUES &&
    !list.includes(v) &&
    formatLink(format, v)
  )
    list.push(v);
}

function setText(code: ContactCode, key: 'name' | 'title' | 'company', value: string): void {
  const v = oneLine(value);
  if (v && v.length <= MAX_VALUE) code[key] ??= v;
}

function setAddress(code: ContactCode, parts: readonly string[]): void {
  const v = parts.map(oneLine).filter(Boolean).join(', ');
  if (v && v.length <= MAX_VALUE) code.address ??= v;
}

const HAS_CJK = /[\u3400-\u9fff]/;

/** 姓和名接起来：中文不加空格、姓在前，别的名在前。 */
function fullName(family: string, given: string): string {
  return HAS_CJK.test(family + given)
    ? family + given
    : [given, family].filter((s) => s.trim()).join(' ');
}

/** 按没有转义的 sep 切开，去掉转义（\n 是换行）。 */
function splitEscaped(raw: string, sep: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw[++i]!;
      current += next === 'n' || next === 'N' ? '\n' : next;
    } else if (c === sep) {
      out.push(current);
      current = '';
    } else current += c;
  }
  out.push(current);
  return out;
}

/** 这一行参数和值之间的冒号（引号里的不算）。 */
function valueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) return i;
  }
  return -1;
}

function parseVCard(text: string): ContactCode {
  const code: ContactCode = { phones: [], emails: [], urls: [] };
  let structured: string | undefined;
  const unfolded = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  for (const line of unfolded.split('\n')) {
    if (/^END:VCARD/i.test(line)) break;
    const colon = valueColon(line);
    if (colon < 0) continue;
    const [property, ...params] = line.slice(0, colon).split(';');
    // 分组前缀（item1.TEL）去掉。
    const key = property!.replace(/^[^.]*\./, '').toUpperCase();
    // 编码过的值（vCard 2.1 的 QP、照片的 BASE64）不解。
    if (/QUOTED-PRINTABLE|BASE64|ENCODING=B/i.test(params.join(';'))) continue;
    const raw = line.slice(colon + 1);
    const parts = splitEscaped(raw, ';');
    if (key === 'FN') setText(code, 'name', parts.join(';'));
    else if (key === 'N') structured = fullName(parts[0] ?? '', parts[1] ?? '');
    else if (key === 'ORG') setText(code, 'company', parts[0] ?? '');
    else if (key === 'TITLE') setText(code, 'title', parts.join(';'));
    else if (key === 'TEL') addValue(code.phones, 'phone', parts[0]!.replace(/^tel:/i, ''));
    else if (key === 'EMAIL') addValue(code.emails, 'email', parts[0]!);
    else if (key === 'URL') addValue(code.urls, 'url', parts.join(';'));
    else if (key === 'ADR') setAddress(code, parts);
  }
  if (structured) setText(code, 'name', structured);
  return code;
}

function parseMeCard(text: string): ContactCode {
  const code: ContactCode = { phones: [], emails: [], urls: [] };
  for (const part of splitRaw(text.replace(/^MECARD:/i, ''))) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = part.slice(0, colon).toUpperCase();
    const value = part.slice(colon + 1);
    const plain = splitEscaped(value, '\u0000')[0]!;
    if (key === 'N') {
      const [family, given] = splitEscaped(value, ',');
      setText(code, 'name', fullName(family ?? '', given ?? ''));
    } else if (key === 'ORG') setText(code, 'company', plain);
    else if (key === 'TITLE') setText(code, 'title', plain);
    else if (key === 'TEL') addValue(code.phones, 'phone', plain);
    else if (key === 'EMAIL') addValue(code.emails, 'email', plain);
    else if (key === 'URL') addValue(code.urls, 'url', plain);
    else if (key === 'ADR') setAddress(code, [plain]);
  }
  return code;
}

/** MeCard 按没有转义的分号切开，转义留给后面（值里还要按逗号切）。 */
function splitRaw(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) current += c + text[++i]!;
    else if (c === ';') {
      out.push(current);
      current = '';
    } else current += c;
  }
  out.push(current);
  return out;
}

const hasContent = (c: ContactCode) =>
  c.name !== undefined ||
  c.title !== undefined ||
  c.company !== undefined ||
  c.address !== undefined ||
  c.phones.length + c.emails.length + c.urls.length > 0;

/**
 * 二维码里的文字：vCard、MeCard 读出字段；网址只算网站（创始人 2026-11-04）；别的都是 null，
 * 名片照常按文字读。这里只认文字，什么都不打开。
 */
export function parseContactCode(text: string): ContactCode | null {
  const code = text.replace(/^\uFEFF/, '').trim();
  if (!code || code.length > MAX_TEXT) return null;
  let parsed: ContactCode;
  if (/^BEGIN:VCARD/i.test(code)) parsed = parseVCard(code);
  else if (/^MECARD:/i.test(code)) parsed = parseMeCard(code);
  else {
    parsed = { phones: [], emails: [], urls: [] };
    addValue(parsed.urls, 'url', code);
  }
  return hasContent(parsed) ? parsed : null;
}

/** 这张表每个字段从二维码得到的值（字段 ID → 值）。只有文字和长文本字段。 */
export function contactCodeValues(
  fields: readonly Field[],
  code: ContactCode,
): Record<string, string[]> {
  const bySlot: Record<Slot, readonly string[]> = {
    name: code.name ? [code.name] : [],
    title: code.title ? [code.title] : [],
    company: code.company ? [code.company] : [],
    address: code.address ? [code.address] : [],
    phone: code.phones,
    email: code.emails,
    url: code.urls,
  };
  const out: Record<string, string[]> = {};
  for (const field of fields) {
    const slot = slotOf(field);
    if (slot && bySlot[slot].length > 0) out[field.id] = [...bySlot[slot]];
  }
  return out;
}
