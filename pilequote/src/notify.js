// Owner alerts and customer confirmations. Email goes out over SMTP (Gmail
// app password works), texts over Twilio. Anything that can't be sent is
// written to DATA_DIR/outbox so nothing is silently lost while setting up.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { config, emailEnabled, smsEnabled } from './config.js';
import { formatMoney, formatPriceRange } from './pricing.js';
import { escapeHtml } from './html.js';

let transport;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transport;
}

function writeOutbox(kind, payload) {
  try {
    const dir = path.join(config.dataDir, 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${crypto.randomBytes(3).toString('hex')}.json`;
    const { attachments, ...rest } = payload;
    const summary = { ...rest, attachments: (attachments || []).map((a) => a.filename) };
    fs.writeFileSync(path.join(dir, name), JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('[outbox] could not write', err.message);
  }
}

export async function sendEmail({ to, subject, text, html, replyTo, attachments, fromName }) {
  if (!to) return { skipped: 'no recipient' };
  if (!emailEnabled()) {
    writeOutbox('email', { to, subject, text, replyTo, attachments });
    console.log(`[email not configured] to=${to} subject="${subject}"`);
    return { skipped: 'email not configured' };
  }
  const name = String(fromName || config.appName).replace(/["\\\r\n<>]/g, '');
  const from = `"${name}" <${config.smtp.from}>`;
  await getTransport().sendMail({ from, to, subject, text, html, replyTo, attachments });
  return { sent: true };
}

export function toE164(phone) {
  const s = String(phone || '').trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export async function sendSms({ to, body }) {
  const number = toE164(to);
  if (!number) return { skipped: 'no phone' };
  if (!smsEnabled()) {
    writeOutbox('sms', { to: number, body });
    return { skipped: 'sms not configured' };
  }
  const { accountSid, authToken, from, apiBase } = config.twilio;
  const res = await fetch(`${apiBase}/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: number, From: from, Body: body.slice(0, 600) }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { sent: true };
}

// ---------- message content ----------

export function formatRequestedDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function leadFacts(lead) {
  const result = lead.estimate;
  const est = result?.estimate;
  const price = result?.price;
  const lines = [];
  if (price) {
    lines.push(`Price shown: ${formatPriceRange(price.low, price.high)} (${price.sizeLabel.replace(/^About /, '')}, about ${est.volumeLow}–${est.volumeHigh} cubic yards)`);
    if (price.fees.length) {
      lines.push(`Item fees: ${price.fees.map((f) => `${f.label} x${f.count} (${formatMoney(f.total)})`).join(', ')}`);
    }
  } else if (lead.estimate_status === 'failed') {
    lines.push('Price shown: none, the automatic estimate failed. Call them with a quote.');
  } else if (est && !est.usable) {
    lines.push(`Price shown: none, photos were not usable (${est.unusableReason})`);
  }
  if (est?.items?.length) lines.push(`Items: ${est.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}`);
  if (est?.heavyMaterials) lines.push('Heads up: heavy materials (concrete, dirt, shingles or similar).');
  if (est?.notAccepted?.length) lines.push(`Heads up, may not be accepted: ${est.notAccepted.join(', ')}`);
  if (lead.customer_notes) lines.push(`Customer notes: ${lead.customer_notes}`);
  if (lead.booking_notes) lines.push(`Booking notes: ${lead.booking_notes}`);
  if (est?.ownerNotes) lines.push(`Crew notes: ${est.ownerNotes}`);
  if (est?.simulated) lines.push('(Demo mode: this estimate was simulated, not made from the photos.)');
  return lines;
}

function contactLine(lead) {
  return [lead.name || 'No name', lead.phone, lead.email].filter(Boolean).join(' · ');
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function photoAttachments(lead, readPhoto) {
  const out = [];
  for (let i = 0; i < lead.photo_count; i++) {
    const photo = readPhoto(lead, i);
    if (photo) {
      out.push({ filename: `photo-${i + 1}.${EXT[photo.type] || 'jpg'}`, content: photo.buffer, contentType: photo.type });
    }
  }
  return out;
}

function toHtml(lines) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">${lines
    .map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`))
    .join('')}</div>`;
}

/** kind: 'quote' (got a price, not booked yet) or 'booking' (pickup requested) */
export async function notifyOwner({ company, lead, kind, readPhoto }) {
  const dashUrl = `${config.appUrl}/dash#lead-${lead.id}`;
  const price = lead.estimate?.price;
  const priceText = price ? formatPriceRange(price.low, price.high) : 'no price';
  const who = `${lead.name || 'New customer'}${lead.phone ? `, ${lead.phone}` : ''}`;
  const when = [formatRequestedDate(lead.requested_date), lead.requested_window].filter(Boolean).join(', ');

  const subject =
    kind === 'booking'
      ? `Pickup request: ${when} · ${priceText} · ${who}`
      : `New quote: ${priceText} · ${who} (not booked yet)`;

  const lines = [
    kind === 'booking' ? 'New pickup request. Call or text to confirm.' : 'Someone just got an instant quote. They have not booked yet, so a quick call could win it.',
    '',
    `Customer: ${contactLine(lead)}`,
  ];
  if (kind === 'booking') {
    lines.push(`Requested: ${when}`);
    lines.push(`Address: ${lead.address}`);
  }
  lines.push(...leadFacts(lead), '', `Photos attached. Open in your dashboard: ${dashUrl}`);

  const to = company.alert_email || company.email || (company.isDemo ? config.adminEmail : '');
  const results = await Promise.allSettled([
    sendEmail({
      to,
      subject,
      text: lines.join('\n'),
      html: toHtml(lines),
      replyTo: lead.email || undefined,
      attachments: photoAttachments(lead, readPhoto),
    }),
    company.alert_phone
      ? sendSms({
          to: company.alert_phone,
          body: `${config.appName}: ${kind === 'booking' ? `Pickup request ${when}` : 'New quote'} from ${who}. ${priceText}. ${dashUrl}`,
        })
      : Promise.resolve({ skipped: 'no alert phone' }),
  ]);
  for (const r of results) if (r.status === 'rejected') console.error('[notify owner]', r.reason?.message || r.reason);
  return results;
}

export async function notifyCustomerBooking({ company, lead }) {
  if (!lead.email) return null;
  const price = lead.estimate?.price;
  const when = [formatRequestedDate(lead.requested_date), lead.requested_window].filter(Boolean).join(', ');
  const lines = [
    `Hi ${lead.name || 'there'},`,
    '',
    `${company.name} got your pickup request for ${when} at ${lead.address}.`,
    price ? `Your estimate: ${formatPriceRange(price.low, price.high)} (${price.sizeLabel.replace(/^About /, 'about ')}).` : '',
    'The final price is confirmed on site before any work starts.',
    '',
    `${company.name} will contact you to confirm the time.${company.phone ? ` Questions? Call ${company.phone}.` : ''}`,
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '');
  try {
    return await sendEmail({
      to: lead.email,
      subject: `Your pickup request with ${company.name}`,
      fromName: `${company.name} via ${config.appName}`,
      text: lines.join('\n'),
      html: toHtml(lines),
      replyTo: company.alert_email || company.email || undefined,
    });
  } catch (err) {
    console.error('[notify customer]', err.message);
    return null;
  }
}

export async function notifyAdminSignup(company) {
  if (!config.adminEmail) return null;
  const lines = [
    `New ${config.appName} signup: ${company.name}`,
    `Owner: ${company.owner_name || '-'} · ${company.email} · ${company.phone}`,
    `Quote link: ${config.appUrl}/q/${company.slug}`,
    `Trial ends: ${new Date(company.trial_ends_at).toDateString()}`,
  ];
  try {
    return await sendEmail({ to: config.adminEmail, subject: `New signup: ${company.name}`, text: lines.join('\n'), html: toHtml(lines) });
  } catch (err) {
    console.error('[notify admin]', err.message);
    return null;
  }
}
