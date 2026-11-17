// Trial + Stripe subscription state. Companies get a free trial with no card;
// after that the quote link pauses until they subscribe through Stripe Checkout.

import Stripe from 'stripe';
import { config, stripeEnabled } from './config.js';

const DAY = 86_400_000;
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function billingState(company, now = Date.now()) {
  if (company.isDemo) return { live: true, state: 'demo' };
  const status = company.subscription_status;
  if (status === 'active' || status === 'trialing') return { live: true, state: 'active', status };
  if (status === 'past_due') return { live: true, state: 'past_due', status };
  const msLeft = (company.trial_ends_at || 0) - now;
  if (msLeft > 0) return { live: true, state: 'trial', daysLeft: Math.ceil(msLeft / DAY), status };
  return { live: false, state: 'expired', status };
}

let stripeClient;
export function getStripe() {
  if (!config.stripe.secretKey) return null;
  if (!stripeClient) {
    const options = { maxNetworkRetries: 2, appInfo: { name: config.appName } };
    if (config.stripe.apiBase) {
      const u = new URL(config.stripe.apiBase);
      Object.assign(options, { host: u.hostname, port: Number(u.port), protocol: u.protocol.replace(':', '') });
    }
    stripeClient = new Stripe(config.stripe.secretKey, options);
  }
  return stripeClient;
}

export async function createCheckoutUrl(company) {
  if (!stripeEnabled()) throw new Error('Stripe is not configured');
  const stripe = getStripe();
  const subscriptionData = { metadata: { company_id: String(company.id) } };
  // Keep their free days: Stripe needs a trial end at least 48 hours away.
  const trialEndSec = Math.floor((company.trial_ends_at || 0) / 1000);
  if (company.trial_ends_at - Date.now() > 2 * DAY + 3_600_000) subscriptionData.trial_end = trialEndSec;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: config.stripe.priceId, quantity: 1 }],
    client_reference_id: String(company.id),
    metadata: { company_id: String(company.id) },
    subscription_data: subscriptionData,
    ...(company.stripe_customer_id
      ? { customer: company.stripe_customer_id }
      : company.email
        ? { customer_email: company.email }
        : {}),
    allow_promotion_codes: true,
    success_url: `${config.appUrl}/dash/billing?done=1`,
    cancel_url: `${config.appUrl}/dash/billing`,
  });
  return session.url;
}

export async function createPortalUrl(company) {
  const stripe = getStripe();
  if (!stripe || !company.stripe_customer_id) throw new Error('No Stripe customer for this company');
  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripe_customer_id,
    return_url: `${config.appUrl}/dash/billing`,
  });
  return session.url;
}

/** Verify and apply a Stripe webhook. Returns a short description for logs. */
export async function handleStripeWebhook(store, rawBody, signature) {
  const stripe = getStripe();
  if (!stripe || !config.stripe.webhookSecret) {
    const err = new Error('Stripe webhook is not configured');
    err.status = 503;
    throw err;
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } catch (cause) {
    const err = new Error(`Bad Stripe signature: ${cause.message}`);
    err.status = 400;
    throw err;
  }

  const apply = (company, fields) => {
    if (!company) return 'no matching company';
    // Ignore events older than the last one applied (Stripe can deliver out of order).
    if (event.created < (company.stripe_event_at || 0)) return 'stale event ignored';
    store.updateCompany(company.id, { ...fields, stripe_event_at: event.created });
    return `company ${company.id} -> ${fields.subscription_status ?? 'updated'}`;
  };

  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription') return 'ignored (not a subscription)';
      const company = store.getCompany(Number(obj.client_reference_id || obj.metadata?.company_id));
      let status = 'active';
      if (obj.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(obj.subscription));
        status = sub.status;
      }
      return apply(company, {
        stripe_customer_id: String(obj.customer || ''),
        stripe_subscription_id: obj.subscription ? String(obj.subscription) : null,
        subscription_status: status,
      });
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const company =
        store.getCompany(Number(obj.metadata?.company_id)) ||
        store.getCompanyByStripeCustomer(String(obj.customer));
      return apply(company, {
        stripe_customer_id: String(obj.customer),
        stripe_subscription_id: obj.id,
        subscription_status: event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status,
      });
    }
    default:
      return `ignored ${event.type}`;
  }
}

export const isLiveStatus = (status) => LIVE_STATUSES.has(status);
