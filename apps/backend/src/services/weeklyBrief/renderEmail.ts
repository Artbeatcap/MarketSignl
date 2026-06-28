import type { WeeklyBrand, WeeklyContent } from './types.js';
import { CHARTSIGNL_BRAND } from './brand.js';

export interface RenderEmailOptions {
  content: WeeklyContent;
  brand?: WeeklyBrand;
  preheader?: string;
  unsubscribeUrl: string;
  preferencesUrl?: string;
}

function pctColor(pct: number | null, brand: WeeklyBrand): string {
  if (pct === null) return '#9fb0c9';
  if (pct < 0) return brand.resistance;
  if (pct > 0) return brand.support;
  return '#9fb0c9';
}

function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function sectorPctColor(pct: number, brand: WeeklyBrand): string {
  if (pct < 0) return brand.resistance;
  if (pct > 0) return brand.support;
  return '#7b8aa3';
}

function moverDirColor(dir: string, brand: WeeklyBrand): string {
  return dir === 'down' ? brand.resistance : brand.support;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTape(content: WeeklyContent, brand: WeeklyBrand): string {
  if (!content.tape?.length) return '';

  const cellWidth = Math.floor(100 / content.tape.length);
  const cells = content.tape
    .map((t, i) => {
      const borderLeft = i === 0 ? 'none' : '1px solid #1e2d49';
      const color = pctColor(t.pct, brand);
      return `
                <td class="tape-cell stack" align="center" width="${cellWidth}%" style="padding:14px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-left:${borderLeft};">
                  <div style="font-size:12px;font-weight:700;color:#9fb0c9;letter-spacing:0.06em;">${escapeHtml(t.symbol)}</div>
                  <div style="font-size:17px;font-weight:800;color:#ffffff;margin-top:3px;">${escapeHtml(t.price)}</div>
                  <div style="font-size:13px;font-weight:700;margin-top:2px;color:${color};">${formatPct(t.pct)}</div>
                </td>`;
    })
    .join('');

  return `
        <tr>
          <td style="background:#0b1220;padding:0 16px 22px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111c30;border:1px solid #1e2d49;border-radius:12px;">
              <tr>${cells}
              </tr>
            </table>
            <div style="font-size:11px;color:#5d6b82;text-align:center;padding-top:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Weekly change · Mon→Fri close</div>
          </td>
        </tr>`;
}

function renderSectors(content: WeeklyContent, brand: WeeklyBrand): string {
  if (!content.sectors?.length) return '';

  const rows = content.sectors
    .map(
      (s) => `
              <tr>
                <td style="padding:9px 0;border-bottom:1px solid #f0f2f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td align="left" style="font-size:14px;color:#3a4658;">
                      <span class="sector-name" style="font-weight:600;color:#1a2230;">${escapeHtml(s.name)}</span>
                      <span style="color:#9aa6b5;font-size:12px;"> · ${escapeHtml(s.etf)}</span>
                    </td>
                    <td align="right" width="120">
                      <span style="display:inline-block;min-width:64px;text-align:right;font-size:14px;font-weight:700;color:${sectorPctColor(s.pct, brand)};">${formatPct(s.pct)}</span>
                    </td>
                  </tr></table>
                </td>
              </tr>`
    )
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Sector Scorecard</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
            </table>
          </td>
        </tr>`;
}

function renderMovers(content: WeeklyContent, brand: WeeklyBrand): string {
  if (!content.movers?.length) return '';

  const cards = content.movers
    .map(
      (m) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:#fafbfc;border:1px solid #eef1f6;border-radius:10px;">
              <tr>
                <td style="padding:13px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <span style="font-size:15px;font-weight:800;color:#0b1220;">$${escapeHtml(m.ticker)}</span>
                  <span style="font-size:14px;font-weight:700;margin-left:8px;color:${moverDirColor(m.dir, brand)};">${escapeHtml(m.pct)}</span>
                  ${m.why ? `<div style="font-size:14px;line-height:1.5;color:#4a586b;margin-top:5px;">${escapeHtml(m.why)}</div>` : ''}
                </td>
              </tr>
            </table>`
    )
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Notable Movers</div>
            ${cards}
          </td>
        </tr>`;
}

function renderLevels(content: WeeklyContent, brand: WeeklyBrand): string {
  if (!content.levels || Object.keys(content.levels).length === 0) return '';

  const levelCards = Object.entries(content.levels)
    .map(
      ([sym, d]) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:#0b1220;border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div style="font-size:13px;font-weight:800;color:${brand.accent};letter-spacing:0.06em;margin-bottom:8px;">${escapeHtml(sym.toUpperCase())}${d.pivot ? ` · pivot ${escapeHtml(d.pivot)}` : ''}</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td width="50%" style="vertical-align:top;">
                      <div style="font-size:11px;color:#7b8aa3;text-transform:uppercase;letter-spacing:0.08em;">Support</div>
                      <div style="font-size:14px;color:${brand.support};font-weight:600;margin-top:3px;">${escapeHtml(d.support)}${d.support2 ? ` &nbsp;·&nbsp; ${escapeHtml(d.support2)}` : ''}</div>
                    </td>
                    <td width="50%" style="vertical-align:top;">
                      <div style="font-size:11px;color:#7b8aa3;text-transform:uppercase;letter-spacing:0.08em;">Resistance</div>
                      <div style="font-size:14px;color:${brand.resistance};font-weight:600;margin-top:3px;">${escapeHtml(d.resistance)}${d.resistance2 ? ` &nbsp;·&nbsp; ${escapeHtml(d.resistance2)}` : ''}</div>
                    </td>
                  </tr></table>
                </td>
              </tr>
            </table>`
    )
    .join('');

  const keyLevelNote = content.sections.key_level_note
    ? `<div style="font-size:15px;line-height:1.55;color:#1f2733;margin-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><strong style="color:#0b1220;">The line that matters:</strong> ${escapeHtml(content.sections.key_level_note)}</div>`
    : '';

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Levels for the Week</div>
            ${levelCards}
            ${keyLevelNote}
          </td>
        </tr>`;
}

function renderWeekAhead(content: WeeklyContent, brand: WeeklyBrand): string {
  const hasBullets = content.week_ahead_bullets?.length;
  const hasHtml = content.sections.week_ahead_html;
  if (!hasBullets && !hasHtml) return '';

  const htmlBlock = hasHtml
    ? `<div class="body-text" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin-bottom:12px;">${content.sections.week_ahead_html}</div>`
    : '';

  const bullets = (content.week_ahead_bullets || [])
    .map(
      (b) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
              <tr>
                <td width="64" style="vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <span style="display:inline-block;background:#e6faf7;color:${brand.accentLight};font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;">${escapeHtml(b.date)}</span>
                </td>
                <td style="vertical-align:top;font-size:14px;line-height:1.5;color:#2a3645;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <strong style="color:#0b1220;">${escapeHtml(b.event)}</strong>${b.why ? ` — <span style="color:#5a6b80;">${escapeHtml(b.why)}</span>` : ''}
                </td>
              </tr>
            </table>`
    )
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">The Week Ahead</div>
            ${htmlBlock}
            ${bullets}
          </td>
        </tr>`;
}

