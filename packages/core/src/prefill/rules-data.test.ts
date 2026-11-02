import { describe, expect, it } from 'vitest';

import { TAX_WORD } from './rules-data';

// 税字样词表（D-403）：整份文字里一个税字样都没有时，没有标签的数不当税额。
// 新加的语言（中文、日文、韩文、土耳其语、葡语、阿拉伯语、俄语、波兰语……）不能因为词表漏了而被当成「没写税」。

describe('TAX_WORD', () => {
  it.each([
    'Tax 3.20',
    'Sales tax',
    'VAT 20%',
    'TVA 10%',
    'MwSt 19%',
    'IVA incluido',
    'BTW 21%',
    'Imposta',
    '增值税',
    '消费税 8%',
    '消費税等',
    '稅額',
    '부가세 포함',
    '세금',
    'KDV %8',
    'TOPKDV 4,12',
    'VERGİ',
    'vergi no',
    'Imposto incluso',
    'ICMS 18%',
    'ضريبة',
    'الضريبة المضافة',
    'ض.ق.م',
    'НДС 20%',
    'налог',
    'PTU 23%',
    'podatek',
    'PPN 11%',
    'moms 25%',
    'ภาษีมูลค่าเพิ่ม',
  ])('认得「%s」', (text) => {
    expect(TAX_WORD.test(text)).toBe(true);
  });

  it.each([
    'taxi to the airport',
    'relaxing',
    'ptuxyz',
    'Total 12.00',
    'thank you',
    '合计 43.20',
    '合計',
    'Итого',
  ])('不认「%s」', (text) => {
    expect(TAX_WORD.test(text)).toBe(false);
  });
});
