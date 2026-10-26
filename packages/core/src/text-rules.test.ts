import { describe, expect, it } from 'vitest';

import { checkNameTemplate, renderNameTemplate, templateReads } from './naming';
import { extractAll, extractFirst } from './text-rules';

// 识别结果的样子照着真实收据、发票、名片写：有换行、全角冒号、千位分隔、中英混排。
const RECEIPT_ZH = `星巴克咖啡（国贸店）
发票号码：04418765
开票日期：2026年10月21日
拿铁 大杯     32.00
可颂          18.50
合计：¥50.50
客服电话 400-820-6998  手机 13812345678`;

const INVOICE_EN = `ACME Supplies Ltd.
Invoice No: INV-2026-0042
Date: 10/22/2026
Subtotal 1,180.00
Total due: $1,234.56
billing@acme.example · https://acme.example/pay.`;

const FACTURE_FR = `Boulangerie Martin
Facture N° F2026-118
Date : 22/10/2026
Montant TTC : 1 234,50 €
Tél. : 01 23 45 67 89`;

describe('extractFirst', () => {
  it('reads the first line, invoice number, date and total of a Chinese receipt', () => {
    expect(extractFirst(RECEIPT_ZH, 'firstLine', 'zh')).toBe('星巴克咖啡（国贸店）');
    expect(extractFirst(RECEIPT_ZH, 'invoiceNo', 'zh')).toBe('04418765');
    expect(extractFirst(RECEIPT_ZH, 'date', 'zh')).toBe('2026-10-21');
    expect(extractFirst(RECEIPT_ZH, 'amount', 'zh')).toBe('50.50');
    expect(extractFirst(RECEIPT_ZH, 'phone', 'zh')).toBe('4008206998');
  });

  it('reads an English invoice: month-first date, grouped total', () => {
    expect(extractFirst(INVOICE_EN, 'invoiceNo', 'en')).toBe('INV-2026-0042');
    expect(extractFirst(INVOICE_EN, 'date', 'en')).toBe('2026-10-22');
    expect(extractFirst(INVOICE_EN, 'amount', 'en')).toBe('1234.56');
    expect(extractFirst(INVOICE_EN, 'email', 'en')).toBe('billing@acme.example');
    expect(extractFirst(INVOICE_EN, 'url', 'en')).toBe('https://acme.example/pay');
  });

  it('reads a French invoice: day-first date, comma decimals, spaced phone number', () => {
    expect(extractFirst(FACTURE_FR, 'invoiceNo', 'fr')).toBe('F2026-118');
    expect(extractFirst(FACTURE_FR, 'date', 'fr')).toBe('2026-10-22');
    expect(extractFirst(FACTURE_FR, 'amount', 'fr')).toBe('1234.50');
    expect(extractFirst(FACTURE_FR, 'phone', 'fr')).toBe('0123456789');
  });

  it('an ambiguous day/month follows the language, and impossible dates are skipped', () => {
    expect(extractFirst('03/04/2026', 'date', 'en')).toBe('2026-03-04');
    expect(extractFirst('03/04/2026', 'date', 'fr')).toBe('2026-04-03');
    expect(extractFirst('2026-02-30 then 2026-03-01', 'date', 'zh')).toBe('2026-03-01');
  });

  it('returns null when there is nothing to take', () => {
    expect(extractFirst('hello', 'invoiceNo', 'en')).toBeNull();
    expect(extractFirst('', 'firstLine', 'en')).toBeNull();
    // 只是一个日期，不是电话。
    expect(extractFirst('2026-10-22', 'phone', 'zh')).toBeNull();
  });
});

describe('extractAll', () => {
  it('lists every phone number, e-mail and number once, in order', () => {
    expect(extractAll(RECEIPT_ZH, 'phone', 'zh')).toEqual(['4008206998', '13812345678']);
    expect(extractAll('a@b.co, c@d.org, a@b.co', 'email', 'en')).toEqual(['a@b.co', 'c@d.org']);
    expect(extractAll('1,234.5 and 12,5 and 7', 'number', 'en')).toEqual(['1234.5', '12.5', '7']);
  });
});

describe('name templates with recognized text', () => {
  const now = new Date(2026, 9, 22);
  it('accepts only the listed rules', () => {
    expect(checkNameTemplate('{ocr:invoiceNo}-{date}').ok).toBe(true);
    expect(checkNameTemplate('{qr:url}').ok).toBe(true);
    expect(checkNameTemplate('{ocr:\\d+}').ok).toBe(false);
    expect(checkNameTemplate('{ocr}').ok).toBe(false);
    expect(templateReads('收据-{ocr:date}')).toEqual({ ocr: true, qr: false });
  });

  it('fills in the part taken from the recognized text', () => {
    const name = renderNameTemplate('收据-{ocr:date}-{ocr:amount}', {
      now,
      sourceName: 'IMG_0001',
      recognized: { ocr: RECEIPT_ZH },
      locale: 'zh',
    });
    expect(name).toBe('收据-2026-10-21-50.50');
  });

  it('drops dangling separators when nothing is found, and falls back to the original name', () => {
    const ctx = {
      now,
      sourceName: 'IMG_0001',
      recognized: { ocr: 'nothing useful' },
      locale: 'en' as const,
    };
    expect(renderNameTemplate('receipt-{ocr:invoiceNo}', ctx)).toBe('receipt');
    expect(renderNameTemplate('{ocr:invoiceNo}', ctx)).toBe('IMG_0001');
    expect(renderNameTemplate('{qr:url}', { now, sourceName: 'scan' })).toBe('scan');
  });
});
