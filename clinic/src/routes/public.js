'use strict';

const express = require('express');
const { getSettings } = require('../db');
const { availableSlots, isValidDate, localDate, addDays } = require('../slots');
const { createAppointment } = require('../appointments');
const { HttpError, bad, notFound, int, required, str, phone, email, normalizePhone } = require('../util');

const PUBLIC_SETTINGS = [
  'clinic_name', 'clinic_tagline', 'clinic_phone', 'clinic_email', 'clinic_address', 'currency',
  'booking_window_days', 'online_booking_enabled',
];

module.exports = function publicRoutes(db) {
  const r = express.Router();

  function slotOptions() {
    const s = getSettings(db);
    return {
      settings: s,
      interval: Number(s.slot_interval_min) || 30,
      minNoticeMin: (Number(s.min_notice_hours) || 0) * 60,
      windowDays: Number(s.booking_window_days) || 60,
    };
  }

  function activeDoctorAndService(query) {
    const doctor = db.prepare('SELECT id FROM doctors WHERE id = ? AND active = 1').get(int(query.doctor_id, 'Doctor'));
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(int(query.service_id, 'Service'));
    if (!doctor || !service) throw bad('Please choose a valid doctor and service.');
    return { doctor, service };
  }

  r.get('/info', (_req, res) => {
    const s = getSettings(db);
    res.json({
      settings: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]])),
      services: db.prepare(
        'SELECT id, name, description, duration_min, price FROM services WHERE active = 1 ORDER BY id').all(),
      doctors: db.prepare(
        'SELECT id, name, title, qualifications, bio FROM doctors WHERE active = 1 ORDER BY name').all(),
    });
  });

  // Dates (within the booking window) on which the doctor has at least one free slot.
  r.get('/days', (req, res) => {
    const { doctor, service } = activeDoctorAndService(req.query);
    const o = slotOptions();
    const days = [];
    const today = localDate();
    for (let i = 0; i <= o.windowDays; i++) {
      const date = addDays(today, i);
      const n = availableSlots(db, doctor.id, date, service.duration_min, o).length;
      if (n) days.push({ date, slots: n });
    }
    res.json({ days });
  });

  r.get('/slots', (req, res) => {
    const { doctor, service } = activeDoctorAndService(req.query);
    if (!isValidDate(req.query.date)) throw bad('Please choose a valid date.');
    const o = slotOptions();
    const tooFar = req.query.date > addDays(localDate(), o.windowDays);
    res.json({ slots: tooFar ? [] : availableSlots(db, doctor.id, req.query.date, service.duration_min, o) });
  });

  r.post('/book', (req, res) => {
    if (getSettings(db).online_booking_enabled !== '1') {
      throw new HttpError(403, 'Online booking is currently closed. Please call the clinic.');
    }
    const b = req.body || {};
    if (b.consent !== true) throw bad('Please agree to the privacy policy to book.');
    const name = required(b.name, 'Name', 120);
    const patientPhone = phone(b.phone);
    const patientEmail = email(b.email);
    const reason = str(b.reason, 'Reason', 1000);

    const appt = createAppointment(db, {
      doctorId: int(b.doctor_id, 'Doctor'),
      serviceId: int(b.service_id, 'Service'),
      date: b.date,
      time: b.time,
      mode: b.mode || 'in-person',
      reason,
      source: 'online',
      resolvePatient: () => {
        const existing = db.prepare('SELECT id, email FROM patients WHERE phone = ?').get(patientPhone);
        if (existing) {
          if (patientEmail && !existing.email) {
            db.prepare('UPDATE patients SET email = ? WHERE id = ?').run(patientEmail, existing.id);
          }
          return existing.id;
        }
        return db.prepare('INSERT INTO patients (name, phone, email) VALUES (?, ?, ?)')
          .run(name, patientPhone, patientEmail).lastInsertRowid;
      },
    });
    res.status(201).json({ appointment: publicView(appt) });
  });

  // Patients can look up / cancel their booking with reference + phone number.
  function findBooking(reference, rawPhone) {
    const appt = db.prepare(`
      SELECT a.*, d.name AS doctor_name, s.name AS service_name, p.phone AS patient_phone, p.name AS patient_name
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id
      JOIN patients p ON p.id = a.patient_id WHERE a.reference = ?`)
      .get(String(reference || '').toUpperCase().trim());
    if (!appt || appt.patient_phone !== normalizePhone(rawPhone)) throw notFound('Booking');
    return appt;
  }

  r.post('/lookup', (req, res) => {
    const b = req.body || {};
    res.json({ appointment: publicView(findBooking(b.reference, b.phone)) });
  });

  r.post('/cancel', (req, res) => {
    const b = req.body || {};
    const appt = findBooking(b.reference, b.phone);
    if (!['pending', 'confirmed'].includes(appt.status)) throw bad('This booking can no longer be cancelled.');
    const hours = Number(getSettings(db).min_notice_hours) || 0;
    const start = new Date(`${appt.date}T${appt.start_time}:00`);
    if (start.getTime() - Date.now() < hours * 36e5) {
      throw bad(`Bookings can only be cancelled online at least ${hours} hour(s) in advance. Please call the clinic.`);
    }
    db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(appt.id);
    res.json({ appointment: publicView({ ...appt, status: 'cancelled' }) });
  });

  return r;
};

function publicView(a) {
  return {
    reference: a.reference, date: a.date, start_time: a.start_time, end_time: a.end_time,
    status: a.status, mode: a.mode, doctor_name: a.doctor_name, service_name: a.service_name,
    patient_name: a.patient_name, fee: a.fee,
  };
}
