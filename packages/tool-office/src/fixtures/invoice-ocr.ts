// 2026-11-09 用户测试里的一张文字版发票（pdf-lib 生成的 A4，表头 Item / Qty / Unit price / Amount，四排商品，
// 每排下面一条很浅的细横线、没有竖线；表下面右边两列是 Subtotal / VAT 20% / Total due）。
// 按 iOS 的 pdf.toImages 画成长边 2000 的图，PP-OCRv6 认出来的行（D-506 的测试用）。细横线太浅，找线找不到。

import type { OcrBox } from '../types';

const line = (text: string, x: number, y: number, width: number, height: number): OcrBox => ({
  text,
  x,
  y,
  width,
  height,
});

export const INVOICE: { width: number; height: number; lines: OcrBox[] } = {
  width: 1408,
  height: 2016,
  lines: [
    line('Northgate Office Supplies Ltd', 113, 112, 542, 45),
    line('INVOICE', 1060, 110, 182, 42),
    line('14 Harbour Road, Bristol BS1 4QA· VAT GB 2841193 55', 116, 169, 565, 28),
    line('Invoice no: INV-2041', 944, 198, 222, 24),
    line('Date: 28 Oct 2026', 943, 231, 197, 27),
    line('Bill to:', 113, 267, 83, 32),
    line('Due: 27 Nov 2026', 944, 266, 194, 24),
    line('Brightwell Logistics', 116, 303, 204, 28),
    line('Unit 7, Avon Trade Park', 115, 336, 258, 27),
    line('Bristol BS2 0QT', 115, 369, 175, 27),
    line('Qty', 772, 478, 55, 41),
    line('Item', 112, 483, 59, 30),
    line('Unit price', 941, 482, 118, 32),
    line('Amount', 1156, 483, 97, 29),
    line('4', 774, 539, 26, 32),
    line('£21.50', 939, 539, 84, 32),
    line('A4 copy paper, 5 reams', 116, 543, 255, 27),
    line('£86.00', 1153, 539, 83, 32),
    line('2', 772, 596, 30, 34),
    line('£64.90', 938, 595, 85, 33),
    line('Toner cartridge HP 59A', 114, 598, 255, 30),
    line('£129.80', 1152, 596, 96, 32),
    line('3', 772, 653, 29, 35),
    line('£12.40', 939, 654, 84, 32),
    line('Lever arch files (10)', 115, 657, 213, 28),
    line('£37.20', 1153, 654, 83, 32),
    line('£18.75', 938, 711, 86, 32),
    line('1', 774, 712, 25, 32),
    line('Desk organiser', 115, 715, 165, 28),
    line('£18.75', 1153, 711, 84, 32),
    line('Subtotal', 940, 793, 99, 32),
    line('£271.75', 1154, 795, 94, 29),
    line('VAT 20%', 942, 833, 107, 28),
    line('£54.35', 1154, 833, 81, 29),
    line('Total due', 941, 879, 124, 32),
    line('£326.10', 1154, 879, 103, 32),
    line(
      'Payment: bank transfer to Northgate Office Supplies, sort code 20-45-77, account 41873390',
      116,
      1710,
      874,
      23,
    ),
    line('Thank you for your business.', 116, 1757, 275, 24),
  ],
};

/** 表头和四排商品：每排四格。 */
export const INVOICE_ITEMS = [
  ['Item', 'Qty', 'Unit price', 'Amount'],
  ['A4 copy paper, 5 reams', '4', '£21.50', '£86.00'],
  ['Toner cartridge HP 59A', '2', '£64.90', '£129.80'],
  ['Lever arch files (10)', '3', '£12.40', '£37.20'],
  ['Desk organiser', '1', '£18.75', '£18.75'],
];
