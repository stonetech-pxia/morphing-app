import { describe, expect, it } from 'vitest';

import { tidyOcrText } from './ocr';

describe('tidyOcrText', () => {
  it('removes the spaces tesseract puts between Chinese and Japanese characters', () => {
    expect(tidyOcrText('租约 续签 通 知\n\n您 的 租约 将 于 2026 年 4 月 15 日 到期 。')).toBe(
      '租约续签通知\n\n您的租约将于2026年4月15日到期。',
    );
    expect(tidyOcrText('東京 都 の 天気')).toBe('東京都の天気');
  });

  it('keeps spaces between Latin words and in Korean, and drops extra blank lines', () => {
    expect(tidyOcrText('  Dear Tenant,  \n\n\n\nYour lease ends on April 15, 2026.\n')).toBe(
      'Dear Tenant,\n\nYour lease ends on April 15, 2026.',
    );
    expect(tidyOcrText('안녕하세요 반갑습니다')).toBe('안녕하세요 반갑습니다');
    expect(tidyOcrText('Morph 工具 PDF')).toBe('Morph 工具 PDF');
  });
});
