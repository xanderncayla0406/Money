import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PRICES, DEFAULT_TRUCK_YARDS, defaultFees } from './pricing.js';

export const DEFAULT_SETTINGS = Object.freeze({
  requireContact: true,
  openDays: [1, 2, 3, 4, 5, 6], // 0 = Sunday
  windows: ['Morning (8am–12pm)', 'Afternoon (12–4pm)', 'Evening (4–7pm)'],
  notAccepted: 'Paint, chemicals, propane tanks, asbestos, medical waste',
  brandColor: '#0f766e',
  serviceArea: '',
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  phone TEXT NOT NULL DEFAULT '',
  alert_email TEXT NOT NULL DEFAULT '',
  alert_phone TEXT NOT NULL DEFAULT '',
  truck_yards REAL NOT NULL DEFAULT ${DEFAULT_TRUCK_YARDS},
  prices_json TEXT NOT NULL DEFAULT '{}',
  fees_json TEXT NOT NULL DEFAULT '{}',
  settings_json TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0,
  trial_ends_at INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  stripe_event_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'quoted',
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  customer_notes TEXT NOT NULL DEFAULT '',
  booking_notes TEXT NOT NULL DEFAULT '',
  requested_date TEXT NOT NULL DEFAULT '',
  requested_window TEXT NOT NULL DEFAULT '',
  photo_count INTEGER NOT NULL DEFAULT 0,
  estimate_json TEXT,
  estimate_status TEXT NOT NULL DEFAULT 'ok',
  price_low INTEGER,
  price_high INTEGER,
  size_label TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_ms INTEGER NOT NULL DEFAULT 0,
  ai_input_tokens INTEGER NOT NULL DEFAULT 0,
  ai_output_tokens INTEGER NOT NULL DEFAULT 0,
  ai_cost REAL NOT NULL DEFAULT 0,
  estimate_count INTEGER NOT NULL DEFAULT 1,
  notified_quote_at INTEGER,
  notified_booking_at INTEGER,
  booked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leads_company_created ON leads(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_company_phone ON leads(company_id, phone);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'pilequote.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

export function companyFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    isDemo: Boolean(row.is_demo),
    truckYards: row.truck_yards,
    prices: { ...DEFAULT_PRICES, ...parseJson(row.prices_json, {}) },
    fees: { ...defaultFees(), ...parseJson(row.fees_json, {}) },
    settings: { ...DEFAULT_SETTINGS, ...parseJson(row.settings_json, {}) },
  };
}

export function leadFromRow(row) {
  if (!row) return null;
  return { ...row, estimate: row.estimate_json ? parseJson(row.estimate_json, null) : null };
}

export const newPublicId = () => crypto.randomBytes(12).toString('base64url');

export function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'company';
}

export const RESERVED_SLUGS = new Set(['demo', 'admin', 'api', 'static', 'new', 'test']);

