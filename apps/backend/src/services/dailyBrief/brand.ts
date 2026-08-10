import { CHARTSIGNL_BRAND, getApiBaseUrl } from '../weeklyBrief/brand.js';
import type { DailyBrand } from './types.js';

export { CHARTSIGNL_BRAND, getApiBaseUrl };

export const DAILY_BRAND: DailyBrand = CHARTSIGNL_BRAND;

export function getDailyBriefFrom(): string {
  return process.env.DAILY_BRIEF_FROM || 'ChartSignl <daily@chartsignl.com>';
}
