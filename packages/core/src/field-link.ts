import type { TextFormat } from './fields/text';
import type { Field } from './schema';

// 文字字段的 format（电话、邮箱、网址，D-422）：哪个值能打开、打开什么（记录页的按钮和那四个步骤都按这里，D-428）。纯函数，只可能出
// tel:、sms:、mailto:、http(s):// 四种。值对不上时是 null：值照样存、照样显示，只是不能点（保存不查格式）。

export interface FieldLink {
  kind: 'phone' | 'message' | 'email' | 'url';
  url: string;
}

/** 电话里可以有的分隔符：拿掉它们不改变号码（半角、全角括号都有）。换行不算：两行是两个号码。 */
const PHONE_SEPARATORS = /[ \t 　().\-/（）–—]/g;

function phoneLink(value: string): FieldLink | null {
  // 字母、「分机」之类不算：只取数字会拨到别的号码。
  const dial = value.replace(PHONE_SEPARATORS, '');
  return /^\+?\d{3,}$/.test(dial) ? { kind: 'phone', url: `tel:${dial}` } : null;
}

// 地址前半段只收 RFC 5322 的字符和文字：冒号、空白不算，mailto:a@b.com 和换行进不来。
const EMAIL = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;

function emailLink(value: string): FieldLink | null {
  if (!EMAIL.test(value)) return null;
  const at = value.indexOf('@');
  // 前半段的 ?、&、= 都编码：写在里面也加不了 ?bcc=、?subject=。
  const local = encodeURIComponent(value.slice(0, at));
  const domain = encodeURIComponent(value.slice(at + 1));
  return { kind: 'email', url: `mailto:${local}@${domain}` };
}

/** 主机名：只有字母、数字、连字符，用点隔开。用户名（a.com@b.com 看着是 a.com）、%2e 都不算。 */
function validHost(host: string, bare: boolean): boolean {
  const labels = host.split('.');
  const ok = labels.every(
    (l) => /^[\p{L}\p{N}-]+$/u.test(l) && !l.startsWith('-') && !l.endsWith('-'),
  );
  if (!ok) return false;
  // 没写 http(s) 的要像域名：x.com 可以，3.14、tel:123 的 tel 不行。
  return !bare || (labels.length >= 2 && /^\p{L}{2,}$/u.test(labels[labels.length - 1]!));
}

function urlLink(value: string): FieldLink | null {
  if (/[\s\p{Cc}\\]/u.test(value)) return null;
  const scheme = /^(https?):\/\//i.exec(value);
  const rest = scheme ? value.slice(scheme[0].length) : value;
  const authority = /^[^/?#]*/.exec(rest)![0];
  // 主机后面只能跟端口；所以 javascript:…、data:…、ftp://… 都走不到下一步。
  const parts = /^([^:]+)(?::\d{1,5})?$/.exec(authority);
  if (!parts || !validHost(parts[1]!, !scheme)) return null;
  return { kind: 'url', url: `${scheme ? scheme[1]!.toLowerCase() : 'https'}://${rest}` };
}

/** 这种 format 下这段文字能打开什么；对不上时 null。 */
export function formatLink(format: TextFormat, value: string): FieldLink | null {
  const v = value.trim();
  if (format === 'phone') return phoneLink(v);
  return format === 'email' ? emailLink(v) : urlLink(v);
}

export type LinkKind = FieldLink['kind'];

const asMessage = (link: FieldLink | null): FieldLink | null =>
  link?.kind === 'phone' ? { kind: 'message', url: `sms:${link.url.slice(4)}` } : null;

/** 打电话、发短信、发邮件、打开网站的步骤（D-428）：这段文字能不能当这种链接打开。 */
export function actionLink(kind: LinkKind, value: string): FieldLink | null {
  if (kind === 'message') return asMessage(formatLink('phone', value));
  return formatLink(kind, value);
}

/**
 * 这个字段的这个值能打开什么；没有 format 或值对不上时 null。
 * message：电话字段发短信（D-423，和打电话同样的规则）；别的字段没有。
 */
export function fieldLink(field: Field, value: unknown, as?: 'message'): FieldLink | null {
  if (field.type !== 'text' || !field.format || typeof value !== 'string') return null;
  const link = formatLink(field.format, value);
  if (as !== 'message') return link;
  return asMessage(link);
}
