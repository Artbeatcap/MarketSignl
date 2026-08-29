process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.PUBLIC_API_URL ||= 'https://api.chartsignl.com';
process.env.NEWSLETTER_FROM ||= 'ChartSignl <brief@mail.chartsignl.com>';
process.env.NEWSLETTER_REPLY_TO ||= 'hello@chartsignl.com';
process.env.NEWSLETTER_API_SECRET ||= 'test-newsletter-secret';
process.env.RESEND_WEBHOOK_SECRET ||= `whsec_${Buffer.from('newsletter-test-webhook-secret-key').toString('base64')}`;
