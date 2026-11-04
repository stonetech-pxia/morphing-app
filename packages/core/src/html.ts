import { REPORT_ATTACHMENT_LIMITS } from './limits';
import { t } from './messages';
import {
  aggregateRecords,
  fieldOf,
  formatRef,
  recordTitle,
  type DataRecord,
  type LinkResolver,
  perCurrencyText,
} from './data';
import { attachmentIds } from './field-values';
import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { fieldDefinition, type Collection, type Field, type Locale } from './schema';

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
  /** 引用字段显示被引用记录的标题（D-250）。 */
  links?: LinkResolver;
  /** 印在标题下面的说明（D-425：哪些附件没放进来）。用户看的文字，先转义再填。 */
  notes?: readonly string[];
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
  // 靠右对齐的数字列（字段定义的 print.numeric：数字、金额）。
  const numeric = (ref: string) => {
    const f = fieldOf(collection, ref);
    return f !== undefined && fieldDefinition(f.type).print?.numeric === true;
  };
  const cell = (r: DataRecord, ref: string) =>
    escapeHtml(formatRef(r, collection, ref, locale, opts.links));
  const date = `${opts.now.getFullYear()}-${String(opts.now.getMonth() + 1).padStart(2, '0')}-${String(opts.now.getDate()).padStart(2, '0')}`;
  const header = `<header><h1>${escapeHtml(opts.title || collection.name)}</h1>
<div class="meta">${escapeHtml(collection.name)} · ${t(locale, 'html_records_3f794', { v0: records.length })} · ${date}</div>${(opts.notes ?? []).map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}</header>`;

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
      // 合计哪个字段：字段定义 print.total 的 rank 小的类型优先（先金额、再数字），同类型取第一个。
      const candidates = collection.fields.filter(
        (f) => refs.includes(f.id) && fieldDefinition(f.type).print?.total,
      );
      const rank = (f: Field) => fieldDefinition(f.type).print!.total!.rank;
      const best = Math.min(...candidates.map(rank));
      const field = candidates.find((f) => rank(f) === best);
      if (field) {
        const sum = aggregateRecords(records, collection, 'sum', field.id) ?? 0;
        const shown =
          perCurrencyText(records, collection, 'sum', field.id, locale) ??
          fieldDefinition(field.type).print!.total!.format(field, sum, locale);
        // 冒号按语言：中文全角，法语前面带窄不换行空格，英文半角。
        const colon = locale === 'zh' ? '：' : locale === 'fr' ? '\u202f: ' : ': ';
        total = `<div class="total">${t(locale, 'html_Total_08322')} · ${escapeHtml(field.name)}${colon}<strong>${escapeHtml(shown)}</strong></div>`;
      }
    }
    body = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${total}`;
  }
  return page(
    `${header}${body}`,
    `${opts.notes?.length ? '.note { font-size: 10pt; margin: 6pt 0 0; overflow-wrap: anywhere; }\n' : ''}header { margin-bottom: 16pt; }
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

// ---- 报表带附件（D-425）----

/** 报表要放的一个附件：属于哪条记录，图注写什么。 */
export interface ReportAttachment {
  /** 用户文件的 ID：只在本机用，不进 HTML、不发给 AI。 */
  assetId: string;
  title: string;
  /** 这条记录在报表里印出来的值，读的人对得上是哪一行。 */
  detail: string;
  /** 这条记录的第几个（从 1 起）、一共几个。 */
  index: number;
  total: number;
}

const CAPTION_CHARS = 120;

