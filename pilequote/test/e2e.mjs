// End-to-end test: runs the real server against fake Anthropic, Stripe and
// Twilio servers, then drives the pages in Chromium (phone + desktop).
// Usage: npm run test:e2e   (screenshots land in test-output/)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, 'test-output');
fs.mkdirSync(outDir, { recursive: true });
const out = (name) => path.join(outDir, name);
const photo1 = path.join(here, 'fixtures', 'garage-1.jpg');
const photo2 = path.join(here, 'fixtures', 'garage-2.jpg');

let step = '';
const log = (msg) => console.log(`  ✓ ${msg}`);
const begin = (name) => {
  step = name;
  console.log(`\n${name}`);
};

// ---------------------------------------------------------------- fake services

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const GOOD_ESTIMATE = {
  usable: true,
  unusable_reason: '',
  items: [
    { name: '3-seat sofa', quantity: 1, fee_type: 'none' },
    { name: 'Queen mattress', quantity: 1, fee_type: 'mattress' },
    { name: 'Moving boxes', quantity: 5, fee_type: 'none' },
    { name: 'Trash bags', quantity: 3, fee_type: 'none' },
  ],
  volume_low_cubic_yards: 5.5,
  volume_high_cubic_yards: 7.5,
  confidence: 'medium',
  heavy_materials: false,
  not_accepted_items: ['Paint cans on the shelf'],
  customer_summary: 'A 3-seat sofa, a queen mattress, about 5 moving boxes and 3 trash bags in a garage.',
  owner_notes: 'Garage, ground level, easy access. Paint cans on the shelf may be included.',
  photo_tips: '',
};
const UNUSABLE_ESTIMATE = {
  ...GOOD_ESTIMATE,
  usable: false,
  unusable_reason: "The photo is too dark to see what's there.",
  items: [],
  volume_low_cubic_yards: 0,
  volume_high_cubic_yards: 0,
  photo_tips: 'Turn on the garage light and step back so everything is in the shot.',
};

const anthropicCalls = [];
const fakeAnthropic = http.createServer(async (req, res) => {
  const body = JSON.parse(await readBody(req));
  anthropicCalls.push({ url: req.url, headers: req.headers, body });
  const text = JSON.stringify(body.messages);
  res.setHeader('content-type', 'application/json');
  if (text.includes('FORCE_FAIL')) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }));
  }
  const estimate = text.includes('FORCE_UNUSABLE') ? UNUSABLE_ESTIMATE : GOOD_ESTIMATE;
  res.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: JSON.stringify(estimate) },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 5400, output_tokens: 850 },
    }),
  );
});

let stripeCompanyId = 0;
const stripeCalls = [];
const fakeStripe = http.createServer(async (req, res) => {
  const body = await readBody(req);
  stripeCalls.push({ method: req.method, url: req.url, body: new URLSearchParams(body) });
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
    return res.end(JSON.stringify({ id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/subscriptions/sub_test_1')) {
    return res.end(
      JSON.stringify({ id: 'sub_test_1', object: 'subscription', status: 'trialing', customer: 'cus_test_1', metadata: { company_id: String(stripeCompanyId) } }),
    );
  }
  if (req.method === 'POST' && req.url === '/v1/billing_portal/sessions') {
    return res.end(JSON.stringify({ id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/test_1' }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: `No fake for ${req.method} ${req.url}` } }));
});

const smsCalls = [];
const fakeTwilio = http.createServer(async (req, res) => {
  const body = await readBody(req);
  smsCalls.push({ url: req.url, auth: req.headers.authorization, body: new URLSearchParams(body) });
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ sid: 'SM_test' }));
});

// ---------------------------------------------------------------- run

const [anthropicPort, stripePort, twilioPort] = await Promise.all([fakeAnthropic, fakeStripe, fakeTwilio].map(listen));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilequote-e2e-'));
const appPort = 4100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${appPort}`;

const env = {
  ...process.env,
  DATA_DIR: dataDir,
  PORT: String(appPort),
  APP_URL: base,
  ADMIN_PASSWORD: 'admin-pass-123',
  ADMIN_EMAIL: 'founder@example.com',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicPort}`,
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_ID: 'price_test_49',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_API_BASE: `http://127.0.0.1:${stripePort}`,
  TWILIO_ACCOUNT_SID: 'AC_test',
  TWILIO_AUTH_TOKEN: 'tw_token',
  TWILIO_FROM: '+15550001111',
  TWILIO_API_BASE: `http://127.0.0.1:${twilioPort}`,
};
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ANTHROPIC_AUTH_TOKEN', 'AI_MODEL', 'AI_EFFORT']) delete env[k];

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitFor(fn, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const outbox = () =>
  fs.existsSync(path.join(dataDir, 'outbox'))
    ? fs.readdirSync(path.join(dataDir, 'outbox')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, 'outbox', f), 'utf8')))
    : [];
