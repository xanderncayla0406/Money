// Tiny auto-escaping HTML templates. Everything interpolated into html`` is
// escaped unless it is itself an html`` result (or wrapped in raw()).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new SafeHtml(String(value));

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

// Embed data for client scripts. Not executable, so it is allowed by the CSP.
export function jsonScript(id, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return raw(`<script type="application/json" id="${escapeHtml(id)}">${json}</script>`);
}
