export interface PolygonSnapshotTicker {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  lastTrade?: { p?: number };
  prevDay?: { v?: number };
}

/** Polygon `type` codes we accept. Everything else is excluded. */
export const ALLOWED_SECURITY_TYPES = new Set(['CS', 'ADRC']);
// CS = Common Stock, ADRC = American Depositary Receipt Common
// Explicitly excluded: ETF, ETN, ETV, ETS, FUND, SP, WARRANT, RIGHT, UNIT, PFD, BOND, LT, OS, AGEN, BASKET, INDEX

const ALLOWED_EXCHANGES = new Set(['XNYS', 'XNAS', 'ARCX', 'BATS', 'XASE']);

/**
 * Backstop for anything that slips past the type code (Polygon occasionally
 * tags a leveraged product as CS on the first days after listing).
 *
 * Explicit leverage markers only. Bare TRUST/FUND/INDEX tokens are already
 * covered by the type code and silently dropped real operating companies:
 * Digital Realty Trust (DLR), Northern Trust (NTRS), Vornado Realty Trust (VNO).
 */
export const FUND_NAME_PATTERN =
  /\b(\d+(\.\d+)?X|ULTRA(SHORT|PRO)?|LEVERAGED|INVERSE|DAILY\s+TARGET|ETF|ETN|EXCHANGE[- ]TRADED|(BULL|BEAR)\s*\d*X?)\b/i;

/** Known leveraged/inverse issuers — name-prefix backstop. */
export const FUND_ISSUER_PATTERN =
  /\b(DEFIANCE|DIREXION|PROSHARES|GRANITESHARES|LEVERAGE\s+SHARES|TRADR|T-REX|REX\s+SHARES|VOLATILITY\s+SHARES|YIELDMAX|KURV|INNOVATOR|SIMPLIFY|BATTERY\s+SHARES)\b/i;

export interface MoverQualityConfig {
  minPrice: number;
  minAvgVolume: number;
  minDollarVolume: number;
  minMarketCap: number;
  minAbsChangePct: number;
  maxAbsChangePct: number;
}

export const DEFAULT_MOVER_CONFIG: MoverQualityConfig = {
  minPrice: 3,
  minAvgVolume: 500_000,
  minDollarVolume: 10_000_000,
  minMarketCap: 300_000_000,
  minAbsChangePct: 4,
  maxAbsChangePct: 60,
};

export interface TickerMeta {
  ticker: string;
  name: string;
  type: string;
  market: string;
  active: boolean;
  primaryExchange: string;
  marketCap: number | null;
}

export function isRealOperatingCompany(meta: TickerMeta): boolean {
  if (!meta.active) return false;
  if ((meta.market || '').toLowerCase() !== 'stocks') return false;
  if (!ALLOWED_SECURITY_TYPES.has(meta.type)) return false;
  if (meta.primaryExchange && !ALLOWED_EXCHANGES.has(meta.primaryExchange)) return false;
  if (FUND_NAME_PATTERN.test(meta.name)) return false;
  if (FUND_ISSUER_PATTERN.test(meta.name)) return false;
  return true;
}

export function passesQualityGate(
  snap: PolygonSnapshotTicker,
  meta: TickerMeta,
  cfg: MoverQualityConfig = DEFAULT_MOVER_CONFIG
): boolean {
  const price = snap.day?.c ?? snap.lastTrade?.p ?? 0;
  const volume = snap.day?.v ?? 0;
  const prevVolume = snap.prevDay?.v ?? 0;
  const absChange = Math.abs(snap.todaysChangePerc ?? 0);

  if (price < cfg.minPrice) return false;
  if (absChange < cfg.minAbsChangePct) return false;
  if (absChange > cfg.maxAbsChangePct) return false;
  if (price * volume < cfg.minDollarVolume) return false;
  if (Math.max(volume, prevVolume) < cfg.minAvgVolume) return false;
  if (meta.marketCap !== null && meta.marketCap < cfg.minMarketCap) return false;

  return true;
}

/**
 * Liquidity-weighted rank. Scale dollar volume against the $10M gate so a
 * 9% move on $2B outranks a 30% print on $12M.
 */
export function scoreMover(snap: PolygonSnapshotTicker): number {
  const absChange = Math.abs(snap.todaysChangePerc ?? 0);
  const dollarVolume = (snap.day?.c ?? 0) * (snap.day?.v ?? 0);
  return absChange * Math.log10(Math.max(dollarVolume / 10_000_000, 1.01));
}

export const FLOW_DRIVEN_WHY = 'No headline — flow-driven';

export function capDirection<T extends { todaysChangePerc?: number }>(
  ranked: T[],
  limit = 6,
  maxSame = 4
): T[] {
  const out: T[] = [];
  let up = 0;
  let down = 0;
  for (const snap of ranked) {
    const pct = snap.todaysChangePerc ?? 0;
    if (pct >= 0) {
      if (up >= maxSame) continue;
      up += 1;
    } else {
      if (down >= maxSame) continue;
      down += 1;
    }
    out.push(snap);
    if (out.length >= limit) break;
  }
  return out;
}