const emails = () => outbox().filter((m) => m.subject);

let browser;
let failed = false;
try {
  await waitFor(() => fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false));
  browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const owner = await desktop.newPage();

  begin('Landing page');
  await owner.goto(`${base}/`);
  assert.match(await owner.textContent('h1'), /booked jobs/);
  await owner.screenshot({ path: out('01-landing.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  log('landing renders');

  begin('Owner signs up');
  await owner.goto(`${base}/signup`);
  await owner.fill('input[name=name]', 'Tampa Junk Pros');
  await owner.fill('input[name=ownerName]', 'Sam Rivera');
  await owner.fill('input[name=phone]', '(813) 555-0142');
  await owner.fill('input[name=alertPhone]', '(813) 555-0199');
  await owner.fill('input[name=email]', 'sam@tampajunkpros.test');
  await owner.fill('input[name=password]', 'correct-horse-9');
  await owner.fill('input[name=truckYards]', '16');
  await owner.screenshot({ path: out('02-signup.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  await Promise.all([owner.waitForURL('**/dash?welcome=1'), owner.click('button:has-text("Create my quote link")')]);
  const quoteUrl = await owner.inputValue('#quote-link');
  assert.equal(quoteUrl, `${base}/q/tampa-junk-pros`);
  assert.match(await owner.textContent('main'), /14 days left/);
  await owner.screenshot({ path: out('03-dashboard-empty.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  log(`signed up, link ${quoteUrl}`);
  const qr = await owner.request.get(`${base}/dash/qr.png`);
  assert.equal(qr.status(), 200);
  assert.equal(qr.headers()['content-type'], 'image/png');
  log('QR code served');

  const db = new DatabaseSync(path.join(dataDir, 'pilequote.db'));
  const companyId = db.prepare("SELECT id FROM companies WHERE slug = 'tampa-junk-pros'").get().id;
  stripeCompanyId = companyId;
  const signupMail = emails().find((m) => m.to === 'founder@example.com');
  assert.ok(signupMail && /New signup: Tampa Junk Pros/.test(signupMail.subject), 'founder gets a signup email');
  log('founder notified of signup');

  begin('Owner edits settings');
  await owner.goto(`${base}/dash/settings`);
  await owner.fill('input[name=serviceArea]', 'Tampa Bay area');
  await owner.$eval('input[name=brandColor]', (el) => (el.value = '#1d4ed8'));
  await owner.fill('input[name=newPassword]', 'new-horse-10');
  await Promise.all([owner.waitForURL('**/dash/settings?saved=1'), owner.click('button:has-text("Save settings")')]);
  assert.equal(await owner.inputValue('input[name=serviceArea]'), 'Tampa Bay area');
  log('settings saved (including a new password)');

  begin('Customer gets a quote on a phone');
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const cust = await phoneCtx.newPage();
  await cust.goto(quoteUrl);
  assert.match(await cust.textContent('.q-company'), /Tampa Junk Pros/);
  await cust.screenshot({ path: out('04-quote-start.png'), fullPage: true });
  await cust.setInputFiles('#photo-input', [photo1, photo2]);
  await cust.waitForFunction(() => document.querySelectorAll('.thumb img').length === 2);
  await cust.fill('#notes', 'Also 2 more boxes in the closet');
  await cust.fill('#c-name', 'Jordan Lee');
  await cust.fill('#c-phone', '(813) 555-0177');
  await cust.fill('#c-email', 'jordan@example.com');
  await cust.screenshot({ path: out('05-quote-photos.png'), fullPage: true });
  await cust.click('#get-price');
  await cust.waitForSelector('#step-result:not([hidden])', { timeout: 30_000 });
  assert.equal(await cust.textContent('#r-price'), '$330–$405');
  assert.match(await cust.textContent('#r-size'), /About 3\/8 to 1\/2 of a truck/);
  assert.match(await cust.textContent('#r-items'), /Queen mattress\+\$25 each/);
  assert.match(await cust.textContent('#r-flags'), /Paint cans/);
  await cust.screenshot({ path: out('06-quote-result.png'), fullPage: true });
  log('estimate shown: $330–$405');

  const call = anthropicCalls[0];
  assert.equal(anthropicCalls.length, 1);
  assert.match(call.url, /^\/v1\/messages/);
  assert.ok(call.headers.authorization === 'Bearer test-key' || call.headers['x-api-key'] === 'test-key', 'API key sent');
  assert.match(call.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.output_config.effort, 'medium');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.ok(!('thinking' in call.body) || call.body.thinking.type === 'adaptive');
  const images = call.body.messages[0].content.filter((b) => b.type === 'image');
  assert.equal(images.length, 2);
  assert.equal(images[0].source.media_type, 'image/jpeg');
  const imgBytes = Buffer.from(images[0].source.data, 'base64');
  assert.ok(imgBytes.length < 400_000, `photo was resized (${imgBytes.length} bytes)`);
  const lastBlock = call.body.messages[0].content.at(-1).text;
  assert.match(lastBlock, /Truck size: 16 cubic yards/);
  assert.match(lastBlock, /Also 2 more boxes in the closet/);
  log('AI request has 2 resized photos, schema output, fallback, notes and truck size');

  begin('Customer requests a pickup');
  await cust.click('#go-book');
  await cust.click('#day-chips .chip >> nth=1');
  await cust.click('#window-chips .chip >> nth=0');
  await cust.fill('#b-address', '4012 W Bay Ave, Tampa, FL 33611');
  await cust.fill('#b-notes', 'Garage code 2580');
  assert.equal(await cust.inputValue('#b-name'), 'Jordan Lee');
  await cust.screenshot({ path: out('07-quote-book.png'), fullPage: true });
  await cust.click('#book-submit');
  await cust.waitForSelector('#step-done:not([hidden])');
  assert.match(await cust.textContent('#d-text'), /Tampa Junk Pros got your request/);
  await cust.screenshot({ path: out('08-quote-done.png'), fullPage: true });
  log('pickup requested');

  await waitFor(() => emails().filter((m) => m.to === 'sam@tampajunkpros.test').length >= 2, 5000);
  const ownerMails = emails().filter((m) => m.to === 'sam@tampajunkpros.test');
  assert.match(ownerMails[0].subject, /^New quote: \$330–\$405 · Jordan Lee/);
  assert.deepEqual(ownerMails[0].attachments, ['photo-1.jpg', 'photo-2.jpg']);
  assert.match(ownerMails[1].subject, /^Pickup request: .*Morning.*Jordan Lee/);
  assert.match(ownerMails[1].text, /4012 W Bay Ave/);
  assert.match(ownerMails[1].text, /Garage code 2580/);
  const custMail = emails().find((m) => m.to === 'jordan@example.com');
  assert.ok(custMail, 'customer confirmation email');
  assert.match(custMail.text, /Your estimate: \$330–\$405/);
  assert.equal(smsCalls.length, 2);
  assert.equal(smsCalls[0].body.get('To'), '+18135550199');
  assert.match(smsCalls[1].body.get('Body'), /Pickup request/);
  log('owner got 2 emails (with photos) + 2 texts, customer got a confirmation');

  begin('Owner sees the lead');
  await owner.goto(`${base}/dash`);
  const leadText = await owner.textContent('.lead-card');
  for (const s of ['Pickup requested', 'Jordan Lee', '$330–$405', '4012 W Bay Ave', 'Queen mattress', 'Garage code 2580', 'Paint cans']) {
    assert.ok(leadText.includes(s), `lead card shows ${s}`);
  }
  await owner.waitForFunction(() => [...document.querySelectorAll('.lead-photos img')].every((i) => i.complete && i.naturalWidth > 0));
  await owner.screenshot({ path: out('09-dashboard-lead.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  const leadId = db.prepare('SELECT id FROM leads WHERE company_id = ?').get(companyId).id;
  const photoRes = await owner.request.get(`${base}/dash/leads/${leadId}/photos/0`);
  assert.equal(photoRes.headers()['content-type'], 'image/jpeg');
  const anon = await fetch(`${base}/dash/leads/${leadId}/photos/0`, { redirect: 'manual' });
  assert.equal(anon.status, 303, 'photos need a login');
  log('lead card + private photos');

  await Promise.all([owner.waitForNavigation(), owner.selectOption(`#status-${leadId}`, 'scheduled')]);
  assert.match(await owner.textContent(`#lead-${leadId} .pill`), /Scheduled/);
  const noCsrf = await owner.request.post(`${base}/dash/leads/${leadId}/status`, { form: { status: 'done' } });
  assert.equal(noCsrf.status(), 403);
  log('status change works, and is rejected without the CSRF token');

  begin('Unusable photos and AI failure');
  const c2 = await phoneCtx.newPage();
  await c2.goto(quoteUrl);
  await c2.setInputFiles('#photo-input', [photo1]);
  await c2.waitForSelector('.thumb img');
  await c2.fill('#notes', 'FORCE_UNUSABLE');
  await c2.fill('#c-name', 'Pat Dark');
  await c2.fill('#c-phone', '813-555-0123');
  await c2.click('#get-price');
  await c2.waitForSelector('#step-unusable:not([hidden])', { timeout: 30_000 });
  assert.match(await c2.textContent('#u-reason'), /too dark/);
  log('unusable photos ask for a better photo');

  const mailsBefore = emails().length;
  const c3 = await phoneCtx.newPage();
  await c3.goto(quoteUrl);
  await c3.setInputFiles('#photo-input', [photo2]);
  await c3.waitForSelector('.thumb img');
  await c3.fill('#notes', 'FORCE_FAIL');
  await c3.fill('#c-name', 'Robin Fail');
  await c3.fill('#c-phone', '813-555-0456');
  await c3.click('#get-price');
  await c3.waitForSelector('#q-error:not([hidden])', { timeout: 30_000 });
  assert.match(await c3.textContent('#q-error'), /busy/);
  const failedLead = db.prepare("SELECT * FROM leads WHERE phone = '813-555-0456'").get();
  assert.equal(failedLead.estimate_status, 'failed');
  await waitFor(() => emails().length > mailsBefore, 5000);
  assert.match(emails().at(-1).text, /automatic estimate failed/);
  log('AI failure: customer sees a friendly error, lead is kept and owner is alerted');

  begin('Billing');
  // Click the real button, but stop at the redirect (this sandbox can't reach stripe.com).
  async function clickAndCaptureRedirect(page, urlPath, buttonText) {
    let location = null;
    const url = `${base}${urlPath}`;
    await page.route(url, async (route) => {
      const resp = await route.fetch({ maxRedirects: 0 });
      location = resp.headers().location;
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<p id="redirect">${resp.status()}</p>` });
    });
    await Promise.all([page.waitForSelector('#redirect'), page.click(`button:has-text("${buttonText}")`)]);
    await page.unroute(url);
    return location;
  }
  await owner.goto(`${base}/dash/billing`);
  assert.equal(await clickAndCaptureRedirect(owner, '/dash/billing/checkout', 'Add card'), 'https://checkout.stripe.com/c/pay/cs_test_1');
  const create = stripeCalls.find((c) => c.url === '/v1/checkout/sessions');
  assert.equal(create.body.get('mode'), 'subscription');
  assert.equal(create.body.get('line_items[0][price]'), 'price_test_49');
  assert.equal(create.body.get('client_reference_id'), String(companyId));
  assert.equal(create.body.get('customer_email'), 'sam@tampajunkpros.test');
  assert.ok(Number(create.body.get('subscription_data[trial_end]')) > Date.now() / 1000 + 10 * 86400, 'keeps remaining trial days');
  log('checkout session created with the remaining trial');

  const stripe = new Stripe('sk_test_fake');
  const sendEvent = async (event, secret = 'whsec_test_secret') => {
    const payload = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  };
  const now = Math.floor(Date.now() / 1000);
  const completed = {
    id: 'evt_1',
    object: 'event',
    type: 'checkout.session.completed',
    created: now,
    data: { object: { id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', client_reference_id: String(companyId), customer: 'cus_test_1', subscription: 'sub_test_1', metadata: { company_id: String(companyId) } } },
  };
  assert.equal((await sendEvent(completed, 'whsec_wrong')).status, 400, 'bad signature rejected');
  assert.equal((await sendEvent(completed)).status, 200);
  let row = db.prepare('SELECT subscription_status, stripe_customer_id FROM companies WHERE id = ?').get(companyId);
  assert.deepEqual({ ...row }, { subscription_status: 'trialing', stripe_customer_id: 'cus_test_1' });
  await owner.goto(`${base}/dash/billing`);
  assert.match(await owner.textContent('.card'), /subscription is active/);
  assert.equal(await clickAndCaptureRedirect(owner, '/dash/billing/portal', 'Manage billing'), 'https://billing.stripe.com/p/session/test_1');
  log('webhook activates the subscription; billing portal opens');

  const staleEvent = { ...completed, id: 'evt_0', type: 'customer.subscription.updated', created: now - 100, data: { object: { id: 'sub_test_1', object: 'subscription', status: 'incomplete', customer: 'cus_test_1', metadata: { company_id: String(companyId) } } } };
  assert.equal((await sendEvent(staleEvent)).status, 200);
  row = db.prepare('SELECT subscription_status FROM companies WHERE id = ?').get(companyId);
  assert.equal(row.subscription_status, 'trialing', 'older event ignored');
  const deleted = { ...staleEvent, id: 'evt_2', type: 'customer.subscription.deleted', created: now + 5 };
  assert.equal((await sendEvent(deleted)).status, 200);
  row = db.prepare('SELECT subscription_status FROM companies WHERE id = ?').get(companyId);
  assert.equal(row.subscription_status, 'canceled');
  log('out-of-order events ignored; cancellation recorded');

  begin('Trial ends');
  db.prepare('UPDATE companies SET trial_ends_at = 0 WHERE id = ?').run(companyId);
  const expiredHtml = await (await fetch(quoteUrl)).text();
  assert.match(expiredHtml, /Instant photo quotes aren't available right now/);
  const blocked = await fetch(`${base}/api/q/tampa-junk-pros/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"photos":[]}' });
  assert.equal(blocked.status, 403);
  await owner.goto(`${base}/dash`);
  assert.match(await owner.textContent('.banner-warn'), /Your trial ended/);
  log('expired link shows the phone number; dashboard asks to subscribe');

  begin('Admin');
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const admin = await adminCtx.newPage();
  await admin.goto(`${base}/admin`);
  await admin.fill('input[name=password]', 'wrong-password');
  await admin.click('button:has-text("Log in")');
  assert.match(await admin.textContent('.flash-error'), /Wrong password/);
  await admin.fill('input[name=password]', 'admin-pass-123');
  await Promise.all([admin.waitForURL(`${base}/admin`), admin.click('button:has-text("Log in")')]);
  assert.match(await admin.textContent('table'), /Tampa Junk Pros/);
  await admin.screenshot({ path: out('10-admin.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  await Promise.all([admin.waitForURL(`${base}/dash`), admin.click('tr:has-text("Tampa Junk Pros") button:has-text("Open")')]);
  assert.match(await admin.textContent('.banner-admin'), /Admin view of/);
  await Promise.all([admin.waitForURL(`${base}/admin`), admin.click('button:has-text("Back to admin")')]);
  await admin.click('tr:has-text("Tampa Junk Pros") button:has-text("+14 days")');
  const ext = db.prepare('SELECT trial_ends_at FROM companies WHERE id = ?').get(companyId);
  assert.ok(ext.trial_ends_at > Date.now() + 13 * 86_400_000);
  assert.equal((await fetch(quoteUrl)).status, 200);
  log('admin can log in, open a company and extend a trial');

  begin('Login, escaping and 404s');
  const loginCtx = await browser.newContext();
  const lp = await loginCtx.newPage();
  await lp.goto(`${base}/login`);
  await lp.fill('input[name=email]', 'sam@tampajunkpros.test');
  await lp.fill('input[name=password]', 'nope-nope-nope');
  await lp.click('button:has-text("Log in")');
  assert.match(await lp.textContent('.flash-error'), /Wrong email or password/);
  await lp.fill('input[name=password]', 'correct-horse-9');
  await lp.click('button:has-text("Log in")');
  assert.match(await lp.textContent('.flash-error'), /Wrong email or password/, 'old password no longer works');
  await lp.fill('input[name=password]', 'new-horse-10');
  await Promise.all([lp.waitForURL(`${base}/dash`), lp.click('button:has-text("Log in")')]);
  log('owner login works with the changed password');

  const evil = new URLSearchParams({
    name: 'Bob <b>Junk</b> "&"',
    ownerName: '<img src=x onerror=alert(1)>',
    phone: '555-555-5555',
    email: 'bob@example.com',
    password: 'password123',
    truckYards: '15',
    price_min: '99', price_quarter: '200', price_half: '350', price_threeQuarter: '450', price_full: '550',
  });
  const signup2 = await fetch(`${base}/signup`, { method: 'POST', body: evil, redirect: 'manual' });
  assert.equal(signup2.status, 303);
  const evilSlug = db.prepare("SELECT slug FROM companies WHERE email = 'bob@example.com'").get().slug;
  const evilPage = await (await fetch(`${base}/q/${evilSlug}`)).text();
  assert.ok(!evilPage.includes('<b>Junk</b>') && evilPage.includes('&lt;b&gt;Junk&lt;/b&gt;'), 'names are escaped');
  assert.equal((await fetch(`${base}/q/no-such-company`)).status, 404);
  log(`HTML is escaped (slug "${evilSlug}"), unknown links 404`);

  db.close();
  console.log('\nAll end-to-end checks passed.');
} catch (err) {
  failed = true;
  console.error(`\nFAILED during "${step}":`, err);
  console.error('\n--- server log ---\n' + serverLog);
} finally {
  await browser?.close();
  server.kill();
  for (const s of [fakeAnthropic, fakeStripe, fakeTwilio]) s.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}
