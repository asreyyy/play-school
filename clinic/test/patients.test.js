'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { localDate, addDays, weekdayOf } = require('../src/slots');

let server;
let base;
let admin;

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
    return { status: res.status, body: await res.json() };
  };
}

before(async () => {
  const db = openDb(':memory:');
  db.exec('UPDATE users SET must_change_password = 0');
  const app = createApp(db, { mailer: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@clinic.local', password: 'admin123' });
});
after(() => server.close());

test('registration assigns sequential patient IDs and stores bystander details', async () => {
  const next = await admin('GET', '/api/patients/next-id');
  assert.equal(next.body.patient_code, 'P-0001');

  const r = await admin('POST', '/api/patients', {
    name: 'Lakshmi Nair', phone: '98470 11111', dob: '1990-05-14', gender: 'Female',
    bystander_name: 'Suresh Nair', bystander_relation: 'Spouse', bystander_phone: '98470 22222',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.patient.patient_code, 'P-0001');
  assert.equal(r.body.patient.bystander_phone, '9847022222');
  assert.equal(r.body.patient.bystander_relation, 'Spouse');

  const bad = await admin('POST', '/api/patients', { name: 'X', phone: '9847033333', bystander_phone: 'abc' });
  assert.equal(bad.status, 400);

  const second = await admin('POST', '/api/patients', { name: 'Ravi Menon', phone: '9847044444' });
  assert.equal(second.body.patient.patient_code, 'P-0002');

  // Searchable by ID and by bystander phone.
  assert.equal((await admin('GET', '/api/patients?q=P-0002')).body.patients[0].name, 'Ravi Menon');
  assert.equal((await admin('GET', '/api/patients?q=9847022222')).body.patients[0].name, 'Lakshmi Nair');
});

test('shared phone numbers need confirmation instead of being blocked', async () => {
  const body = { name: 'Anu Nair', phone: '9847011111', bystander_name: 'Lakshmi Nair', bystander_relation: 'Mother' };
  const warn = await admin('POST', '/api/patients', body);
  assert.equal(warn.status, 409);
  assert.equal(warn.body.code, 'possible_duplicate');
  assert.equal(warn.body.matches[0].name, 'Lakshmi Nair');

  const ok = await admin('POST', '/api/patients', { ...body, confirm_duplicate: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.patient.patient_code, 'P-0003');
});

test('online booking reuses the patient only when phone and name both match', async () => {
  let date = addDays(localDate(), 2);
  while ([0, 6].includes(weekdayOf(date))) date = addDays(date, 1);
  const book = (time, name) => client()('POST', '/api/public/book',
    { doctor_id: 1, service_id: 2, date, time, name, phone: '9847011111', consent: true });

  const same = await book('10:00', ' lakshmi nair ');
  assert.equal(same.status, 201);
  const sibling = await book('10:30', 'Meera Nair');
  assert.equal(sibling.status, 201);

  const { body } = await admin('GET', '/api/patients?q=9847011111');
  const names = body.patients.map((p) => p.name).sort();
  assert.deepEqual(names, ['Anu Nair', 'Lakshmi Nair', 'Meera Nair']);
  assert.ok(body.patients.find((p) => p.name === 'Meera Nair').patient_code.startsWith('P-'));
});

test('patient ID prefix can be changed in settings', async () => {
  assert.equal((await admin('PUT', '/api/settings', { patient_id_prefix: 'm c' })).status, 400);
  await admin('PUT', '/api/settings', { patient_id_prefix: 'mc' });
  const r = await admin('POST', '/api/patients', { name: 'New Prefix', phone: '9847055555' });
  assert.match(r.body.patient.patient_code, /^MC-\d{4}$/);
});

test('upgrading an old database keeps patients, adds IDs and moves emergency contact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-migrate-'));
  const file = path.join(dir, 'old.db');
  try {
    // Build a database the way the first version created it, with UNIQUE(phone) and no patient IDs.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL DEFAULT '', dob TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '', emergency_contact TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO patients (id, name, phone, emergency_contact) VALUES (5, 'Old One', '9000000001', 'Mother 9000000002');
      INSERT INTO patients (id, name, phone) VALUES (9, 'Old Two', '9000000003');`);
    old.close();

    const db = openDb(file);
    const rows = db.prepare('SELECT id, patient_code, bystander_name FROM patients ORDER BY id').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { id: 5, patient_code: 'P-0001', bystander_name: 'Mother 9000000002' },
      { id: 9, patient_code: 'P-0002', bystander_name: '' },
    ]);
    // Phone is no longer unique.
    db.prepare("INSERT INTO patients (name, phone, patient_code) VALUES ('Sibling', '9000000001', 'P-0099')").run();
    // Appointments can still reference patients after the rebuild.
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    db.close();
    // Opening again is a no-op.
    openDb(file).close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
