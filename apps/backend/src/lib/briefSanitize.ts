const HR_RE = /^\s*-{3,}\s*$/gm;
const GREETING_RE =
  /^\s*((hey|hi|hello)(\s+(guys|everyone|team))?[,.!]*)\s*(here is your morning brief[.!]*)?\s*/i;
const SIGNOFF_RE = /\s*(have a (great|good) (day|one)(\s+guys)?[.!]*)\s*$/i;

export function sanitizeAiField(text: string): string {
  return (text || '').replace(HR_RE, '').replace(GREETING_RE, '').replace(SIGNOFF_RE, '').trim();
}

export function sanitizeHtmlField(html: string): string {
  return sanitizeAiField(html).replace(/<p>\s*---+\s*<\/p>/gi, '').trim();
}

/**
 * Greeting and sign-off are their own fields, so stripping them would delete
 * the voice on days the model wrote one. They only get markdown rules removed.
 */
const VERBATIM_SECTION_KEYS = new Set(['greeting', 'signoff']);

export function sanitizeDailySections<T extends object>(sections: T): T {
  const out = { ...sections } as Record<string, unknown>;
  for (const [name, val] of Object.entries(out)) {
    if (typeof val !== 'string') continue;
    if (VERBATIM_SECTION_KEYS.has(name)) {
      out[name] = val.replace(HR_RE, '').trim();
    } else if (name.endsWith('_html')) {
      out[name] = sanitizeHtmlField(val);
    } else {
      out[name] = sanitizeAiField(val);
    }
  }
  return out as T;
}
