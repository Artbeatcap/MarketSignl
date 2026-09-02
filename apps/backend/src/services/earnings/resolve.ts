import {
  mergeKey,
  sessionQuality,
  type EarningsRow,
  type EarningsSource,
  type ResolvedEarningsRow,
} from './types.js';

/** Finnhub > FMP > Alpha Vantage > news. */
export const SOURCE_PRECEDENCE: Record<EarningsSource, number> = {
  finnhub: 4,
  fmp: 3,
  alphavantage: 2,
  news: 1,
};

const CLUSTER_DAYS = 7;

function isoDiffDays(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function rank(row: EarningsRow): number {
  return SOURCE_PRECEDENCE[row.source] ?? 0;
}

function sessionOrigin(row: EarningsRow): EarningsSource {
  const resolved = row as ResolvedEarningsRow;
  if (resolved.sessionSource && sessionQuality(row.session) > 0) return resolved.sessionSource;
  return row.source;
}

function pickWinner(rows: EarningsRow[]): ResolvedEarningsRow {
  const sorted = [...rows].sort((a, b) => rank(b) - rank(a));
  const providers = sorted.filter((r) => r.source !== 'news');
  const usable = providers.length ? providers : sorted;
  const winner = usable[0];

  const sessionRow =
    [...usable].sort(
      (a, b) => sessionQuality(b.session) - sessionQuality(a.session) || rank(b) - rank(a)
    ).find((r) => sessionQuality(r.session) > 0) ?? winner;

  const dateStatus = winner.confidence === 'inferred' || winner.confidence === 'projected' ? 'projected' : null;

  return {
    ...winner,
    session: sessionRow.session,
    sessionSource: sessionOrigin(sessionRow),
    dateStatus,
    epsEstimate: winner.epsEstimate ?? usable.find((r) => r.epsEstimate != null)?.epsEstimate ?? null,
    fiscalYear: winner.fiscalYear ?? usable.find((r) => r.fiscalYear != null)?.fiscalYear ?? null,
    fiscalPeriod: winner.fiscalPeriod ?? usable.find((r) => r.fiscalPeriod != null)?.fiscalPeriod ?? null,
    companyName: winner.companyName ?? usable.find((r) => r.companyName)?.companyName ?? null,
    revenueEstimate: winner.revenueEstimate ?? usable.find((r) => r.revenueEstimate != null)?.revenueEstimate ?? null,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * Merge provider rows keyed by (ticker, fiscalYear, fiscalPeriod), falling
 * back to (ticker, date) when fiscal is missing. Nearby dates for the same
 * ticker collapse so FMP-without-fiscal and Finnhub-with-fiscal become one row.
 *
 * News never overrides a provider row in the same cluster.
 */
export function resolveEarningsRows(groups: EarningsRow[][]): ResolvedEarningsRow[] {
  const flat = groups.flat().filter((r) => r.ticker && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (!flat.length) return [];

  const byFiscal = groupBy(flat, mergeKey);
  const firstPass: ResolvedEarningsRow[] = [];
  for (const rows of byFiscal.values()) {
    firstPass.push(pickWinner(rows));
  }

  firstPass.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date));
  const collapsed: ResolvedEarningsRow[] = [];
  const used = new Set<number>();
  for (let i = 0; i < firstPass.length; i += 1) {
    if (used.has(i)) continue;
    const cluster: EarningsRow[] = [firstPass[i]];
    for (let j = i + 1; j < firstPass.length; j += 1) {
      if (used.has(j)) continue;
      if (firstPass[j].ticker !== firstPass[i].ticker) continue;
      if (Math.abs(isoDiffDays(firstPass[j].date, firstPass[i].date)) > CLUSTER_DAYS) continue;
      used.add(j);
      cluster.push(firstPass[j]);
    }
    collapsed.push(pickWinner(cluster));
  }

  return collapsed.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

/** Fetch every configured provider; a single failure does not abort the rest. */
export async function gatherProviderRows(
  providers: Array<{ source: EarningsSource; fetchCalendar: (from: string, to: string) => Promise<EarningsRow[]> }>,
  from: string,
  to: string
): Promise<{ rows: EarningsRow[][]; errors: Array<{ source: EarningsSource; error: string }> }> {
  const rows: EarningsRow[][] = [];
  const errors: Array<{ source: EarningsSource; error: string }> = [];
  const results = await Promise.allSettled(providers.map((p) => p.fetchCalendar(from, to)));
  results.forEach((result, i) => {
    const source = providers[i].source;
    if (result.status === 'fulfilled') {
      rows.push(result.value);
    } else {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push({ source, error });
      console.warn(`[week-ahead] provider ${source} failed:`, error);
    }
  });
  return { rows, errors };
}
