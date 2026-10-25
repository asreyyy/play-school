# Clinic Manager

An appointment booking and clinic management app for a small psychiatry practice.

- **Patient website** (`/`): patients choose a service, a doctor and a free time slot and book online, with no account needed. They get a booking reference they can use to check or cancel the booking.
- **Staff dashboard** (`/staff`): admins, doctors and receptionists manage appointments, patients, schedules and the clinic.

## Quick start

Requires **Node.js 22.5 or newer** (it uses Node's built-in SQLite, so you don't need to install a database).

```bash
cd clinic
npm install
npm start
```

Open http://localhost:3000 for the booking site and http://localhost:3000/staff for the dashboard.

On first run the app creates these starter accounts. **Change the passwords right away** (Account → Change password):

| Role   | Email                                                  | Password    |
|--------|--------------------------------------------------------|-------------|
| Admin  | `admin@clinic.local`                                   | `admin123`  |
| Doctor | `doctor1@clinic.local`, `doctor2@…`, `doctor3@…`       | `doctor123` |

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
| `COOKIE_SECURE`   | off                | Set to `1` when serving over HTTPS                   |
| `TRUST_PROXY`     | off                | Set to `1` when behind a reverse proxy (nginx, etc.) |

**Backups:** all data lives in the single `DB_FILE`. Back it up regularly, for example with a daily copy of `data/clinic.db`.

**Going live:** run the app behind HTTPS (for example nginx or Caddy) with `COOKIE_SECURE=1` and `TRUST_PROXY=1`. Patient mental-health data is sensitive, so check your local data-protection rules before you take real bookings.

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
  routes/           public (booking), auth, staff (appointments, patients, notes), admin
public/
  index.html, js/book.js     patient booking site
  staff.html, js/staff.js    staff dashboard (single page, no build step)
test/api.test.js
```
