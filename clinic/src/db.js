'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'receptionist')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctors (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT 'Psychiatrist',
  qualifications TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price        REAL NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

-- Weekly working hours. weekday: 0 = Sunday ... 6 = Saturday
CREATE TABLE IF NOT EXISTS availability (
  id         INTEGER PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_off (
  id         INTEGER PRIMARY KEY,
  doctor_id  INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS patients (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL DEFAULT '',
  dob               TEXT NOT NULL DEFAULT '',
  gender            TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  emergency_contact TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  doctor_id      INTEGER NOT NULL REFERENCES doctors(id),
  patient_id     INTEGER NOT NULL REFERENCES patients(id),
  service_id     INTEGER NOT NULL REFERENCES services(id),
  date           TEXT NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'in-person' CHECK (mode IN ('in-person', 'online')),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no-show')),
  reason         TEXT NOT NULL DEFAULT '',
  fee            REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'waived')),
  source         TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('online', 'staff')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_doctor_date ON appointments(doctor_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);

-- Confidential clinical notes. Readable only by the writing doctor and admins.
CREATE TABLE IF NOT EXISTS session_notes (
  id             INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id      INTEGER NOT NULL REFERENCES doctors(id),
  content        TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const DEFAULT_SETTINGS = {
  clinic_name: 'Mind Care Clinic',
  clinic_tagline: 'Compassionate psychiatric care',
  clinic_phone: '',
  clinic_email: '',
  clinic_address: '',
  currency: 'INR',
  slot_interval_min: '30',
  booking_window_days: '60',
  min_notice_hours: '2',
  auto_confirm_online: '0',
  online_booking_enabled: '1',
};

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

/** Wraps fn in a transaction; rolls back if it throws. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed(db) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@clinic.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  tx(db, () => {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('Clinic Admin', adminEmail, hashPassword(adminPassword), 'admin');

    const addService = db.prepare(
      'INSERT INTO services (name, description, duration_min, price) VALUES (?, ?, ?, ?)');
    addService.run('Initial Consultation', 'First visit: detailed psychiatric assessment.', 60, 1500);
    addService.run('Follow-up Session', 'Review of progress and medication.', 30, 800);
    addService.run('Therapy Session', 'Talk therapy / counselling session.', 45, 1200);

    // Three starter doctors with login accounts. Rename them from the admin panel.
    const addUser = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
    const addDoctor = db.prepare(
      'INSERT INTO doctors (user_id, name, title, qualifications, bio) VALUES (?, ?, ?, ?, ?)');
    const addHours = db.prepare(
      'INSERT INTO availability (doctor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 3; i++) {
      const name = `Dr. Doctor ${i}`;
      const user = addUser.run(name, `doctor${i}@clinic.local`, hashPassword('doctor123'), 'doctor');
      const doc = addDoctor.run(user.lastInsertRowid, name, 'Consultant Psychiatrist', 'MBBS, MD (Psychiatry)',
        'Edit this profile from Admin → Doctors.');
      for (let wd = 1; wd <= 5; wd++) {
        addHours.run(doc.lastInsertRowid, wd, '10:00', '13:00');
        addHours.run(doc.lastInsertRowid, wd, '14:00', '18:00');
      }
      addHours.run(doc.lastInsertRowid, 6, '10:00', '14:00');
    }
  });

  if (process.env.NODE_ENV !== 'test') {
    console.log(`\nFirst run: created admin account ${adminEmail} / ${adminPassword}`);
    console.log('Doctor accounts: doctor1@clinic.local, doctor2@clinic.local, doctor3@clinic.local / doctor123');
    console.log('Change these passwords after logging in!\n');
  }
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

module.exports = { openDb, tx, getSettings, DEFAULT_SETTINGS };
