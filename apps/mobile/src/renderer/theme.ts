import type { Theme } from '@morph/core';
import { useColorScheme } from 'react-native';

export interface Palette {
  dark: boolean;
  background: string;
  card: string;
  border: string;
  text: string;
  subtext: string;
  primary: string;
  onPrimary: string;
  danger: string;
}

export function makePalette(theme: Theme, systemDark: boolean): Palette {
  const dark = theme.mode === 'dark' || (theme.mode === 'system' && systemDark);
  return {
    dark,
    background: dark ? '#111214' : '#F6F7F9',
    card: dark ? '#1C1D21' : '#FFFFFF',
    border: dark ? '#2C2E33' : '#E3E5E8',
    text: dark ? '#F1F3F5' : '#16181B',
    subtext: dark ? '#A0A4AB' : '#5C6168',
    primary: theme.primaryColor,
    onPrimary: '#FFFFFF',
    danger: dark ? '#FF6B6B' : '#C92A2A',
  };
}

export function usePalette(theme: Theme): Palette {
  return makePalette(theme, useColorScheme() === 'dark');
}
