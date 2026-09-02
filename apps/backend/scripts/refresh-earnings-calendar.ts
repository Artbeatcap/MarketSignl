/**
 * Manual FMP earnings-calendar refresh.
 * Run: npx tsx apps/backend/scripts/refresh-earnings-calendar.ts
 */
import { refreshEarningsCalendar } from '../src/lib/earningsCalendarRefresh.js';

refreshEarningsCalendar()
  .then((r) => {
    console.log('Refresh complete', r);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
