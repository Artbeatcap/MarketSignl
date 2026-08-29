export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const first = local.charAt(0);
  return `${first}•••@${domain}`;
}

function pageShell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ChartSignl</title>
</head>
<body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAF9;color:#57534E;text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(17,24,39,0.08);">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#14B8A6;margin-bottom:12px;">ChartSignl</div>
    ${inner}
  </div>
</body>
</html>`;
}

export function renderUnsubscribeConfirmPage(input: {
  actionUrl: string;
  token: string;
  maskedEmail?: string;
  valid: boolean;
}): string {
  if (!input.valid) {
    return pageShell(
      'Unsubscribe',
      `<h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">This link is no longer valid</h1>
       <p style="font-size:16px;line-height:1.6;margin:0;">If you still receive the ChartSignl daily brief, use the unsubscribe link in a recent email or turn it off in Settings.</p>`
    );
  }

  const who = input.maskedEmail
    ? `<p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#78716C;">${escapeHtml(input.maskedEmail)}</p>`
    : '';

  return pageShell(
    'Unsubscribe',
    `<h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">Unsubscribe from the ChartSignl daily brief?</h1>
     ${who}
     <form method="POST" action="${escapeAttr(input.actionUrl)}">
       <input type="hidden" name="token" value="${escapeAttr(input.token)}">
       <button type="submit" style="display:inline-block;padding:12px 24px;background:#0D9488;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Unsubscribe</button>
     </form>
     <p style="font-size:13px;color:#A8A29E;margin:24px 0 0;">You can turn it back on anytime in Settings.</p>`
  );
}

export function renderUnsubscribedPage(input: {
  resubscribeUrl: string;
  maskedEmail?: string;
}): string {
  const who = input.maskedEmail
    ? `<p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#78716C;">${escapeHtml(input.maskedEmail)}</p>`
    : '';

  return pageShell(
    'Unsubscribed',
    `<h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">You're unsubscribed</h1>
     ${who}
     <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">You won't receive the ChartSignl daily brief anymore.</p>
     <form method="POST" action="${escapeAttr(input.resubscribeUrl)}">
       <button type="submit" style="display:inline-block;padding:12px 24px;background:transparent;color:#0D9488;border:1px solid #99F6E4;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Resubscribe</button>
     </form>
     <p style="font-size:13px;color:#A8A29E;margin:24px 0 0;">Resubscribe is available for 30 days after an accidental click.</p>`
  );
}

export function renderResubscribedPage(): string {
  return pageShell(
    'Resubscribed',
    `<h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">You're back on the list</h1>
     <p style="font-size:16px;line-height:1.6;margin:0;">The ChartSignl daily brief will land before the open.</p>`
  );
}

export function renderResubscribeConfirmPage(input: { actionUrl: string }): string {
  return pageShell(
    'Resubscribe',
    `<h1 style="font-size:24px;color:#0b1220;margin:0 0 12px;">Resubscribe to the ChartSignl daily brief?</h1>
     <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">You'll get one email each market morning. Unsubscribe anytime.</p>
     <form method="POST" action="${escapeAttr(input.actionUrl)}">
       <button type="submit" style="display:inline-block;padding:12px 24px;background:#0D9488;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Resubscribe</button>
     </form>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
