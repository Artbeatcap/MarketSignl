export async function postDailyBriefAlert(message: string): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  console.warn(`[daily-brief] ALERT: ${message}`);

  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[ChartSignl Morning Brief] ${message}`,
      }),
    });
  } catch (err) {
    console.error('[daily-brief] Failed to post alert webhook:', err);
  }
}
