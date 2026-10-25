import { localize } from './localization';
import { t } from './messages';
import type { Locale, Localized, Theme } from './schema';

// 内置风格预设（D-094）：每个都是一份完整的主题，AI 用 applyThemePreset 整套套用，之后还可以再微调。
// 除了固定深色的终端和霓虹，都同时给了浅色和深色配色，跟随系统切换；全部通过对比度检查（测试覆盖）。

export const THEME_PRESET_IDS = [
  'ios',
  'material',
  'editorial',
  'pastel',
  'nature',
  'terminal',
  'neon',
  'claymorphism',
  'brutalist',
  'neumorphism',
  'glass',
  'y2k',
] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export interface ThemePreset {
  name: Localized;
  /** 给模型看的一句话说明。 */
  description: string;
  theme: Theme;
}

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  ios: {
    name: { zh: 'iOS 原生', en: 'iOS' },
    description: 'Apple system look: grouped gray background, white cards, system blue',
    theme: {
      primaryColor: '#007AFF',
      mode: 'system',
      colors: {
        background: '#F2F2F7',
        surface: '#FFFFFF',
        text: '#000000',
        secondary: '#34C759',
        tertiary: '#FF9500',
      },
      darkColors: {
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        secondary: '#30D158',
        tertiary: '#FF9F0A',
      },
      font: 'system',
      fontScale: 1,
      radius: 12,
      density: 'comfortable',
      cardStyle: 'flat',
      navStyle: 'iconLabel',
    },
  },
  material: {
    name: { zh: 'Material You', en: 'Material You' },
    description: 'Google Material 3: tonal purple surfaces, large rounded cards',
    theme: {
      primaryColor: '#6750A4',
      mode: 'system',
      colors: {
        background: '#FEF7FF',
        surface: '#F3EDF7',
        text: '#1D1B20',
        secondary: '#625B71',
        tertiary: '#7D5260',
      },
      darkColors: {
        background: '#141218',
        surface: '#211F26',
        text: '#E6E0E9',
        secondary: '#CCC2DC',
        tertiary: '#EFB8C8',
      },
      font: 'system',
      fontScale: 1,
      radius: 24,
      density: 'comfortable',
      cardStyle: 'flat',
      navStyle: 'iconLabel',
    },
  },
  editorial: {
    name: { zh: '杂志', en: 'Editorial' },
    description: 'Magazine layout: serif type, paper background, hairline borders, red accent',
    theme: {
      primaryColor: '#B3261E',
      mode: 'system',
      colors: {
        background: '#FAF7F0',
        surface: '#FFFDF8',
        text: '#1A1A1A',
        secondary: '#2F4A3A',
        tertiary: '#8A6D3B',
      },
      darkColors: {
        background: '#121110',
        surface: '#1C1A18',
        text: '#F2EEE6',
        secondary: '#9DB8A6',
        tertiary: '#C9A56B',
      },
      font: 'serif',
      fontScale: 1.1,
      radius: 2,
      density: 'spacious',
      cardStyle: 'outline',
      navStyle: 'label',
    },
  },
  pastel: {
    name: { zh: '马卡龙', en: 'Pastel' },
    description: 'Soft wellness look: peach background, coral and mint, very round cards',
    theme: {
      primaryColor: '#F0794F',
      mode: 'system',
      colors: {
        background: '#FFF4EC',
        surface: '#FFFFFF',
        text: '#3D2C29',
        secondary: '#4FA382',
        tertiary: '#7C9BE0',
      },
      darkColors: {
        background: '#221A18',
        surface: '#2E2421',
        text: '#FBEDE6',
        secondary: '#8FD3B4',
        tertiary: '#A9C2F5',
      },
      font: 'clay',
      fontScale: 1,
      radius: 26,
      density: 'spacious',
      cardStyle: 'shadow',
      navStyle: 'iconLabel',
    },
  },
  nature: {
    name: { zh: '自然', en: 'Nature' },
    description: 'Earthy biophilic look: fern green, sienna and ochre over a soft gradient',
    theme: {
      primaryColor: '#4F7942',
      mode: 'system',
      colors: {
        background: '#F1EEE4',
        surface: '#FBF9F3',
        text: '#2B2A22',
        secondary: '#A0522D',
        tertiary: '#B8901F',
      },
      darkColors: {
        background: '#161A14',
        surface: '#20261D',
        text: '#EEF0E6',
        secondary: '#D08A5E',
        tertiary: '#DDBB55',
      },
      font: 'clay',
      fontScale: 1,
      radius: 18,
      density: 'comfortable',
      cardStyle: 'shadow',
      navStyle: 'iconLabel',
      backdrop: 'gradient',
    },
  },
  terminal: {
    name: { zh: '终端', en: 'Terminal' },
    description: 'Developer terminal: always dark, monospace, compact, green accent, outlined',
    theme: {
      primaryColor: '#22C55E',
      mode: 'dark',
      colors: {
        background: '#0B0F0C',
        surface: '#111813',
        text: '#D1FAE5',
        secondary: '#38BDF8',
        tertiary: '#FACC15',
      },
      font: 'mono',
      fontScale: 0.95,
      radius: 4,
      density: 'compact',
      cardStyle: 'outline',
      navStyle: 'label',
    },
  },
  neon: {
    name: { zh: '赛博霓虹', en: 'Neon' },
    description: 'Cyberpunk: always dark, aurora glow background, cyan neon-glowing cards',
    theme: {
      primaryColor: '#22D3EE',
      mode: 'dark',
      colors: {
        background: '#05050A',
        surface: '#111122',
        text: '#EDEBFF',
        secondary: '#F472B6',
        tertiary: '#8B5CF6',
      },
      font: 'system',
      fontScale: 1,
      radius: 16,
      density: 'comfortable',
      cardStyle: 'glow',
      navStyle: 'iconLabel',
      backdrop: 'aurora',
    },
  },
  claymorphism: {
    name: { zh: '黏土', en: 'Claymorphism' },
    description: 'Playful 3D clay: lavender pastels, puffy cards with an inner highlight',
    theme: {
      primaryColor: '#8B5CF6',
      mode: 'system',
      colors: {
        background: '#F3EEFF',
        surface: '#FBF8FF',
        text: '#2E1065',
        secondary: '#DB2777',
        tertiary: '#0F9488',
      },
      darkColors: {
        background: '#1A1033',
        surface: '#261A45',
        text: '#F3EEFF',
        secondary: '#F472B6',
        tertiary: '#2DD4BF',
      },
      font: 'clay',
      fontScale: 1.05,
      radius: 28,
      density: 'spacious',
      cardStyle: 'puffy',
      navStyle: 'iconLabel',
    },
  },
  brutalist: {
    name: { zh: '新粗野', en: 'Neubrutalism' },
    description: 'Neubrutalism: cream background, thick outlines, hard offset shadows, loud colors',
    theme: {
      primaryColor: '#FF5C39',
      mode: 'system',
      colors: {
        background: '#FFF4D6',
        surface: '#FFFFFF',
        text: '#111111',
        secondary: '#2563EB',
        tertiary: '#16A34A',
      },
      darkColors: {
        background: '#141414',
        surface: '#1F1F1F',
        text: '#FFF4D6',
        secondary: '#60A5FA',
        tertiary: '#4ADE80',
      },
      font: 'system',
      fontScale: 1.05,
      radius: 6,
      density: 'comfortable',
      cardStyle: 'brutal',
      navStyle: 'iconLabel',
    },
  },
  neumorphism: {
    name: { zh: '新拟物', en: 'Neumorphism' },
    description:
      'Soft UI: cards the same color as the background, raised by light and dark shadows',
    theme: {
      primaryColor: '#5B6CFF',
      mode: 'system',
      colors: {
        background: '#E4E9F2',
        surface: '#E4E9F2',
        text: '#2D3748',
        secondary: '#2F855A',
        tertiary: '#C05621',
      },
      darkColors: {
        background: '#2A2D34',
        surface: '#2A2D34',
        text: '#E2E8F0',
        secondary: '#68D391',
        tertiary: '#F6AD55',
      },
      font: 'system',
      fontScale: 1,
      radius: 22,
      density: 'spacious',
      cardStyle: 'soft',
      navStyle: 'iconLabel',
    },
  },
  glass: {
    name: { zh: '液态玻璃', en: 'Liquid Glass' },
    description:
      'Glassmorphism / Liquid Glass: aurora background behind translucent frosted-glass cards',
    theme: {
      primaryColor: '#6366F1',
      mode: 'system',
      colors: {
        background: '#F5F3FF',
        surface: '#FFFFFF',
        text: '#1E1B4B',
        secondary: '#EC4899',
        tertiary: '#06B6D4',
      },
      darkColors: {
        background: '#0B0B1A',
        surface: '#1E1B3A',
        text: '#EEF2FF',
        secondary: '#F472B6',
        tertiary: '#22D3EE',
      },
      font: 'system',
      fontScale: 1,
      radius: 24,
      density: 'comfortable',
      cardStyle: 'glass',
      navStyle: 'iconLabel',
      backdrop: 'aurora',
    },
  },
  y2k: {
    name: { zh: 'Y2K 千禧', en: 'Y2K' },
    description:
      'Y2K chrome: pink-to-blue gradient background, glossy metallic cards, hot pink accent',
    theme: {
      primaryColor: '#FF3EA5',
      mode: 'system',
      colors: {
        background: '#EEF2FF',
        surface: '#D9DEE5',
        text: '#111827',
        secondary: '#3B82F6',
        tertiary: '#A855F7',
      },
      darkColors: {
        background: '#0F1020',
        surface: '#3A3F4B',
        text: '#F1F5F9',
        secondary: '#60A5FA',
        tertiary: '#C084FC',
      },
      font: 'system',
      fontScale: 1,
      radius: 14,
      density: 'comfortable',
      cardStyle: 'chrome',
      navStyle: 'iconLabel',
      backdrop: 'gradient',
    },
  },
};

/** 结构相同即可（校验后对象的键顺序可能变）；值为 undefined 的键视为没有。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  const keys = (o: object) =>
    Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  const ka = keys(a);
  return (
    ka.length === keys(b).length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** 当前主题仍和某个预设完全一致时返回它的 id（风格选择器用来标出当前风格）；微调过就不再算。 */
export function presetOfTheme(theme: Theme): ThemePresetId | null {
  return THEME_PRESET_IDS.find((id) => sameValue(theme, THEME_PRESETS[id].theme)) ?? null;
}

/** 风格选择器填进输入框的一句话（D-095）；mock AI 能把它识别成对应的 applyThemePreset（测试覆盖全部预设）。 */
export function presetRequest(id: ThemePresetId, locale: Locale): string {
  const name = localize(THEME_PRESETS[id].name, locale);
  return t(locale, 'presets_Switch_to_the_style_aedda', { v0: name });
}
