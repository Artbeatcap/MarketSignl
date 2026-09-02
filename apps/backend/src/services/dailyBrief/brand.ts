import type { DailyBrand } from './types.js';
import { CHARTSIGNL_BRAND } from '../weeklyBrief/brand.js';

export {
  CHARTSIGNL_BRAND,
  getApiBaseUrl,
  EMAIL_PAGE_BG,
  EMAIL_SURFACE,
  EMAIL_BORDER,
  EMAIL_MUTED,
  EMAIL_INK,
} from '../weeklyBrief/brand.js';

export const DAILY_BRAND: DailyBrand = CHARTSIGNL_BRAND;

export function getDailyBriefFrom(): string {
  return process.env.DAILY_BRIEF_FROM || 'ChartSignl <daily@chartsignl.com>';
}
