import cron from 'node-cron';
import { resolveDuePredictions } from '../services/predictionResolver.js';

export function startResolverSchedule() {
  if (process.env.ENABLE_RESOLVER_CRON !== 'true') {
    console.log('[resolver] schedule disabled (set ENABLE_RESOLVER_CRON=true to enable)');
    return;
  }

  cron.schedule('*/30 * * * *', async () => {
    try {
      await resolveDuePredictions();
    } catch (e) {
      console.error('[resolver cron] run failed:', e);
    }
  });

  console.log('[resolver] in-process schedule active (every 30m)');
}
