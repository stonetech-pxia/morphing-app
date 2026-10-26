// 文件命名模板（§7C）：只允许白名单占位符，不支持任何表达式。
//   {date}         = {date:YYYY-MM-DD}
//   {date:FORMAT}  FORMAT 只能由 YYYY MM DD HH mm ss 和 - _ . 组成，使用设备本地时间
//   {index}        同一次执行中的序号（从 1 开始）
//   {seq}          两位序号：01、02…（超过 99 时照常增长）
//   {sourceName}   这个文件原来的名字（不含扩展名）
//   {taken} / {taken:FORMAT}  照片的拍摄日期；读不到时用当天
//   {ocr:RULE} / {qr:RULE}    这次运行在本机从这个文件识别出的文字 / 二维码内容里按规则取的一段（D-244）；
//                             RULE 只能是 text-rules.ts 的 TEXT_RULES，AI 只选规则，看不到文字

import { TEXT_RULES, extractFirst, type TextRule } from './text-rules';
import type { Locale } from './schema';

const PLACEHOLDER = /\{([^{}]*)\}/g;
const DATE_FORMAT = /^(YYYY|MM|DD|HH|mm|ss|[-_.])+$/;
const MAX_NAME_LENGTH = 80;
const SIMPLE = new Set(['index', 'seq', 'sourceName', 'date', 'taken']);

export type TemplateCheck = { ok: true } | { ok: false; error: string };

export function checkNameTemplate(template: string): TemplateCheck {
  if (template.trim().length === 0) return { ok: false, error: 'template is empty' };
  if (template.length > MAX_NAME_LENGTH) return { ok: false, error: 'template is too long' };
  const stripped = template.replace(PLACEHOLDER, '');
  if (/[{}]/.test(stripped)) return { ok: false, error: 'unbalanced braces' };
  for (const [, body = ''] of template.matchAll(PLACEHOLDER)) {
    if (SIMPLE.has(body)) continue;
    const format = /^(date|taken):(.*)$/.exec(body)?.[2];
    if (format !== undefined && DATE_FORMAT.test(format)) continue;
    const rule = /^(ocr|qr):(.*)$/.exec(body)?.[2];
    if (rule !== undefined && (TEXT_RULES as readonly string[]).includes(rule)) continue;
    return { ok: false, error: `unsupported placeholder {${body}}` };
  }
  return { ok: true };
}

export interface NameContext {
  now: Date;
  index?: number;
  sourceName?: string;
  /** 照片的拍摄时间（EXIF）。 */
  takenAt?: Date;
  /** 这个文件在本机识别出的文字和二维码内容（模板里有 {ocr:…} / {qr:…} 时才有，D-244）。 */
  recognized?: { ocr?: string; qr?: string };
  /** 认日期时分不清日 / 月时用（英文月在前）。 */
  locale?: Locale;
}

/** 模板要不要在本机识别文字 / 二维码（D-244）。 */
export function templateReads(template: string): { ocr: boolean; qr: boolean } {
  return { ocr: /\{ocr:[^{}]*\}/.test(template), qr: /\{qr:[^{}]*\}/.test(template) };
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDate(format: string, d: Date): string {
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(d.getFullYear());
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'DD':
        return pad(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'mm':
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

/** 去掉文件系统不允许的字符。 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || 'untitled';
}

/** 渲染模板，返回不含扩展名的文件名。调用前应先通过 checkNameTemplate。 */
export function renderNameTemplate(template: string, ctx: NameContext): string {
  let missing = false;
  let rendered = template.replace(PLACEHOLDER, (_, body: string) => {
    const read = /^(ocr|qr):(.*)$/.exec(body);
    if (read) {
      const source = ctx.recognized?.[read[1] as 'ocr' | 'qr'];
      const found = source ? extractFirst(source, read[2] as TextRule, ctx.locale ?? 'en') : null;
      if (!found) missing = true;
      return found ?? '';
    }
    if (body === 'index') return String(ctx.index ?? 1);
    if (body === 'seq') return String(ctx.index ?? 1).padStart(2, '0');
    if (body === 'sourceName') return ctx.sourceName ?? '';
    const [kind, format = 'YYYY-MM-DD'] = body.split(':');
    return formatDate(format, kind === 'taken' ? (ctx.takenAt ?? ctx.now) : ctx.now);
  });
  // 识别不到要的内容：去掉留下的连接符；什么都不剩时用原来的名字（D-244）。
  if (missing)
    rendered = rendered.replace(/^[\s\-_.]+|[\s\-_.]+$/g, '').replace(/([-_.])[\s\-_.]+/g, '$1');
  if (missing && !rendered) rendered = ctx.sourceName ?? '';
  return sanitizeFileName(rendered);
}

/** 重名时追加序号，绝不覆盖已有文件：report.pdf → report-2.pdf → report-3.pdf */
export function uniqueFileName(base: string, ext: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  let candidate = `${base}.${ext}`;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}.${ext}`;
  return candidate;
}
