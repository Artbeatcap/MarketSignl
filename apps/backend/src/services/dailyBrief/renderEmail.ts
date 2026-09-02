import type { DailyBrand, DailyContent } from './types.js';
import {
  DAILY_BRAND,
  EMAIL_BORDER,
  EMAIL_INK,
  EMAIL_MUTED,
  EMAIL_PAGE_BG,
  EMAIL_SURFACE,
} from './brand.js';
import { EMAIL_FONT, emailClientCss } from '../briefShared/emailCss.js';
import { sanitizeAiField, sanitizeDailySections } from '../../lib/briefSanitize.js';
import type { CalendarRow } from '../../lib/weekAhead.js';

export interface RenderEmailOptions {
  content: DailyContent;
  brand?: DailyBrand;
  preheader?: string;
  unsubscribeUrl: string;
  preferencesUrl?: string;
  /** Structured calendar rows. Empty/omitted → section is skipped. */
  calendar?: CalendarRow[];
}

function pctColor(pct: number | null, brand: DailyBrand): string {
  if (pct === null) return EMAIL_MUTED;
  if (pct < 0) return brand.resistance;
  if (pct > 0) return brand.support;
  return EMAIL_MUTED;
}

function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function sectorPctColor(pct: number, brand: DailyBrand): string {
  if (pct < 0) return brand.resistance;
  if (pct > 0) return brand.support;
  return '#7b8aa3';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTape(content: DailyContent, brand: DailyBrand): string {
  if (!content.tape?.length) return '';

  const cellWidth = Math.floor(100 / content.tape.length);
  const cells = content.tape
    .map((t, i) => {
      const borderLeft = i === 0 ? 'none' : `1px solid ${EMAIL_BORDER}`;
      const color = pctColor(t.pct, brand);
      return `
                <td class="tape-cell" align="center" width="${cellWidth}%" style="padding:12px 4px;font-family:${EMAIL_FONT};border-left:${borderLeft};">
                  <div class="tape-sym" style="font-size:11px;font-weight:700;color:${EMAIL_MUTED};letter-spacing:0.04em;">${escapeHtml(t.symbol)}</div>
                  <div class="tape-price" style="font-size:15px;font-weight:800;color:${EMAIL_INK};margin-top:3px;white-space:nowrap;">${escapeHtml(t.price)}</div>
                  <div class="tape-pct" style="font-size:12px;font-weight:700;margin-top:2px;color:${color};white-space:nowrap;">${formatPct(t.pct)}</div>
                </td>`;
    })
    .join('');

  return `
        <tr>
          <td class="tape-wrap" style="background:#ffffff;padding:0 16px 22px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_SURFACE};border:1px solid ${EMAIL_BORDER};border-radius:12px;">
              <tr>${cells}
              </tr>
            </table>
            <div style="font-size:11px;color:${EMAIL_MUTED};text-align:center;padding-top:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Overnight / premarket change</div>
          </td>
        </tr>`;
}

function renderSectors(content: DailyContent, brand: DailyBrand): string {
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
                    <td align="right" width="72">
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

function badge(label: string, background: string, color: string): string {
  return `<span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${background};color:${color};vertical-align:middle;">${escapeHtml(label)}</span>`;
}

/**
 * "Yesterday" is wrong on a Monday send. Derive the label from the actual
 * prior trading day rather than hardcoding it.
 */
export function priorSessionLabel(dateLabel: string, now = new Date()): string {
  const parsed = Date.parse(dateLabel.replace(/^[A-Za-z]+,\s*/, ''));
  const base = Number.isNaN(parsed) ? now : new Date(parsed);
  const prior = new Date(base);
  do {
    prior.setDate(prior.getDate() - 1);
  } while (prior.getDay() === 0 || prior.getDay() === 6);

  const isYesterday = (base.getTime() - prior.getTime()) / 86_400_000 <= 1;
  if (isYesterday) return 'Yesterday';
  return prior.toLocaleDateString('en-US', { weekday: 'long' });
}

function renderMovers(content: DailyContent, _brand: DailyBrand): string {
  if (!content.movers?.length) return '';

  const priorLabel = priorSessionLabel(content.date_label);

  const cards = content.movers
    .map((m) => {
      const pctColor = m.dir === 'down' ? '#EF4444' : '#10B981';
      const flowDriven = !m.why || m.why === 'No headline — flow-driven';
      const whyColor = flowDriven ? '#9aa6b5' : '#4a586b';
      const whyText = m.why || 'No headline — flow-driven';
      const name = m.companyName
        ? `<span style="font-size:13px;color:#78716C;margin-left:8px;">${escapeHtml(m.companyName)}</span>`
        : '';

      // The badge carries the percentage's meaning. A row reading "$DKS -1.14%"
      // with no window label is worse than no row: it reads as the whole move.
      const windowBadge =
        m.window === 'index_driver'
          ? badge('Index Driver', '#EDE9FE', '#5B21B6')
          : m.window === 'premarket'
            ? badge('Premarket', '#E0F2F1', '#0F766E')
            : badge(priorLabel, '#F5F5F4', '#78716C');
      const earningsBadge = m.isEarnings ? ` ${badge('Earnings', '#FEF3C7', '#92400E')}` : '';

      const priorClause = m.priorSessionPct
        ? ` — <span style="color:${m.priorSessionPct.trim().startsWith('-') ? '#EF4444' : '#10B981'};font-weight:600;">${escapeHtml(m.priorSessionPct)} ${escapeHtml(priorLabel.toLowerCase())}</span>`
        : '';

      // A driver row carries no number beyond its percentage. The catalyst is
      // the payload, so its line is a step larger and darker than a mover's —
      // that contrast is what marks the row as explanatory without needing a
      // figure to justify itself. Muted when the no-catalyst override fired.
      const isDriver = m.window === 'index_driver';
      const noCatalyst = isDriver && m.hasCatalyst === false;
      const reasonStyle = isDriver
        ? `font-size:13.5px;line-height:1.55;color:${noCatalyst ? '#9aa6b5' : '#3d4a5c'};margin-top:6px;`
        : `font-size:13px;line-height:1.5;color:${whyColor};margin-top:5px;`;

      return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:#fafbfc;border:1px solid #eef1f6;border-radius:10px;">
              <tr>
                <td style="padding:13px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  ${windowBadge}${earningsBadge}
                  <span style="font-size:15px;font-weight:800;color:#0b1220;margin-left:8px;">$${escapeHtml(m.ticker)}</span>
                  <span style="font-size:14px;font-weight:700;margin-left:8px;color:${pctColor};">${escapeHtml(m.pct)}</span>
                  ${name}
                  <div style="${reasonStyle}">${escapeHtml(whyText)}${priorClause}</div>
                </td>
              </tr>
            </table>`;
    })
    .join('');

  const hasPremarket = content.movers.some((m) => m.window === 'premarket');
  const caption = hasPremarket
    ? `
            <div style="font-size:12px;line-height:1.5;color:#9aa6b5;margin-top:2px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Premarket prints are thin and can reverse at the open.</div>`
    : '';

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Movers</div>
            ${cards}${caption}
          </td>
        </tr>`;
}

function injectEstMarker(body: string, weekday: string | undefined, estimated: boolean): string {
  const escaped = escapeHtml(body);
  if (!estimated) return escaped;
  const marker = ' <span style="color:#9aa6b5">(est.)</span>';
  if (weekday && escaped.includes(escapeHtml(weekday))) {
    return escaped.replace(escapeHtml(weekday), `${escapeHtml(weekday)}${marker}`);
  }
  return `${escaped}${marker}`;
}

function renderCalendar(rows: CalendarRow[] | undefined): string {
  if (!rows?.length) return '';

  const cards = rows
    .map((row) => {
      const isMacro = row.kind === 'macro';
      const badgeHtml = isMacro
        ? badge('Macro', '#DBEAFE', '#1E40AF')
        : badge('Earnings', '#FEF3C7', '#92400E');

      const name =
        !isMacro && row.companyName
          ? `<span style="font-size:13px;color:#78716C;margin-left:8px;">${escapeHtml(row.companyName)}</span>`
          : '';

      const body = injectEstMarker(row.body, row.weekday, row.estimated);

      return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:#fafbfc;border:1px solid #eef1f6;border-radius:10px;">
              <tr>
                <td style="padding:13px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  ${badgeHtml}
                  <span style="font-size:15px;font-weight:800;color:#0b1220;margin-left:8px;">${escapeHtml(row.headline)}</span>
                  ${name}
                  <div style="font-size:13.5px;line-height:1.55;color:#3d4a5c;margin-top:6px;">${body}</div>
                </td>
              </tr>
            </table>`;
    })
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">On the Calendar</div>
            ${cards}
          </td>
        </tr>`;
}

function renderLevels(content: DailyContent, brand: DailyBrand): string {
  if (!content.levels || Object.keys(content.levels).length === 0) return '';

  const levelCards = Object.entries(content.levels)
    .map(
      ([sym, d]) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:${EMAIL_SURFACE};border:1px solid ${EMAIL_BORDER};border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div style="font-size:13px;font-weight:800;color:${brand.accent};letter-spacing:0.06em;margin-bottom:8px;">${escapeHtml(sym.toUpperCase())}${d.pivot ? ` · pivot ${escapeHtml(d.pivot)}` : ''}</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td class="level-col" width="50%" style="vertical-align:top;padding-right:8px;">
                      <div style="font-size:11px;color:${EMAIL_MUTED};text-transform:uppercase;letter-spacing:0.08em;">Support</div>
                      <div style="font-size:14px;color:${brand.support};font-weight:600;margin-top:3px;">${escapeHtml(d.support)}${d.support2 ? `<br>${escapeHtml(d.support2)}` : ''}</div>
                    </td>
                    <td class="level-col" width="50%" style="vertical-align:top;">
                      <div style="font-size:11px;color:${EMAIL_MUTED};text-transform:uppercase;letter-spacing:0.08em;">Resistance</div>
                      <div style="font-size:14px;color:${brand.resistance};font-weight:600;margin-top:3px;">${escapeHtml(d.resistance)}${d.resistance2 ? `<br>${escapeHtml(d.resistance2)}` : ''}</div>
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
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Levels for Today</div>
            ${levelCards}
            ${keyLevelNote}
          </td>
        </tr>`;
}

function renderCatalysts(content: DailyContent, brand: DailyBrand): string {
  const hasBullets = content.catalyst_bullets?.length;
  const hasHtml = content.sections.todays_watch_html;
  if (!hasBullets && !hasHtml) return '';

  const htmlBlock = hasHtml
    ? `<div class="body-text" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin-bottom:12px;">${content.sections.todays_watch_html}</div>`
    : '';

  const bullets = (content.catalyst_bullets || [])
    .map(
      (b) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
              <tr>
                <td class="date-cell" width="72" style="vertical-align:top;padding-right:10px;font-family:${EMAIL_FONT};">
                  <span style="display:inline-block;background:#e6faf7;color:${brand.accentLight};font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;white-space:nowrap;">${escapeHtml(b.date)}</span>
                </td>
                <td class="event-cell" style="vertical-align:top;font-size:14px;line-height:1.5;color:#2a3645;font-family:${EMAIL_FONT};">
                  <strong style="color:#0b1220;">${escapeHtml(b.event)}</strong>${b.why ? ` — <span style="color:#5a6b80;">${escapeHtml(b.why)}</span>` : ''}
                </td>
              </tr>
            </table>`
    )
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Today's Watch</div>
            ${htmlBlock}
            ${bullets}
          </td>
        </tr>`;
}

function renderHeadlines(content: DailyContent): string {
  if (!content.headlines?.length) return '';

  const rows = content.headlines
    .map(
      (h) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
              <tr>
                <td style="padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div style="font-size:15px;font-weight:700;color:#0b1220;line-height:1.4;">${escapeHtml(h.headline)}</div>
                  ${h.summary ? `<div style="font-size:14px;line-height:1.5;color:#4a586b;margin-top:4px;">${escapeHtml(h.summary)}</div>` : ''}
                </td>
              </tr>
            </table>`
    )
    .join('');

  return `
        <tr>
          <td class="px" style="padding-top:28px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Headlines in Focus</div>
            ${rows}
          </td>
        </tr>`;
}

export function buildPreheader(content: DailyContent, maxLen = 120): string {
  // Sanitize here too: artifacts ingested before greetings became their own
  // field can still carry "Hey guys…" at the head of opening_bias.
  const text = sanitizeAiField(content.preheader || content.sections.opening_bias || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

export function renderDailyBriefEmail(options: RenderEmailOptions): string {
  const brand = options.brand ?? DAILY_BRAND;
  // Backstop the ingest-time sanitizer: artifacts stored before it existed
  // still carry greetings inside the callout fields.
  const content: DailyContent = {
    ...options.content,
    sections: sanitizeDailySections(options.content.sections),
  };
  const preheader = options.preheader ?? buildPreheader(content);
  const preferencesUrl = options.preferencesUrl ?? brand.appUrl;

  const greeting = content.sections.greeting
    ? `
        <tr>
          <td class="px" style="padding-top:24px;">
            <div style="font-size:15px;line-height:1.55;color:#3a4658;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(content.sections.greeting)}</div>
          </td>
        </tr>`
    : '';

  const signoff = content.sections.signoff
    ? `
        <tr>
          <td class="px" style="padding-top:22px;">
            <div style="font-size:15px;line-height:1.55;color:#3a4658;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(content.sections.signoff)}</div>
          </td>
        </tr>`
    : '';

  const openingBias = content.sections.opening_bias
    ? `
        <tr>
          <td class="px" style="padding-top:28px;padding-bottom:4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border-left:4px solid ${brand.accent};border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div class="kicker" style="color:${brand.accent};margin-bottom:8px;">Opening bias</div>
                  <div style="font-size:16px;line-height:1.55;color:#1a2230;font-weight:500;">${escapeHtml(content.sections.opening_bias)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  const sessionSetup = content.sections.session_setup_html
    ? `
        <tr>
          <td class="px" style="padding-top:26px;">
            <div class="sec-title" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:2px solid #eef1f6;padding-bottom:8px;margin-bottom:14px;">Session Setup</div>
            <div class="body-text" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${content.sections.session_setup_html}</div>
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
  <title>${escapeHtml(brand.name)} — Morning Brief — ${escapeHtml(content.date_label)}</title>
  <style>${emailClientCss(brand)}
  </style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_PAGE_BG};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">
    ${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_PAGE_BG};">
    <tr><td class="email-shell" align="center" style="padding:24px 8px;">
      <table class="email-wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${EMAIL_BORDER};border-radius:16px;overflow:hidden;font-family:${EMAIL_FONT};">

        <tr>
          <td class="header-pad" style="background:${brand.headerGradientStart};background-image:linear-gradient(180deg,${brand.headerGradientStart} 0%,${brand.headerGradientEnd} 100%);padding:30px 28px 24px 28px;border-bottom:1px solid ${EMAIL_BORDER};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div class="kicker" style="color:${brand.accent};">${escapeHtml(brand.name)} · Morning Brief</div>
                  <div class="h1" style="color:${EMAIL_INK};margin-top:8px;">Markets This Morning</div>
                  <div class="muted" style="color:${EMAIL_MUTED};margin-top:6px;font-size:13px;">${escapeHtml(content.date_label)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${renderTape(content, brand)}
        ${greeting}
        ${openingBias}
        ${sessionSetup}
        ${renderSectors(content, brand)}
        ${renderMovers(content, brand)}
        ${renderLevels(content, brand)}
        ${renderCatalysts(content, brand)}
        ${renderHeadlines(content)}
        ${biggestRisk}
        ${signoff}
        ${renderCalendar(options.calendar)}

        <tr>
          <td class="px" style="padding-top:30px;padding-bottom:6px;" align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="border-radius:10px;background:${brand.cta};">
                  <a class="cta-btn" href="${escapeHtml(brand.chartsUrl || brand.appUrl)}" style="display:inline-block;padding:14px 22px;font-family:${EMAIL_FONT};font-size:15px;font-weight:700;color:#ffffff;border-radius:10px;line-height:1.3;text-align:center;">Pull these levels up on live charts →</a>
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
          <td class="footer-pad" style="padding:22px 28px 30px 28px;border-top:1px solid #eef1f6;">
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

export function buildSubject(content: DailyContent): string {
  return `ChartSignl Morning — ${content.date_label}`;
}
