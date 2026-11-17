import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';

import { config, stripeEnabled, emailEnabled, smsEnabled } from './config.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  safeEqual,
  newToken,
  hashToken,
  csrfFor,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  createRateLimiter,
} from './auth.js';
import { DEFAULT_SETTINGS, slugify } from './db.js';
import { PRICE_FIELDS, FEE_TYPES } from './pricing.js';
import { estimateJob, EstimateError } from './estimate.js';
import { notifyOwner, notifyCustomerBooking, notifyAdminSignup, formatRequestedDate } from './notify.js';
import { billingState, createCheckoutUrl, createPortalUrl, handleStripeWebhook } from './billing.js';
import * as views from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

class BadInput extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// ---------------------------------------------------------------- helpers

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const multiline = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const phoneDigits = (phone) => String(phone ?? '').replace(/\D/g, '');
const validPhone = (phone) => phoneDigits(phone).length >= 10 && phoneDigits(phone).length <= 15;
const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function money(value, max, label) {
  const n = Math.round(Number(value));
  if (value === '' || value === undefined || !Number.isFinite(n) || n < 0 || n > max) {
    throw new BadInput(`Check the price for "${label}".`);
  }
  return n;
}

function parsePrices(body) {
  return Object.fromEntries(PRICE_FIELDS.map((f) => [f.key, money(body[`price_${f.key}`], 20000, f.label)]));
}

function parseFees(body) {
  return Object.fromEntries(
    FEE_TYPES.map((f) => [f.key, money(body[`fee_${f.key}`] ?? 0, 5000, f.label)]),
  );
}

function parseTruckYards(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 3 || n > 60) throw new BadInput('Truck size should be between 3 and 60 cubic yards.');
  return Math.round(n * 2) / 2;
}

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function parsePhotos(list) {
  const { maxPhotos, maxPhotoBytes } = config.limits;
  if (!Array.isArray(list) || list.length === 0) throw new BadInput('Add at least one photo.');
  if (list.length > maxPhotos) throw new BadInput(`Up to ${maxPhotos} photos, please.`);
  return list.map((item) => {
    const b64 = typeof item === 'string' ? item : '';
    if (!b64 || b64.length > Math.ceil(maxPhotoBytes * 1.37)) throw new BadInput('One of the photos is too large.');
    const buffer = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
    const mediaType = sniffImage(buffer);
    if (!mediaType) throw new BadInput('Photos need to be JPG, PNG or WebP images.');
    if (buffer.length > maxPhotoBytes) throw new BadInput('One of the photos is too large.');
    return { buffer, mediaType };
  });
}

function parseContact(raw, required) {
  const contact = {
    name: text(raw?.name, 80),
    phone: text(raw?.phone, 30),
    email: text(raw?.email, 254).toLowerCase(),
  };
  if (required) {
    if (!contact.name) throw new BadInput('Please enter your name.');
    if (!validPhone(contact.phone)) throw new BadInput('Please enter a valid mobile number.');
  } else if (contact.phone && !validPhone(contact.phone)) {
    contact.phone = '';
  }
  if (contact.email && !validEmail(contact.email)) throw new BadInput('That email address looks off.');
  return contact;
}

function validDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCDate() !== Number(m[3])) return false;
  const now = Date.now();
  return t >= now - 2 * DAY && t <= now + 90 * DAY;
}

/** What the customer's browser gets back: no internal crew notes. */
function publicEstimate(estimate) {
  const { ownerNotes, ...rest } = estimate;
  return rest;
}

// ---------------------------------------------------------------- photos on disk

const photoDir = (lead) => path.join(config.dataDir, 'photos', lead.public_id);

function savePhotos(lead, photos) {
  const dir = photoDir(lead);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  photos.forEach((p, i) => fs.writeFileSync(path.join(dir, `${i}.img`), p.buffer));
}

