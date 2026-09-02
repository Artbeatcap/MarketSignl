import type { WeeklyBrand } from '../weeklyBrief/types.js';
import { EMAIL_INK, EMAIL_MUTED, EMAIL_PAGE_BG } from '../weeklyBrief/brand.js';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const EMAIL_FONT = FONT;

/** Email-safe CSS. Gmail/iOS ignore some of this; keep critical layout in inline styles too. */
export function emailClientCss(brand: WeeklyBrand): string {
  return `
    body { margin:0; padding:0; background:${EMAIL_PAGE_BG}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; }
    img { border:0; line-height:100%; outline:none; text-decoration:none; }
    a { color:${brand.accentLight}; text-decoration:none; }
    .px { padding-left:28px; padding-right:28px; }
    .h1 { font-size:26px; line-height:1.25; font-weight:800; letter-spacing:-0.02em; }
    .kicker { font-size:11px; letter-spacing:0.18em; text-transform:uppercase; font-weight:700; }
    .sec-title { font-size:13px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:${EMAIL_MUTED}; }
    .body-text { font-size:16px; line-height:1.62; color:#44403C; }
    .body-text p { margin:0 0 14px 0; }
    .body-text strong { color:${EMAIL_INK}; }
    .muted { color:${EMAIL_MUTED}; font-size:13px; line-height:1.5; }
    .cta-btn { white-space:normal !important; }
    @media only screen and (max-width:620px) {
      .email-shell { padding:12px 0 !important; }
      .email-wrap { width:100% !important; max-width:100% !important; }
      .px { padding-left:16px !important; padding-right:16px !important; }
      .header-pad { padding:22px 16px 18px 16px !important; }
      .tape-wrap { padding:0 12px 16px 12px !important; }
      .footer-pad { padding:18px 16px 24px 16px !important; }
      .h1 { font-size:22px !important; }
      .tape-cell { padding:10px 3px !important; }
      .tape-sym { font-size:11px !important; letter-spacing:0.02em !important; }
      .tape-price { font-size:13px !important; }
      .tape-pct { font-size:11px !important; }
      .sector-name { font-size:13px !important; }
      .date-cell { display:block !important; width:100% !important; padding-bottom:4px !important; }
      .event-cell { display:block !important; width:100% !important; }
      .level-col { display:block !important; width:100% !important; padding-bottom:8px !important; }
      .cta-btn { display:block !important; width:auto !important; padding:14px 16px !important; font-size:14px !important; }
    }
  `;
}
