const ATLAS_UNAVAILABLE_MESSAGE =
  'Atlas is temporarily unavailable. The chart and levels still work.';

/** Hide raw OpenAI billing text if a response still contains it. */
export function friendlyAtlasError(message: string): string {
  const text = message.toLowerCase();
  if (
    text.includes('no credits remaining') ||
    text.includes('insufficient_quota') ||
    text.includes('exceeded your current quota') ||
    text.includes('platform.openai.com/settings/organization/billing')
  ) {
    return ATLAS_UNAVAILABLE_MESSAGE;
  }
  return message;
}
