import { useColorScheme } from 'react-native';

import type { Tone } from '@/features/balances/describe';

const light = {
  background: '#ffffff',
  surface: '#f3f4f6',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  primary: '#2563eb',
  onPrimary: '#ffffff',
  positive: '#15803d',
  negative: '#b91c1c',
  warning: '#b45309',
};

const dark: typeof light = {
  background: '#0b0f17',
  surface: '#161b26',
  text: '#f3f4f6',
  muted: '#9ca3af',
  border: '#272e3b',
  primary: '#60a5fa',
  onPrimary: '#0b0f17',
  positive: '#4ade80',
  negative: '#f87171',
  warning: '#fbbf24',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function toneColor(theme: Theme, tone: Tone): string {
  return tone === 'positive' ? theme.positive : tone === 'negative' ? theme.negative : theme.muted;
}