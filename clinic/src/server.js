'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');
const { openDb, getSettings } = require('./db');
const { loadUser, requireAuth, requirePasswordChanged } = require('./auth');
const { backupTo, scheduleDailyBackups } = require('./backup');
const { createMailer, createNotifier } = require('./notify');
const { HttpError } = require('./util');

function createApp(db, { mailer = createMailer() } = {}) {
  const notifier = createNotifier(db, mailer);
  const app = express();
  app.disable('x-powered-by');
  const production = process.env.NODE_ENV === 'production';
  app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : production);
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(loadUser(db));

  // Used by the hosting provider to check the app is up.
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  app.use('/api/public', require('./routes/public')(db, notifier));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api', requirePasswordChanged);

  // Admin: download a full copy of the database.
  app.get('/api/backup', requireAuth('admin'), (_req, res, next) => {
    const file = path.join(os.tmpdir(), `clinic-backup-${Date.now()}.db`);
    try {
      backupTo(db, file);
    } catch (err) {
      return next(err);
    }
    const name = `clinic-backup-${new Date().toISOString().slice(0, 10)}.db`;
    res.download(file, name, () => fs.rmSync(file, { force: true }));
  });

  // QR code of the booking site, for posters and visiting cards.
  app.get('/api/qr.svg', requireAuth(), async (req, res) => {
    const url = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 2, width: 512 }));
  });

  app.use('/api', require('./routes/staff')(db, notifier));
  app.use('/api', require('./routes/admin')(db, notifier));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  const pub = path.join(__dirname, '..', 'public');

  // The booking page gets the clinic's name and details filled in server-side,
  // so search engines and link previews (WhatsApp, Facebook) show them.
  const indexTemplate = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const html = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  app.get(['/', '/index.html'], (_req, res) => {
    const s = getSettings(db);
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'MedicalClinic',
      name: s.clinic_name,
      description: s.clinic_tagline,
      medicalSpecialty: 'Psychiatric',
      ...(s.clinic_phone && { telephone: s.clinic_phone }),
      ...(s.clinic_email && { email: s.clinic_email }),
      ...(s.clinic_address && { address: s.clinic_address }),
      ...(process.env.PUBLIC_URL && { url: process.env.PUBLIC_URL }),
    }).replace(/</g, '\\u003c');
    const values = { CLINIC_NAME: html(s.clinic_name), CLINIC_TAGLINE: html(s.clinic_tagline), JSON_LD: jsonLd };
    res.type('html').send(indexTemplate.replace(/\{\{(\w+)\}\}/g, (m, key) => values[key] ?? m));
  });
  app.use(express.static(pub, { extensions: ['html'] }));
  // Front-end libraries are served locally so the app works without internet access.
  const modules = path.join(__dirname, '..', 'node_modules');
  app.use('/vendor/bootstrap', express.static(path.join(modules, 'bootstrap', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/fontawesome', express.static(path.join(modules, '@fortawesome', 'fontawesome-free'), { maxAge: '7d' }));
  app.get('/staff', (_req, res) => res.sendFile(path.join(pub, 'staff.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

if (require.main === module) {
  const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'clinic.db');
  const port = Number(process.env.PORT) || 3000;
  const db = openDb(dbFile);
  const app = createApp(db);
  scheduleDailyBackups(db, process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups'),
    Number(process.env.BACKUP_KEEP_DAYS) || 14);
  app.listen(port, () => {
    console.log(`Clinic app running:`);
    console.log(`  Patient booking  → http://localhost:${port}/`);
    console.log(`  Staff dashboard  → http://localhost:${port}/staff`);
  });
}

module.exports = { createApp };
