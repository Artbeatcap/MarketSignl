import type {
  LevelSet,
  MoverItem,
  SectorItem,
  TapeItem,
  WeekAheadBullet,
  WeeklyBrand,
} from './weeklyBrief';

/** Same shape as week-ahead bullets; labeled for the daily catalyst list. */
export type CatalystBullet = WeekAheadBullet;

export interface HeadlineItem {
  headline: string;
  summary: string;
}

export interface DailySections {
  /** Rendered outside the callout boxes so it never bleeds into analysis fields. */
  greeting?: string;
  opening_bias: string;
  session_setup_html: string;
  key_level_note: string;
  todays_watch_html: string;
  biggest_risk: string;
  signoff?: string;
}

/**
 * Neutral daily brief artifact ingested from Options Plunge.
 * Brand/subject/unsubscribe URLs are owned by ChartSignl at render time.
 */
export interface DailyContent {
  schema_version: number;
  date_label: string;
  generated_at: string;
  data_stale: boolean;
  preheader?: string;
  tape: TapeItem[];
  sectors: SectorItem[];
  movers: MoverItem[];
  levels: Record<string, LevelSet>;
  catalyst_bullets: CatalystBullet[];
  headlines: HeadlineItem[];
  sections: DailySections;
}

export type DailyBrand = WeeklyBrand;

export interface DailyBriefRecipient {
  id: string;
  email: string;
  unsubscribe_token: string;
}

export interface StoredDailyBrief {
  id: string;
  date_label: string;
  generated_at: string | null;
  data_stale: boolean;
  artifact: DailyContent;
  received_at: string;
}
