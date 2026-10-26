'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { localDate } = require('./slots');

/** Writes a consistent copy of the live database to `file` (safe while the app is running). */
function backupTo(db, file) {
  fs.rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
}

/**
 * Keeps one backup per day in `dir` (clinic-YYYY-MM-DD.db) and deletes those older than `keepDays`.
 * Checks hourly, so a backup is made soon after start-up and then once each day.
 */
function scheduleDailyBackups(db, dir, keepDays = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const run = () => {
    try {
      const file = path.join(dir, `clinic-${localDate()}.db`);
      if (!fs.existsSync(file)) {
        backupTo(db, file);
        console.log(`Backup saved: ${file}`);
      }
      const backups = fs.readdirSync(dir).filter((f) => /^clinic-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - keepDays))) {
        fs.rmSync(path.join(dir, old), { force: true });
      }
    } catch (err) {
      console.error('Backup failed:', err);
    }
  };
  run();
  return setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { backupTo, scheduleDailyBackups };
