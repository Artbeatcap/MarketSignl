import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/backend/.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log('SKIP db check: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(0);
}

const supabase = createClient(url, key);

const tables = ['profiles', 'usage_counters', 'predictions'];
for (const table of tables) {
  const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`FAIL table ${table}:`, error.message);
    process.exit(1);
  }
  console.log(`OK table ${table} (rows: ${count ?? 0})`);
}

const { error: ucError } = await supabase.from('usage_counters').select('free_predictions_used, last_prediction_at').limit(1);
if (ucError) {
  console.error('FAIL usage_counters prediction columns:', ucError.message);
  process.exit(1);
}
console.log('OK usage_counters has prediction columns');

const { error: resError } = await supabase
  .from('predictions')
  .select('entry_close, horizon_end_at, resolved_at, direction_hit')
  .limit(1);
if (resError) {
  console.error('FAIL predictions resolution columns:', resError.message);
  process.exit(1);
}
console.log('OK predictions has resolution columns');
