export interface TextRun {
  text: string;
  bold: boolean;
}

export interface HtmlBlock {
  runs: TextRun[];
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (all, name: string) => NAMED[name.toLowerCase()] ?? all);
}

function pushRun(runs: TextRun[], raw: string, bold: boolean): void {
  const text = decodeHtmlEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (previous && previous.bold === bold) {
    previous.text = `${previous.text} ${text}`;
    return;
  }
  runs.push({ text, bold });
}

function runsFrom(fragment: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /<strong>([\s\S]*?)<\/strong>/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment))) {
    pushRun(runs, fragment.slice(last, match.index), false);
    pushRun(runs, match[1], true);
    last = match.index + match[0].length;
  }
  pushRun(runs, fragment.slice(last), false);
  return runs;
}

/** Paragraphs from brief HTML. Keeps strong as bold runs. No WebView. */
export function htmlToBlocks(html: string | undefined | null): HtmlBlock[] {
  if (!html || !html.trim()) return [];
  const withBreaks = html
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '');
  return withBreaks
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ runs: runsFrom(part) }))
    .filter((block) => block.runs.length > 0);
}
