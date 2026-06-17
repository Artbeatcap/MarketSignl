import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from 'recharts';
import type { AIPrediction, ChartInterval } from '@marketsignl/core';
import { CHART_COLORS, FREE_PREDICTION_LIMIT } from '@marketsignl/core';
import { apiFetch, publicFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import './Terminal.css';

const INTERVALS: { value: ChartInterval; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '5d', label: '5D' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '1y', label: '1Y' },
];

const NAV_ITEMS = [
  { id: 'terminal', label: 'Terminal', active: true },
  { id: 'breakouts', label: 'Breakouts', disabled: true },
  { id: 'screener', label: 'Screener', disabled: true },
  { id: 'ai', label: 'AI Co-Pilot', disabled: true },
  { id: 'calendars', label: 'Calendars', disabled: true },
];

async function fetchMarketData(symbol: string, interval: string) {
  const res = await publicFetch<{ data: Array<Record<string, number>> }>(
    `/api/market-data/${symbol}?interval=${interval}`
  );
  return res.data ?? [];
}

async function fetchUsage() {
  return apiFetch<{
    isPro?: boolean;
    freePredictionsUsed?: number;
    freePredictionsLimit?: number;
  }>('/api/user/usage');
}

export default function Terminal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, user, signOut } = useAuth();
  const [symbol, setSymbol] = useState('AAPL');
  const [symbolInput, setSymbolInput] = useState('AAPL');
  const [interval, setInterval] = useState<ChartInterval>('3mo');
  const [prediction, setPrediction] = useState<AIPrediction | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: chartData = [], isLoading } = useQuery({
    queryKey: ['marketData', symbol, interval],
    queryFn: () => fetchMarketData(symbol, interval),
  });

  const { data: usage } = useQuery({
    queryKey: ['usage', session?.user?.id],
    queryFn: fetchUsage,
    enabled: !!session,
    retry: false,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSymbol(symbolInput.toUpperCase().trim());
    setPrediction(null);
    setError(null);
  };

  const handlePredict = async () => {
    if (!session) {
      navigate('/login?redirect=/terminal');
      return;
    }

    if (!usage?.isPro && (usage?.freePredictionsUsed ?? 0) >= FREE_PREDICTION_LIMIT) {
      setError('Free prediction limit reached. Upgrade to Pro for unlimited forecasts.');
      return;
    }

    setIsPredicting(true);
    setError(null);
    try {
      const result = await apiFetch<{ success: boolean; prediction?: AIPrediction; error?: string }>(
        '/api/predict',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, interval, data: chartData }),
        }
      );
      if (!result.success || !result.prediction) {
        throw new Error(result.error || 'Prediction failed');
      }
      setPrediction(result.prediction);
      queryClient.invalidateQueries({ queryKey: ['usage'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Prediction failed';
      if (msg.toLowerCase().includes('not authenticated')) {
        navigate('/login?redirect=/terminal');
        return;
      }
      setError(msg);
    } finally {
      setIsPredicting(false);
    }
  };

  const historicalChart = chartData.map((d, i) => ({
    ...d,
    index: i,
    type: 'historical' as const,
  }));

  const predictionChart = prediction
    ? prediction.projectedPath.map((p, i) => ({
        index: chartData.length + i,
        timestamp: p.timestamp,
        close: p.price,
        upperBand: p.upperBand ?? p.price,
        lowerBand: p.lowerBand ?? p.price,
        type: 'prediction' as const,
      }))
    : [];

  const combinedChart = [...historicalChart, ...predictionChart];
  const dividerIndex = chartData.length > 0 ? chartData.length - 1 : 0;

  return (
    <div className="terminal-layout">
      <aside className="terminal-sidebar">
        <div className="sidebar-brand">MarketSignl</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${item.active ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
              disabled={item.disabled}
              title={item.disabled ? 'Coming in Phase 2' : undefined}
            >
              {item.label}
              {item.disabled && <span className="soon">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-auth">
          {session && user ? (
            <>
              <p className="sidebar-user" title={user.email ?? undefined}>
                {user.email}
              </p>
              {usage?.isPro ? (
                <span className="pro-badge">Pro</span>
              ) : (
                <span className="usage-sidebar">
                  {usage?.freePredictionsUsed ?? 0}/{FREE_PREDICTION_LIMIT} predictions
                </span>
              )}
              <button
                type="button"
                className="sign-out-btn"
                onClick={async () => {
                  await signOut();
                  queryClient.removeQueries({ queryKey: ['usage'] });
                  setPrediction(null);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login?redirect=/terminal" className="sign-in-link">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <main className="terminal-main">
        <header className="terminal-toolbar">
          <form onSubmit={handleSearch} className="symbol-form">
            <input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              placeholder="Search symbol (e.g. AAPL)"
            />
            <button type="submit">Go</button>
          </form>

          <div className="interval-row">
            {INTERVALS.map((opt) => (
              <button
                key={opt.value}
                className={`interval-btn ${interval === opt.value ? 'active' : ''}`}
                onClick={() => {
                  setInterval(opt.value);
                  setPrediction(null);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            className="predict-btn"
            onClick={handlePredict}
            disabled={isLoading || chartData.length === 0 || isPredicting}
          >
            {isPredicting ? 'Generating...' : '✨ AI Prediction'}
          </button>

          {session && usage && !usage.isPro && (
            <span className="usage-badge">
              {usage.freePredictionsUsed ?? 0}/{FREE_PREDICTION_LIMIT} free
            </span>
          )}
        </header>

        {error && <div className="terminal-error">{error}</div>}

        <div className="terminal-content">
          <section className="chart-panel">
            {isLoading ? (
              <div className="chart-loading">Loading chart...</div>
            ) : (
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart data={combinedChart} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                  <XAxis dataKey="index" tick={false} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                    labelFormatter={() => symbol}
                  />
                  {prediction && (
                    <ReferenceLine x={dividerIndex} stroke={CHART_COLORS.grid} strokeDasharray="4 4" />
                  )}
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke={CHART_COLORS.lineStroke}
                    strokeWidth={2.5}
                    dot={false}
                    data={historicalChart}
                  />
                  {prediction && (
                    <>
                      <Area
                        dataKey="upperBand"
                        stroke="none"
                        fill={CHART_COLORS.predictionBand}
                        data={predictionChart}
                      />
                      <Line
                        type="monotone"
                        dataKey="close"
                        stroke={CHART_COLORS.prediction}
                        strokeWidth={2.5}
                        strokeDasharray="6 4"
                        dot={false}
                        data={predictionChart}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {prediction && (
              <div className="prediction-chip">
                ✨ AI Prediction {prediction.expectedChangePct >= 0 ? '+' : ''}
                {prediction.expectedChangePct.toFixed(2)}%
              </div>
            )}
          </section>

          <aside className="insight-panel">
            <h2>Insight</h2>
            {prediction ? (
              <div className="insight-content">
                <h3>{prediction.headline}</h3>
                <p>{prediction.summary}</p>
                <div className="insight-meta">
                  <div>
                    <span>Confidence</span>
                    <strong>{prediction.confidence}%</strong>
                  </div>
                  <div>
                    <span>Direction</span>
                    <strong>{prediction.direction}</strong>
                  </div>
                  <div>
                    <span>Forecast</span>
                    <strong>
                      {prediction.expectedChangePct >= 0 ? '+' : ''}
                      {prediction.expectedChangePct.toFixed(2)}%
                    </strong>
                  </div>
                </div>
                {prediction.reasoning.length > 0 && (
                  <div className="insight-section">
                    <h4>Reasoning</h4>
                    <ul>
                      {prediction.reasoning.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {prediction.riskFactors.length > 0 && (
                  <div className="insight-section">
                    <h4>Risk Factors</h4>
                    <ul className="risk-list">
                      {prediction.riskFactors.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="disclaimer">
                  Educational forecast only — not financial advice.
                </p>
              </div>
            ) : (
              <div className="insight-empty">
                <p>Search a symbol and click <strong>AI Prediction</strong> to see the forecast and reasoning here.</p>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
