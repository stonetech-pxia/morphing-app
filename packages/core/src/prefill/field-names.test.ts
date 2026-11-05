import { describe, expect, it } from 'vitest';

import { extractFieldNames, fieldNameFromText, looksLikeValue } from './field-names';
import type { TextPage } from './rows';

const page = (lines: [string, number, number][], height = 16): TextPage => ({
  width: 800,
  height: 1100,
  lines: lines.map(([text, x, y]) => ({ text, x, y, width: text.length * 8, height })),
});

describe('extractFieldNames', () => {
  it('冒号：左边是字段名，整段不切开', () => {
    expect(
      extractFieldNames([
        page([
          ['Date of birth: 12/03/1990', 40, 100],
          ['N° de facture : 88', 40, 150],
        ]),
      ]),
    ).toEqual(['Date of birth', 'N° de facture']);
  });
  it('字段名里有认不出的字符也不切开（OCR 错字、符号）', () => {
    expect(
      extractFieldNames([
        page([
          ['NumÃ©ro de contrat : CT-77120', 40, 100],
          ['Assur€ : Julien', 40, 150],
          ['Prix H.T. (€) : 12', 40, 200],
        ]),
      ]),
    ).toEqual(['NumÃ©ro de contrat', 'Assur€', 'Prix H.T. (€)']);
  });
  it('同一行两组冒号都找到', () => {
    expect(extractFieldNames([page([['Inv No :KSB800  Date:11/03/18', 40, 100]])])).toEqual([
      'Inv No',
      'Date',
    ]);
  });
  it('值在右边，文字值也不当字段名', () => {
    const lines: [string, number, number][] = [
      ['Postal district', 40, 100],
      ['Northbridge', 380, 100],
      ['Registration date', 40, 195],
      ['16 April 2024', 380, 195],
      ['Annual fee', 40, 290],
      ['€240.50', 380, 290],
    ];
    expect(extractFieldNames([page(lines)])).toEqual([
      'Postal district',
      'Registration date',
      'Annual fee',
    ]);
  });
  it('换行的字段名合成一个：值在第二行或第一行', () => {
    const second: [string, number, number][] = [
      ['Member', 40, 100],
      ['reference', 40, 119],
      ['MB-4831', 400, 119],
      ['Full', 40, 195],
      ['name', 40, 214],
      ['Elena Voss', 400, 214],
    ];
    expect(extractFieldNames([page(second)])).toEqual(['Member reference', 'Full name']);
    const first: [string, number, number][] = [
      ['Date of birth of the', 40, 100],
      ['12/03/1990', 400, 100],
      ['insured person', 40, 119],
      ['Policy', 40, 195],
      ['AB-221', 400, 195],
    ];
    expect(extractFieldNames([page(first)])).toEqual([
      'Date of birth of the insured person',
      'Policy',
    ]);
  });
  it('值在下面，文字值不当字段名', () => {
    const lines: [string, number, number][] = [
      ['Insurer', 40, 100],
      ['Bluecrest', 40, 120],
      ['Policy number', 40, 190],
      ['PL-22817', 40, 210],
      ['Vehicle make', 40, 280],
      ['Toyota', 40, 300],
    ];
    expect(extractFieldNames([page(lines)])).toEqual(['Insurer', 'Policy number', 'Vehicle make']);
  });
  it('表格：第一排是字段名，换行的表头按列合并', () => {
    const table: [string, number, number][] = [
      ['Item', 40, 100],
      ['Qty', 240, 100],
      ['Unit price', 440, 100],
      ['Soap', 40, 130],
      ['2', 240, 130],
      ['3.50', 440, 130],
      ['Rice', 40, 160],
      ['1', 240, 160],
      ['9.00', 440, 160],
    ];
    expect(extractFieldNames([page(table)])).toEqual(['Item', 'Qty', 'Unit price']);
  });
  it('中文和没有专门处理的语言一样（不靠词典）', () => {
    expect(
      extractFieldNames([
        page([
          ['保单号码：BD-40917', 40, 100],
          ['Prémio anual: 344,90 €', 40, 150],
        ]),
      ]),
    ).toEqual(['保单号码', 'Prémio anual']);
  });
  it('标题、整句和值不算；只有一行字时不猜', () => {
    expect(
      extractFieldNames([
        page([
          ['Keep this page with your papers.', 40, 100],
          ['12 Main Street', 40, 200],
        ]),
      ]),
    ).toEqual([]);
    expect(extractFieldNames([])).toEqual([]);
  });
});

describe('fieldNameFromText', () => {
  it('取冒号左边，去掉填空线', () => {
    expect(fieldNameFromText('Policy number: PL-1')).toBe('Policy number');
    expect(fieldNameFromText('Name ______')).toBe('Name');
  });
  it('值判断', () => {
    expect(looksLikeValue('MB-4831')).toBe(true);
    expect(looksLikeValue('Address line 2')).toBe(false);
  });
});
