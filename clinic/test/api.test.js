'use strict';

process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { localDate, addDays, weekdayOf } = require('../src/slots');

let server;
let base;

before(async () => {
  const app = createApp(openDb(':memory:'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Tiny client that keeps a session cookie. */
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

async function login(email, password) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

// Next Monday–Friday date at least 2 days out, so working hours and notice rules apply.
function nextWeekday() {
  let d = addDays(localDate(), 2);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

test('public info lists 3 doctors and services', async () => {
  const r = await client()('GET', '/api/public/info');
  assert.equal(r.status, 200);
  assert.equal(r.body.doctors.length, 3);
  assert.ok(r.body.services.length >= 3);
});

test('patient books online, slot disappears, double booking rejected', async () => {
  const c = client();
  const date = nextWeekday();
  const slots = await c('GET', `/api/public/slots?doctor_id=1&service_id=2&date=${date}`);
  assert.ok(slots.body.slots.includes('10:00'));

  const booking = { doctor_id: 1, service_id: 2, date, time: '10:00', name: 'Asha Rao', phone: '98765 43210' };
  const r = await c('POST', '/api/public/book', booking);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.appointment.status, 'pending');
  assert.equal(r.body.appointment.end_time, '10:30');

  const after = await c('GET', `/api/public/slots?doctor_id=1&service_id=2&date=${date}`);
  assert.ok(!after.body.slots.includes('10:00'));

  const dup = await c('POST', '/api/public/book', { ...booking, phone: '9000000001', name: 'Other' });
  assert.equal(dup.status, 409);

  // Patient can look up and cancel with reference + phone.
  const ref = r.body.appointment.reference;
  assert.equal((await c('POST', '/api/public/lookup', { reference: ref, phone: '000' })).status, 404);
  const look = await c('POST', '/api/public/lookup', { reference: ref, phone: '9876543210' });
  assert.equal(look.body.appointment.doctor_name, 'Dr. Doctor 1');
  const cancel = await c('POST', '/api/public/cancel', { reference: ref, phone: '9876543210' });
  assert.equal(cancel.body.appointment.status, 'cancelled');
});

test('online booking rejects off-hours and Sunday times', async () => {
  const c = client();
  const date = nextWeekday();
  const r = await c('POST', '/api/public/book',
    { doctor_id: 1, service_id: 2, date, time: '13:00', name: 'X', phone: '9111111111' });
  assert.equal(r.status, 409);
  let sunday = addDays(localDate(), 1);
  while (weekdayOf(sunday) !== 0) sunday = addDays(sunday, 1);
  const s = await c('GET', `/api/public/slots?doctor_id=1&service_id=2&date=${sunday}`);
  assert.deepEqual(s.body.slots, []);
});

test('staff APIs require login; wrong password rejected', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/appointments')).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'admin@clinic.local', password: 'nope' })).status, 401);
});

test('admin manages appointments, doctors, services, settings', async () => {
  const admin = await login('admin@clinic.local', 'admin123');
  const date = nextWeekday();

  const created = await admin('POST', '/api/appointments', {
    doctor_id: 2, service_id: 1, date, time: '11:00', patient: { name: 'Ravi Kumar', phone: '9222222222' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.appointment.status, 'confirmed');
  assert.equal(created.body.appointment.end_time, '12:00');

  // Outside hours needs force.
  const late = await admin('POST', '/api/appointments', {
    doctor_id: 2, service_id: 2, date, time: '19:00', patient_id: created.body.appointment.patient_id,
  });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'outside_hours');
  const forced = await admin('POST', '/api/appointments', {
    doctor_id: 2, service_id: 2, date, time: '19:00', patient_id: created.body.appointment.patient_id, force: true,
  });
  assert.equal(forced.status, 201);

  // Reschedule into a conflict fails; mark completed + paid works.
  const id = forced.body.appointment.id;
  assert.equal((await admin('PATCH', `/api/appointments/${id}`, { time: '11:30' })).status, 409);
  const done = await admin('PATCH', `/api/appointments/${id}`, { status: 'completed', payment_status: 'paid' });
  assert.equal(done.body.appointment.status, 'completed');

  const doc = await admin('POST', '/api/doctors', {
    name: 'Dr. New', email: 'new@clinic.local', password: 'password123',
  });
  assert.equal(doc.status, 201);
  const sched = await admin('PUT', `/api/doctors/${doc.body.doctor.id}/availability`, {
    availability: [{ weekday: 1, start_time: '09:00', end_time: '12:00' }],
  });
  assert.equal(sched.body.availability.length, 1);
  const overlap = await admin('PUT', `/api/doctors/${doc.body.doctor.id}/availability`, {
    availability: [{ weekday: 1, start_time: '09:00', end_time: '12:00' }, { weekday: 1, start_time: '11:00', end_time: '13:00' }],
  });
  assert.equal(overlap.status, 400);

  const svc = await admin('POST', '/api/services', { name: 'Online Review', duration_min: 20, price: 500 });
  assert.equal(svc.status, 201);
  const set = await admin('PUT', '/api/settings', { clinic_name: 'Test Clinic', slot_interval_min: 15 });
  assert.equal(set.body.settings.clinic_name, 'Test Clinic');

  const rep = await admin('GET', `/api/reports?from=${localDate()}&to=${addDays(localDate(), 30)}`);
  assert.equal(rep.status, 200);
  assert.ok(rep.body.totals.revenue >= 800);
  assert.equal(rep.body.byDoctor.find((d) => d.name === 'Dr. New').total, 0);
});

test('time off removes slots', async () => {
  const admin = await login('admin@clinic.local', 'admin123');
  const date = nextWeekday();
  await admin('POST', '/api/doctors/3/time-off', { start_date: date, end_date: date, reason: 'Conference' });
  const s = await client()('GET', `/api/public/slots?doctor_id=3&service_id=2&date=${date}`);
  assert.deepEqual(s.body.slots, []);
});

test('doctor sees only own appointments; notes are private', async () => {
  const admin = await login('admin@clinic.local', 'admin123');
  const date = addDays(nextWeekday(), 7);
  const a1 = await admin('POST', '/api/appointments', {
    doctor_id: 1, service_id: 2, date, time: '15:00', patient: { name: 'Meera', phone: '9333333333' }, force: true,
  });
  const a2 = await admin('POST', '/api/appointments', {
    doctor_id: 2, service_id: 2, date, time: '15:00', patient: { name: 'Karan', phone: '9444444444' }, force: true,
  });
  assert.equal(a1.status, 201);

  const doc1 = await login('doctor1@clinic.local', 'doctor123');
  const list = await doc1('GET', '/api/appointments');
  assert.ok(list.body.appointments.every((a) => a.doctor_id === 1));
  assert.equal((await doc1('GET', `/api/appointments/${a2.body.appointment.id}`)).status, 403);
  assert.equal((await doc1('GET', `/api/patients/${a2.body.appointment.patient_id}`)).status, 403);
  assert.equal((await doc1('GET', '/api/users')).status, 403);
  assert.equal((await doc1('POST', '/api/services', { name: 'x', duration_min: 10 })).status, 403);

  const pid = a1.body.appointment.patient_id;
  const note = await doc1('POST', `/api/patients/${pid}/notes`, {
    content: 'Presenting with low mood.', appointment_id: a1.body.appointment.id,
  });
  assert.equal(note.status, 201);

  const doc2 = await login('doctor2@clinic.local', 'doctor123');
  assert.equal((await doc2('GET', `/api/patients/${pid}/notes`)).status, 403);
  assert.equal((await doc2('PATCH', `/api/notes/${note.body.note.id}`, { content: 'x' })).status, 403);

  const reception = client();
  await admin('POST', '/api/users', { name: 'Front Desk', email: 'desk@clinic.local', role: 'receptionist', password: 'password123' });
  await reception('POST', '/api/auth/login', { email: 'desk@clinic.local', password: 'password123' });
  assert.equal((await reception('GET', `/api/patients/${pid}`)).status, 200);
  assert.equal((await reception('GET', `/api/patients/${pid}/notes`)).status, 403);

  const adminNotes = await admin('GET', `/api/patients/${pid}/notes`);
  assert.equal(adminNotes.body.notes.length, 1);

  // Doctor can edit own schedule but not another doctor's.
  assert.equal((await doc1('PUT', '/api/doctors/2/availability', { availability: [] })).status, 403);
  assert.equal((await doc1('PUT', '/api/doctors/1/availability', {
    availability: [{ weekday: 1, start_time: '10:00', end_time: '13:00' }],
  })).status, 200);
});

test('last admin cannot be deactivated; password change works', async () => {
  const admin = await login('admin@clinic.local', 'admin123');
  assert.equal((await admin('PATCH', '/api/users/1', { active: false })).status, 400);
  assert.equal((await admin('POST', '/api/auth/change-password', { current_password: 'admin123', new_password: 'short' })).status, 400);
  assert.equal((await admin('POST', '/api/auth/change-password', { current_password: 'admin123', new_password: 'newpassword1' })).status, 200);
  await login('admin@clinic.local', 'newpassword1');
});
