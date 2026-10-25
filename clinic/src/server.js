'use strict';

const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { loadUser } = require('./auth');
const { HttpError } = require('./util');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(loadUser(db));

  app.use('/api/public', require('./routes/public')(db));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api', require('./routes/staff')(db));
  app.use('/api', require('./routes/admin')(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  const pub = path.join(__dirname, '..', 'public');
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
  const app = createApp(openDb(dbFile));
  app.listen(port, () => {
    console.log(`Clinic app running:`);
    console.log(`  Patient booking  → http://localhost:${port}/`);
    console.log(`  Staff dashboard  → http://localhost:${port}/staff`);
  });
}

module.exports = { createApp };
