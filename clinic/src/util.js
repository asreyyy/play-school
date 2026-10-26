'use strict';

const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg, extra) => new HttpError(400, msg, extra);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
const forbidden = () => new HttpError(403, 'You do not have permission to do this.');

/** Trimmed string, or '' when missing. Throws if longer than max. */
function str(v, field, max = 500) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters).`);
  return s;
}

function required(v, field, max) {
  const s = str(v, field, max);
  if (!s) throw bad(`${field} is required.`);
  return s;
}

function int(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${field} is invalid.`);
  return n;
}

function oneOf(v, field, allowed) {
  if (!allowed.includes(v)) throw bad(`${field} must be one of: ${allowed.join(', ')}.`);
  return v;
}

const normalizePhone = (p) => String(p || '').replace(/[\s\-().]/g, '');

function phone(v) {
  const p = normalizePhone(v);
  if (!/^\+?\d{7,15}$/.test(p)) throw bad('Please enter a valid phone number.');
  return p;
}

function email(v, field = 'Email', { optional = true } = {}) {
  const e = str(v, field, 200).toLowerCase();
  if (!e && optional) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad(`Please enter a valid ${field.toLowerCase()}.`);
  return e;
}

function newReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = '';
  for (const b of crypto.randomBytes(6)) ref += alphabet[b % alphabet.length];
  return ref;
}

/** Builds "SET a = ?, b = ?" from the keys present in `fields`. */
function updateSet(fields) {
  const keys = Object.keys(fields);
  return { sql: keys.map((k) => `${k} = ?`).join(', '), values: keys.map((k) => fields[k]) };
}

/** Inserts `fields` (trusted column names) into `table`; returns the new id. */
function insertRow(db, table, fields) {
  const keys = Object.keys(fields);
  return db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => fields[k])).lastInsertRowid;
}

module.exports = {
  HttpError, bad, notFound, forbidden, str, required, int, oneOf, phone, normalizePhone, email,
  newReference, updateSet, insertRow,
};
