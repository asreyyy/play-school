'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { localDate, addDays, weekdayOf } = require('../src/slots');

let server;
let base;
const sent = [];

before(async () => {
  const db = openDb(':memory:');
  db.exec('UPDATE users SET must_change_password = 0');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'clinic_email'").run('clinic@example.com');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'clinic_name'").run('Calm & <Care> $& Clinic');
  const mailer = { send: async (msg) => { sent.push(msg); } };
  const app = createApp(db, { mailer });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

function nextWeekday(offset = 2) {
  let d = addDays(localDate(), offset);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('booking page has clinic name filled in safely for search engines', async () => {
  const r = await client()('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /<title>Calm &#38; &#60;Care&#62; \$&#38; Clinic – Book an Appointment<\/title>/);
  assert.doesNotMatch(r.body, /\{\{/);
  assert.match(r.body, /"@type":"MedicalClinic"/);
  assert.doesNotMatch(r.body, /"name":"[^"]*<Care>/); // '<' escaped inside JSON-LD
  const robots = await client()('GET', '/robots.txt');
  assert.match(robots.body, /Disallow: \/staff/);
});

test('emails: patient + clinic on online booking, patient on confirm, reschedule, cancel', async () => {
  sent.length = 0;
  const c = client();
  const date = nextWeekday();
  const r = await c('POST', '/api/public/book', {
    doctor_id: 1, service_id: 2, date, time: '10:00', name: 'Asha', phone: '9876500001',
    email: 'asha@example.com', consent: true, mode: 'online',
  });
  assert.equal(r.status, 201);
  await settle();
  assert.deepEqual(sent.map((m) => m.to).sort(), ['asha@example.com', 'clinic@example.com']);
  assert.match(sent.find((m) => m.to === 'clinic@example.com').subject, /New booking request: Asha/);

  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@clinic.local', password: 'admin123' });
  const { body: list } = await admin('GET', `/api/appointments?from=${date}&to=${date}`);
  const id = list.appointments[0].id;

  sent.length = 0;
  await admin('PATCH', `/api/appointments/${id}`, { status: 'confirmed' });
  await settle();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /confirmed/);

  // Video link: must be https, is emailed, and shows in the patient's booking lookup.
  assert.equal((await admin('PATCH', `/api/appointments/${id}`, { meeting_link: 'javascript:alert(1)' })).status, 400);
  sent.length = 0;
  await admin('PATCH', `/api/appointments/${id}`, { meeting_link: 'https://meet.google.com/abc-defg-hij' });
  await settle();
  assert.match(sent[0].text, /meet\.google\.com\/abc-defg-hij/);
  const look = await c('POST', '/api/public/lookup', { reference: r.body.appointment.reference, phone: '9876500001' });
  assert.equal(look.body.appointment.meeting_link, 'https://meet.google.com/abc-defg-hij');

  sent.length = 0;
  await admin('PATCH', `/api/appointments/${id}`, { time: '11:00' });
  await settle();
  assert.match(sent[0].subject, /rescheduled/);

  sent.length = 0;
  await admin('PATCH', `/api/appointments/${id}`, { status: 'cancelled' });
  await settle();
  assert.match(sent[0].subject, /cancelled/);
});

test('a failing mail server never breaks booking', async () => {
  const db = openDb(':memory:');
  db.prepare("UPDATE settings SET value = 'x@example.com' WHERE key = 'clinic_email'").run();
  const app = createApp(db, { mailer: { send: async () => { throw new Error('SMTP down'); } } });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/public/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctor_id: 1, service_id: 2, date: nextWeekday(), time: '10:00', name: 'B', phone: '9000000099', consent: true }),
    });
    assert.equal(res.status, 201);
    await settle();
  } finally {
    console.error = origError;
    srv.close();
  }
});

test('dashboard lists tomorrow for reminders; QR code needs login; country code validated', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@clinic.local', password: 'admin123' });
  const tomorrow = addDays(localDate(), 1);
  await admin('POST', '/api/appointments', {
    doctor_id: 3, service_id: 2, date: tomorrow, time: '21:00', patient: { name: 'Tom', phone: '9000000077' }, force: true,
  });
  const dash = await admin('GET', '/api/dashboard');
  assert.ok(dash.body.tomorrow.some((a) => a.patient_name === 'Tom'));

  assert.equal((await client()('GET', '/api/qr.svg')).status, 401);
  const qr = await admin('GET', '/api/qr.svg');
  assert.equal(qr.status, 200);
  assert.match(qr.body, /^<svg/);

  assert.equal((await admin('PUT', '/api/settings', { phone_country_code: 'abc' })).status, 400);
  const ok = await admin('PUT', '/api/settings', { phone_country_code: '+44' });
  assert.equal(ok.body.settings.phone_country_code, '44');
  const s = await admin('GET', '/api/settings');
  assert.equal(s.body.email_enabled, true);
});
