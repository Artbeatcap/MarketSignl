import type {
  BriefLevelCall,
  BriefScenario,
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
  /** Set when the headline was added from our own news feed. */
  url?: string;
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
  /** Model-supplied level calls. The support/resistance card stays in `levels`. */
  level_calls?: BriefLevelCall[];
  scenarios?: BriefScenario[];
  /** Hash of the Atlas prompt Options Plunge used. Missing or old raises BRIEF PROMPT STALE. */
  promptVersion?: string;
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
