import { z } from 'zod';

const tapeItemSchema = z.object({
  symbol: z.string(),
  price: z.string(),
  pct: z.number().nullable(),
});

const sectorItemSchema = z.object({
  name: z.string(),
  etf: z.string(),
  pct: z.number(),
});

const moverItemSchema = z.object({
  ticker: z.string(),
  pct: z.string(),
  dir: z.enum(['up', 'down']),
  why: z.string(),
});

const levelSetSchema = z.object({
  pivot: z.string().optional(),
  support: z.string(),
  support2: z.string().optional(),
  resistance: z.string(),
  resistance2: z.string().optional(),
});

const catalystBulletSchema = z.object({
  date: z.string(),
  event: z.string(),
  why: z.string().optional(),
});

const headlineItemSchema = z.object({
  headline: z.string(),
  summary: z.string().optional().default(''),
});

const sectionsSchema = z.object({
  opening_bias: z.string().min(1),
  session_setup_html: z.string().optional().default(''),
  key_level_note: z.string().optional().default(''),
  todays_watch_html: z.string().optional().default(''),
  biggest_risk: z.string().optional().default(''),
});

export const dailyContentSchema = z.object({
  schema_version: z.literal(1),
  date_label: z.string().min(1),
  generated_at: z.string().min(1),
  data_stale: z.boolean(),
  preheader: z.string().optional(),
  tape: z.array(tapeItemSchema).min(1),
  sectors: z.array(sectorItemSchema).default([]),
  movers: z.array(moverItemSchema).default([]),
  levels: z.record(levelSetSchema).default({}),
  catalyst_bullets: z.array(catalystBulletSchema).default([]),
  headlines: z.array(headlineItemSchema).default([]),
  sections: sectionsSchema,
});

export type ParsedDailyContent = z.infer<typeof dailyContentSchema>;

export function parseDailyContent(body: unknown): ParsedDailyContent {
  return dailyContentSchema.parse(body);
}
