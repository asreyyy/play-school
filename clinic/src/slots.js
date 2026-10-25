'use strict';

// All dates/times are clinic-local strings: dates 'YYYY-MM-DD', times 'HH:MM'.
// The server's timezone is treated as the clinic's timezone (set TZ to change it).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime()) && localDate(d) === s;
}
const isValidTime = (s) => typeof s === 'string' && TIME_RE.test(s);

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const weekdayOf = (date) => new Date(`${date}T00:00:00`).getDay();

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

/** Working windows [{start, end}] in minutes for a doctor on a date; empty when on leave. */
function workingWindows(db, doctorId, date) {
  const off = db.prepare(
    'SELECT 1 FROM time_off WHERE doctor_id = ? AND start_date <= ? AND end_date >= ?')
    .get(doctorId, date, date);
  if (off) return [];
  return db.prepare(
    'SELECT start_time, end_time FROM availability WHERE doctor_id = ? AND weekday = ? ORDER BY start_time')
    .all(doctorId, weekdayOf(date))
    .map((r) => ({ start: toMin(r.start_time), end: toMin(r.end_time) }));
}

function bookedRanges(db, doctorId, date, excludeId = 0) {
  return db.prepare(`
    SELECT start_time, end_time FROM appointments
    WHERE doctor_id = ? AND date = ? AND status NOT IN ('cancelled') AND id != ?`)
    .all(doctorId, date, excludeId)
    .map((r) => ({ start: toMin(r.start_time), end: toMin(r.end_time) }));
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * Free start times for a doctor/date/duration.
 * opts: { interval, minNoticeMin, excludeId }
 */
function availableSlots(db, doctorId, date, duration, opts = {}) {
  const interval = opts.interval || 30;
  const booked = bookedRanges(db, doctorId, date, opts.excludeId);
  const now = new Date();
  const earliest = date === localDate(now)
    ? now.getHours() * 60 + now.getMinutes() + (opts.minNoticeMin || 0)
    : date < localDate(now) ? Infinity : 0;

  const slots = [];
  for (const w of workingWindows(db, doctorId, date)) {
    for (let s = w.start; s + duration <= w.end; s += interval) {
      const range = { start: s, end: s + duration };
      if (s >= earliest && !booked.some((b) => overlaps(b, range))) slots.push(fromMin(s));
    }
  }
  return slots;
}

/** Checks a proposed booking. Returns { conflict, outsideHours }. */
function checkBooking(db, doctorId, date, startTime, duration, excludeId = 0) {
  const range = { start: toMin(startTime), end: toMin(startTime) + duration };
  const conflict = bookedRanges(db, doctorId, date, excludeId).some((b) => overlaps(b, range));
  const outsideHours = !workingWindows(db, doctorId, date)
    .some((w) => range.start >= w.start && range.end <= w.end);
  return { conflict, outsideHours };
}

module.exports = {
  toMin, fromMin, isValidDate, isValidTime, localDate, addDays, weekdayOf,
  availableSlots, checkBooking,
};
