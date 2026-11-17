import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const port = int(env.PORT, 3000);

export const config = {
  appName: env.APP_NAME || 'PileQuote',
  port,
  dataDir: env.DATA_DIR || path.join(here, '..', 'data'),
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  adminPassword: env.ADMIN_PASSWORD || '',
  supportEmail: env.SUPPORT_EMAIL || '',
  // Where demo-page leads and "new signup" notices go (you, the founder).
  adminEmail: env.ADMIN_EMAIL || env.SUPPORT_EMAIL || '',

  // Pricing shown to haulers on the landing page. The real charge is whatever
  // the Stripe price (STRIPE_PRICE_ID) is set to.
  priceLabel: env.PRICE_LABEL || '$49/month',
  monthlyPrice: int(env.MONTHLY_PRICE, 49),
  trialDays: int(env.TRIAL_DAYS, 14),

  ai: {
    // No key means demo mode: estimates are simulated and clearly labeled.
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.AI_MODEL || 'claude-opus-5-5',
    effort: env.AI_EFFORT || 'medium',
    timeoutMs: int(env.AI_TIMEOUT_MS, 120_000),
  },

  limits: {
    estimatesPerIpPerHour: int(env.LIMIT_ESTIMATES_PER_IP_HOUR, 12),
    estimatesPerIpPerDay: int(env.LIMIT_ESTIMATES_PER_IP_DAY, 40),
    estimatesPerCompanyPerDay: int(env.LIMIT_ESTIMATES_PER_COMPANY_DAY, 200),
    estimatesPerDay: int(env.LIMIT_ESTIMATES_PER_DAY, 2000),
    maxPhotos: 6,
    maxPhotoBytes: 4 * 1024 * 1024,
  },

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    priceId: env.STRIPE_PRICE_ID || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    // Only used by the test suite to point at a local fake Stripe.
    apiBase: env.STRIPE_API_BASE || '',
  },

  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '',
    // Only used by the test suite to point at a local fake Twilio.
    apiBase: env.TWILIO_API_BASE || 'https://api.twilio.com',
  },
};

export const stripeEnabled = () => Boolean(config.stripe.secretKey && config.stripe.priceId);
export const emailEnabled = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
export const smsEnabled = () =>
  Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.from);
