import { html, raw, jsonScript } from './html.js';
import { config } from './config.js';
import {
  PRICE_FIELDS,
  FEE_TYPES,
  formatMoney,
  formatPriceRange,
  tierPrices,
} from './pricing.js';
import { formatRequestedDate } from './notify.js';

const ASSET_VERSION = '4';
const appName = () => config.appName;

export const LEAD_STATUSES = [
  ['quoted', 'Quoted, not booked'],
  ['requested', 'Pickup requested'],
  ['scheduled', 'Scheduled'],
  ['done', 'Done'],
  ['lost', 'Lost'],
];
const statusLabel = (s) => (LEAD_STATUSES.find(([k]) => k === s) || [s, s])[1];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const logo = html`<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="7" width="20" height="16" rx="3" fill="currentColor"/><path d="M21 12h5.5l4.5 5.5V23H21z" fill="currentColor" opacity=".75"/><circle cx="8" cy="25" r="3.5" fill="#fff" stroke="currentColor" stroke-width="2"/><circle cx="25" cy="25" r="3.5" fill="#fff" stroke="currentColor" stroke-width="2"/><path d="M6 15.5l3 3 6-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function head(title, extra = '') {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css?v=${ASSET_VERSION}">
${extra}`;
}

function siteHeader(ctx) {
  const company = ctx?.company;
  const right = company
    ? html`<nav class="nav">
        <a href="/dash">Leads</a>
        <a href="/dash/settings">Settings</a>
        <a href="/dash/billing">Billing</a>
        ${ctx.isAdmin ? html`<a href="/admin">Admin</a>` : ''}
        <form method="post" action="/logout" class="inline">${csrfField(ctx.csrf)}<button class="link-btn" type="submit">Log out</button></form>
      </nav>`
    : ctx?.isAdmin
      ? html`<nav class="nav"><a href="/admin">Admin</a><form method="post" action="/logout" class="inline">${csrfField(ctx.csrf)}<button class="link-btn" type="submit">Log out</button></form></nav>`
      : html`<nav class="nav"><a href="/login">Log in</a><a class="btn btn-sm btn-primary" href="/signup">Start free trial</a></nav>`;
  return html`<header class="site-header"><div class="container header-row">
    <a class="brand" href="${company ? '/dash' : '/'}">${logo}<span>${appName()}</span></a>
    ${right}
  </div></header>`;
}

function siteFooter() {
  return html`<footer class="site-footer"><div class="container footer-row">
    <span>© ${new Date().getFullYear()} ${appName()}</span>
    <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>${config.supportEmail ? html` · <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>` : ''}</span>
  </div></footer>`;
}

export function page({ title, body, ctx, bodyClass = '' }) {
  return html`<!doctype html>
<html lang="en"><head>${head(title)}</head>
<body class="${bodyClass}">
${siteHeader(ctx)}
<main>${body}</main>
${siteFooter()}
<script src="/static/site.js?v=${ASSET_VERSION}" defer></script>
</body></html>`;
}

const csrfField = (csrf) => (csrf ? html`<input type="hidden" name="_csrf" value="${csrf}">` : '');

function flash(msg, kind = 'ok') {
  return msg ? html`<div class="flash flash-${kind}" role="status">${msg}</div>` : '';
}

