'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { getSettings } = require('../db');
const { availableSlots, isValidDate, localDate, addDays } = require('../slots');
const {
  APPOINTMENT_SELECT, STATUSES, getAppointment, createAppointment, updateAppointment,
} = require('../appointments');
const {
  bad, notFound, forbidden, int, str, required, phone, email, updateSet, insertRow,
} = require('../util');

const PATIENT_FIELDS = {
  name: (v) => required(v, 'Name', 120),
  phone: (v) => phone(v),
  email: (v) => email(v),
  dob: (v) => {
    const s = str(v, 'Date of birth', 10);
    if (s && !isValidDate(s)) throw bad('Date of birth is invalid.');
    return s;
  },
  gender: (v) => str(v, 'Gender', 30),
  address: (v) => str(v, 'Address', 500),
  emergency_contact: (v) => str(v, 'Emergency contact', 200),
  notes: (v) => str(v, 'Notes', 2000),
};

function patientFields(body, { partial }) {
  const out = {};
  for (const [k, fn] of Object.entries(PATIENT_FIELDS)) {
    if (body[k] !== undefined || (!partial && (k === 'name' || k === 'phone'))) out[k] = fn(body[k]);
  }
  return out;
}

module.exports = function staffRoutes(db, notifier) {
  const r = express.Router();
  r.use(requireAuth());

  const isDoctor = (u) => u.role === 'doctor';

  function assertCanSeeAppointment(user, appt) {
    if (isDoctor(user) && appt.doctor_id !== user.doctor_id) throw forbidden();
  }

  function assertCanSeePatient(user, patientId) {
    if (!isDoctor(user)) return;
    const seen = db.prepare(`
      SELECT 1 FROM appointments WHERE patient_id = ? AND doctor_id = ?
      UNION SELECT 1 FROM session_notes WHERE patient_id = ? AND doctor_id = ?`)
      .get(patientId, user.doctor_id, patientId, user.doctor_id);
    if (!seen) throw forbidden();
  }

  function existingPatientConflict(phoneNo, exceptId = 0) {
    const p = db.prepare('SELECT id, name FROM patients WHERE phone = ? AND id != ?').get(phoneNo, exceptId);
    if (p) throw bad(`A patient with this phone number already exists (${p.name}).`, { patient_id: p.id });
  }

  // ---------- Dashboard ----------
  r.get('/dashboard', (req, res) => {
    const today = localDate();
    const scope = isDoctor(req.user) ? 'AND a.doctor_id = ?' : '';
    const args = isDoctor(req.user) ? [req.user.doctor_id] : [];

    const todays = db.prepare(`${APPOINTMENT_SELECT} WHERE a.date = ? ${scope} ORDER BY a.start_time`)
      .all(today, ...args);
    const pending = db.prepare(`${APPOINTMENT_SELECT}
      WHERE a.status = 'pending' AND a.date >= ? ${scope} ORDER BY a.date, a.start_time LIMIT 20`)
      .all(today, ...args);
    const upcomingCount = db.prepare(`SELECT COUNT(*) AS n FROM appointments a
      WHERE a.date > ? AND a.date <= ? AND a.status IN ('pending','confirmed') ${scope}`)
      .get(today, addDays(today, 7), ...args).n;

    const tomorrow = db.prepare(`${APPOINTMENT_SELECT}
      WHERE a.date = ? AND a.status IN ('pending','confirmed') ${scope} ORDER BY a.start_time`)
      .all(addDays(today, 1), ...args);

    const out = { today, todays, pending, upcomingCount, tomorrow };
    if (req.user.role === 'admin') {
      const monthStart = `${today.slice(0, 8)}01`;
      out.month = db.prepare(`SELECT
          COUNT(*) AS total,
          SUM(status = 'completed') AS completed,
          SUM(status = 'no-show') AS no_show,
          SUM(status = 'cancelled') AS cancelled,
          COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN fee END), 0) AS revenue
        FROM appointments WHERE date >= ? AND date <= ?`).get(monthStart, today);
      out.patientCount = db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
    }
    res.json(out);
  });

  // ---------- Appointments ----------
  r.get('/appointments', (req, res) => {
    const q = req.query;
    const where = [];
    const args = [];
    if (q.from) { where.push('a.date >= ?'); args.push(String(q.from)); }
    if (q.to) { where.push('a.date <= ?'); args.push(String(q.to)); }
    if (q.status) { where.push('a.status = ?'); args.push(String(q.status)); }
    if (q.patient_id) { where.push('a.patient_id = ?'); args.push(Number(q.patient_id)); }
    if (isDoctor(req.user)) {
      where.push('a.doctor_id = ?'); args.push(req.user.doctor_id);
    } else if (q.doctor_id) {
      where.push('a.doctor_id = ?'); args.push(Number(q.doctor_id));
    }
    if (q.q) {
      where.push('(p.name LIKE ? OR p.phone LIKE ? OR a.reference LIKE ?)');
      const like = `%${String(q.q).trim()}%`;
      args.push(like, like, like);
    }
    const order = q.order === 'desc' ? 'DESC' : 'ASC';
    const rows = db.prepare(`${APPOINTMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.date ${order}, a.start_time ${order} LIMIT 500`).all(...args);
    res.json({ appointments: rows });
  });

  r.get('/appointments/:id', (req, res) => {
    const appt = getAppointment(db, int(req.params.id, 'Appointment'));
    assertCanSeeAppointment(req.user, appt);
    res.json({ appointment: appt });
  });

  r.post('/appointments', (req, res) => {
    const b = req.body || {};
    const doctorId = int(b.doctor_id, 'Doctor');
    if (isDoctor(req.user) && doctorId !== req.user.doctor_id) throw forbidden();

    let resolvePatient;
    if (b.patient_id) {
      const patientId = int(b.patient_id, 'Patient');
      if (!db.prepare('SELECT 1 FROM patients WHERE id = ?').get(patientId)) throw notFound('Patient');
      resolvePatient = () => patientId;
    } else {
      const fields = patientFields(b.patient || {}, { partial: false });
      resolvePatient = () => {
        const existing = db.prepare('SELECT id FROM patients WHERE phone = ?').get(fields.phone);
        if (existing) return existing.id;
        return insertRow(db, 'patients', fields);
      };
    }

    const appt = createAppointment(db, {
      doctorId,
      serviceId: int(b.service_id, 'Service'),
      date: b.date,
      time: b.time,
      mode: b.mode || 'in-person',
      reason: str(b.reason, 'Reason', 1000),
      status: b.status && STATUSES.includes(b.status) ? b.status : 'confirmed',
      source: 'staff',
      force: Boolean(b.force),
      resolvePatient,
    });
    notifier.bookingCreated(appt);
    res.status(201).json({ appointment: appt });
  });

  r.patch('/appointments/:id', (req, res) => {
    const id = int(req.params.id, 'Appointment');
    const appt = getAppointment(db, id);
    assertCanSeeAppointment(req.user, appt);
    const b = req.body || {};
    if (isDoctor(req.user) && b.doctor_id !== undefined && Number(b.doctor_id) !== req.user.doctor_id) {
      throw forbidden();
    }
    const updated = updateAppointment(db, id, b);
    notifier.appointmentUpdated(appt, updated);
    res.json({ appointment: updated });
  });

  r.get('/slots', (req, res) => {
    const doctorId = int(req.query.doctor_id, 'Doctor');
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(int(req.query.service_id, 'Service'));
    if (!service) throw notFound('Service');
    if (!isValidDate(req.query.date)) throw bad('Please choose a valid date.');
    const s = getSettings(db);
    res.json({
      slots: availableSlots(db, doctorId, req.query.date, service.duration_min, {
        interval: Number(s.slot_interval_min) || 30,
        excludeId: Number(req.query.exclude_id) || 0,
      }),
    });
  });

  // ---------- Patients ----------
  r.get('/patients', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      where.push('(p.name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)');
      args.push(like, like, like);
    }
    if (isDoctor(req.user)) {
      where.push(`p.id IN (SELECT patient_id FROM appointments WHERE doctor_id = ?
                          UNION SELECT patient_id FROM session_notes WHERE doctor_id = ?)`);
      args.push(req.user.doctor_id, req.user.doctor_id);
    }
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS visit_count,
        (SELECT MAX(date) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit,
        (SELECT MIN(date) FROM appointments a WHERE a.patient_id = p.id
           AND a.status IN ('pending','confirmed') AND a.date >= date('now','localtime')) AS next_visit
      FROM patients p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.name LIMIT 500`).all(...args);
    res.json({ patients: rows });
  });

  r.get('/patients/:id', (req, res) => {
    const id = int(req.params.id, 'Patient');
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
    if (!patient) throw notFound('Patient');
    assertCanSeePatient(req.user, id);
    const scope = isDoctor(req.user) ? 'AND a.doctor_id = ?' : '';
    const appointments = db.prepare(`${APPOINTMENT_SELECT} WHERE a.patient_id = ? ${scope}
      ORDER BY a.date DESC, a.start_time DESC`).all(id, ...(isDoctor(req.user) ? [req.user.doctor_id] : []));
    res.json({ patient, appointments });
  });

  r.post('/patients', (req, res) => {
    const fields = patientFields(req.body || {}, { partial: false });
    existingPatientConflict(fields.phone);
    const id = insertRow(db, 'patients', fields);
    res.status(201).json({ patient: db.prepare('SELECT * FROM patients WHERE id = ?').get(id) });
  });

  r.patch('/patients/:id', (req, res) => {
    const id = int(req.params.id, 'Patient');
    if (!db.prepare('SELECT 1 FROM patients WHERE id = ?').get(id)) throw notFound('Patient');
    assertCanSeePatient(req.user, id);
    const fields = patientFields(req.body || {}, { partial: true });
    if (fields.phone) existingPatientConflict(fields.phone, id);
    if (Object.keys(fields).length) {
      const { sql, values } = updateSet(fields);
      db.prepare(`UPDATE patients SET ${sql} WHERE id = ?`).run(...values, id);
    }
    res.json({ patient: db.prepare('SELECT * FROM patients WHERE id = ?').get(id) });
  });

  r.delete('/patients/:id', requireAuth('admin'), (req, res) => {
    const id = int(req.params.id, 'Patient');
    if (db.prepare('SELECT 1 FROM appointments WHERE patient_id = ?').get(id)) {
      throw bad('This patient has appointment history and cannot be deleted.');
    }
    const result = db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    if (!result.changes) throw notFound('Patient');
    res.json({ ok: true });
  });

  // ---------- Confidential session notes (doctors write; author doctor + admin read) ----------
  r.get('/patients/:id/notes', requireAuth('admin', 'doctor'), (req, res) => {
    const id = int(req.params.id, 'Patient');
    assertCanSeePatient(req.user, id);
    const scope = isDoctor(req.user) ? 'AND n.doctor_id = ?' : '';
    const notes = db.prepare(`
      SELECT n.*, d.name AS doctor_name, a.date AS appointment_date
      FROM session_notes n JOIN doctors d ON d.id = n.doctor_id
      LEFT JOIN appointments a ON a.id = n.appointment_id
      WHERE n.patient_id = ? ${scope} ORDER BY n.created_at DESC`)
      .all(id, ...(isDoctor(req.user) ? [req.user.doctor_id] : []));
    res.json({ notes });
  });

  r.post('/patients/:id/notes', requireAuth('doctor'), (req, res) => {
    const id = int(req.params.id, 'Patient');
    assertCanSeePatient(req.user, id);
    const b = req.body || {};
    const content = required(b.content, 'Note', 20000);
    let appointmentId = null;
    if (b.appointment_id) {
      const appt = getAppointment(db, int(b.appointment_id, 'Appointment'));
      if (appt.patient_id !== id || appt.doctor_id !== req.user.doctor_id) throw bad('Invalid appointment.');
      appointmentId = appt.id;
    }
    const noteId = db.prepare(
      'INSERT INTO session_notes (appointment_id, patient_id, doctor_id, content) VALUES (?, ?, ?, ?)')
      .run(appointmentId, id, req.user.doctor_id, content).lastInsertRowid;
    res.status(201).json({ note: db.prepare('SELECT * FROM session_notes WHERE id = ?').get(noteId) });
  });

  function ownNote(req) {
    const note = db.prepare('SELECT * FROM session_notes WHERE id = ?').get(int(req.params.id, 'Note'));
    if (!note) throw notFound('Note');
    if (note.doctor_id !== req.user.doctor_id) throw forbidden();
    return note;
  }

  r.patch('/notes/:id', requireAuth('doctor'), (req, res) => {
    const note = ownNote(req);
    const content = required((req.body || {}).content, 'Note', 20000);
    db.prepare("UPDATE session_notes SET content = ?, updated_at = datetime('now') WHERE id = ?")
      .run(content, note.id);
    res.json({ note: db.prepare('SELECT * FROM session_notes WHERE id = ?').get(note.id) });
  });

  r.delete('/notes/:id', requireAuth('doctor'), (req, res) => {
    const note = ownNote(req);
    db.prepare('DELETE FROM session_notes WHERE id = ?').run(note.id);
    res.json({ ok: true });
  });

  return r;
};
