#!/usr/bin/env node
/**
 * Run sniper_alerts migration against Supabase Postgres.
 * Requires DATABASE_URL or SUPABASE_DB_URL in env (direct postgres connection).
 * Get from: Supabase Dashboard → Project Settings → Database → Connection string (URI)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error('Set DATABASE_URL or SUPABASE_DB_URL (postgres URI from Supabase dashboard)');
  process.exit(1);
}

const sql = readFileSync(resolve(__dirname, '../../supabase/20260711_sniper_alerts.sql'), 'utf8');

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Migration OK: sniper_alerts');
} finally {
  await client.end();
}