export function readPhoto(lead, index) {
  try {
    const buffer = fs.readFileSync(path.join(photoDir(lead), `${index}.img`));
    return { buffer, type: sniffImage(buffer) || 'application/octet-stream' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- app

export function createApp({ store }) {
  const app = express();
  const limiter = createRateLimiter();
  const secureCookies = config.appUrl.startsWith('https://');
  const quoteUrl = (company) => `${config.appUrl}/q/${company.slug}`;
  const send = (res, view, status = 200) => res.status(status).type('html').send(String(view));

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const isQuote = req.path.startsWith('/q/');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
        "base-uri 'none'",
        "object-src 'none'",
        // Quote pages may be embedded on a hauler's own website.
        `frame-ancestors ${isQuote ? '*' : "'none'"}`,
      ].join('; '),
    );
    if (!isQuote) res.set('X-Frame-Options', 'DENY');
    next();
  });

  app.use('/static', express.static(publicDir, { maxAge: '7d', index: false }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Stripe needs the raw body to verify the signature, so this comes before any parsers.
  app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      const result = await handleStripeWebhook(store, req.body, req.get('stripe-signature'));
      console.log('[stripe]', result);
      res.json({ received: true });
    } catch (err) {
      console.error('[stripe webhook]', err.message);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Webhook failed' });
    }
  });

  const form = express.urlencoded({ extended: false, limit: '64kb' });
  const json = express.json({ limit: '32mb' });

  // Session lookup.
  app.use((req, res, next) => {
    req.ctx = { company: null, isAdmin: false, csrf: null };
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const tokenHash = hashToken(token);
      const session = store.getSession(tokenHash);
      if (session) {
        req.session = { ...session, tokenHash };
        req.ctx.isAdmin = Boolean(session.is_admin);
        req.ctx.csrf = csrfFor(token);
        if (session.company_id) req.ctx.company = store.getCompany(session.company_id);
      }
    }
    next();
  });

  function startSession(res, { companyId = null, isAdmin = false }) {
    const token = newToken();
    store.createSession(hashToken(token), companyId, isAdmin, SESSION_TTL_MS);
    res.append('Set-Cookie', sessionCookie(token, { secure: secureCookies }));
  }

  const requireCsrf = (req, res, next) => {
    const sent = req.body?._csrf || req.get('x-csrf-token');
    if (!req.ctx.csrf || !sent || !safeEqual(sent, req.ctx.csrf)) {
      return send(res, views.messagePage(req.ctx, { title: 'Please try again', message: 'Your session expired. Go back, refresh the page and try again.' }), 403);
    }
    next();
  };
  const requireCompany = (req, res, next) => (req.ctx.company ? next() : res.redirect(303, '/login'));
  const requireAdmin = (req, res, next) => (req.ctx.isAdmin ? next() : res.redirect(303, '/admin'));

  // ---------------------------------------------------------------- public pages

  app.get('/', (req, res) => send(res, views.landingPage(req.ctx)));
  app.get('/privacy', (req, res) => send(res, views.privacyPage(req.ctx)));
  app.get('/terms', (req, res) => send(res, views.termsPage(req.ctx)));

  app.get('/signup', (req, res) => {
    if (req.ctx.company && !req.ctx.isAdmin) return res.redirect(303, '/dash');
    send(res, views.signupPage(req.ctx));
  });

  app.post('/signup', form, async (req, res) => {
    const body = req.body ?? {};
    const values = {
      name: text(body.name, 80),
      ownerName: text(body.ownerName, 80),
      email: text(body.email, 254).toLowerCase(),
      phone: text(body.phone, 30),
      alertPhone: text(body.alertPhone, 30),
      truckYards: body.truckYards,
    };
    try {
      if (!limiter.hit(`signup:${req.ip}`, 10, HOUR)) throw new BadInput('Too many sign-ups from here. Try again later.');
      if (values.name.length < 2) throw new BadInput('Enter your business name.');
      if (!validEmail(values.email)) throw new BadInput('Enter a valid email address.');
      if (!validPhone(values.phone)) throw new BadInput('Enter a valid business phone number.');
      if (values.alertPhone && !validPhone(values.alertPhone)) throw new BadInput('Check the cell number for text alerts.');
      const password = String(body.password ?? '');
      if (password.length < 8 || password.length > 200) throw new BadInput('Use a password with at least 8 characters.');
      values.prices = parsePrices(body);
      values.fees = parseFees(body);
      values.truckYards = parseTruckYards(body.truckYards);
      if (store.getCompanyByEmail(values.email)) throw new BadInput('There is already an account with that email. Log in instead.');

      const companyId = store.createCompany({
        slug: store.uniqueSlug(slugify(values.name)),
        name: values.name,
        ownerName: values.ownerName,
        email: values.email,
        passwordHash: await hashPassword(password),
        phone: values.phone,
        alertEmail: values.email,
        alertPhone: values.alertPhone,
        truckYards: values.truckYards,
        prices: values.prices,
        fees: values.fees,
        trialEndsAt: Date.now() + config.trialDays * DAY,
      });
      notifyAdminSignup(store.getCompany(companyId)).catch(() => {});
      // An admin signing someone up stays logged in as admin, viewing the new company.
      if (req.ctx.isAdmin && req.session) store.setSessionCompany(req.session.tokenHash, companyId);
      else startSession(res, { companyId });
      res.redirect(303, '/dash?welcome=1');
    } catch (err) {
      if (!(err instanceof BadInput)) throw err;
      send(res, views.signupPage(req.ctx, { values, error: err.message }), 400);
    }
  });

  app.get('/login', (req, res) => {
    if (req.ctx.company) return res.redirect(303, '/dash');
    send(res, views.loginPage(req.ctx));
  });

  app.post('/login', form, async (req, res) => {
    const email = text(req.body?.email, 254).toLowerCase();
    if (!limiter.hit(`login:${req.ip}`, 10, 15 * MINUTE)) {
      return send(res, views.loginPage(req.ctx, { email, error: 'Too many attempts. Wait 15 minutes and try again.' }), 429);
    }
    const company = email ? store.getCompanyByEmail(email) : null;
    const ok = company && (await verifyPassword(String(req.body?.password ?? ''), company.password_hash));
    if (!ok) return send(res, views.loginPage(req.ctx, { email, error: 'Wrong email or password.' }), 401);
    startSession(res, { companyId: company.id });
    res.redirect(303, '/dash');
  });

  app.post('/logout', form, requireCsrf, (req, res) => {
    if (req.session) store.deleteSession(req.session.tokenHash);
    res.append('Set-Cookie', clearSessionCookie({ secure: secureCookies }));
    res.redirect(303, '/');
  });

  // ---------------------------------------------------------------- customer quote flow

  app.get('/q/:slug', (req, res) => {
    const company = store.getCompanyBySlug(String(req.params.slug).toLowerCase());
    if (!company) {
      return send(res, views.messagePage(req.ctx, { title: 'Page not found', message: 'This quote link does not exist. Check the link and try again.', status: 404 }), 404);
    }
    const state = billingState(company);
    if (!state.live) return send(res, views.quoteUnavailablePage({ company }));
    send(res, views.quotePage({ company, aiEnabled: config.ai.enabled }));
  });

  // Per-device limits run before the (large) photo upload is read.
  const estimateIpLimit = (req, res, next) => {
    const L = config.limits;
    if (!limiter.hit(`est-ip-h:${req.ip}`, L.estimatesPerIpPerHour, HOUR) || !limiter.hit(`est-ip-d:${req.ip}`, L.estimatesPerIpPerDay, DAY)) {
      const company = store.getCompanyBySlug(String(req.params.slug).toLowerCase());
      return res.status(429).json({ error: `That's a lot of quotes! Please try again later or call ${company?.phone || 'us'}.` });
    }
    next();
  };

  app.post('/api/q/:slug/estimate', estimateIpLimit, json, async (req, res) => {
    const company = store.getCompanyBySlug(String(req.params.slug).toLowerCase());
    if (!company) return res.status(404).json({ error: 'This quote link does not exist.' });
    if (!billingState(company).live) {
      return res.status(403).json({ error: `Instant quotes aren't available right now. Please call ${company.phone || 'us'}.` });
    }

    const L = config.limits;
    if (!limiter.hit(`est-co:${company.id}`, L.estimatesPerCompanyPerDay, DAY) || !limiter.hit('est-all', L.estimatesPerDay, DAY)) {
      return res.status(429).json({ error: `Instant quotes are busy right now. Please call ${company.phone || 'us'}.` });
    }

    let photos;
    let contact;
    const notes = multiline(req.body?.notes, 1000);
    try {
      photos = parsePhotos(req.body?.photos);
      contact = parseContact(req.body?.contact, company.settings.requireContact);
    } catch (err) {
      if (err instanceof BadInput) return res.status(400).json({ error: err.message });
      throw err;
    }

    let outcome;
    let failure = null;
    try {
      outcome = await estimateJob({ photos, notes, company });
    } catch (err) {
      failure = err instanceof EstimateError ? err : new EstimateError('unexpected', 'Something went wrong. Please try again.', err);
      console.error('[estimate failed]', company.slug, failure.code, failure.cause?.message || failure.message);
    }

    // Keep the lead whenever we have a way to reach the customer, even if the estimate failed.
    let lead = null;
    if (!failure || contact.phone) {
      const existing = contact.phone ? store.findRecentQuotedLead(company.id, contact.phone, 30 * MINUTE) : null;
      lead = store.saveQuote({
        existingId: existing?.id,
        companyId: company.id,
        contact,
        notes,
        photoCount: photos.length,
        result: failure ? null : { estimate: outcome.estimate, price: outcome.price },
        ai: outcome?.ai,
      });
      savePhotos(lead, photos);
      const worthAlert = contact.phone && (failure || outcome.estimate.usable);
      if (worthAlert && !lead.notified_quote_at) {
        store.markNotified(lead.id, 'quote');
        notifyOwner({ company, lead, kind: 'quote', readPhoto }).catch((err) => console.error('[notify]', err.message));
      }
    }

    if (failure) return res.status(502).json({ error: failure.userMessage });
    res.json({ leadId: lead.public_id, estimate: publicEstimate(outcome.estimate), price: outcome.price });
  });

  app.post('/api/leads/:publicId/book', json, async (req, res) => {
    const lead = store.getLeadByPublicId(String(req.params.publicId));
    if (!lead) return res.status(404).json({ error: 'We could not find that quote. Please start again.' });
    const company = store.getCompany(lead.company_id);
    if (!billingState(company).live) {
      return res.status(403).json({ error: `Online booking isn't available right now. Please call ${company.phone || 'us'}.` });
    }
    if (!limiter.hit(`book:${req.ip}`, 20, HOUR)) return res.status(429).json({ error: 'Too many requests. Please call us instead.' });

    const b = req.body ?? {};
    const data = {
      name: text(b.name, 80),
      phone: text(b.phone, 30),
      email: text(b.email, 254).toLowerCase(),
      address: text(b.address, 200),
      date: text(b.date, 10),
      window: text(b.window, 60),
      notes: multiline(b.notes, 1000),
    };
    if (!data.name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!validPhone(data.phone)) return res.status(400).json({ error: 'Please enter a valid mobile number.' });
    if (data.email && !validEmail(data.email)) return res.status(400).json({ error: 'That email address looks off.' });
    if (data.address.length < 5) return res.status(400).json({ error: 'Please enter the pickup address.' });
    if (!validDate(data.date)) return res.status(400).json({ error: 'Please pick a day.' });
    if (!company.settings.windows.includes(data.window)) return res.status(400).json({ error: 'Please pick a time.' });

    const booked = store.bookLead(lead.id, data);
    if (!booked.notified_booking_at) {
      store.markNotified(booked.id, 'booking');
      notifyOwner({ company, lead: booked, kind: 'booking', readPhoto }).catch((err) => console.error('[notify]', err.message));
      notifyCustomerBooking({ company, lead: booked }).catch((err) => console.error('[notify]', err.message));
    }
    res.json({ ok: true, date: formatRequestedDate(data.date), window: data.window });
  });

  // ---------------------------------------------------------------- owner dashboard

  app.get('/dash', requireCompany, (req, res) => {
    const company = req.ctx.company;
    send(
      res,
      views.dashboardPage(req.ctx, {
        company,
        leads: store.listLeads(company.id, 100),
        stats: store.companyStats(company.id),
        state: billingState(company),
        quoteUrl: quoteUrl(company),
        welcome: req.query.welcome === '1',
        aiEnabled: config.ai.enabled,
      }),
    );
  });

  app.get('/dash/leads/:id/photos/:n', requireCompany, (req, res) => {
    const lead = store.getLead(Number(req.params.id));
    const n = Number(req.params.n);
    if (!lead || lead.company_id !== req.ctx.company.id || !Number.isInteger(n) || n < 0 || n >= lead.photo_count) {
      return res.status(404).type('text').send('Not found');
    }
    const photo = readPhoto(lead, n);
    if (!photo) return res.status(404).type('text').send('Not found');
    res.set('Cache-Control', 'private, max-age=86400').type(photo.type).send(photo.buffer);
  });

  app.post('/dash/leads/:id/status', form, requireCompany, requireCsrf, (req, res) => {
    const status = String(req.body?.status ?? '');
    const id = Number(req.params.id);
    if (views.LEAD_STATUSES.some(([k]) => k === status)) store.setLeadStatus(id, req.ctx.company.id, status);
    res.redirect(303, `/dash#lead-${id}`);
  });

  app.get('/dash/qr.png', requireCompany, async (req, res) => {
    const png = await QRCode.toBuffer(quoteUrl(req.ctx.company), { type: 'png', width: 600, margin: 2, errorCorrectionLevel: 'M' });
    if (req.query.download) res.attachment(`${req.ctx.company.slug}-quote-qr.png`);
    res.set('Cache-Control', 'private, max-age=300').type('png').send(png);
  });

  app.get('/dash/settings', requireCompany, (req, res) => {
    send(res, views.settingsPage(req.ctx, { company: req.ctx.company, saved: req.query.saved === '1', quoteBase: `${config.appUrl}/q` }));
  });

  app.post('/dash/settings', form, requireCompany, requireCsrf, async (req, res) => {
    const company = req.ctx.company;
    const b = req.body ?? {};
    try {
      const name = text(b.name, 80);
      if (name.length < 2) throw new BadInput('Enter your business name.');
      const phone = text(b.phone, 30);
      if (!validPhone(phone)) throw new BadInput('Enter a valid business phone number.');
      const alertPhone = text(b.alertPhone, 30);
      if (alertPhone && !validPhone(alertPhone)) throw new BadInput('Check the cell number for text alerts.');
      const alertEmail = text(b.alertEmail, 254).toLowerCase();
      if (alertEmail && !validEmail(alertEmail)) throw new BadInput('Check the email for lead alerts.');
      const slug = text(b.slug, 40).toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new BadInput('The link name can only use lowercase letters, numbers and dashes.');
      if (!store.slugAvailable(slug, company.id)) throw new BadInput('That link name is taken. Try another.');

      const openDays = [].concat(b.openDays ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (!openDays.length) throw new BadInput('Pick at least one day you take pickups.');
      const windows = multiline(b.windows, 400).split('\n').map((w) => text(w, 40)).filter(Boolean).slice(0, 6);
      const brandColor = /^#[0-9a-f]{6}$/i.test(b.brandColor || '') ? b.brandColor.toLowerCase() : company.settings.brandColor;

      const login = {};
      if (!company.isDemo) {
        const loginEmail = text(b.loginEmail, 254).toLowerCase();
        if (!validEmail(loginEmail)) throw new BadInput('Enter a valid login email.');
        const other = store.getCompanyByEmail(loginEmail);
        if (other && other.id !== company.id) throw new BadInput('Another account already uses that login email.');
        login.email = loginEmail;
        const newPassword = String(b.newPassword ?? '');
        if (newPassword) {
          if (newPassword.length < 8 || newPassword.length > 200) throw new BadInput('Use a new password with at least 8 characters.');
          login.password_hash = await hashPassword(newPassword);
        }
      }

      const settings = {
        ...company.settings,
        serviceArea: text(b.serviceArea, 80),
        notAccepted: text(b.notAccepted, 300),
        openDays: [...new Set(openDays)].sort(),
        windows: windows.length ? windows : DEFAULT_SETTINGS.windows,
        requireContact: b.requireContact === '1',
        brandColor,
      };
      store.updateCompany(company.id, {
        name,
        owner_name: text(b.ownerName, 80),
        phone,
        alert_phone: alertPhone,
        alert_email: alertEmail,
        slug,
        truck_yards: parseTruckYards(b.truckYards),
        prices_json: JSON.stringify(parsePrices(b)),
        fees_json: JSON.stringify(parseFees(b)),
        settings_json: JSON.stringify(settings),
        ...login,
      });
      res.redirect(303, '/dash/settings?saved=1');
    } catch (err) {
      if (!(err instanceof BadInput)) throw err;
      send(res, views.settingsPage(req.ctx, { company, error: err.message, quoteBase: `${config.appUrl}/q` }), 400);
    }
  });

  app.get('/dash/billing', requireCompany, (req, res) => {
    const company = req.ctx.company;
    send(res, views.billingPage(req.ctx, { company, state: billingState(company), stripeReady: stripeEnabled(), done: req.query.done === '1' }));
  });

  app.post('/dash/billing/checkout', form, requireCompany, requireCsrf, async (req, res) => {
    const company = req.ctx.company;
    try {
      res.redirect(303, await createCheckoutUrl(company));
    } catch (err) {
      console.error('[checkout]', err.message);
      send(res, views.billingPage(req.ctx, { company, state: billingState(company), stripeReady: stripeEnabled(), error: "Couldn't open checkout. Please try again in a minute." }), 502);
    }
  });

  app.post('/dash/billing/portal', form, requireCompany, requireCsrf, async (req, res) => {
    const company = req.ctx.company;
    try {
      res.redirect(303, await createPortalUrl(company));
    } catch (err) {
      console.error('[portal]', err.message);
      send(res, views.billingPage(req.ctx, { company, state: billingState(company), stripeReady: stripeEnabled(), error: "Couldn't open billing. Please try again in a minute." }), 502);
    }
  });

  // ---------------------------------------------------------------- admin

  app.get('/admin', (req, res) => {
    if (!req.ctx.isAdmin) return send(res, views.adminLoginPage(req.ctx, { configured: Boolean(config.adminPassword) }));
    const companies = store.listCompanies().map((c) => ({ ...c, state: billingState(c) }));
    const totals = {
      companies: companies.filter((c) => !c.isDemo).length,
      live: companies.filter((c) => !c.isDemo && c.state.live).length,
      paying: companies.filter((c) => c.state.state === 'active' || c.state.state === 'past_due').length,
      aiCost30: store.aiCostSince(Date.now() - 30 * DAY).cost,
    };
    send(res, views.adminPage(req.ctx, {
      companies,
      totals,
      aiEnabled: config.ai.enabled,
      stripeReady: stripeEnabled() && Boolean(config.stripe.webhookSecret),
      emailReady: emailEnabled(),
      smsReady: smsEnabled(),
    }));
  });

  app.post('/admin/login', form, (req, res) => {
    if (!limiter.hit(`admin:${req.ip}`, 10, 15 * MINUTE)) {
      return send(res, views.adminLoginPage(req.ctx, { configured: true, error: 'Too many attempts. Wait 15 minutes.' }), 429);
    }
    if (!config.adminPassword || !safeEqual(String(req.body?.password ?? ''), config.adminPassword)) {
      return send(res, views.adminLoginPage(req.ctx, { configured: Boolean(config.adminPassword), error: 'Wrong password.' }), 401);
    }
    startSession(res, { isAdmin: true });
    res.redirect(303, '/admin');
  });

  app.post('/admin/companies/:id/login-as', form, requireAdmin, requireCsrf, (req, res) => {
    const company = store.getCompany(Number(req.params.id));
    if (!company) return res.redirect(303, '/admin');
    store.setSessionCompany(req.session.tokenHash, company.id);
    res.redirect(303, '/dash');
  });

  app.post('/admin/companies/:id/extend-trial', form, requireAdmin, requireCsrf, (req, res) => {
    const company = store.getCompany(Number(req.params.id));
    if (company) {
      store.updateCompany(company.id, { trial_ends_at: Math.max(Date.now(), company.trial_ends_at) + 14 * DAY });
    }
    res.redirect(303, '/admin');
  });

  app.post('/admin/exit', form, requireAdmin, requireCsrf, (req, res) => {
    store.setSessionCompany(req.session.tokenHash, null);
    res.redirect(303, '/admin');
  });

  app.post('/admin/reset-password', form, requireAdmin, requireCsrf, async (req, res) => {
    const company = store.getCompanyByEmail(text(req.body?.email, 254).toLowerCase());
    const password = String(req.body?.password ?? '');
    if (company && password.length >= 8) {
      store.updateCompany(company.id, { password_hash: await hashPassword(password) });
    }
    res.redirect(303, '/admin');
  });

  // ---------------------------------------------------------------- errors

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    send(res, views.messagePage(req.ctx || {}, { title: 'Page not found', message: "We couldn't find that page.", status: 404 }), 404);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', req.method, req.path, err);
    if (req.path.startsWith('/api/')) {
      const message = status === 413 ? 'Those photos are too large. Try fewer photos.' : status < 500 ? 'Bad request.' : 'Something went wrong. Please try again.';
      return res.status(status).json({ error: message });
    }
    send(res, views.messagePage(req.ctx || {}, { title: 'Something went wrong', message: 'Please go back and try again.' }), status);
  });

  return app;
}

