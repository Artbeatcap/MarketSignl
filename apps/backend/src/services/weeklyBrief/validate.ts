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

const weekAheadBulletSchema = z.object({
  date: z.string(),
  event: z.string(),
  why: z.string().optional(),
});

const sectionsSchema = z.object({
  major_driver: z.string().min(1),
  week_in_review_html: z.string().optional().default(''),
  key_level_note: z.string().optional().default(''),
  week_ahead_html: z.string().optional().default(''),
  biggest_risk: z.string().optional().default(''),
});

export const weeklyContentSchema = z.object({
  schema_version: z.literal(1),
  week_label: z.string().min(1),
  generated_at: z.string().min(1),
  data_stale: z.boolean(),
  tape: z.array(tapeItemSchema).min(1),
  sectors: z.array(sectorItemSchema).default([]),
  movers: z.array(moverItemSchema).default([]),
  levels: z.record(levelSetSchema).default({}),
  week_ahead_bullets: z.array(weekAheadBulletSchema).default([]),
  sections: sectionsSchema,
});

export type ParsedWeeklyContent = z.infer<typeof weeklyContentSchema>;

export function parseWeeklyContent(body: unknown): ParsedWeeklyContent {
  return weeklyContentSchema.parse(body);
}
