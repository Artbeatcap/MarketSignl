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
  // Served as static HTML that launches chartsignl:// (and Android intent) when the app is installed
  chartsUrl: 'https://www.chartsignl.com/open-app',
  accent: colors.lineStroke,
  accentLight: colors.prediction,
  support: colors.support,
  resistance: colors.resistance,
  cta: colors.prediction,
  // Match app splash / screen wash (#F0F9F9) → white card header
  headerGradientStart: '#F0F9F9',
  headerGradientEnd: '#FFFFFF',
};

/** Outer email canvas — same warm surface as chart / web UI. */
export const EMAIL_PAGE_BG = (colors as { background?: string }).background ?? '#FAFAF9';
export const EMAIL_SURFACE = '#F0F9F9';
export const EMAIL_BORDER = '#E7E5E4';
export const EMAIL_MUTED = '#78716C';
export const EMAIL_INK = '#1C1917';

export function getApiBaseUrl(): string {
  return process.env.API_URL || 'https://api.chartsignl.com';
}

export function getWeeklyBriefFrom(): string {
  return process.env.WEEKLY_BRIEF_FROM || 'ChartSignl <weekly@chartsignl.com>';
}
