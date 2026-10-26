'use strict';

/* Helpers shared by the public site and the staff app. */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  (date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, opts) : '');
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function money(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 })
      .format(amount || 0);
  } catch {
    return `${currency || ''} ${Math.round(amount || 0)}`;
  }
}
const initials = (name) => String(name || '').replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean)
  .slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const statusBadge = (s) => `<span class="badge badge-status status-${esc(s)}">${esc(s)}</span>`;
const formData = (form) => Object.fromEntries(new FormData(form).entries());
