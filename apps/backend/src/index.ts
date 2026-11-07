// Load dotenv FIRST before any other imports (ESM hoisting-safe)
import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, appendFileSync } from 'fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Load .env file from apps/backend/.env (force reload v1.0.2)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

// #region agent log
try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:14',message:'checking env file',data:{envPath,exists:existsSync(envPath),cwd:process.cwd(),dirname:__dirname},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');}catch(e){console.error('Log error:',e.message);}
// #endregion

if (existsSync(envPath)) {
  const result = config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
    // #region agent log
    try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:19',message:'env file load error',data:{error:result.error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');}catch(e){console.error('Log error:',e.message);}
    // #endregion
  } else {
    console.log(`✓ Loaded .env from: ${envPath}`);
    // #region agent log
    try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:22',message:'env file loaded',data:{envPath,parsed:Object.keys(result.parsed||{}),massiveKeyInParsed:!!result.parsed?.MASSIVE_API_KEY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');}catch(e){console.error('Log error:',e.message);}
    // #endregion
  }
} else {
  console.warn(`⚠️  .env file not found at: ${envPath}`);
  // #region agent log
  try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:25',message:'env file not found',data:{envPath,fallback:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');}catch(e){console.error('Log error:',e.message);}
  // #endregion
  config(); // Fallback to default dotenv behavior
}

// Log environment variable status (without exposing values)
console.log('Environment variables loaded:');
const massiveKeyStatus = process.env.MASSIVE_API_KEY ? `✓ Set (${process.env.MASSIVE_API_KEY.length} chars)` : '✗ Missing';
console.log(`  MASSIVE_API_KEY: ${massiveKeyStatus}`);
console.log(`  SUPABASE_URL: ${process.env.SUPABASE_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing'}`);

// #region agent log
try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:33',message:'env vars after load',data:{hasMassiveKey:!!process.env.MASSIVE_API_KEY,massiveKeyLength:process.env.MASSIVE_API_KEY?.length||0,allEnvKeys:Object.keys(process.env).filter(k=>k.includes('MASSIVE')||k.includes('massive')),cwd:process.cwd()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');}catch(e){console.error('Log error:',e.message);}
// #endregion

// Routes
import analyzeDataRoute from './routes/analyzeData.js';
import historyRoute from './routes/history.js';
import userRoute from './routes/user.js';
import marketDataRoute from './routes/marketData.js';
import subscriptionRoute from './routes/subscription.js';
import internalSignalsRoute from './routes/internalSignals.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// Request logging middleware
app.use('*', async (c, next) => {
  console.log('[MIDDLEWARE] Incoming request:', c.req.method, c.req.path, c.req.url);
  // #region agent log
  try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:65',message:'incoming request',data:{method:c.req.method,path:c.req.path,url:c.req.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})+'\n');}catch(e){console.error('Log error:',e.message);}
  // #endregion
  await next();
});

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  'https://app.chartsignl.com',
  'https://chartsignl.com',
];

app.use('*', cors({
  origin: corsOrigins,
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/health', (c) => {
  console.log('[HEALTH] Health check endpoint hit');
  const polygonKey = (process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || process.env.AICHARTS_POLYGON_KEY || '').trim();
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    polygonKeyPresent: Boolean(polygonKey),
  });
});

// Debug endpoint - add this right after the /health endpoint
app.get('/debug-env', (c) => {
  const key = process.env.MASSIVE_API_KEY || '';
  return c.json({
    hasKey: !!key,
    keyLength: key.length,
    keyPreview: key ? key.substring(0, 4) + '...' : 'EMPTY'
  });
});

// API Routes
app.route('/api/analyze-data', analyzeDataRoute);
app.route('/api/analyses', historyRoute);
app.route('/api/user', userRoute);
app.route('/api/market-data', marketDataRoute);
app.route('/api/subscription', subscriptionRoute);
app.route('/api/internal', internalSignalsRoute);

// #region agent log
try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:94',message:'routes registered',data:{routes:['analyze-data','analyses','user','market-data','subscription']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');}catch(e){console.error('Log error:',e.message);}
// #endregion

// 404 handler
app.notFound((c) => {
  // #region agent log
  try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:97',message:'404 not found',data:{method:c.req.method,path:c.req.path,url:c.req.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');}catch(e){console.error('Log error:',e.message);}
  // #endregion
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  // #region agent log
  try{const logPath='c:\\Users\\Art\\VScode\\chartsignl\\.cursor\\debug.log';appendFileSync(logPath,JSON.stringify({location:'index.ts:102',message:'server error handler',data:{error:err.message,stack:err.stack,path:c.req.path,method:c.req.method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})+'\n');}catch(e){console.error('Log error:',e.message);}
  // #endregion
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
});

// Validate required environment variables
const requiredEnvVars = {
  MASSIVE_API_KEY: process.env.MASSIVE_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // Stripe is optional (only needed for web subscriptions)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value || value.trim() === '')
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.warn(`
╔═══════════════════════════════════════════════════╗
║   ⚠️  WARNING: Missing Environment Variables     ║
╚═══════════════════════════════════════════════════╝
  
  Missing: ${missingVars.join(', ')}
  
  Please add these to apps/backend/.env:
  ${missingVars.map(v => `  ${v}=your_${v.toLowerCase()}_here`).join('\n')}
  
  ${missingVars.includes('MASSIVE_API_KEY') ? '  Get Massive API key: https://massive.com\n' : ''}
`);
}

// Start server
const port = parseInt(process.env.PORT || '4000');

console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🚀 ChartSignl API Server                       ║
║                                                   ║
║   Running on: http://localhost:${port}              ║
║   Environment: ${process.env.NODE_ENV || 'development'}                    ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
