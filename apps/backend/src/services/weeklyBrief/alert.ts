export async function postWeeklyBriefAlert(message: string): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  console.warn(`[weekly-brief] ALERT: ${message}`);

  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[ChartSignl Weekly Brief] ${message}`,
      }),
    });
  } catch (err) {
    console.error('[weekly-brief] Failed to post alert webhook:', err);
  }
}
