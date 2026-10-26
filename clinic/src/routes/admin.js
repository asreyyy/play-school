'use strict';

const express = require('express');
const { requireAuth, hashPassword } = require('../auth');
const { tx, getSettings, DEFAULT_SETTINGS } = require('../db');
const { isValidDate, isValidTime, localDate, toMin } = require('../slots');
const {
  bad, notFound, forbidden, int, str, required, email, oneOf, updateSet, insertRow,
} = require('../util');

function password(v) {
  const p = required(v, 'Password', 200);
  if (p.length < 8) throw bad('Password must be at least 8 characters.');
  return p;
}

const bool = (v) => (v ? 1 : 0);

module.exports = function adminRoutes(db) {
  const r = express.Router();
  r.use(requireAuth());
  const admin = requireAuth('admin');

  const getDoctor = (id) => {
    const d = db.prepare(`SELECT d.*, u.email, u.active AS login_active FROM doctors d
                          LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?`).get(id);
    if (!d) throw notFound('Doctor');
    return d;
  };

  function emailTaken(addr, exceptUserId = 0) {
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(addr, exceptUserId)) {
      throw bad('Another account already uses this email.');
    }
  }

  // ---------- Doctors ----------
  r.get('/doctors', (_req, res) => {
    res.json({
      doctors: db.prepare(`SELECT d.*, u.email, u.active AS login_active FROM doctors d
                           LEFT JOIN users u ON u.id = d.user_id ORDER BY d.active DESC, d.name`).all(),
    });
  });

  r.post('/doctors', admin, (req, res) => {
    const b = req.body || {};
    const name = required(b.name, 'Name', 120);
    const loginEmail = email(b.email, 'Email', { optional: false });
    const pw = password(b.password);
    emailTaken(loginEmail);
    const id = tx(db, () => {
      const userId = insertRow(db, 'users', {
        name, email: loginEmail, password_hash: hashPassword(pw), role: 'doctor', must_change_password: 1,
      });
      return insertRow(db, 'doctors', {
        user_id: userId,
        name,
        title: str(b.title, 'Title', 120) || 'Psychiatrist',
        qualifications: str(b.qualifications, 'Qualifications', 300),
        bio: str(b.bio, 'Bio', 2000),
      });
    });
    res.status(201).json({ doctor: getDoctor(id) });
  });

  r.patch('/doctors/:id', admin, (req, res) => {
    const doctor = getDoctor(int(req.params.id, 'Doctor'));
    const b = req.body || {};
    const fields = {};
    if (b.name !== undefined) fields.name = required(b.name, 'Name', 120);
    if (b.title !== undefined) fields.title = str(b.title, 'Title', 120);
    if (b.qualifications !== undefined) fields.qualifications = str(b.qualifications, 'Qualifications', 300);
    if (b.bio !== undefined) fields.bio = str(b.bio, 'Bio', 2000);
    if (b.active !== undefined) fields.active = bool(b.active);

    tx(db, () => {
      if (Object.keys(fields).length) {
        const { sql, values } = updateSet(fields);
        db.prepare(`UPDATE doctors SET ${sql} WHERE id = ?`).run(...values, doctor.id);
      }
      if (doctor.user_id) {
        const userFields = {};
        if (fields.name) userFields.name = fields.name;
        if (fields.active !== undefined) userFields.active = fields.active;
        if (b.email !== undefined) {
          userFields.email = email(b.email, 'Email', { optional: false });
          emailTaken(userFields.email, doctor.user_id);
        }
        if (b.password) {
          userFields.password_hash = hashPassword(password(b.password));
          userFields.must_change_password = 1;
        }
        if (Object.keys(userFields).length) {
          const { sql, values } = updateSet(userFields);
          db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...values, doctor.user_id);
        }
        if (userFields.active === 0 || userFields.password_hash) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(doctor.user_id);
        }
      }
    });
    res.json({ doctor: getDoctor(doctor.id) });
  });

  // Admins manage any doctor's schedule; doctors manage their own.
  function scheduleDoctor(req) {
    const doctor = getDoctor(int(req.params.id, 'Doctor'));
    const canEdit = req.user.role === 'admin' || req.user.doctor_id === doctor.id;
    if (req.method !== 'GET' && !canEdit) throw forbidden();
    return doctor;
  }

  function schedule(doctorId) {
    return {
      availability: db.prepare(
        'SELECT * FROM availability WHERE doctor_id = ? ORDER BY weekday, start_time').all(doctorId),
      time_off: db.prepare(
        'SELECT * FROM time_off WHERE doctor_id = ? AND end_date >= ? ORDER BY start_date').all(doctorId, localDate()),
    };
  }

  r.get('/doctors/:id/schedule', (req, res) => {
    res.json(schedule(scheduleDoctor(req).id));
  });

  r.put('/doctors/:id/availability', (req, res) => {
    const doctor = scheduleDoctor(req);
    const blocks = (req.body || {}).availability;
    if (!Array.isArray(blocks) || blocks.length > 100) throw bad('Invalid schedule.');
    const clean = blocks.map((blk) => {
      const weekday = Number(blk.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw bad('Invalid weekday.');
      if (!isValidTime(blk.start_time) || !isValidTime(blk.end_time)) throw bad('Times must be HH:MM.');
      if (toMin(blk.start_time) >= toMin(blk.end_time)) throw bad('Each block must end after it starts.');
      return { weekday, start_time: blk.start_time, end_time: blk.end_time };
    });
    for (const a of clean) {
      for (const b of clean) {
        if (a !== b && a.weekday === b.weekday && a.start_time < b.end_time && b.start_time < a.end_time) {
          throw bad('Working hours on the same day must not overlap.');
        }
      }
    }
    tx(db, () => {
      db.prepare('DELETE FROM availability WHERE doctor_id = ?').run(doctor.id);
      for (const blk of clean) insertRow(db, 'availability', { doctor_id: doctor.id, ...blk });
    });
    res.json(schedule(doctor.id));
  });

  r.post('/doctors/:id/time-off', (req, res) => {
    const doctor = scheduleDoctor(req);
    const b = req.body || {};
    if (!isValidDate(b.start_date) || !isValidDate(b.end_date)) throw bad('Please choose valid dates.');
    if (b.end_date < b.start_date) throw bad('End date must be on or after start date.');
    insertRow(db, 'time_off', {
      doctor_id: doctor.id, start_date: b.start_date, end_date: b.end_date, reason: str(b.reason, 'Reason', 200),
    });
    const clashes = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND date BETWEEN ? AND ?
                                AND status IN ('pending','confirmed')`).get(doctor.id, b.start_date, b.end_date).n;
    res.status(201).json({ ...schedule(doctor.id), clashing_appointments: clashes });
  });

  r.delete('/time-off/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM time_off WHERE id = ?').get(int(req.params.id, 'Leave'));
    if (!row) throw notFound('Leave');
    if (req.user.role !== 'admin' && req.user.doctor_id !== row.doctor_id) throw forbidden();
    db.prepare('DELETE FROM time_off WHERE id = ?').run(row.id);
    res.json(schedule(row.doctor_id));
  });

  // ---------- Services ----------
  r.get('/services', (_req, res) => {
    res.json({ services: db.prepare('SELECT * FROM services ORDER BY active DESC, id').all() });
  });

  function serviceFields(b, partial) {
    const f = {};
    if (!partial || b.name !== undefined) f.name = required(b.name, 'Name', 120);
    if (b.description !== undefined) f.description = str(b.description, 'Description', 500);
    if (!partial || b.duration_min !== undefined) {
      const d = Number(b.duration_min);
      if (!Number.isInteger(d) || d < 5 || d > 480) throw bad('Duration must be between 5 and 480 minutes.');
      f.duration_min = d;
    }
    if (b.price !== undefined) {
      const p = Number(b.price);
      if (!Number.isFinite(p) || p < 0) throw bad('Price is invalid.');
      f.price = p;
    }
    if (b.active !== undefined) f.active = bool(b.active);
    return f;
  }

  r.post('/services', admin, (req, res) => {
    const id = insertRow(db, 'services', serviceFields(req.body || {}, false));
    res.status(201).json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(id) });
  });

  r.patch('/services/:id', admin, (req, res) => {
    const id = int(req.params.id, 'Service');
    if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(id)) throw notFound('Service');
    const fields = serviceFields(req.body || {}, true);
    if (Object.keys(fields).length) {
      const { sql, values } = updateSet(fields);
      db.prepare(`UPDATE services SET ${sql} WHERE id = ?`).run(...values, id);
    }
    res.json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(id) });
  });

  // ---------- Staff accounts ----------
  const USER_COLS = 'u.id, u.name, u.email, u.role, u.active, u.created_at, d.id AS doctor_id';

  r.get('/users', admin, (_req, res) => {
    res.json({
      users: db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN doctors d ON d.user_id = u.id
                         ORDER BY u.role, u.name`).all(),
    });
  });

  r.post('/users', admin, (req, res) => {
    const b = req.body || {};
    const role = oneOf(b.role, 'Role', ['admin', 'receptionist']);
    const loginEmail = email(b.email, 'Email', { optional: false });
    emailTaken(loginEmail);
    const id = insertRow(db, 'users', {
      name: required(b.name, 'Name', 120), email: loginEmail, password_hash: hashPassword(password(b.password)), role,
      must_change_password: 1,
    });
    res.status(201).json({
      user: db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN doctors d ON d.user_id = u.id WHERE u.id = ?`).get(id),
    });
  });

  r.patch('/users/:id', admin, (req, res) => {
    const id = int(req.params.id, 'User');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User');
    const b = req.body || {};
    const f = {};
    if (b.name !== undefined) f.name = required(b.name, 'Name', 120);
    if (b.email !== undefined) {
      f.email = email(b.email, 'Email', { optional: false });
      emailTaken(f.email, id);
    }
    if (b.role !== undefined) {
      if (user.role === 'doctor') throw bad("A doctor's role cannot be changed. Deactivate the doctor instead.");
      f.role = oneOf(b.role, 'Role', ['admin', 'receptionist']);
    }
    if (b.active !== undefined) f.active = bool(b.active);
    if (b.password) {
      f.password_hash = hashPassword(password(b.password));
      f.must_change_password = id === req.user.id ? 0 : 1;
    }

    const losingAdmin = user.role === 'admin' && (f.active === 0 || (f.role && f.role !== 'admin'));
    if (losingAdmin) {
      if (id === req.user.id) throw bad('You cannot deactivate or demote your own account.');
      const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(id).n;
      if (!others) throw bad('There must be at least one active admin.');
    }
    tx(db, () => {
      if (Object.keys(f).length) {
        const { sql, values } = updateSet(f);
        db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...values, id);
      }
      if (f.name && user.role === 'doctor') db.prepare('UPDATE doctors SET name = ? WHERE user_id = ?').run(f.name, id);
      if (f.active === 0 || f.password_hash || f.role) {
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').run(id, req.user.id);
      }
    });
    res.json({
      user: db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN doctors d ON d.user_id = u.id WHERE u.id = ?`).get(id),
    });
  });

  // ---------- Settings ----------
  r.get('/settings', (_req, res) => res.json({ settings: getSettings(db) }));

  r.put('/settings', admin, (req, res) => {
    const b = req.body || {};
    const numeric = { slot_interval_min: [5, 240], booking_window_days: [1, 365], min_notice_hours: [0, 168] };
    const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    tx(db, () => {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (b[key] === undefined) continue;
        let value = str(b[key], key, 500);
        if (numeric[key]) {
          const n = Number(value);
          const [min, max] = numeric[key];
          if (!Number.isInteger(n) || n < min || n > max) throw bad(`${key} must be between ${min} and ${max}.`);
          value = String(n);
        } else if (key === 'auto_confirm_online' || key === 'online_booking_enabled') {
          value = b[key] && b[key] !== '0' ? '1' : '0';
        }
        set.run(value, key);
      }
    });
    res.json({ settings: getSettings(db) });
  });

  // ---------- Reports ----------
  r.get('/reports', admin, (req, res) => {
    const today = localDate();
    const from = isValidDate(req.query.from) ? req.query.from : `${today.slice(0, 8)}01`;
    const to = isValidDate(req.query.to) ? req.query.to : today;
    const statsCols = `
      COUNT(a.id) AS total,
      SUM(a.status = 'completed') AS completed,
      SUM(a.status IN ('pending','confirmed')) AS upcoming,
      SUM(a.status = 'cancelled') AS cancelled,
      SUM(a.status = 'no-show') AS no_show,
      COALESCE(SUM(CASE WHEN a.payment_status = 'paid' THEN a.fee END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN a.payment_status = 'unpaid' AND a.status = 'completed' THEN a.fee END), 0) AS outstanding`;
    res.json({
      from,
      to,
      totals: db.prepare(`SELECT ${statsCols},
          COUNT(DISTINCT a.patient_id) AS patients,
          SUM(a.source = 'online') AS online_bookings
        FROM appointments a WHERE a.date BETWEEN ? AND ?`).get(from, to),
      byDoctor: db.prepare(`SELECT d.id, d.name, ${statsCols} FROM doctors d
        LEFT JOIN appointments a ON a.doctor_id = d.id AND a.date BETWEEN ? AND ?
        GROUP BY d.id ORDER BY d.name`).all(from, to),
      byService: db.prepare(`SELECT s.id, s.name, ${statsCols} FROM services s
        LEFT JOIN appointments a ON a.service_id = s.id AND a.date BETWEEN ? AND ?
        GROUP BY s.id ORDER BY s.name`).all(from, to),
      newPatients: db.prepare(`SELECT COUNT(*) AS n FROM patients WHERE date(created_at) BETWEEN ? AND ?`).get(from, to).n,
    });
  });

  return r;
};
