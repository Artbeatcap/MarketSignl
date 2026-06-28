import { CHART_COLORS } from '@chartsignl/core';
import type { WeeklyBrand } from './types.js';

export const CHARTSIGNL_BRAND: WeeklyBrand = {
  name: 'ChartSignl',
  appUrl: process.env.FRONTEND_URL?.includes('app.chartsignl')
    ? process.env.FRONTEND_URL
    : 'https://app.chartsignl.com',
  accent: CHART_COLORS.lineStroke,
  accentLight: CHART_COLORS.prediction,
  support: CHART_COLORS.support,
  resistance: CHART_COLORS.resistance,
  cta: CHART_COLORS.prediction,
  headerGradientStart: '#0b1220',
  headerGradientEnd: '#0f2e2a',
};

export function getApiBaseUrl(): string {
  return process.env.API_URL || 'https://api.chartsignl.com';
}

export function getWeeklyBriefFrom(): string {
  return process.env.WEEKLY_BRIEF_FROM || 'ChartSignl <weekly@chartsignl.com>';
}
