import type { AIPrediction } from '../types/prediction';

export interface CardOptions {
  brand?: string;
  domain?: string;
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? '+' : ''}${v}%`;
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DIR = {
  bullish: { arrow: '↑', label: 'Bullish' },
  bearish: { arrow: '↓', label: 'Bearish' },
  neutral: { arrow: '→', label: 'Neutral' },
} as const;

export function buildPredictionCardSVG(p: AIPrediction, opts: CardOptions = {}): string {
  const brand = opts.brand ?? 'ChartSignl';
  const domain = opts.domain ?? 'chartsignl.com';

  const resolved = p.status === 'resolved' || !!p.resolvedAt;
  const correct = p.directionHit === true;
  const dir = DIR[p.direction] ?? DIR.neutral;

  const badge = !resolved
    ? { txt: '◷ Pending', fg: '#1D4ED8', bg: '#EFF6FF', w: 220 }
    : correct
      ? { txt: '✓ Hit', fg: '#047857', bg: '#ECFDF5', w: 186 }
      : { txt: '✗ Miss', fg: '#B91C1C', bg: '#FEF2F2', w: 200 };

  const actualColor = !resolved ? '#57534E' : correct ? '#10B981' : '#EF4444';

  const exp = p.expectedChangePct ?? 0;
  const act = p.actualChangePct ?? 0;
  const M = Math.max(Math.abs(exp), Math.abs(act), 1);
  const clamp = (y: number) => Math.max(180, Math.min(440, y));
  const fY = clamp(300 - (exp / M) * 120);
  const aY = clamp(300 - (act / M) * 120);

  const actualGlyph = resolved
    ? `<polyline points="913,300 970,${Math.round((300 + aY) / 2 - 6)} 1030,${Math.round(aY + (300 - aY) * 0.18)} 1112,${aY}" fill="none" stroke="${actualColor}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
       <circle cx="1112" cy="${aY}" r="8" fill="${actualColor}"/>
       <text x="1100" y="${aY + 24}" font-family="sans-serif" font-size="18" fill="#0F6E56" text-anchor="end">actual</text>`
    : '';

  const horizonLabel = p.horizonEndAt;
  const actualLine = resolved
    ? `<text x="64" y="492" font-family="sans-serif" font-size="68" font-weight="600" fill="${actualColor}">Actual ${pct(act)}</text>`
    : `<text x="64" y="492" font-family="sans-serif" font-size="48" font-weight="600" fill="#57534E">Resolves ${shortDate(horizonLabel)}</text>`;

  const dateLine = resolved
    ? `Forecast ${shortDate(p.createdAt)} → resolved ${shortDate(p.resolvedAt) || shortDate(horizonLabel)}`
    : `Forecast ${shortDate(p.createdAt)} → horizon ${shortDate(horizonLabel)}`;

  return `<svg viewBox="0 0 1200 630" width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1200" height="630" fill="#FAFAF9"/>
  <rect x="0" y="0" width="10" height="630" fill="#1D9E75"/>

  <text x="64" y="84" font-family="sans-serif" font-size="30" font-weight="600" fill="#1C1917">${brand}</text>
  <text x="64" y="116" font-family="sans-serif" font-size="18" fill="#A8A29E">Atlas AI · verified call</text>

  <text x="64" y="248" font-family="sans-serif" font-size="92" font-weight="600" fill="#1C1917">${p.symbol}</text>
  <text x="${64 + p.symbol.length * 56 + 24}" y="248" font-family="sans-serif" font-size="28" fill="#A8A29E">${p.interval}</text>

  <text x="64" y="300" font-family="sans-serif" font-size="30" fill="#57534E">${dir.arrow} ${dir.label} · called ${pct(exp)}</text>

  <rect x="64" y="332" width="${badge.w}" height="52" rx="26" fill="${badge.bg}"/>
  <text x="92" y="367" font-family="sans-serif" font-size="26" font-weight="600" fill="${badge.fg}">${badge.txt}</text>

  ${actualLine}
  <text x="64" y="540" font-family="sans-serif" font-size="22" fill="#A8A29E">${dateLine}</text>

  <rect x="640" y="150" width="496" height="310" rx="14" fill="#FFFFFF" stroke="#E7E5E4" stroke-width="1"/>
  <rect x="913" y="151" width="222" height="308" fill="#E6F1FB" opacity="0.5"/>
  <polyline points="664,400 720,392 770,398 820,360 870,344 913,300" fill="none" stroke="#888780" stroke-width="3" stroke-linejoin="round"/>
  <line x1="913" y1="180" x2="913" y2="440" stroke="#B4B2A9" stroke-width="1" stroke-dasharray="6 5"/>
  <line x1="913" y1="300" x2="1112" y2="${fY}" stroke="#378ADD" stroke-width="3" stroke-dasharray="8 6"/>
  <circle cx="913" cy="300" r="6" fill="#5F5E5A"/>
  <circle cx="1112" cy="${fY}" r="6" fill="#378ADD"/>
  <text x="1100" y="${fY - 12}" font-family="sans-serif" font-size="18" fill="#378ADD" text-anchor="end">predicted</text>
  ${actualGlyph}

  <text x="64" y="590" font-family="sans-serif" font-size="17" fill="#A8A29E" font-style="italic">Timestamped and scored against actual price. Educational only — not financial advice.</text>
  <text x="1136" y="590" font-family="sans-serif" font-size="17" fill="#A8A29E" text-anchor="end">${domain}</text>
</svg>`;
}