export function createStore(db) {
  const now = () => Date.now();

  const q = {
    companyById: db.prepare('SELECT * FROM companies WHERE id = ?'),
    companyBySlug: db.prepare('SELECT * FROM companies WHERE slug = ?'),
    companyByEmail: db.prepare('SELECT * FROM companies WHERE email = ?'),
    companyByCustomer: db.prepare('SELECT * FROM companies WHERE stripe_customer_id = ?'),
    slugTaken: db.prepare('SELECT 1 FROM companies WHERE slug = ?'),
    insertCompany: db.prepare(`
      INSERT INTO companies (slug, name, owner_name, email, password_hash, phone, alert_email,
        alert_phone, truck_yards, prices_json, fees_json, settings_json, is_demo, trial_ends_at, created_at)
      VALUES ($slug, $name, $owner_name, $email, $password_hash, $phone, $alert_email,
        $alert_phone, $truck_yards, $prices_json, $fees_json, $settings_json, $is_demo, $trial_ends_at, $created_at)`),
    allCompanies: db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM leads l WHERE l.company_id = c.id) AS lead_count,
        (SELECT COUNT(*) FROM leads l WHERE l.company_id = c.id AND l.booked_at IS NOT NULL) AS booked_count,
        (SELECT MAX(created_at) FROM leads l WHERE l.company_id = c.id) AS last_lead_at
      FROM companies c ORDER BY c.is_demo DESC, c.created_at DESC`),

    insertSession: db.prepare(
      'INSERT INTO sessions (token_hash, company_id, is_admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    setSessionCompany: db.prepare('UPDATE sessions SET company_id = ? WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

    insertLead: db.prepare(`
      INSERT INTO leads (public_id, company_id, status, name, phone, email, customer_notes, photo_count,
        estimate_json, estimate_status, price_low, price_high, size_label, ai_model, ai_ms,
        ai_input_tokens, ai_output_tokens, ai_cost, created_at, updated_at)
      VALUES ($public_id, $company_id, 'quoted', $name, $phone, $email, $customer_notes, $photo_count,
        $estimate_json, $estimate_status, $price_low, $price_high, $size_label, $ai_model, $ai_ms,
        $ai_input_tokens, $ai_output_tokens, $ai_cost, $now, $now)`),
    requoteLead: db.prepare(`
      UPDATE leads SET name = $name, phone = $phone, email = $email, customer_notes = $customer_notes,
        photo_count = $photo_count, estimate_json = $estimate_json, estimate_status = $estimate_status,
        price_low = $price_low, price_high = $price_high, size_label = $size_label, ai_model = $ai_model,
        ai_ms = $ai_ms, ai_input_tokens = ai_input_tokens + $ai_input_tokens,
        ai_output_tokens = ai_output_tokens + $ai_output_tokens, ai_cost = ai_cost + $ai_cost,
        estimate_count = estimate_count + 1, updated_at = $now
      WHERE id = $id`),
    recentLeadByPhone: db.prepare(`
      SELECT * FROM leads WHERE company_id = ? AND phone = ? AND phone != '' AND status = 'quoted'
        AND created_at > ? ORDER BY created_at DESC LIMIT 1`),
    leadByPublicId: db.prepare('SELECT * FROM leads WHERE public_id = ?'),
    leadById: db.prepare('SELECT * FROM leads WHERE id = ?'),
    leadsForCompany: db.prepare(
      'SELECT * FROM leads WHERE company_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ),
    bookLead: db.prepare(`
      UPDATE leads SET status = 'requested', name = $name, phone = $phone, email = $email,
        address = $address, requested_date = $requested_date, requested_window = $requested_window,
        booking_notes = $booking_notes, booked_at = $now, updated_at = $now
      WHERE id = $id`),
    setLeadStatus: db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?'),
    markNotified: {
      quote: db.prepare('UPDATE leads SET notified_quote_at = ? WHERE id = ?'),
      booking: db.prepare('UPDATE leads SET notified_booking_at = ? WHERE id = ?'),
    },
    companyStats: db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN created_at > $week THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN booked_at IS NOT NULL THEN 1 ELSE 0 END) AS booked,
        SUM(CASE WHEN booked_at > $week THEN 1 ELSE 0 END) AS booked_week,
        SUM(CASE WHEN booked_at IS NOT NULL THEN COALESCE(price_low, 0) ELSE 0 END) AS booked_value
      FROM leads WHERE company_id = $company_id`),
    estimatesSince: db.prepare(
      'SELECT COALESCE(SUM(estimate_count), 0) AS n FROM leads WHERE updated_at > ?',
    ),
    companyEstimatesSince: db.prepare(
      'SELECT COALESCE(SUM(estimate_count), 0) AS n FROM leads WHERE company_id = ? AND updated_at > ?',
    ),
    aiCostSince: db.prepare(
      'SELECT COALESCE(SUM(ai_cost), 0) AS cost, COUNT(*) AS leads FROM leads WHERE created_at > ?',
    ),
  };

  function uniqueSlug(base) {
    let slug = RESERVED_SLUGS.has(base) ? `${base}-co` : base;
    for (let i = 2; q.slugTaken.get(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  return {
    db,
    uniqueSlug,
    slugAvailable: (slug, exceptId) => {
      if (RESERVED_SLUGS.has(slug)) return false;
      const row = q.companyBySlug.get(slug);
      return !row || row.id === exceptId;
    },

    getCompany: (id) => companyFromRow(q.companyById.get(id)),
    getCompanyBySlug: (slug) => companyFromRow(q.companyBySlug.get(slug)),
    getCompanyByEmail: (email) => companyFromRow(q.companyByEmail.get(String(email).trim())),
    getCompanyByStripeCustomer: (id) => companyFromRow(q.companyByCustomer.get(id)),
    listCompanies: () => q.allCompanies.all().map(companyFromRow),

    createCompany(data) {
      const info = q.insertCompany.run({
        slug: data.slug,
        name: data.name,
        owner_name: data.ownerName || '',
        email: data.email ?? null,
        password_hash: data.passwordHash ?? null,
        phone: data.phone || '',
        alert_email: data.alertEmail || '',
        alert_phone: data.alertPhone || '',
        truck_yards: data.truckYards || DEFAULT_TRUCK_YARDS,
        prices_json: JSON.stringify(data.prices || DEFAULT_PRICES),
        fees_json: JSON.stringify(data.fees || defaultFees()),
        settings_json: JSON.stringify({ ...DEFAULT_SETTINGS, ...(data.settings || {}) }),
        is_demo: data.isDemo ? 1 : 0,
        trial_ends_at: data.trialEndsAt || 0,
        created_at: now(),
      });
      return Number(info.lastInsertRowid);
    },

    updateCompany(id, fields) {
      const allowed = [
        'slug', 'name', 'owner_name', 'email', 'password_hash', 'phone', 'alert_email', 'alert_phone',
        'truck_yards', 'prices_json', 'fees_json', 'settings_json', 'trial_ends_at',
        'stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'stripe_event_at',
      ];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (!keys.length) return;
      const sql = `UPDATE companies SET ${keys.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $id`;
      const params = { id };
      for (const k of keys) params[k] = fields[k];
      db.prepare(sql).run(params);
    },

    createSession(tokenHash, companyId, isAdmin, ttlMs) {
      const t = now();
      q.insertSession.run(tokenHash, companyId ?? null, isAdmin ? 1 : 0, t, t + ttlMs);
    },
    getSession: (tokenHash) => q.sessionByHash.get(tokenHash, now()) || null,
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),
    setSessionCompany: (tokenHash, companyId) => q.setSessionCompany.run(companyId ?? null, tokenHash),
    purgeSessions: () => q.purgeSessions.run(now()),

    findRecentQuotedLead: (companyId, phone, withinMs) =>
      leadFromRow(q.recentLeadByPhone.get(companyId, phone, now() - withinMs)),

    saveQuote({ existingId, companyId, contact, notes, photoCount, result, ai }) {
      const params = {
        name: contact.name || '',
        phone: contact.phone || '',
        email: contact.email || '',
        customer_notes: notes || '',
        photo_count: photoCount,
        estimate_json: result ? JSON.stringify(result) : null,
        estimate_status: result ? (result.estimate.usable ? 'ok' : 'unusable') : 'failed',
        price_low: result?.price ? result.price.low : null,
        price_high: result?.price ? result.price.high : null,
        size_label: result?.price ? result.price.sizeLabel : '',
        ai_model: ai?.model || '',
        ai_ms: ai?.ms || 0,
        ai_input_tokens: ai?.inputTokens || 0,
        ai_output_tokens: ai?.outputTokens || 0,
        ai_cost: ai?.cost || 0,
        now: now(),
      };
      if (existingId) {
        q.requoteLead.run({ ...params, id: existingId });
        return leadFromRow(q.leadById.get(existingId));
      }
      const publicId = newPublicId();
      const info = q.insertLead.run({ ...params, public_id: publicId, company_id: companyId });
      return leadFromRow(q.leadById.get(Number(info.lastInsertRowid)));
    },

    getLead: (id) => leadFromRow(q.leadById.get(id)),
    getLeadByPublicId: (publicId) => leadFromRow(q.leadByPublicId.get(publicId)),
    listLeads: (companyId, limit = 50, offset = 0) =>
      q.leadsForCompany.all(companyId, limit, offset).map(leadFromRow),

    bookLead(id, data) {
      q.bookLead.run({
        id,
        name: data.name,
        phone: data.phone,
        email: data.email || '',
        address: data.address,
        requested_date: data.date,
        requested_window: data.window,
        booking_notes: data.notes || '',
        now: now(),
      });
      return leadFromRow(q.leadById.get(id));
    },

    setLeadStatus: (id, companyId, status) => q.setLeadStatus.run(status, now(), id, companyId).changes,
    markNotified: (id, kind) => q.markNotified[kind].run(now(), id),

    companyStats(companyId) {
      const week = now() - 7 * 86_400_000;
      const row = q.companyStats.get({ company_id: companyId, week });
      return {
        total: row.total || 0,
        week: row.week || 0,
        booked: row.booked || 0,
        bookedWeek: row.booked_week || 0,
        bookedValue: row.booked_value || 0,
      };
    },
    estimatesSince: (since) => q.estimatesSince.get(since).n,
    companyEstimatesSince: (companyId, since) => q.companyEstimatesSince.get(companyId, since).n,
    aiCostSince: (since) => q.aiCostSince.get(since),
  };
}

export function ensureDemoCompany(store, appName) {
  if (store.getCompanyBySlug('demo')) return;
  store.createCompany({
    slug: 'demo',
    name: 'Demo Junk Removal',
    ownerName: appName,
    phone: '(555) 010-0199',
    isDemo: true,
    settings: { serviceArea: 'Demo company: try it with any photo' },
  });
}
