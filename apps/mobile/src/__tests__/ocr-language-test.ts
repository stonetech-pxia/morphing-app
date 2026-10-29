import { autoOcrLanguage } from '../runtime/ocr-language';

// 识别语言「自动」（D-278）：按手机语言列表的第一种选，没有时按界面语言。

describe('automatic text recognition language', () => {
  it('follows the first phone language', () => {
    expect(autoOcrLanguage(['zh-Hans-CN', 'en-US'], 'en')).toBe('chi_sim');
    expect(autoOcrLanguage(['zh-Hant-TW'], 'zh')).toBe('chi_tra');
    expect(autoOcrLanguage(['zh-HK'], 'zh')).toBe('chi_tra');
    expect(autoOcrLanguage(['fr-FR', 'zh-Hans'], 'zh')).toBe('fra');
    expect(autoOcrLanguage(['ja-JP'], 'en')).toBe('jpn');
  });

  it('picks the system engines for Korean, Russian and Vietnamese phones', () => {
    expect(autoOcrLanguage(['ko-KR'], 'en')).toBe('kor');
    expect(autoOcrLanguage(['ru-RU'], 'en')).toBe('rus');
    expect(autoOcrLanguage(['vi-VN'], 'en')).toBe('vie');
  });

  it('falls back to the interface language, then English', () => {
    expect(autoOcrLanguage([], 'zh')).toBe('chi_sim');
    expect(autoOcrLanguage([], 'fr')).toBe('fra');
    expect(autoOcrLanguage(['th-TH'], 'zh')).toBe('eng');
  });
});
