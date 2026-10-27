import type { ComponentStyle } from '@morph/core';

import type { Palette } from './theme';

export type Tone = NonNullable<ComponentStyle['tone']>;

/** 文字组件的 tone 是文字颜色。 */
export function textColor(palette: Palette, tone: Tone | undefined, fallback: string): string {
  switch (tone) {
    case 'primary':
      return palette.primaryText;
    case 'secondary':
      return palette.secondary;
    case 'tertiary':
      return palette.tertiary;
    case 'muted':
      return palette.caption;
    default:
      return fallback;
  }
}

export const SIZES = { small: 0.85, medium: 1, large: 1.2 } as const;