/** 记录顺序、每条记录内按字段和附件的顺序，列出文件字段里的附件。 */
export function reportAttachments(
  collection: Collection,
  records: readonly DataRecord[],
  opts: {
    fields: readonly string[];
    locale: Locale;
    now: Date;
    cal?: Calendar;
    links?: LinkResolver;
  },
): ReportAttachment[] {
  const { locale, now, cal = DEFAULT_CALENDAR } = opts;
  const refs = (opts.fields.length > 0 ? opts.fields : collection.fields.map((f) => f.id)).filter(
    (ref) =>
      ref === 'createdAt' ||
      ref === 'updatedAt' ||
      (fieldOf(collection, ref) && fieldOf(collection, ref)!.type !== 'file'),
  );
  const fileFields = collection.fields.filter((f) => f.type === 'file');
  return records.flatMap((record) => {
    const ids = fileFields.flatMap((f) => attachmentIds(record.values[f.id]));
    if (ids.length === 0) return [];
    const title = recordTitle(record, collection, locale, now, cal);
    const detail = refs
      .map((ref) => formatRef(record, collection, ref, locale, opts.links, now, cal))
      .filter((text) => text !== '' && text !== title)
      .join(' · ');
    return ids.map((assetId, i) => ({
      assetId,
      title,
      detail,
      index: i + 1,
      total: ids.length,
    }));
  });
}

/** 一页附件：图注 + 照片（JPEG 的 base64）。没有照片时是后面接 PDF 页面的那一页图注。 */
export interface ReportAttachmentPage {
  attachment: ReportAttachment;
  jpegBase64?: string;
  /** 后面接的 PDF 有几页。 */
  pdfPages?: number;
}

/** 附件页的 HTML：每张照片一页，图注在上面。 */
export function reportAttachmentsToHtml(
  pages: readonly ReportAttachmentPage[],
  opts: { pageSize: PageSize; locale: Locale },
): string {
  const { height } = PAGE_POINTS[opts.pageSize];
  const cut = (s: string) => Array.from(s).slice(0, CAPTION_CHARS).join('');
  const body = pages
    .map(({ attachment: a, jpegBase64, pdfPages }) => {
      const count =
        a.total > 1 ? t(opts.locale, 'reportAttachmentOf', { index: a.index, total: a.total }) : '';
      const meta = [cut(a.detail), count].filter(Boolean).join(' · ');
      const pdf =
        pdfPages !== undefined
          ? `<p class="pdf">${escapeHtml(t(opts.locale, 'reportAttachmentPdfFollows', { n: pdfPages }))}</p>`
          : '';
      const image = jpegBase64
        ? `<img alt="" src="data:image/jpeg;base64,${escapeHtml(jpegBase64)}">`
        : '';
      return `<section class="att"><h2>${escapeHtml(cut(a.title))}</h2><div class="meta">${escapeHtml(meta)}</div>${pdf}${image}</section>`;
    })
    .join('\n');
  // 上下边距 40pt，图注最多占大约 90pt：照片不会被挤到下一页。
  return page(
    body,
    `.att { page-break-after: always; break-after: page; }
.att:last-child { page-break-after: auto; break-after: auto; }
h2 { font-size: 14pt; margin: 0 0 3pt; overflow-wrap: anywhere; }
.meta { font-size: 9pt; color: #666; margin-bottom: 8pt; overflow-wrap: anywhere; }
.pdf { font-size: 10pt; }
img { display: block; margin: 0 auto; max-width: 100%; max-height: ${height - 80 - 90}pt; }`,
    opts.pageSize,
  );
}

/** 没放进来的附件 → 印在报表上的话。多于 8 条记录时只列前 8 条。 */
export function reportAttachmentNotes(
  left: { overLimit: readonly string[]; unreadable: readonly string[] },
  locale: Locale,
): string[] {
  const titles = (list: readonly string[]) => {
    const unique = [...new Set(list)];
    const shown = unique.slice(0, 8).join(t(locale, 'reportAttachmentSeparator'));
    return unique.length > 8 ? `${shown}…` : shown;
  };
  const notes: string[] = [];
  if (left.overLimit.length > 0)
    notes.push(
      t(locale, 'reportAttachmentsOverLimit', {
        n: left.overLimit.length,
        max: REPORT_ATTACHMENT_LIMITS.maxCount,
        mb: REPORT_ATTACHMENT_LIMITS.maxBytes / (1024 * 1024),
        titles: titles(left.overLimit),
      }),
    );
  if (left.unreadable.length > 0)
    notes.push(
      t(locale, 'reportAttachmentsUnreadable', {
        n: left.unreadable.length,
        titles: titles(left.unreadable),
      }),
    );
  return notes;
}
