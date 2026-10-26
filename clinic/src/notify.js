'use strict';

const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

/**
 * Email is optional: it turns on when SMTP_HOST is set (e.g. Gmail, Zoho, Brevo).
 * Returns { send(message) } or null.
 */
function createMailer(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return { send: (msg) => transport.sendMail({ from, ...msg }) };
}

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Sends appointment emails in the background. Failures are logged, never thrown,
 * so a mail problem can't break a booking. Messages avoid clinical details on purpose.
 */
function createNotifier(db, mailer, env = process.env) {
  const siteUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

  function send(msg) {
    if (!mailer || !msg.to) return;
    Promise.resolve().then(() => mailer.send(msg)).catch((err) => console.error('Email failed:', err.message));
  }

  function details(a) {
    return [
      `Date: ${fmtDate(a.date)}`,
      `Time: ${fmtTime(a.start_time)}`,
      `Doctor: ${a.doctor_name}`,
      `Appointment: ${a.service_name} (${a.mode === 'online' ? 'online' : 'in person'})`,
      a.meeting_link ? `Video call link: ${a.meeting_link}` : '',
      `Booking reference: ${a.reference}`,
    ].filter(Boolean).join('\n');
  }

  function toPatient(a, heading, extra = '') {
    if (!a.patient_email) return;
    const s = getSettings(db);
    const contact = [s.clinic_phone && `Phone: ${s.clinic_phone}`, s.clinic_address && `Address: ${s.clinic_address}`]
      .filter(Boolean).join('\n');
    send({
      to: a.patient_email,
      subject: `${heading} – ${s.clinic_name}`,
      text: `Dear ${a.patient_name},\n\n${heading}.\n\n${details(a)}\n\n${extra}`
        + (siteUrl ? `To check or cancel your booking, visit ${siteUrl}/#manage\n\n` : '')
        + `${s.clinic_name}\n${contact}\n`,
    });
  }

  function toClinic(subject, a, intro) {
    const s = getSettings(db);
    send({
      to: s.clinic_email,
      subject: `${subject}: ${a.patient_name}, ${fmtDate(a.date)} ${fmtTime(a.start_time)}`,
      text: `${intro}\n\nPatient: ${a.patient_name} (${a.patient_phone})\n${details(a)}\n`
        + (siteUrl ? `\nOpen the dashboard: ${siteUrl}/staff\n` : ''),
    });
  }

  return {
    enabled: Boolean(mailer),

    bookingCreated(a) {
      if (a.status === 'pending') {
        toPatient(a, 'We have received your booking request', 'The clinic will confirm your appointment shortly.\n\n');
      } else {
        toPatient(a, 'Your appointment is confirmed');
      }
      if (a.source === 'online') {
        toClinic(a.status === 'pending' ? 'New booking request' : 'New booking', a,
          a.status === 'pending' ? 'A patient booked online. Please confirm or decline it in the dashboard.'
            : 'A patient booked online.');
      }
    },

    appointmentUpdated(before, after) {
      if (after.status === 'cancelled' && before.status !== 'cancelled') {
        toPatient(after, 'Your appointment has been cancelled', 'Please contact the clinic if you would like to book a new time.\n\n');
      } else if (after.status === 'confirmed' && before.status === 'pending') {
        toPatient(after, 'Your appointment is confirmed');
      } else if (['pending', 'confirmed'].includes(after.status)
        && (before.date !== after.date || before.start_time !== after.start_time || before.doctor_id !== after.doctor_id)) {
        toPatient(after, 'Your appointment has been rescheduled');
      } else if (after.meeting_link && after.meeting_link !== before.meeting_link && after.status !== 'cancelled') {
        toPatient(after, 'Your video call link');
      }
    },

    cancelledByPatient(a) {
      toClinic('Booking cancelled by patient', a, 'A patient cancelled their booking online.');
    },
  };
}

module.exports = { createMailer, createNotifier };
