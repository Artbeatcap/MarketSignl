import cron from 'node-cron';
import { refreshEarningsCalendar } from './earningsCalendarRefresh.js';

export function startCalendarSchedule() {
  if (process.env.ENABLE_CALENDAR_CRON !== 'true') {
    console.log('[week-ahead] in-process 21:00 ET refresh disabled (set ENABLE_CALENDAR_CRON=true)');
    return;
  }

  cron.schedule(
    '0 21 * * *',
    async () => {
      try {
        await refreshEarningsCalendar();
      } catch (e) {
        console.error('[week-ahead] nightly refresh failed:', e);
      }
    },
    { timezone: 'America/New_York' }
  );

  console.log('[week-ahead] in-process schedule active (21:00 ET; Finnhub/FMP/AV + news gap-fill)');
}
