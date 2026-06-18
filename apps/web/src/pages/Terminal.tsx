import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AIPrediction, ChartInterval, MarketDataPoint } from '@marketsignl/core';
import { FREE_PREDICTION_LIMIT } from '@marketsignl/core';
import { apiFetch, getToken, publicFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import PredictionStatsPanel from '../components/PredictionStatsPanel';
import PredictionHistory from '../components/PredictionHistory';
import PredictionChart from '../components/PredictionChart';
import ReplayBanner from '../components/ReplayBanner';
import {
  PredictionReplayProvider,
  usePredictionReplay,
} from '../state/PredictionReplayContext';
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
  const res = await publicFetch<{ data: MarketDataPoint[] }>(
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
  return (
    <PredictionReplayProvider getToken={getToken}>
      <TerminalContent />
    </PredictionReplayProvider>
  );
}

function TerminalContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, user, signOut } = useAuth();
  const { active, loading: replayLoading, error: replayError, replay, clear } =
    usePredictionReplay();
  const [symbol, setSymbol] = useState('AAPL');
  const [symbolInput, setSymbolInput] = useState('AAPL');
  const [interval, setInterval] = useState<ChartInterval>('3mo');
  const [prediction, setPrediction] = useState<AIPrediction | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReplayId, setPendingReplayId] = useState<string | null>(null);

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

  const insight = active?.prediction ?? prediction;
  const displayData = active?.historical ?? chartData;
  const displayPrediction = active?.prediction ?? prediction;
  const displaySymbol = active?.prediction.symbol ?? symbol;
  const displayInterval = active?.prediction.interval ?? interval;
  const displayError = error ?? replayError;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    setSymbol(symbolInput.toUpperCase().trim());
    setPrediction(null);
    setError(null);
  };

  const handleReplay = async (id: string) => {
    setPendingReplayId(id);
    setError(null);
    await replay(id);
    setPendingReplayId(null);
  };

  const handlePredict = async () => {
    if (active) return;

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
      queryClient.invalidateQueries({ queryKey: ['predictionStats'] });
      queryClient.invalidateQueries({ queryKey: ['predictionHistory'] });
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
        <PredictionStatsPanel enabled={!!session} />
        <PredictionHistory
          enabled={!!session}
          onSelect={handleReplay}
          activeId={active?.prediction.id}
          loadingId={replayLoading ? pendingReplayId : null}
        />
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
                  clear();
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
                  clear();
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
            disabled={
              !!active ||
              isLoading ||
              chartData.length === 0 ||
              isPredicting ||
              replayLoading
            }
            title={active ? 'Exit replay to run a new prediction' : undefined}
          >
            {isPredicting ? 'Generating...' : '✨ AI Prediction'}
          </button>

          {session && usage && !usage.isPro && (
            <span className="usage-badge">
              {usage.freePredictionsUsed ?? 0}/{FREE_PREDICTION_LIMIT} free
            </span>
          )}
        </header>

        {displayError && <div className="terminal-error">{displayError}</div>}

        <div className="terminal-content">
          <section className="chart-panel">
            <ReplayBanner />
            {isLoading && !active ? (
              <div className="chart-loading">Loading chart...</div>
            ) : replayLoading ? (
              <div className="chart-loading">Loading replay...</div>
            ) : (
              <PredictionChart
                data={displayData}
                symbol={displaySymbol}
                interval={displayInterval}
                prediction={displayPrediction}
                height={420}
                actualPath={active?.actual}
                priceDomainOverride={active?.priceDomain}
                replayOutcome={active?.prediction.directionHit ?? null}
                isReplay={!!active}
              />
            )}
          </section>

          <aside className="insight-panel">
            <h2>Insight</h2>
            {insight ? (
              <div className="insight-content">
                <h3>{insight.headline}</h3>
                <p>{insight.summary}</p>
                <div className="insight-meta">
                  <div>
                    <span>Confidence</span>
                    <strong>{insight.confidence}%</strong>
                  </div>
                  <div>
                    <span>Direction</span>
                    <strong>{insight.direction}</strong>
                  </div>
                  <div>
                    <span>Forecast</span>
                    <strong>
                      {insight.expectedChangePct >= 0 ? '+' : ''}
                      {insight.expectedChangePct.toFixed(2)}%
                    </strong>
                  </div>
                  {active?.prediction.status === 'resolved' &&
                    active.prediction.actualChangePct != null && (
                      <div>
                        <span>Actual</span>
                        <strong>
                          {active.prediction.actualChangePct >= 0 ? '+' : ''}
                          {active.prediction.actualChangePct.toFixed(2)}%
                        </strong>
                      </div>
                    )}
                </div>
                {insight.reasoning.length > 0 && (
                  <div className="insight-section">
                    <h4>Reasoning</h4>
                    <ul>
                      {insight.reasoning.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {insight.riskFactors.length > 0 && (
                  <div className="insight-section">
                    <h4>Risk Factors</h4>
                    <ul className="risk-list">
                      {insight.riskFactors.map((r, i) => (
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
                <p>
                  Search a symbol and click <strong>AI Prediction</strong> to see the forecast
                  and reasoning here. Click a history row to replay a past call.
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
