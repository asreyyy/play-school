# Clinic Manager

An appointment booking and clinic management app for a small psychiatry practice.

- **Patient website** (`/`): patients choose a service, a doctor and a free time slot and book online, with no account needed. They get a booking reference they can use to check or cancel the booking.
- **Staff dashboard** (`/staff`): admins, doctors and receptionists manage appointments, patients, schedules and the clinic.

> **Putting it online?** Follow the step-by-step [LAUNCH_GUIDE.md](LAUNCH_GUIDE.md). It's written for non-technical readers.

## Quick start

Requires **Node.js 22.5 or newer** (it uses Node's built-in SQLite, so you don't need to install a database).

```bash
cd clinic
npm install
npm start
```

Open http://localhost:3000 for the booking site and http://localhost:3000/staff for the dashboard.

On first run (in development) the app creates these starter accounts. Each one must choose a new password on first sign-in:

| Role   | Email                                                  | Password    |
|--------|--------------------------------------------------------|-------------|
| Admin  | `admin@clinic.local`                                   | `admin123`  |
| Doctor | `doctor1@clinic.local`, `doctor2@…`, `doctor3@…`       | `doctor123` |

In production (`NODE_ENV=production`) you must set `ADMIN_PASSWORD`, and the starter doctors get random passwords: set real ones under **Doctors → Edit**. Passwords set by an admin are always temporary.

It also creates 3 placeholder doctors (Mon–Fri 10:00–13:00 and 14:00–18:00, Sat 10:00–14:00) and 3 services (Initial Consultation 60 min, Follow-up 30 min, Therapy 45 min). Rename and edit them under **Doctors**, **Working Hours** and **Services & Fees**.

## What each role can do

| Feature                                       | Admin | Receptionist | Doctor          |
|-----------------------------------------------|:-----:|:------------:|:---------------:|
| Dashboard, day view, appointments             | All   | All          | Own only        |
| Book / reschedule / confirm / cancel          | ✔     | ✔            | Own only        |
| Patients (contact details, history)           | ✔     | ✔            | Own patients    |
| Confidential session notes                    | Read  | ✖            | Write/read own  |
| Working hours & leave                         | Any doctor | ✖       | Own             |
| Payments (fee, paid/unpaid/waived)            | ✔     | ✔            | Own appts       |
| Doctors, services & fees, staff accounts      | ✔     | ✖            | ✖               |
| Reports, clinic settings                      | ✔     | ✖            | ✖               |

## Features

- **Online booking**: shows only real free slots, based on each doctor's weekly hours and leave, the service length, existing bookings, minimum notice and how far ahead booking is allowed. Bookings can arrive as *pending* for staff to confirm, or be auto-confirmed (Settings).
- **No double booking**: overlaps are blocked on the server. Staff can book outside working hours after a confirmation prompt.
- **Day view**: one column per doctor for a chosen day.
- **Patient records**: contact details, emergency contact, visit history, and private session notes linked to visits.
- **Working hours & leave**: multiple blocks per day (for lunch breaks). Adding leave warns you about appointments that clash with it.
- **Reports**: appointments, completions, no-shows, cancellations, money collected and money outstanding, broken down by doctor and by service for any date range.
- **Settings**: clinic name/contact (shown on the booking site), currency, slot interval, booking window, notice period, and switches for online booking and auto-confirm.

## Configuration (environment variables)

| Variable          | Default            | Purpose                                              |
|-------------------|--------------------|------------------------------------------------------|
| `PORT`            | `3000`             | HTTP port                                            |
| `DB_FILE`         | `data/clinic.db`   | SQLite database file                                 |
| `TZ`              | system             | Clinic timezone, e.g. `Asia/Kolkata`                 |
| `ADMIN_EMAIL`     | `admin@clinic.local` | First-run admin email                              |
| `ADMIN_PASSWORD`  | `admin123`         | First-run admin password                             |
| `NODE_ENV`        | —                  | `production` turns on secure cookies & proxy trust   |
| `COOKIE_SECURE`   | on in production   | Secure (HTTPS-only) session cookie                   |
| `TRUST_PROXY`     | on in production   | Trust `X-Forwarded-*` from a reverse proxy           |
| `BACKUP_DIR`      | `data/backups`     | Where daily automatic backups are written            |
| `BACKUP_KEEP_DAYS`| `14`               | How many daily backups to keep                       |

**Backups:** all data lives in the single `DB_FILE`. The app writes a consistent daily copy to `BACKUP_DIR`, and admins can download one any time from **Clinic Settings → Download backup**.

**Deploying:** a `Dockerfile` and a Render Blueprint (`render.yaml` in the repo root) are included. The health check is `GET /healthz`. Patient mental-health data is sensitive, so check your local data-protection rules before taking real bookings.

## Development

```bash
npm run dev   # restart on file changes
npm test      # API tests (node:test, in-memory database)
```

Project layout:

```
src/
  server.js         Express app & startup
  db.js             schema, first-run seed, settings
  auth.js           password hashing, sessions, role checks
  slots.js          working hours → free slot calculation
  appointments.js   create / update rules (conflicts, status, payments)
  backup.js         daily backups & on-demand copies (VACUUM INTO)
  routes/           public (booking), auth, staff (appointments, patients, notes), admin
public/
  index.html, js/book.js     patient booking site
  staff.html, js/staff.js    staff dashboard (single page, no build step)
  privacy.html               privacy policy template (review before launch)
test/api.test.js
```
