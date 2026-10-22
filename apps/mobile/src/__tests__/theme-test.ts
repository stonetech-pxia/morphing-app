import { DEFAULT_THEME, type Theme } from '@morph/core';

import { makePalette } from '../renderer/theme';

const card = (patch: Partial<Theme>) =>
  makePalette({ ...DEFAULT_THEME, ...patch }, false).cardStyle();

describe('card styles', () => {
  it('keeps the classic shadow, outline and flat cards on the old shadow props', () => {
    expect(card({})).toMatchObject({ shadowRadius: 15 });
    expect(card({ cardStyle: 'outline' })).toMatchObject({ borderWidth: 1 });
    expect(card({ cardStyle: 'flat' })).not.toHaveProperty('boxShadow');
  });

  it('brutal: thick outline and a hard shadow in the text color', () => {
    const style = card({ cardStyle: 'brutal', colors: { text: '#111111' } });
    expect(style).toMatchObject({ borderWidth: 2, borderColor: '#111111' });
    expect(style.boxShadow).toBe('4px 4px 0px #111111');
  });

  it('soft: a light shadow at the top left and a dark one at the bottom right', () => {
    const style = card({
      cardStyle: 'soft',
      colors: { background: '#E0E5EC', surface: '#E0E5EC' },
    });
    expect(style.boxShadow).toMatch(/^-5px -5px 12px #[0-9A-F]{6}, 6px 6px 14px rgba\(/);
    expect(card({ cardStyle: 'soft', mode: 'dark' }).boxShadow).toContain(
      'rgba(255, 255, 255, 0.06)',
    );
  });

  it('puffy: an outer shadow plus inner highlight and inner shade', () => {
    const style = card({ cardStyle: 'puffy' });
    expect(String(style.boxShadow).match(/inset/g)).toHaveLength(2);
  });
});
