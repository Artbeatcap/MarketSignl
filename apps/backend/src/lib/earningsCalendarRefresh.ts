/**
 * Nightly earnings-calendar refresh.
 * Layers Finnhub, FMP, Alpha Vantage, then Massive news gap-fill.
 * The 8:30 send never calls this.
 */
import { supabaseAdmin } from './supabase.js';
import { etDateISO, addDaysISO, tradingHorizon } from './weekAhead.js';
import { loadGateUniverse, refreshMarketHolidays } from './weekAheadLoad.js';
import { getTickerMeta } from './tickerMeta.js';
import { createAlphaVantageProvider } from '../services/earnings/providers/alphaVantage.js';
import { createFinnhubProvider } from '../services/earnings/providers/finnhub.js';
import { createFmpProvider } from '../services/earnings/providers/fmp.js';
import { gatherProviderRows, resolveEarningsRows } from '../services/earnings/resolve.js';
import { fillEarningsGapsFromNews } from '../services/earnings/news.js';
import type { EarningsRow, ResolvedEarningsRow } from '../services/earnings/types.js';

async function hydrateNames(rows: Array<{ ticker: string; companyName?: string | null }>): Promise<void> {
  const tickers = [...new Set(rows.filter((r) => !r.companyName).map((r) => r.ticker))];
  if (!tickers.length) return;
  const { data, error } = await supabaseAdmin.from('ticker_metadata').select('ticker, name').in('ticker', tickers);
  if (error) {
    console.warn('[week-ahead] ticker_metadata name lookup failed:', error.message);
    return;
  }
  const names = new Map((data || []).map((r) => [String(r.ticker).toUpperCase(), String(r.name)]));
  for (const row of rows) {
    if (!row.companyName) row.companyName = names.get(row.ticker) ?? null;
  }
}

function toDbRow(row: ResolvedEarningsRow, fetchedAt: string) {
  const fiscalLabel =
    row.fiscalYear && row.fiscalPeriod ? `${row.fiscalPeriod} FY${row.fiscalYear}` : row.fiscalPeriod;
  return {
    ticker: row.ticker,
    report_date: row.date,
    session: row.session,
    is_confirmed: row.source !== 'news' && row.confidence === 'reported',
    eps_estimate: row.epsEstimate,
    revenue_estimate: row.revenueEstimate ?? null,
    fiscal_period: fiscalLabel,
    fiscal_year: row.fiscalYear,
    company_name: row.companyName ?? null,
    fetched_at: row.fetchedAt || fetchedAt,
    source: row.source,
    confidence: row.confidence,
    date_status: row.dateStatus,
    session_source: row.sessionSource,
  };
}

export async function refreshEarningsCalendar(opts?: { now?: Date }): Promise<{
  upserted: number;
  deleted: number;
  sources: Record<string, number>;
  newsFilled: number;
  errors: Array<{ source: string; error: string }>;
}> {
  const now = opts?.now ?? new Date();
  const today = etDateISO(now);
  const to = addDaysISO(today, 21);
  const fetchedAt = now.toISOString();

  const providers = [
    createFinnhubProvider(),
    createFmpProvider(),
    createAlphaVantageProvider(),
  ].filter((p): p is NonNullable<typeof p> => p != null);

  if (process.env.FINNHUB_API_KEY?.trim()) {
    console.warn(
      '[week-ahead] FINNHUB_API_KEY is set. Confirm commercial terms before relying on the free tier in production.'
    );
  }

  if (!providers.length && !(process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY)) {
    throw new Error('No earnings calendar providers configured (need Finnhub, FMP, Alpha Vantage, or Massive news)');
  }

  const { rows: providerGroups, errors } = await gatherProviderRows(providers, today, to);
  let merged = resolveEarningsRows(providerGroups);

  let holidays: string[] = [];
  try {
    holidays = await refreshMarketHolidays();
  } catch (err) {
    console.warn('[week-ahead] holiday refresh failed:', err);
  }
  const horizon = tradingHorizon(today, holidays);
  const horizonEnd = horizon[horizon.length - 1] || today;

  const gate = await loadGateUniverse();
  const horizonCovered = new Set(
    merged.filter((r) => r.date >= today && r.date <= horizonEnd).map((r) => r.ticker)
  );
  const newsTargets = gate.tickers.filter((t) => !horizonCovered.has(t));
  const meta = newsTargets.length ? await getTickerMeta(newsTargets) : new Map();
  const names = new Map<string, string>();
  for (const [ticker, row] of meta) {
    if (row.name) names.set(ticker, row.name);
  }
  const newsRows: EarningsRow[] = await fillEarningsGapsFromNews({
    tickers: newsTargets,
    names,
    existing: merged,
    horizonStart: today,
    horizonEnd,
  });
  if (newsRows.length) {
    merged = resolveEarningsRows([...providerGroups, newsRows]);
  }

  await hydrateNames(merged);

  if (merged.length) {
    const { error } = await supabaseAdmin.from('earnings_calendar').upsert(
      merged.map((r) => toDbRow(r, fetchedAt)),
      { onConflict: 'ticker,report_date' }
    );
    if (error) throw new Error(`earnings_calendar upsert failed: ${error.message}`);
  }

  const keep = new Set(merged.map((r) => `${r.ticker}|${r.date}`));
  const { data: forward } = await supabaseAdmin
    .from('earnings_calendar')
    .select('ticker, report_date')
    .gte('report_date', today)
    .lte('report_date', to);
  const stale = (forward || []).filter((r) => !keep.has(`${String(r.ticker).toUpperCase()}|${String(r.report_date).slice(0, 10)}`));
  for (const row of stale) {
    await supabaseAdmin
      .from('earnings_calendar')
      .delete()
      .eq('ticker', row.ticker)
      .eq('report_date', row.report_date);
  }

  const cutoff = addDaysISO(today, -7);
  const { error: delError, count } = await supabaseAdmin
    .from('earnings_calendar')
    .delete({ count: 'exact' })
    .lt('report_date', cutoff);
  if (delError) {
    console.warn('[week-ahead] earnings_calendar prune failed:', delError.message);
  }

  if (!merged.length && errors.length && errors.length === providers.length && providers.length) {
    throw new Error(`all earnings providers failed: ${errors.map((e) => `${e.source}=${e.error}`).join('; ')}`);
  }

  const sources: Record<string, number> = {};
  for (const row of merged) {
    sources[row.source] = (sources[row.source] || 0) + 1;
  }

  console.log(
    JSON.stringify({
      event: 'week_ahead_refresh',
      from: today,
      to,
      upserted: merged.length,
      deleted: (count ?? 0) + stale.length,
      newsFilled: newsRows.length,
      sources,
      errors,
    })
  );

  return {
    upserted: merged.length,
    deleted: (count ?? 0) + stale.length,
    sources,
    newsFilled: newsRows.length,
    errors,
  };
}
