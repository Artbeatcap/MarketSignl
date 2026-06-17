import { Link } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-header">
        <span className="landing-logo">MarketSignl</span>
        <nav className="landing-nav">
          <Link to="/login">Sign In</Link>
          <Link to="/terminal">Open Terminal</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <span className="landing-badge">AI Prediction Terminal</span>
        <h1>
          One-click AI forecast on <span>any stock</span>
        </h1>
        <p>
          One button runs our AI and draws its projected path on the right side of the chart —
          filling in the empty future space where price hasn't happened yet.
        </p>
        <div className="landing-cta">
          <Link to="/terminal" className="btn-primary">
            Open Terminal →
          </Link>
          <a href="#how-it-works" className="btn-ghost">
            See how it works
          </a>
        </div>
      </section>

      <section id="how-it-works" className="landing-steps">
        <p className="section-label">HOW IT WORKS</p>
        <h2>From ticker to forecast in 3 steps</h2>
        <div className="steps-grid">
          <div className="step-card">
            <span className="step-num">1</span>
            <h3>Pull up any stock</h3>
            <p>Type a ticker or company name. Works across U.S. equities &amp; ETFs.</p>
          </div>
          <div className="step-card">
            <span className="step-num">2</span>
            <h3>Click AI Prediction</h3>
            <p>One button on the chart. Our system analyzes technical data in the background.</p>
          </div>
          <div className="step-card">
            <span className="step-num">3</span>
            <h3>Read the chart</h3>
            <p>Projected price path and reasoning — plotted directly on the chart.</p>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <h2>Built for traders, styled for clarity</h2>
        <ul>
          <li>✨ One-click AI Prediction with confidence bands</li>
          <li>📊 Real-time charts with EMA overlays</li>
          <li>🗺️ Atlas support &amp; resistance analysis</li>
          <li>📋 Prediction &amp; analysis history</li>
        </ul>
      </section>

      <footer className="landing-footer">
        <p>Educational analysis only — not financial advice.</p>
        <p>© {new Date().getFullYear()} MarketSignl</p>
      </footer>
    </div>
  );
}
