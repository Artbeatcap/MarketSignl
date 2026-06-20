import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'ChartSignl <noreply@chartsignl.com>';
const frontendUrl = process.env.FRONTEND_URL || 'https://chartsignl.com';

/**
 * Send confirmation email when user requests account deletion.
 * Contains a secure link to confirm deletion (valid 24h).
 */
export async function sendDeletionConfirmationEmail(to: string, token: string): Promise<void> {
  const confirmUrl = `${frontendUrl}/confirm-deletion?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from,
    to,
    subject: 'Confirm your ChartSignl account deletion',
    text: `You requested to delete your ChartSignl account. To confirm, open this link within 24 hours:\n\n${confirmUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>You requested to delete your ChartSignl account.</p>
      <p>To confirm, <a href="${confirmUrl}">click here</a> within 24 hours.</p>
      <p>If you did not request this, you can ignore this email.</p>
      <p style="color:#888;font-size:12px;">Or copy this link: ${confirmUrl}</p>
    `.trim(),
  });
}

/**
 * Send completion email after account and data have been deleted.
 */
export async function sendDeletionCompletedEmail(to: string): Promise<void> {
  await transporter.sendMail({
    from,
    to,
    subject: 'Your ChartSignl account has been deleted',
    text: 'Your ChartSignl account and associated data have been permanently deleted. Transaction records are retained for 7 years as required by law. If you have any questions, contact support@chartsignl.com.',
    html: `
      <p>Your ChartSignl account and associated data have been permanently deleted.</p>
      <p>Transaction records are retained for 7 years as required by law. Anonymized analytics may be retained.</p>
      <p>If you have any questions, contact <a href="mailto:support@chartsignl.com">support@chartsignl.com</a>.</p>
    `.trim(),
  });
}
