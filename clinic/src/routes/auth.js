'use strict';

const express = require('express');
const { verifyPassword, hashPassword, createSession, destroySession, requireAuth } = require('../auth');
const { HttpError, bad, required } = require('../util');

// Simple in-memory brute-force protection: 10 failed attempts per email+IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;

module.exports = function authRoutes(db) {
  const r = express.Router();

  r.post('/login', (req, res) => {
    const b = req.body || {};
    const emailAddr = required(b.email, 'Email', 200).toLowerCase();
    const password = required(b.password, 'Password', 200);
    const key = `${emailAddr}|${req.ip}`;
    const f = failures.get(key);
    if (f && f.count >= 10 && Date.now() - f.first < WINDOW_MS) {
      throw new HttpError(429, 'Too many failed attempts. Please try again in 15 minutes.');
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailAddr);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      const entry = f && Date.now() - f.first < WINDOW_MS ? f : { count: 0, first: Date.now() };
      entry.count++;
      failures.set(key, entry);
      throw new HttpError(401, 'Incorrect email or password.');
    }
    failures.delete(key);
    createSession(db, res, user.id);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth(), (req, res) => res.json({ user: req.user }));

  r.post('/change-password', requireAuth(), (req, res) => {
    const b = req.body || {};
    const current = required(b.current_password, 'Current password', 200);
    const next = required(b.new_password, 'New password', 200);
    if (next.length < 8) throw bad('New password must be at least 8 characters.');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current, row.password_hash)) throw bad('Current password is incorrect.');
    if (next === current) throw bad('Please choose a different password.');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hashPassword(next), req.user.id);
    res.json({ ok: true });
  });

  return r;
};
