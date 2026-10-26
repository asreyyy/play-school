'use strict';

const { tx, getSettings } = require('./db');
const { checkBooking, toMin, fromMin, isValidDate, isValidTime, availableSlots, localDate } = require('./slots');
const { HttpError, bad, notFound, newReference } = require('./util');

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
const MODES = ['in-person', 'online'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'waived'];

const APPOINTMENT_SELECT = `
  SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
         d.name AS doctor_name, s.name AS service_name, s.duration_min
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctors d ON d.id = a.doctor_id
  JOIN services s ON s.id = a.service_id`;

function getAppointment(db, id) {
  const appt = db.prepare(`${APPOINTMENT_SELECT} WHERE a.id = ?`).get(id);
  if (!appt) throw notFound('Appointment');
  return appt;
}

function loadDoctorAndService(db, doctorId, serviceId, { activeOnly }) {
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
  if (!doctor || (activeOnly && !doctor.active)) throw bad('Please choose a valid doctor.');
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service || (activeOnly && !service.active)) throw bad('Please choose a valid service.');
  return { doctor, service };
}

function validateDateTime(date, time, duration) {
  if (!isValidDate(date)) throw bad('Please choose a valid date.');
  if (!isValidTime(time)) throw bad('Please choose a valid time.');
  if (toMin(time) + duration > 24 * 60) throw bad('Appointment must end before midnight.');
}

/**
 * Ensures the slot is free. Online (patient) bookings must match an offered slot exactly;
 * staff bookings only need to avoid overlaps, and may go outside working hours with `force`.
 */
function assertBookable(db, { doctorId, date, time, duration, source, force, excludeId = 0 }) {
  if (source === 'online') {
    const s = getSettings(db);
    const window = Number(s.booking_window_days) || 60;
    const lastDate = localDate(new Date(Date.now() + window * 864e5));
    const slots = date > lastDate ? [] : availableSlots(db, doctorId, date, duration, {
      interval: Number(s.slot_interval_min) || 30,
      minNoticeMin: (Number(s.min_notice_hours) || 0) * 60,
    });
    if (!slots.includes(time)) {
      throw new HttpError(409, 'Sorry, that time is no longer available. Please pick another slot.');
    }
    return;
  }
  const { conflict, outsideHours } = checkBooking(db, doctorId, date, time, duration, excludeId);
  if (conflict) throw new HttpError(409, 'This doctor already has an appointment at that time.');
  if (outsideHours && !force) {
    throw new HttpError(409, "This time is outside the doctor's working hours (or they are on leave).",
      { code: 'outside_hours' });
  }
}

/** input.resolvePatient() runs inside the transaction and returns the patient id. */
function createAppointment(db, input) {
  const { doctorId, serviceId, resolvePatient, date, time, mode = 'in-person', reason = '', source, force } = input;
  if (!MODES.includes(mode)) throw bad('Invalid consultation mode.');

  return tx(db, () => {
    const { service } = loadDoctorAndService(db, doctorId, serviceId, { activeOnly: source === 'online' });
    validateDateTime(date, time, service.duration_min);
    assertBookable(db, { doctorId, date, time, duration: service.duration_min, source, force });

    let status = input.status;
    if (!status) {
      status = source === 'online' && getSettings(db).auto_confirm_online !== '1' ? 'pending' : 'confirmed';
    }
    const patientId = resolvePatient();
    let reference;
    do reference = newReference();
    while (db.prepare('SELECT 1 FROM appointments WHERE reference = ?').get(reference));

    const r = db.prepare(`
      INSERT INTO appointments
        (reference, doctor_id, patient_id, service_id, date, start_time, end_time, mode, status, reason, fee, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(reference, doctorId, patientId, serviceId, date, time,
        fromMin(toMin(time) + service.duration_min), mode, status, reason, service.price, source);
    return getAppointment(db, r.lastInsertRowid);
  });
}

/** Applies a staff edit (reschedule / status / payment) to an appointment. */
function updateAppointment(db, id, changes) {
  return tx(db, () => {
    const appt = getAppointment(db, id);
    const fields = {};

    if (changes.status !== undefined) {
      if (!STATUSES.includes(changes.status)) throw bad('Invalid status.');
      fields.status = changes.status;
    }
    if (changes.payment_status !== undefined) {
      if (!PAYMENT_STATUSES.includes(changes.payment_status)) throw bad('Invalid payment status.');
      fields.payment_status = changes.payment_status;
    }
    if (changes.mode !== undefined) {
      if (!MODES.includes(changes.mode)) throw bad('Invalid consultation mode.');
      fields.mode = changes.mode;
    }
    if (changes.reason !== undefined) fields.reason = String(changes.reason).slice(0, 1000);
    if (changes.fee !== undefined) {
      const fee = Number(changes.fee);
      if (!Number.isFinite(fee) || fee < 0) throw bad('Invalid fee.');
      fields.fee = fee;
    }

    const rescheduling = ['doctor_id', 'service_id', 'date', 'time'].some((k) => changes[k] !== undefined);
    if (rescheduling) {
      const doctorId = Number(changes.doctor_id ?? appt.doctor_id);
      const serviceId = Number(changes.service_id ?? appt.service_id);
      const date = changes.date ?? appt.date;
      const time = changes.time ?? appt.start_time;
      const { service } = loadDoctorAndService(db, doctorId, serviceId, { activeOnly: false });
      validateDateTime(date, time, service.duration_min);
      const status = fields.status || appt.status;
      if (status !== 'cancelled') {
        assertBookable(db, {
          doctorId, date, time, duration: service.duration_min, source: 'staff', force: changes.force, excludeId: id,
        });
      }
      Object.assign(fields, {
        doctor_id: doctorId, service_id: serviceId, date, start_time: time,
        end_time: fromMin(toMin(time) + service.duration_min),
      });
      if (serviceId !== appt.service_id && changes.fee === undefined) fields.fee = service.price;
    } else if (fields.status && appt.status === 'cancelled' && fields.status !== 'cancelled') {
      // Re-activating a cancelled appointment: make sure the slot is still free.
      assertBookable(db, {
        doctorId: appt.doctor_id, date: appt.date, time: appt.start_time, duration: appt.duration_min,
        source: 'staff', force: true, excludeId: id,
      });
    }

    if (Object.keys(fields).length) {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE appointments SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now')
                  WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    }
    return getAppointment(db, id);
  });
}

module.exports = {
  STATUSES, MODES, PAYMENT_STATUSES, APPOINTMENT_SELECT, getAppointment, createAppointment, updateAppointment,
};