export function buildPreheader(content: WeeklyContent, maxLen = 120): string {
  const text = content.sections.major_driver || '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

export function renderWeeklyBriefEmail(options: RenderEmailOptions): string {
  const brand = options.brand ?? CHARTSIGNL_BRAND;
  const content = options.content;
  const preheader = options.preheader ?? buildPreheader(content);
  const preferencesUrl = options.preferencesUrl ?? brand.appUrl;

  const majorDriver = content.sections.major_driver
    ? `
        <tr>
          <td class="px" style="padding-top:28px;padding-bottom:4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border-left:4px solid ${brand.accent};border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div class="kicker" style="color:${brand.accent};margin-bottom:8px;">What drove the week</div>
                  <div style="font-size:16px;line-height:1.55;color:#1a2230;font-weight:500;">${escapeHtml(content.sections.major_driver)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  const weekInReview = content.sections.week_in_review_html
    ? `
        <tr>
          <td class="px" style="padding-top:26px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Last Week in Review</div>
            <div class="body-text" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${content.sections.week_in_review_html}</div>
          </td>
        </tr>`
    : '';

  const biggestRisk = content.sections.biggest_risk
    ? `
        <tr>
          <td class="px" style="padding-top:26px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7f8;border-left:4px solid ${brand.resistance};border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div class="kicker" style="color:${brand.resistance};margin-bottom:8px;">The biggest risk</div>
                  <div style="font-size:16px;line-height:1.55;color:#1a2230;font-weight:500;">${escapeHtml(content.sections.biggest_risk)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  const staleNote = content.data_stale
    ? `<div style="font-size:12px;color:#b06a00;background:#fff8e6;border:1px solid #ffe2a8;border-radius:8px;padding:10px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Some market data was unavailable at generation time; affected sections were omitted rather than estimated.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(brand.name)} — Weekly Brief — ${escapeHtml(content.week_label)}</title>
  <style>
    body { margin:0; padding:0; background:#0b0f17; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; }
    img { border:0; line-height:100%; outline:none; text-decoration:none; }
    a { color:${brand.accentLight}; text-decoration:none; }
    .px { padding-left:28px; padding-right:28px; }
    .h1 { font-size:26px; line-height:1.2; font-weight:800; letter-spacing:-0.02em; }
    .kicker { font-size:11px; letter-spacing:0.18em; text-transform:uppercase; font-weight:700; }
    .sec-title { font-size:13px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:#7b8aa3; }
    .body-text { font-size:16px; line-height:1.62; color:#1f2733; }
    .body-text p { margin:0 0 14px 0; }
    .body-text strong { color:#0b1220; }
    .muted { color:#8a97a8; font-size:13px; line-height:1.5; }
    @media only screen and (max-width:620px) {
      .px { padding-left:18px !important; padding-right:18px !important; }
      .h1 { font-size:22px !important; }
      .stack { display:block !important; width:100% !important; }
      .tape-cell { padding:10px 8px !important; }
      .sector-name { font-size:13px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0b0f17;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">
    ${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f17;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <tr>
          <td style="background:${brand.headerGradientStart};background-image:linear-gradient(135deg,${brand.headerGradientStart} 0%,${brand.headerGradientEnd} 100%);padding:30px 28px 24px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div class="kicker" style="color:${brand.accent};">${escapeHtml(brand.name)} · Weekly Brief</div>
                  <div class="h1" style="color:#ffffff;margin-top:8px;">The Week in Markets</div>
                  <div class="muted" style="color:#9fb0c9;margin-top:6px;font-size:13px;">${escapeHtml(content.week_label)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${renderTape(content, brand)}
        ${majorDriver}
        ${weekInReview}
        ${renderSectors(content, brand)}
        ${renderMovers(content, brand)}
        ${renderLevels(content, brand)}
        ${renderWeekAhead(content, brand)}
        ${biggestRisk}

        <tr>
          <td class="px" style="padding-top:30px;padding-bottom:6px;" align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="border-radius:10px;background:${brand.cta};">
                  <a href="${escapeHtml(brand.appUrl)}" style="display:inline-block;padding:14px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;border-radius:10px;">Pull these levels up on live charts →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding-top:24px;">
            ${staleNote}
            <div class="muted" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin-top:14px;font-size:12px;line-height:1.55;color:#9aa6b5;">
              Educational market commentary, not financial advice. Levels and scenarios are analytical, not trade instructions. Figures reflect data available at ${escapeHtml(content.generated_at)}.
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 28px 30px 28px;border-top:1px solid #eef1f6;margin-top:10px;">
            <div style="font-size:13px;color:#8a97a8;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <strong style="color:#5a6b80;">${escapeHtml(brand.name)}</strong><br>
              <a href="${escapeHtml(preferencesUrl)}" style="color:#8a97a8;text-decoration:underline;">Email preferences</a> &nbsp;·&nbsp;
              <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#8a97a8;text-decoration:underline;">Unsubscribe</a>
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildSubject(content: WeeklyContent): string {
  return `ChartSignl Weekly — ${content.week_label}`;
}
