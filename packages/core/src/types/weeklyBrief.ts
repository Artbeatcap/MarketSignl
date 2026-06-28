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

export interface MoverItem {
  ticker: string;
  pct: string;
  dir: 'up' | 'down';
  why: string;
}

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