function field({ label, name, type = 'text', value = '', required = false, hint = '', attrs = '' }) {
  return html`<label class="field"><span class="field-label">${label}${required ? '' : html` <span class="opt">(optional)</span>`}</span>
    <input type="${type}" name="${name}" value="${value ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;
}

function priceInputs(prices) {
  return html`<div class="grid-5">${PRICE_FIELDS.map(
    (f) => html`<label class="field money"><span class="field-label">${f.label}</span>
      <span class="money-input"><span>$</span><input type="number" inputmode="numeric" min="0" max="20000" step="1" name="price_${f.key}" value="${prices[f.key]}" required></span></label>`,
  )}</div>`;
}

function feeInputs(fees) {
  return html`<div class="grid-3">${FEE_TYPES.map(
    (f) => html`<label class="field money"><span class="field-label">${f.label}</span>
      <span class="money-input"><span>$</span><input type="number" inputmode="numeric" min="0" max="5000" step="1" name="fee_${f.key}" value="${fees[f.key]}"></span></label>`,
  )}</div><p class="hint">Charged per piece on top of the load price. Use 0 for no extra fee.</p>`;
}

function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
const smsHref = (phone) => `sms:${String(phone || '').replace(/[^\d+]/g, '')}`;

// ---------------------------------------------------------------- landing

export function landingPage(ctx) {
  const tiers = tierPrices({});
  const monthsPaid = Math.max(1, Math.floor(tiers[2] / config.monthlyPrice));
  return page({
    title: `${appName()}: instant photo quotes for junk removal`,
    ctx,
    bodyClass: 'landing',
    body: html`
<section class="hero"><div class="container hero-grid">
  <div>
    <p class="eyebrow">For junk removal companies</p>
    <h1>Turn “text us a photo” into booked jobs.</h1>
    <p class="lead">Your customers snap a photo of their junk. ${appName()} estimates how much of your truck it fills, prices it from <strong>your</strong> price sheet, and lets them request a pickup. You get their name, number, photos and price, even at 10pm while you're on another job.</p>
    <div class="hero-cta">
      <a class="btn btn-primary btn-lg" href="/q/demo">Try it with a photo</a>
      <a class="btn btn-ghost btn-lg" href="/signup">Start ${config.trialDays}-day free trial</a>
    </div>
    <p class="fine">No card needed for the trial. ${config.priceLabel} after that, cancel anytime.</p>
  </div>
  <div class="hero-phone" aria-hidden="true">
    <div class="phone">
      <div class="phone-bar">Acme Hauling</div>
      <div class="phone-body">
        <div class="ph-label">Your estimate</div>
        <div class="ph-price">$305–$380</div>
        <div class="ph-size">About 3/8 to 1/2 of a truck</div>
        ${truckSvg(0.38, 0.5)}
        <ul class="ph-items"><li>3-seat sofa</li><li>Queen mattress <span>+$25</span></li><li>Moving boxes ×8</li></ul>
        <div class="ph-btn">Book a pickup</div>
      </div>
    </div>
  </div>
</div></section>

<section class="container section">
  <h2 class="center">How it works</h2>
  <div class="steps">
    <div class="step"><span class="step-n">1</span><h3>Share your link</h3><p>Put it on your website, Google Business Profile, Facebook, Instagram bio, or a QR code on your truck.</p></div>
    <div class="step"><span class="step-n">2</span><h3>Customer snaps a photo</h3><p>No app to download. The photos are measured against your truck size and priced from your rates, plus item fees like mattresses and fridges.</p></div>
    <div class="step"><span class="step-n">3</span><h3>You get the job</h3><p>They pick a day and time. You get the photos, price, address and phone number by email and text. Confirm and go.</p></div>
  </div>
</section>

<section class="container section">
  <div class="features">
    <div class="feature"><h3>Your prices, your rules</h3><p>Minimum, 1/4, 1/2, 3/4 and full truck prices, per-item fees, the days you work, and what you won't take.</p></div>
    <div class="feature"><h3>Every lead, even the ones who don't book</h3><p>Customers leave a name and number before they see a price, so you can call back anyone who didn't book.</p></div>
    <div class="feature"><h3>Honest estimates</h3><p>Customers see a range and a clear note that the final price is confirmed on site. You see every photo before you roll a truck.</p></div>
    <div class="feature"><h3>Nothing to install</h3><p>Works in any phone browser. You manage leads from a simple dashboard.</p></div>
  </div>
</section>

<section class="container section">
  <div class="pricing-card">
    <h2>One price</h2>
    <div class="price-big">${config.priceLabel}</div>
    <p>${config.trialDays} days free, no card needed. Cancel anytime.</p>
    <p class="muted">A single quarter-load job (around ${formatMoney(tiers[2])}) covers about ${monthsPaid} months.</p>
    <a class="btn btn-primary btn-lg" href="/signup">Start free trial</a>
  </div>
</section>

<section class="container section narrow">
  <h2 class="center">Questions</h2>
  <details class="faq"><summary>How accurate are the estimates?</summary><p>It estimates from photos, the same way you quote from texted photos today, and shows the customer a range. The final price is always confirmed on site. If the photos aren't good enough, it asks the customer for a better one instead of guessing.</p></details>
  <details class="faq"><summary>Do my customers need to download anything?</summary><p>No. It's a web page that works on any phone.</p></details>
  <details class="faq"><summary>I already use Jobber or Housecall Pro.</summary><p>Keep using it. This brings in the request with photos and a price; you schedule it wherever you schedule everything else.</p></details>
  <details class="faq"><summary>What happens after the free trial?</summary><p>Add a card to keep your link live. If you don't, your quote page shows your phone number instead of quotes. No surprise charges.</p></details>
</section>`,
  });
}

// ---------------------------------------------------------------- auth pages

export function signupPage(ctx, { values = {}, error } = {}) {
  const prices = values.prices || tierPricesToFields(tierPrices({}));
  const fees = values.fees || Object.fromEntries(FEE_TYPES.map((f) => [f.key, f.default]));
  return page({
    title: `Start your free trial · ${appName()}`,
    ctx,
    body: html`<div class="container narrow">
  <h1>Start your free trial</h1>
  <p class="lead">${config.trialDays} days free, no card needed. You can change everything later.</p>
  ${flash(error, 'error')}
  <form method="post" action="/signup" class="card form">
    <h2>Your business</h2>
    <div class="grid-2">
      ${field({ label: 'Business name', name: 'name', value: values.name, required: true, attrs: 'maxlength="80" autocomplete="organization"' })}
      ${field({ label: 'Your name', name: 'ownerName', value: values.ownerName, attrs: 'maxlength="80" autocomplete="name"' })}
      ${field({ label: 'Business phone (shown to customers)', name: 'phone', type: 'tel', value: values.phone, required: true, attrs: 'maxlength="30" autocomplete="tel"' })}
      ${field({ label: 'Cell for text alerts', name: 'alertPhone', type: 'tel', value: values.alertPhone, attrs: 'maxlength="30"' })}
    </div>
    <h2>Login</h2>
    <div class="grid-2">
      ${field({ label: 'Email (login and lead alerts)', name: 'email', type: 'email', value: values.email, required: true, attrs: 'maxlength="254" autocomplete="email"' })}
      ${field({ label: 'Password', name: 'password', type: 'password', required: true, hint: 'At least 8 characters', attrs: 'minlength="8" maxlength="200" autocomplete="new-password"' })}
    </div>
    <h2>Your truck and prices</h2>
    <div class="grid-2">
      ${field({ label: 'Truck size (cubic yards)', name: 'truckYards', type: 'number', value: values.truckYards ?? 15, required: true, hint: 'Most junk trucks are 15–20 yards', attrs: 'min="3" max="60" step="0.5" inputmode="decimal"' })}
    </div>
    ${priceInputs(prices)}
    <h3>Item fees</h3>
    ${feeInputs(fees)}
    <button class="btn btn-primary btn-lg btn-block" type="submit">Create my quote link</button>
    <p class="fine center">By signing up you agree to the <a href="/terms">terms</a>.</p>
  </form>
  <p class="center">Already have an account? <a href="/login">Log in</a></p>
</div>`,
  });
}

function tierPricesToFields(t) {
  return { min: t[0], quarter: t[2], half: t[4], threeQuarter: t[6], full: t[8] };
}

export function loginPage(ctx, { error, email = '' } = {}) {
  return page({
    title: `Log in · ${appName()}`,
    ctx,
    body: html`<div class="container tiny">
  <h1>Log in</h1>
  ${flash(error, 'error')}
  <form method="post" action="/login" class="card form">
    ${field({ label: 'Email', name: 'email', type: 'email', value: email, required: true, attrs: 'autocomplete="email"' })}
    ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    <button class="btn btn-primary btn-block" type="submit">Log in</button>
  </form>
  <p class="center muted">Forgot your password? ${config.supportEmail ? html`Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>` : 'Contact us'} and we'll reset it.</p>
  <p class="center">New here? <a href="/signup">Start a free trial</a></p>
</div>`,
  });
}

// ---------------------------------------------------------------- dashboard

function billingBanner(state) {
  if (state.state === 'trial') {
    return html`<div class="banner banner-info"><span>Free trial: <strong>${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left</strong>.</span> <a class="btn btn-sm btn-primary" href="/dash/billing">Keep my link live</a></div>`;
  }
  if (state.state === 'expired') {
    return html`<div class="banner banner-warn"><span><strong>Your trial ended.</strong> Your quote page is showing your phone number instead of quotes.</span> <a class="btn btn-sm btn-primary" href="/dash/billing">Subscribe ${config.priceLabel}</a></div>`;
  }
  if (state.state === 'past_due') {
    return html`<div class="banner banner-warn"><span><strong>Your last payment failed.</strong> Update your card to keep your link live.</span> <a class="btn btn-sm btn-primary" href="/dash/billing">Fix billing</a></div>`;
  }
  if (state.state === 'demo') {
    return html`<div class="banner banner-info"><span>This is the shared demo company. Leads here come from people trying the demo link.</span></div>`;
  }
  return '';
}

export function dashboardPage(ctx, { company, leads, stats, state, quoteUrl, welcome, aiEnabled }) {
  return page({
    title: `Leads · ${company.name}`,
    ctx,
    body: html`<div class="container">
  ${ctx.isAdmin ? html`<div class="banner banner-admin"><span>Admin view of <strong>${company.name}</strong>.</span><form method="post" action="/admin/exit" class="inline">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Back to admin</button></form></div>` : ''}
  ${welcome ? html`<div class="banner banner-ok"><span><strong>You're set up!</strong> Open your link below and try it with a photo of anything. Your test will show up here as a lead.</span></div>` : ''}
  ${!aiEnabled ? html`<div class="banner banner-warn"><span><strong>Demo mode:</strong> no AI key is set, so estimates are simulated. Set ANTHROPIC_API_KEY to turn on real photo estimates.</span></div>` : ''}
  ${billingBanner(state)}

  <section class="card link-card">
    <div class="link-main">
      <h2>Your quote link</h2>
      <div class="copy-row">
        <input id="quote-link" class="mono" readonly value="${quoteUrl}" aria-label="Your quote link">
        <button class="btn btn-primary" type="button" data-copy="#quote-link">Copy</button>
        <a class="btn btn-ghost" href="${quoteUrl}" target="_blank" rel="noopener">Open</a>
      </div>
      <details class="where"><summary>Where to put it</summary>
        <ul>
          <li><strong>Google Business Profile:</strong> Edit profile → Contact → add it as your booking or website link.</li>
          <li><strong>Facebook page:</strong> Edit the button → “Book now” or “Get quote” → paste the link.</li>
          <li><strong>Your website:</strong> a big “Get an instant quote” button that opens this link.</li>
          <li><strong>Text replies:</strong> when someone asks for a price, send them the link.</li>
          <li><strong>Truck, flyers, door hangers:</strong> print the QR code.</li>
        </ul>
      </details>
    </div>
    <div class="qr-box">
      <img src="/dash/qr.png" alt="QR code for your quote link" width="132" height="132">
      <a href="/dash/qr.png?download=1">Download QR</a>
    </div>
  </section>

  <section class="stats">
    <div class="stat"><span class="stat-n">${stats.week}</span><span class="stat-l">quotes this week</span></div>
    <div class="stat"><span class="stat-n">${stats.bookedWeek}</span><span class="stat-l">pickup requests this week</span></div>
    <div class="stat"><span class="stat-n">${stats.total}</span><span class="stat-l">leads all time</span></div>
    <div class="stat"><span class="stat-n">${formatMoney(stats.bookedValue)}</span><span class="stat-l">requested jobs (low estimate)</span></div>
  </section>

  <h2>Leads</h2>
  ${leads.length ? html`<div class="leads">${leads.map((lead) => leadCard(lead, ctx))}</div>` : html`<div class="card empty">
      <h3>No leads yet</h3>
      <p>Open your link on your phone and try it with a photo of anything: your garage, a couch, a pile of boxes. It will show up here.</p>
      <a class="btn btn-primary" href="${quoteUrl}" target="_blank" rel="noopener">Try my quote page</a>
    </div>`}
</div>`,
  });
}

function leadCard(lead, ctx) {
  const result = lead.estimate;
  const est = result?.estimate;
  const price = result?.price;
  const when = [formatRequestedDate(lead.requested_date), lead.requested_window].filter(Boolean).join(', ');
  const photos = Array.from({ length: lead.photo_count }, (_, i) => i);
  return html`<article class="card lead-card" id="lead-${lead.id}">
  <div class="lead-top">
    <span class="pill pill-${lead.status}">${statusLabel(lead.status)}</span>
    <span class="muted">${timeAgo(lead.created_at)}${lead.estimate_count > 1 ? ` · ${lead.estimate_count} tries` : ''}</span>
  </div>
  <div class="lead-body">
    <div class="lead-price">
      ${price ? html`<div class="lp-amount">${formatPriceRange(price.low, price.high)}</div><div class="muted">${price.sizeLabel} · ${est.volumeLow}–${est.volumeHigh} yd³</div>` : html`<div class="lp-amount muted">No price</div><div class="muted">${lead.estimate_status === 'failed' ? 'Estimate failed, quote them by phone' : est?.unusableReason || ''}</div>`}
    </div>
    <div class="lead-who">
      <div class="lead-name">${lead.name || 'No name given'}</div>
      ${lead.phone ? html`<div class="lead-actions"><a class="btn btn-sm btn-primary" href="${telHref(lead.phone)}">Call ${lead.phone}</a><a class="btn btn-sm btn-ghost" href="${smsHref(lead.phone)}">Text</a></div>` : html`<div class="muted">No phone number</div>`}
      ${lead.email ? html`<div><a href="mailto:${lead.email}">${lead.email}</a></div>` : ''}
    </div>
  </div>
  ${lead.booked_at ? html`<div class="lead-booking"><div><strong>Requested:</strong> ${when}</div><div><strong>Address:</strong> <a href="https://maps.google.com/?q=${encodeURIComponent(lead.address)}" target="_blank" rel="noopener">${lead.address}</a></div></div>` : ''}
  ${est?.items?.length ? html`<div class="lead-items"><strong>Items:</strong> ${est.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')}</div>` : ''}
  ${price?.fees?.length ? html`<div class="lead-items"><strong>Fees:</strong> ${price.fees.map((f) => `${f.label} ×${f.count} (${formatMoney(f.total)})`).join(', ')}</div>` : ''}
  ${est?.heavyMaterials ? html`<div class="flag">Heavy materials (concrete, dirt, shingles or similar)</div>` : ''}
  ${est?.notAccepted?.length ? html`<div class="flag">May include items you don't take: ${est.notAccepted.join(', ')}</div>` : ''}
  ${lead.customer_notes ? html`<div class="lead-note"><strong>Customer:</strong> ${lead.customer_notes}</div>` : ''}
  ${lead.booking_notes ? html`<div class="lead-note"><strong>Booking note:</strong> ${lead.booking_notes}</div>` : ''}
  ${est?.ownerNotes ? html`<div class="lead-note"><strong>Crew notes:</strong> ${est.ownerNotes}</div>` : ''}
  ${photos.length ? html`<div class="lead-photos">${photos.map((i) => html`<a href="/dash/leads/${lead.id}/photos/${i}" target="_blank" rel="noopener"><img src="/dash/leads/${lead.id}/photos/${i}" alt="Customer photo ${i + 1}" loading="lazy"></a>`)}</div>` : ''}
  <form method="post" action="/dash/leads/${lead.id}/status" class="lead-status">
    ${csrfField(ctx.csrf)}
    <label class="sr-only" for="status-${lead.id}">Status</label>
    <select id="status-${lead.id}" name="status" data-autosubmit>
      ${LEAD_STATUSES.map(([k, label]) => html`<option value="${k}" ${k === lead.status ? raw('selected') : ''}>${label}</option>`)}
    </select>
    <button class="btn btn-sm btn-ghost js-hide" type="submit">Save</button>
  </form>
</article>`;
}

// ---------------------------------------------------------------- settings

export function settingsPage(ctx, { company, saved, error, quoteBase }) {
  const s = company.settings;
  return page({
    title: `Settings · ${company.name}`,
    ctx,
    body: html`<div class="container narrow">
  <h1>Settings</h1>
  ${flash(saved ? 'Saved.' : '', 'ok')}${flash(error, 'error')}
  <form method="post" action="/dash/settings" class="card form">
    ${csrfField(ctx.csrf)}
    <h2>Business</h2>
    <div class="grid-2">
      ${field({ label: 'Business name', name: 'name', value: company.name, required: true, attrs: 'maxlength="80"' })}
      ${field({ label: 'Your name', name: 'ownerName', value: company.owner_name, attrs: 'maxlength="80"' })}
      ${field({ label: 'Business phone (shown to customers)', name: 'phone', type: 'tel', value: company.phone, required: true, attrs: 'maxlength="30"' })}
      ${field({ label: 'Service area', name: 'serviceArea', value: s.serviceArea, hint: 'Shown on your quote page, e.g. "Greater Tampa"', attrs: 'maxlength="80"' })}
    </div>
    <label class="field"><span class="field-label">Link name</span>
      <span class="slug-input"><span class="mono">${quoteBase}/</span><input name="slug" value="${company.slug}" required pattern="[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?" maxlength="40"></span>
      <span class="hint">Lowercase letters, numbers and dashes. Changing it breaks your old link.</span>
    </label>
    <label class="field color-field"><span class="field-label">Brand color</span><input type="color" name="brandColor" value="${s.brandColor}"></label>

    <h2>Alerts</h2>
    <div class="grid-2">
      ${field({ label: 'Email for lead alerts', name: 'alertEmail', type: 'email', value: company.alert_email || company.email || '', attrs: 'maxlength="254"' })}
      ${field({ label: 'Cell for text alerts', name: 'alertPhone', type: 'tel', value: company.alert_phone, attrs: 'maxlength="30"' })}
    </div>

    <h2>Truck and prices</h2>
    <div class="grid-2">
      ${field({ label: 'Truck size (cubic yards)', name: 'truckYards', type: 'number', value: company.truck_yards, required: true, attrs: 'min="3" max="60" step="0.5" inputmode="decimal"' })}
    </div>
    ${priceInputs(company.prices)}
    <h3>Item fees</h3>
    ${feeInputs(company.fees)}
    <label class="field"><span class="field-label">Items you don't take</span>
      <textarea name="notAccepted" rows="2" maxlength="300">${s.notAccepted}</textarea>
      <span class="hint">Shown to customers and flagged on leads.</span></label>

    <h2>Booking</h2>
    <fieldset class="field"><legend class="field-label">Days you take pickups</legend>
      <div class="day-checks">${DAY_NAMES.map((d, i) => html`<label class="check"><input type="checkbox" name="openDays" value="${i}" ${s.openDays.includes(i) ? raw('checked') : ''}> ${d}</label>`)}</div>
    </fieldset>
    <label class="field"><span class="field-label">Time windows customers can pick</span>
      <textarea name="windows" rows="3" maxlength="400">${s.windows.join('\n')}</textarea>
      <span class="hint">One per line.</span></label>
    <label class="check big-check"><input type="checkbox" name="requireContact" value="1" ${s.requireContact ? raw('checked') : ''}>
      <span>Ask for name and phone <strong>before</strong> showing the price <span class="hint">(recommended: you can call back people who don't book)</span></span></label>

    <h2>Login</h2>
    <div class="grid-2">
      ${field({ label: 'Login email', name: 'loginEmail', type: 'email', value: company.email || '', attrs: 'maxlength="254" autocomplete="email"' })}
      ${field({ label: 'New password', name: 'newPassword', type: 'password', hint: 'Leave blank to keep your current password', attrs: 'minlength="8" maxlength="200" autocomplete="new-password"' })}
    </div>

    <button class="btn btn-primary btn-lg btn-block" type="submit">Save settings</button>
  </form>
</div>`,
  });
}

// ---------------------------------------------------------------- billing

export function billingPage(ctx, { company, state, stripeReady, done, error }) {
  let body;
  if (state.state === 'demo') {
    body = html`<p>The demo company never needs billing.</p>`;
  } else if (state.state === 'active' || state.state === 'past_due') {
    body = html`<p class="lead">${state.state === 'active' ? html`Your subscription is <strong>active</strong>. Your quote link is live.` : html`Your last payment <strong>failed</strong>. Update your card to keep your link live.`}</p>
      <form method="post" action="/dash/billing/portal">${csrfField(ctx.csrf)}<button class="btn btn-primary" type="submit">Manage billing, card or cancel</button></form>`;
  } else {
    const intro =
      state.state === 'trial'
        ? html`You have <strong>${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'}</strong> left in your free trial. Add a card now and you won't be charged until the trial ends.`
        : html`Your free trial has ended, so your quote page is showing your phone number instead of quotes. Subscribe to turn instant quotes back on.`;
    body = html`<p class="lead">${intro}</p>
      <div class="pricing-card inline-card"><div class="price-big">${config.priceLabel}</div><p>Cancel anytime.</p>
      ${stripeReady
        ? html`<form method="post" action="/dash/billing/checkout">${csrfField(ctx.csrf)}<button class="btn btn-primary btn-lg" type="submit">${state.state === 'trial' ? 'Add card' : 'Subscribe'}</button></form>`
        : html`<p class="muted">Online billing isn't set up yet. ${config.supportEmail ? html`Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>` : 'Contact us'} to subscribe.</p>`}
      </div>`;
  }
  return page({
    title: `Billing · ${company.name}`,
    ctx,
    body: html`<div class="container narrow"><h1>Billing</h1>
    ${flash(done ? 'Thanks! Your subscription is being set up; this page updates within a minute.' : '', 'ok')}${flash(error, 'error')}
    <div class="card">${body}</div></div>`,
  });
}

// ---------------------------------------------------------------- admin

export function adminLoginPage(ctx, { error, configured }) {
  return page({
    title: `Admin · ${appName()}`,
    ctx,
    body: html`<div class="container tiny"><h1>Admin</h1>
    ${configured ? '' : flash('Set the ADMIN_PASSWORD environment variable to enable the admin page.', 'error')}
    ${flash(error, 'error')}
    <form method="post" action="/admin/login" class="card form">
      ${field({ label: 'Admin password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
      <button class="btn btn-primary btn-block" type="submit">Log in</button>
    </form></div>`,
  });
}

export function adminPage(ctx, { companies, totals, aiEnabled, stripeReady, emailReady, smsReady }) {
  const check = (on, label) => html`<span class="pill ${on ? 'pill-done' : 'pill-lost'}">${label}: ${on ? 'on' : 'off'}</span>`;
  return page({
    title: `Admin · ${appName()}`,
    ctx,
    body: html`<div class="container">
  <h1>Admin</h1>
  <div class="checks">${check(aiEnabled, 'AI estimates')}${check(emailReady, 'Email')}${check(smsReady, 'Texts')}${check(stripeReady, 'Stripe')}</div>
  <section class="stats">
    <div class="stat"><span class="stat-n">${totals.companies}</span><span class="stat-l">companies</span></div>
    <div class="stat"><span class="stat-n">${totals.live}</span><span class="stat-l">live links</span></div>
    <div class="stat"><span class="stat-n">${totals.paying}</span><span class="stat-l">paying</span></div>
    <div class="stat"><span class="stat-n">$${totals.aiCost30.toFixed(2)}</span><span class="stat-l">AI cost, last 30 days (approx.)</span></div>
  </section>
  <p><a class="btn btn-primary" href="/signup">Sign up a new company</a> <span class="muted">Use the owner's email and a temporary password, then text them their link.</span></p>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Company</th><th>Contact</th><th>Status</th><th>Leads</th><th>Last lead</th><th></th></tr></thead>
    <tbody>${companies.map(
      (c) => html`<tr>
      <td><strong>${c.name}</strong><br><a class="mono small" href="/q/${c.slug}" target="_blank" rel="noopener">/q/${c.slug}</a></td>
      <td>${c.owner_name}<br><span class="small">${c.email || ''}${c.phone ? html`<br>${c.phone}` : ''}</span></td>
      <td><span class="pill pill-${c.state.live ? 'done' : 'lost'}">${c.state.state}${c.state.state === 'trial' ? ` (${c.state.daysLeft}d)` : ''}</span></td>
      <td>${c.lead_count} <span class="small muted">(${c.booked_count} booked)</span></td>
      <td class="small">${c.last_lead_at ? timeAgo(c.last_lead_at) : '–'}</td>
      <td class="actions">
        <form method="post" action="/admin/companies/${c.id}/login-as" class="inline">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Open</button></form>
        ${c.isDemo ? '' : html`<form method="post" action="/admin/companies/${c.id}/extend-trial" class="inline">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">+14 days</button></form>`}
      </td>
    </tr>`,
    )}</tbody>
  </table></div>
  <h2>Reset an owner's password</h2>
  <form method="post" action="/admin/reset-password" class="card form inline-form">
    ${csrfField(ctx.csrf)}
    ${field({ label: 'Owner email', name: 'email', type: 'email', required: true })}
    ${field({ label: 'New password', name: 'password', type: 'text', required: true, attrs: 'minlength="8"' })}
    <button class="btn btn-ghost" type="submit">Reset password</button>
  </form>
</div>`,
  });
}

// ---------------------------------------------------------------- quote page

export function truckSvg(lowFill, highFill) {
  const W = 196; // inner cargo width
  const lowW = Math.round(W * Math.max(0, Math.min(1, lowFill)));
  const highW = Math.round(W * Math.max(0, Math.min(1, highFill)));
  return html`<svg class="truck" viewBox="0 0 320 132" role="img" aria-label="Truck about ${Math.round(highFill * 100)}% full">
  <rect x="8" y="8" width="210" height="92" rx="8" class="truck-box"/>
  <rect x="15" y="15" width="${highW}" height="78" rx="4" class="truck-fill-high"/>
  <rect x="15" y="15" width="${lowW}" height="78" rx="4" class="truck-fill"/>
  <path d="M224 38h50l30 34v28h-80z" class="truck-cab"/>
  <path d="M234 46h36l20 24h-56z" class="truck-window"/>
  <circle cx="62" cy="108" r="16" class="truck-wheel"/><circle cx="62" cy="108" r="6" class="truck-hub"/>
  <circle cx="176" cy="108" r="16" class="truck-wheel"/><circle cx="176" cy="108" r="6" class="truck-hub"/>
  <circle cx="268" cy="108" r="16" class="truck-wheel"/><circle cx="268" cy="108" r="6" class="truck-hub"/>
</svg>`;
}

function quoteHead(company) {
  return head(`Instant junk removal quote · ${company.name}`);
}

export function quotePage({ company, aiEnabled }) {
  const s = company.settings;
  const data = {
    slug: company.slug,
    name: company.name,
    phone: company.phone,
    requireContact: Boolean(s.requireContact),
    openDays: s.openDays,
    windows: s.windows,
    maxPhotos: config.limits.maxPhotos,
    demoMode: !aiEnabled,
  };
  const phoneLink = company.phone ? html`<a class="q-call" href="${telHref(company.phone)}">Call ${company.phone}</a>` : '';
  return html`<!doctype html>
<html lang="en"><head>${quoteHead(company)}</head>
<body class="quote" style="--brand: ${s.brandColor}">
<header class="q-header"><div class="q-wrap q-header-row"><div><div class="q-company">${company.name}</div>${s.serviceArea ? html`<div class="q-area">${s.serviceArea}</div>` : ''}</div>${phoneLink}</div></header>
<main class="q-wrap">
  ${!aiEnabled ? html`<div class="banner banner-warn small"><span><strong>Demo mode:</strong> estimates are simulated until an AI key is set.</span></div>` : ''}
  <div id="q-error" class="flash flash-error" role="alert" hidden></div>

  <section id="step-photos" class="q-step">
    <h1>Get a junk removal price in about 30 seconds</h1>
    <p class="q-lead">Snap a photo of what you want gone. We'll estimate how much truck space it takes and show you a price right away.</p>
    <form id="photo-form" novalidate>
      <label class="dropzone" for="photo-input" id="dropzone">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="dz-icon"><path d="M9 3l-1.8 2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" fill="currentColor"/></svg>
        <span class="dz-title">Take or choose photos</span>
        <span class="dz-sub">Up to ${config.limits.maxPhotos} photos. Step back so everything fits.</span>
      </label>
      <input id="photo-input" type="file" accept="image/*" multiple class="sr-only">
      <div id="thumbs" class="thumbs" aria-live="polite"></div>
      <label class="field"><span class="field-label">Anything we can't see? <span class="opt">(optional)</span></span>
        <textarea id="notes" rows="2" maxlength="1000" placeholder="e.g. 10 more boxes in the basement, everything is on the 2nd floor"></textarea></label>
      ${s.requireContact ? html`<div class="q-contact">
        <p class="q-contact-title">Where should we send your quote?</p>
        <label class="field"><span class="field-label">Name</span><input id="c-name" autocomplete="name" maxlength="80" required></label>
        <label class="field"><span class="field-label">Mobile phone</span><input id="c-phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" required></label>
        <label class="field"><span class="field-label">Email <span class="opt">(optional)</span></span><input id="c-email" type="email" autocomplete="email" maxlength="254"></label>
      </div>` : ''}
      <button id="get-price" class="btn btn-primary btn-lg btn-block" type="submit" disabled>See my price</button>
      <p class="fine">Your photos are only shared with ${company.name}.${s.requireContact ? ` By continuing, you agree ${company.name} may call or text you about this quote.` : ''}</p>
      ${s.notAccepted ? html`<p class="fine">${company.name} can't take: ${s.notAccepted}.</p>` : ''}
    </form>
  </section>

  <section id="step-loading" class="q-step center" hidden>
    <div class="spinner" aria-hidden="true"></div>
    <h2 id="loading-text">Looking at your photos…</h2>
    <p class="muted">This usually takes 10–30 seconds.</p>
  </section>

  <section id="step-unusable" class="q-step" hidden>
    <h2>We need a better photo</h2>
    <p id="u-reason" class="q-lead"></p>
    <p id="u-tip" class="muted"></p>
    <button id="u-retry" class="btn btn-primary btn-lg btn-block" type="button">Try different photos</button>
    ${phoneLink ? html`<a class="btn btn-ghost btn-block" href="${telHref(company.phone)}">Or call ${company.phone}</a>` : ''}
  </section>

  <section id="step-result" class="q-step" hidden>
    <div class="q-price-card">
      <div class="q-price-label">Your estimate</div>
      <div class="q-price" id="r-price"></div>
      <div class="q-size" id="r-size"></div>
      <div class="q-yards" id="r-yards"></div>
      <div id="r-truck"></div>
      <p class="q-summary" id="r-summary"></p>
    </div>
    <div id="r-flags"></div>
    <div class="q-items"><h3>What we see</h3><ul id="r-items"></ul></div>
    <p id="r-tip" class="muted small" hidden></p>
    <p class="fine">This is an estimate from your photos. ${company.name} confirms the final price on site before any work starts.</p>
    <button id="go-book" class="btn btn-primary btn-lg btn-block" type="button">Book a pickup</button>
    ${phoneLink ? html`<a class="btn btn-ghost btn-block" href="${telHref(company.phone)}">Call ${company.phone}</a>` : ''}
    <button id="retake" class="link-btn center-block" type="button">Start over with new photos</button>
  </section>

  <section id="step-book" class="q-step" hidden>
    <h2>Request a pickup</h2>
    <p class="muted">Pick a day and time. ${company.name} will confirm by phone or text.</p>
    <form id="book-form" novalidate>
      <fieldset class="field"><legend class="field-label">Day</legend><div class="chips" id="day-chips"></div></fieldset>
      <fieldset class="field"><legend class="field-label">Time</legend><div class="chips" id="window-chips"></div></fieldset>
      <label class="field"><span class="field-label">Pickup address</span><input id="b-address" autocomplete="street-address" maxlength="200" placeholder="Street, city, ZIP" required></label>
      <label class="field"><span class="field-label">Name</span><input id="b-name" autocomplete="name" maxlength="80" required></label>
      <label class="field"><span class="field-label">Mobile phone</span><input id="b-phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" required></label>
      <label class="field"><span class="field-label">Email <span class="opt">(optional, for a confirmation)</span></span><input id="b-email" type="email" autocomplete="email" maxlength="254"></label>
      <label class="field"><span class="field-label">Anything else? <span class="opt">(optional)</span></span><textarea id="b-notes" rows="2" maxlength="1000" placeholder="Gate code, where the items are, parking…"></textarea></label>
      <button id="book-submit" class="btn btn-primary btn-lg btn-block" type="submit">Request pickup</button>
      <p class="fine">Nothing is charged online.</p>
      <button id="book-back" class="link-btn center-block" type="button">Back to my estimate</button>
    </form>
  </section>

  <section id="step-done" class="q-step center" hidden>
    <div class="done-check" aria-hidden="true">✓</div>
    <h2>Request sent!</h2>
    <p id="d-text" class="q-lead"></p>
    ${phoneLink ? html`<a class="btn btn-ghost btn-block" href="${telHref(company.phone)}">Call ${company.phone}</a>` : ''}
  </section>
</main>
<footer class="q-footer">Instant quotes by <a href="/" target="_blank" rel="noopener">${appName()}</a></footer>
${jsonScript('pq-data', data)}
<script src="/static/quote.js?v=${ASSET_VERSION}" defer></script>
</body></html>`;
}

export function quoteUnavailablePage({ company }) {
  return html`<!doctype html>
<html lang="en"><head>${quoteHead(company)}</head>
<body class="quote" style="--brand: ${company.settings.brandColor}">
<header class="q-header"><div class="q-wrap q-header-row"><div class="q-company">${company.name}</div></div></header>
<main class="q-wrap"><section class="q-step center">
  <h1>Get a junk removal quote</h1>
  <p class="q-lead">Instant photo quotes aren't available right now. Call or text ${company.name} for a quick price.</p>
  ${company.phone ? html`<a class="btn btn-primary btn-lg btn-block" href="${telHref(company.phone)}">Call ${company.phone}</a><a class="btn btn-ghost btn-block" href="${smsHref(company.phone)}">Text ${company.phone}</a>` : ''}
</section></main>
</body></html>`;
}

// ---------------------------------------------------------------- misc

export function messagePage(ctx, { title, message, status }) {
  return page({
    title: `${title} · ${appName()}`,
    ctx,
    body: html`<div class="container tiny center"><h1>${title}</h1><p class="lead">${message}</p>${status === 404 ? html`<p><a class="btn btn-primary" href="/">Go home</a></p>` : ''}</div>`,
  });
}

export function privacyPage(ctx) {
  const contact = config.supportEmail || 'the email address listed on this site';
  return page({
    title: `Privacy · ${appName()}`,
    ctx,
    body: html`<div class="container narrow prose">
<h1>Privacy</h1>
<p><em>Plain-language summary. Have it reviewed before relying on it.</em></p>
<h2>Customers requesting a quote</h2>
<p>When you use a company's quote page, we collect the photos you upload, the notes you write, and the contact and address details you enter. We share them with that junk removal company so they can quote and schedule your job. Photos are analyzed by an AI service (Anthropic) to estimate the size of the job.</p>
<p>We don't sell your information or use it for advertising. The company you contacted may call, text or email you about your quote.</p>
<h2>Business accounts</h2>
<p>We store your account details, prices and settings to run your quote page. Payments are processed by Stripe; we don't store card numbers.</p>
<h2>Keeping and deleting data</h2>
<p>Leads are kept so the company can follow up. To ask for your data to be deleted, contact ${contact}.</p>
</div>`,
  });
}

export function termsPage(ctx) {
  return page({
    title: `Terms · ${appName()}`,
    ctx,
    body: html`<div class="container narrow prose">
<h1>Terms</h1>
<p><em>Plain-language summary. Have it reviewed before relying on it.</em></p>
<h2>For businesses</h2>
<p>${appName()} gives your company a quote page that estimates junk removal jobs from customer photos using your prices. Estimates are automated and can be wrong; you are responsible for confirming the final price with your customer before starting work.</p>
<p>After the free trial, the subscription is ${config.priceLabel}, billed monthly through Stripe until you cancel. You can cancel anytime from the billing page; your link stays live until the end of the period you paid for.</p>
<h2>For customers</h2>
<p>The price you see is an estimate based on your photos. The company confirms the final price on site. Requesting a pickup doesn't charge you anything and isn't a confirmed appointment until the company confirms it.</p>
<h2>Acceptable use</h2>
<p>Don't upload photos you don't have the right to share, or anything unlawful.</p>
</div>`,
  });
}
