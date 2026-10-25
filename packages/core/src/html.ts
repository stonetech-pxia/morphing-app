import { t } from './messages';
import {
  aggregateRecords,
  fieldOf,
  formatMoney,
  formatNumber,
  formatRef,
  type DataRecord,
} from './data';
import type { Collection, Locale } from './schema';

// 文字转 PDF、用记录生成 PDF 的固定 HTML 模板（expo-print 渲染，系统字体，中日韩都能显示）。
// 用户的文字和记录值一律先转义再在本机填进去；AI 只能选模板、标题和字段名（D-042）。
// 模板里没有脚本、没有外部资源。

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type PageSize = 'a4' | 'letter';

/** 纸张大小（PDF 点，1/72 英寸）。 */
export const PAGE_POINTS: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
};

const FONT_STACK =
  "-apple-system, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans', 'Noto Sans CJK SC', Roboto, sans-serif";

function page(body: string, css: string, size: PageSize): string {
  const { width, height } = PAGE_POINTS[size];
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
@page { size: ${width}pt ${height}pt; margin: 40pt 44pt; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${FONT_STACK}; color: #1a1a1a; }
${css}
</style></head><body>${body}</body></html>`;
}

/** 一段文字 → 一页页的 PDF（保留换行，长行自动折行）。 */
export function textToHtml(
  text: string,
  opts: { fontSize: number; pageSize: PageSize; title?: string },
): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const title = opts.title ? `<h1>${escapeHtml(opts.title)}</h1>` : '';
  return page(
    `${title}${paragraphs}`,
    `h1 { font-size: ${opts.fontSize * 1.6}pt; margin: 0 0 12pt; }
p { font-size: ${opts.fontSize}pt; line-height: 1.5; margin: 0 0 ${opts.fontSize * 0.8}pt; white-space: normal; overflow-wrap: anywhere; }`,
    opts.pageSize,
  );
}

export const RECORD_TEMPLATES = ['table', 'cards', 'receipt'] as const;
export type RecordTemplate = (typeof RECORD_TEMPLATES)[number];

export interface RecordsHtmlOptions {
  template: RecordTemplate;
  title: string;
  /** 要显示的字段（字段 ID 或 createdAt）；空 = 全部字段。不存在的字段忽略。 */
  fields: readonly string[];
  pageSize: PageSize;
  locale: Locale;
  now: Date;
}

/** 记录 → HTML。receipt 在表格下面合计第一个金额（没有就数字）字段。 */
export function recordsToHtml(
  collection: Collection,
  records: readonly DataRecord[],
  opts: RecordsHtmlOptions,
): string {
  const { locale } = opts;
  const refs = (opts.fields.length > 0 ? opts.fields : collection.fields.map((f) => f.id)).filter(
    (ref) => ref === 'createdAt' || ref === 'updatedAt' || fieldOf(collection, ref),
  );
  const nameOf = (ref: string) =>
    ref === 'createdAt'
      ? t(locale, 'html_Created_1626a')
      : ref === 'updatedAt'
        ? t(locale, 'html_Updated_74f0c')
        : fieldOf(collection, ref)!.name;
  const numeric = (ref: string) => {
    const f = fieldOf(collection, ref);
    return f?.type === 'money' || f?.type === 'number';
  };
  const cell = (r: DataRecord, ref: string) => escapeHtml(formatRef(r, collection, ref, locale));
  const date = `${opts.now.getFullYear()}-${String(opts.now.getMonth() + 1).padStart(2, '0')}-${String(opts.now.getDate()).padStart(2, '0')}`;
  const header = `<header><h1>${escapeHtml(opts.title || collection.name)}</h1>
<div class="meta">${escapeHtml(collection.name)} · ${t(locale, 'html_records_3f794', { v0: records.length })} · ${date}</div></header>`;

  let body: string;
  if (opts.template === 'cards') {
    body = records
      .map(
        (r) =>
          `<section class="card">${refs
            .map(
              (ref) =>
                `<div class="row"><span class="k">${escapeHtml(nameOf(ref))}</span><span class="v">${cell(r, ref) || '—'}</span></div>`,
            )
            .join('')}</section>`,
      )
      .join('\n');
  } else {
    const head = refs
      .map((ref) => `<th${numeric(ref) ? ' class="num"' : ''}>${escapeHtml(nameOf(ref))}</th>`)
      .join('');
    const rows = records
      .map(
        (r) =>
          `<tr>${refs.map((ref) => `<td${numeric(ref) ? ' class="num"' : ''}>${cell(r, ref)}</td>`).join('')}</tr>`,
      )
      .join('\n');
    let total = '';
    if (opts.template === 'receipt') {
      const money = collection.fields.find((f) => f.type === 'money' && refs.includes(f.id));
      const number = collection.fields.find((f) => f.type === 'number' && refs.includes(f.id));
      const field = money ?? number;
      if (field) {
        const sum = aggregateRecords(records, collection, 'sum', field.id) ?? 0;
        const shown =
          field.type === 'money'
            ? formatMoney(sum, field.currency)
            : formatNumber(sum, field.type === 'number' ? field.decimals : undefined);
        total = `<div class="total">${t(locale, 'html_Total_08322')} · ${escapeHtml(field.name)}：<strong>${escapeHtml(shown)}</strong></div>`;
      }
    }
    body = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${total}`;
  }
  return page(
    `${header}${body}`,
    `header { margin-bottom: 16pt; }
h1 { font-size: 20pt; margin: 0 0 4pt; }
.meta { font-size: 9pt; color: #666; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; }
th { text-align: left; border-bottom: 1.5pt solid #333; padding: 5pt 6pt; }
td { border-bottom: 0.5pt solid #ccc; padding: 5pt 6pt; vertical-align: top; overflow-wrap: anywhere; }
tr { page-break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.total { margin-top: 12pt; text-align: right; font-size: 12pt; }
.card { border: 0.75pt solid #ccc; border-radius: 6pt; padding: 8pt 10pt; margin-bottom: 10pt; page-break-inside: avoid; }
.row { display: flex; gap: 12pt; font-size: 10pt; padding: 2pt 0; }
.k { width: 30%; color: #666; }
.v { flex: 1; overflow-wrap: anywhere; }`,
    opts.pageSize,
  );
}
