import { CHART_COLORS } from '@chartsignl/core';
import type { WeeklyBrand } from './types.js';

/** Fallback if package resolution races during local scripts. */
const colors = CHART_COLORS ?? {
  lineStroke: '#14B8A6',
  prediction: '#3B82F6',
  support: '#10B981',
  resistance: '#EF4444',
};

/** ChartSignl product tokens for weekly + daily brief emails (not Options Plunge). */
export const CHARTSIGNL_BRAND: WeeklyBrand = {
  name: 'ChartSignl',
  appUrl: process.env.FRONTEND_URL?.includes('app.chartsignl')
    ? process.env.FRONTEND_URL
    : 'https://app.chartsignl.com',
  accent: colors.lineStroke,
  accentLight: colors.prediction,
  support: colors.support,
  resistance: colors.resistance,
  cta: colors.prediction,
  headerGradientStart: '#0b1220',
  headerGradientEnd: '#0f2e2a',
};

export function getApiBaseUrl(): string {
  return process.env.API_URL || 'https://api.chartsignl.com';
}

export function getWeeklyBriefFrom(): string {
  return process.env.WEEKLY_BRIEF_FROM || 'ChartSignl <weekly@chartsignl.com>';
}
