'use strict';

// Patient records: table definition, migrations from older versions, and creation with
// an automatic patient ID (e.g. "P-0007"). Phone numbers may be shared, since family members
// often use one phone, so duplicates are warned about rather than blocked.

const patientsTable = (name) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id                 INTEGER PRIMARY KEY,
  patient_code       TEXT,
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  email              TEXT NOT NULL DEFAULT '',
  dob                TEXT NOT NULL DEFAULT '',
  gender             TEXT NOT NULL DEFAULT '',
  address            TEXT NOT NULL DEFAULT '',
  emergency_contact  TEXT NOT NULL DEFAULT '',
  bystander_name     TEXT NOT NULL DEFAULT '',
  bystander_relation TEXT NOT NULL DEFAULT '',
  bystander_phone    TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const COPY_COLS = 'id, name, phone, email, dob, gender, address, emergency_contact, notes, created_at';

function migratePatients(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'patients'").get();

  // v1 had UNIQUE(phone) and no patient ID / bystander columns: rebuild the table (SQLite can't drop a constraint).
  if (/phone\s+TEXT NOT NULL UNIQUE/.test(sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec('DROP TABLE IF EXISTS patients_new');
      db.exec(patientsTable('patients_new'));
      db.exec(`INSERT INTO patients_new (${COPY_COLS}) SELECT ${COPY_COLS} FROM patients`);
      db.exec('DROP TABLE patients');
      db.exec('ALTER TABLE patients_new RENAME TO patients');
      // Carry the old free-text emergency contact over to the new bystander field.
      db.exec("UPDATE patients SET bystander_name = emergency_contact WHERE bystander_name = '' AND emergency_contact != ''");
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone)');
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_patient_number', '1')");

  // Give an ID to any patient that doesn't have one yet, in registration order.
  const missing = db.prepare("SELECT id FROM patients WHERE patient_code IS NULL OR patient_code = '' ORDER BY id").all();
  for (const { id } of missing) {
    db.prepare('UPDATE patients SET patient_code = ? WHERE id = ?').run(allocateCode(db), id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_code ON patients(patient_code)');
}

function setting(db, key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

const formatCode = (prefix, n) => `${prefix ? `${prefix}-` : ''}${String(n).padStart(4, '0')}`;

/** The ID the next registered patient will get (for showing on the form; not reserved). */
function peekCode(db) {
  let n = Number(setting(db, 'next_patient_number', '1'));
  const prefix = setting(db, 'patient_id_prefix', 'P');
  while (db.prepare('SELECT 1 FROM patients WHERE patient_code = ?').get(formatCode(prefix, n))) n++;
  return formatCode(prefix, n);
}

/** Takes the next free patient ID and advances the counter. Call inside a transaction. */
function allocateCode(db) {
  let n = Number(setting(db, 'next_patient_number', '1'));
  const prefix = setting(db, 'patient_id_prefix', 'P');
  while (db.prepare('SELECT 1 FROM patients WHERE patient_code = ?').get(formatCode(prefix, n))) n++;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_patient_number'").run(String(n + 1));
  return formatCode(prefix, n);
}

/** Inserts a patient with a new patient ID; `fields` holds validated column values. Returns the id. */
function createPatient(db, fields) {
  const row = { ...fields, patient_code: allocateCode(db) };
  const keys = Object.keys(row);
  return db.prepare(`INSERT INTO patients (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k])).lastInsertRowid;
}

/** Existing patient with this phone *and* name (case-insensitive), or undefined. */
function findByPhoneAndName(db, phoneNo, name) {
  return db.prepare('SELECT * FROM patients WHERE phone = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1')
    .get(phoneNo, name);
}

module.exports = { patientsTable, migratePatients, peekCode, createPatient, findByPhoneAndName };
