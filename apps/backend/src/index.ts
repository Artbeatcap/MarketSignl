import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Load .env file from apps/backend/.env (force reload v1.0.2)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

if (existsSync(envPath)) {
  const result = config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  } else {
    console.log(`✓ Loaded .env from: ${envPath}`);
  }
} else {
  console.warn(`⚠️  .env file not found at: ${envPath}`);
  config(); // Fallback to default dotenv behavior
}

// Log environment variable status (without exposing values)
console.log('Environment variables loaded:');
const massiveKeyStatus = process.env.MASSIVE_API_KEY ? `✓ Set (${process.env.MASSIVE_API_KEY.length} chars)` : '✗ Missing';
console.log(`  MASSIVE_API_KEY: ${massiveKeyStatus}`);
console.log(`  SUPABASE_URL: ${process.env.SUPABASE_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  SMTP (deletion emails): ${process.env.SMTP_HOST && process.env.SMTP_USER ? '✓ Set' : '✗ Optional'}`);

// Routes
import analyzeDataRoute from './routes/analyzeData.js';
import historyRoute from './routes/history.js';
import userRoute from './routes/user.js';
import marketDataRoute from './routes/marketData.js';
import subscriptionRoute from './routes/subscription.js';
import authRoute from './routes/auth.js';
import deleteAccountRoute from './routes/delete-account.js';
import webhooksRoute from './routes/webhooks.js';
import socialRoute from './routes/social.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// Request logging middleware
app.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  console.log('[MIDDLEWARE] Incoming request:', c.req.method, c.req.path, c.req.url, 'Origin:', origin);
  await next();
});

// CORS configuration
const defaultOrigins = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  'https://app.chartsignl.com',
  'https://chartsignl.com',
  'https://www.chartsignl.com',
];

// Merge env var origins with defaults, ensuring www.chartsignl.com is always included
const envOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || [];
const corsOrigins = [...new Set([...envOrigins, ...defaultOrigins])]; // Remove duplicates

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return corsOrigins[0];
    return corsOrigins.includes(origin) ? origin : null;
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Root - avoid 404 for GET /
app.get('/', (c) => {
  return c.json({
    name: 'ChartSignl API',
    version: '1.0.0',
    docs: '/health (health check), /api/* (API routes)',
  });
});

// Health check
app.get('/health', (c) => {
  console.log('[HEALTH] Health check endpoint hit');
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
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
app.route('/api/auth', authRoute);
app.route('/api/auth', deleteAccountRoute);
app.route('/webhooks', webhooksRoute);
app.route('/api/social', socialRoute);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
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
║   CORS Origins: ${corsOrigins.join(', ')}         ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
