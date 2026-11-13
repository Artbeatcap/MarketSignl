import { assertBriefComplete, briefAsOfFromLabel } from '../../lib/briefCompleteness.js';
import type { DailyContent } from './types.js';
import { postDailyBriefAlert } from './alert.js';
import type { BriefInAppDb } from './briefStore.js';

export type PublishResult = {
  status: 'stored' | 'store_failed';
  asOf: string;
  complete: boolean;
  missing: number;
};

export async function publishGatedBrief(
  db: BriefInAppDb,
  content: DailyContent,
  alert: (message: string) => Promise<void> = postDailyBriefAlert
): Promise<PublishResult> {
  const asOf = briefAsOfFromLabel(content.date_label);
  const checked = assertBriefComplete(content, 'morning');
  try {
    await db.upsertPublished({
      asOf,
      content,
      complete: checked.complete,
      missing: checked.missing,
      publishedAt: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        event: 'brief_publish',
        asOf,
        complete: checked.complete,
        missing: checked.missing.length,
        status: 'stored',
      })
    );
    return {
      status: 'stored',
      asOf,
      complete: checked.complete,
      missing: checked.missing.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({
        event: 'brief_publish',
        asOf,
        complete: checked.complete,
        missing: checked.missing.length,
        status: 'store_failed',
      })
    );
    await alert(`Brief publish failed: ${message}`);
    return {
      status: 'store_failed',
      asOf,
      complete: checked.complete,
      missing: checked.missing.length,
    };
  }
}
