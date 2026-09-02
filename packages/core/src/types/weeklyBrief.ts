export interface TapeItem {
  symbol: string;
  price: string;
  pct: number | null;
}

export interface SectorItem {
  name: string;
  etf: string;
  pct: number;
}

/**
 * Which session the headline percentage is measured over. `index_driver` rows
 * are ranked on a different axis entirely — basis points of index contribution
 * rather than percentage move — so they are never sorted against the others.
 */
export type MoverWindow = 'index_driver' | 'premarket' | 'prior_session';

export interface MoverItem {
  ticker: string;
  /** Percentage for this row's own window — read it with `window`. */
  pct: string;
  dir: 'up' | 'down';
  why: string;
  companyName?: string;
  reasonUrl?: string;
  window?: MoverWindow;
  /** Set when a row also moved in the prior session. */
  priorSessionPct?: string;
  /** Set on a prior-session-headlined driver row that also moved premarket. */
  premarketPct?: string;
  isEarnings?: boolean;
  /**
   * False on a driver row rendered under the no-catalyst override, which is
   * styled muted rather than as an explanation.
   */
  hasCatalyst?: boolean;
}

/**
 * `contributionBps` and `indexWeightPct` are deliberately absent from
 * `MoverItem`. Basis points rank drivers, steer the prose, and go in the logs;
 * they never render. The type boundary is what enforces that — do not add them
 * here "for completeness".
 */

export interface LevelSet {
  pivot?: string;
  support: string;
  support2?: string;
  resistance: string;
  resistance2?: string;
}

export interface WeekAheadBullet {
  date: string;
  event: string;
  why?: string;
}

export interface WeeklySections {
  major_driver: string;
  week_in_review_html: string;
  key_level_note: string;
  week_ahead_html: string;
  biggest_risk: string;
}

export interface WeeklyContent {
  schema_version: number;
  week_label: string;
  generated_at: string;
  data_stale: boolean;
  tape: TapeItem[];
  sectors: SectorItem[];
  movers: MoverItem[];
  levels: Record<string, LevelSet>;
  week_ahead_bullets: WeekAheadBullet[];
  sections: WeeklySections;
}

export interface WeeklyBrand {
  name: string;
  appUrl: string;
  /** HTTPS URL that opens the native app when installed (Universal Links + scheme fallback). */
  chartsUrl: string;
  accent: string;
  accentLight: string;
  support: string;
  resistance: string;
  cta: string;
  headerGradientStart: string;
  headerGradientEnd: string;
}

export interface WeeklyBriefRecipient {
  id: string;
  email: string;
  unsubscribe_token: string;
}

export interface StoredWeeklyBrief {
  id: string;
  week_label: string;
  generated_at: string | null;
  data_stale: boolean;
  artifact: WeeklyContent;
  received_at: string;
}
