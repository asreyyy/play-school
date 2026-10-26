'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];

const app = { user: null, settings: {}, doctors: [], services: [] };
const isAdmin = () => app.user?.role === 'admin';
const isDoctor = () => app.user?.role === 'doctor';
const view = () => $('#view');

// ---------------------------------------------------------------- UI helpers
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  $('#toasts').append(el);
  const t = new bootstrap.Toast(el, { delay: 3000 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}
const fail = (e) => toast(e.message, 'danger');

const modalEl = $('#modal');
const modal = new bootstrap.Modal(modalEl);
function openModal({ title, body, footer = '', size = '' }) {
  $('.modal-dialog', modalEl).className = `modal-dialog modal-dialog-scrollable ${size}`;
  $('.modal-content', modalEl).innerHTML = `
    <div class="modal-header"><h5 class="modal-title">${title}</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-footer">${footer}</div>` : ''}`;
  modal.show();
  return $('.modal-content', modalEl);
}
const closeModal = () => modal.hide();

const options = (items, selected, label = (x) => x.name, value = (x) => x.id) =>
  items.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(selected) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');

const header = (title, actions = '') => `
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
    <h1 class="h3 mb-0">${title}</h1><div class="d-flex flex-wrap gap-2">${actions}</div></div>`;

const empty = (msg) => `<div class="text-center text-muted py-5"><i class="fa-regular fa-folder-open fa-2x mb-2 d-block"></i>${esc(msg)}</div>`;

const money$ = (n) => money(n, app.settings.currency);

/** Submit handler wrapper: disables the button, shows errors inline in [data-error]. */
function onSubmit(form, handler) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('button[type=submit]', form);
    const errBox = $('[data-error]', form);
    if (errBox) errBox.innerHTML = '';
    if (btn) btn.disabled = true;
    try {
      await handler(formData(form), ev);
    } catch (e) {
      if (errBox) errBox.innerHTML = `<div class="alert alert-danger py-2">${esc(e.message)}</div>`;
      else fail(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- Auth & boot
async function boot() {
  try {
    const info = await api('GET', '/api/public/info');
    $$('[data-clinic-name]').forEach((el) => { el.textContent = info.settings.clinic_name; });
    document.title = `${info.settings.clinic_name} – Staff`;
  } catch { /* ignore */ }
  try {
    app.user = (await api('GET', '/api/auth/me')).user;
  } catch {
    return showLogin();
  }
  if (!app.user.must_change_password) await loadReference();
  showApp();
}

async function loadReference() {
  const [s, d, sv] = await Promise.all([
    api('GET', '/api/settings'), api('GET', '/api/doctors'), api('GET', '/api/services'),
  ]);
  app.settings = s.settings;
  app.doctors = d.doctors;
  app.services = sv.services;
}

function showLogin() {
  $('#app-view').classList.add('d-none');
  $('#login-view').classList.remove('d-none');
  const form = $('#login-form');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    $('#login-error').innerHTML = '';
    try {
      await api('POST', '/api/auth/login', formData(form));
      form.reset();
      await boot();
    } catch (e) {
      $('#login-error').innerHTML = `<div class="alert alert-danger py-2">${esc(e.message)}</div>`;
    }
  };
}

const NAV = [
  { route: 'dashboard', icon: 'fa-gauge', label: 'Dashboard' },
  { route: 'calendar', icon: 'fa-calendar-days', label: 'Day View' },
  { route: 'appointments', icon: 'fa-calendar-check', label: 'Appointments' },
  { route: 'patients', icon: 'fa-users', label: 'Patients' },
  { route: 'schedule', icon: 'fa-clock', label: 'Working Hours', roles: ['admin', 'doctor'] },
  { section: 'Administration', roles: ['admin'] },
  { route: 'doctors', icon: 'fa-user-doctor', label: 'Doctors', roles: ['admin'] },
  { route: 'services', icon: 'fa-notes-medical', label: 'Services & Fees', roles: ['admin'] },
  { route: 'users', icon: 'fa-user-shield', label: 'Staff Accounts', roles: ['admin'] },
  { route: 'reports', icon: 'fa-chart-column', label: 'Reports', roles: ['admin'] },
  { route: 'settings', icon: 'fa-gear', label: 'Clinic Settings', roles: ['admin'] },
];

function showApp() {
  $('#login-view').classList.add('d-none');
  $('#app-view').classList.remove('d-none');
  $('#me-name').textContent = app.user.name;
  $('#me-role').textContent = app.user.role;
  $('#nav').innerHTML = NAV.filter((n) => !n.roles || n.roles.includes(app.user.role)).map((n) => (n.section
    ? `<div class="section">${n.section}</div>`
    : `<a class="nav-link" href="#/${n.route}" data-route="${n.route}"><i class="fa-solid ${n.icon} me-2"></i>${n.label}</a>`)).join('');
  $('#logout').onclick = async (ev) => {
    ev.preventDefault();
    await api('POST', '/api/auth/logout').catch(() => {});
    app.user = null;
    showLogin();
  };
  $('#menu-toggle').onclick = () => $('#sidebar').classList.toggle('open');
  window.onhashchange = route;
  route();
}

const ROUTES = {
  dashboard: renderDashboard,
  calendar: renderCalendar,
  appointments: renderAppointments,
  patients: renderPatients,
  patient: renderPatient,
  schedule: renderSchedule,
  doctors: renderDoctors,
  services: renderServices,
  users: renderUsers,
  reports: renderReports,
  settings: renderSettings,
  account: renderAccount,
};

async function route() {
  let [name, arg] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  if (app.user.must_change_password) name = 'account';
  const fn = ROUTES[name] || renderDashboard;
  $$('#nav .nav-link').forEach((a) => a.classList.toggle('active',
    a.dataset.route === name || (name === 'patient' && a.dataset.route === 'patients')));
  $('#sidebar').classList.remove('open');
  view().innerHTML = '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
  try {
    await fn(arg);
  } catch (e) {
    if (e.status === 401) return showLogin();
    if (e.data?.code === 'password_change_required') {
      app.user.must_change_password = 1;
      return route();
    }
    view().innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}
const refresh = () => route();

// ---------------------------------------------------------------- Appointments (shared)
function appointmentRow(a, opts = {}) {
  return `<tr data-appt="${a.id}">
    ${opts.showDate !== false ? `<td class="text-nowrap">${esc(fmtDate(a.date))}</td>` : ''}
    <td class="text-nowrap">${fmtTime(a.start_time)}</td>
    ${opts.hidePatient ? '' : `<td><div class="fw-semibold">${esc(a.patient_name)}</div><div class="small text-muted">${esc(a.patient_phone)}</div></td>`}
    ${isDoctor() ? '' : `<td>${esc(a.doctor_name)}</td>`}
    <td>${esc(a.service_name)}${a.mode === 'online' ? ' <i class="fa-solid fa-video text-muted small" title="Online"></i>' : ''}</td>
    <td>${statusBadge(a.status)}</td>
    <td class="small ${a.payment_status === 'paid' ? 'text-success' : 'text-muted'}">${esc(a.payment_status)}</td>
  </tr>`;
}

function appointmentTable(list, opts = {}) {
  if (!list.length) return empty(opts.emptyMsg || 'No appointments found.');
  return `<div class="table-responsive"><table class="table table-hover mb-0">
    <thead><tr>${opts.showDate === false ? '' : '<th>Date</th>'}<th>Time</th>${opts.hidePatient ? '' : '<th>Patient</th>'}${isDoctor() ? '' : '<th>Doctor</th>'}
      <th>Service</th><th>Status</th><th>Payment</th></tr></thead>
    <tbody>${list.map((a) => appointmentRow(a, opts)).join('')}</tbody></table></div>`;
}

function bindAppointmentRows(root) {
  $$('[data-appt]', root).forEach((tr) => { tr.onclick = () => openAppointment(Number(tr.dataset.appt)); });
}

async function openAppointment(id) {
  const { appointment: a } = await api('GET', `/api/appointments/${id}`).catch((e) => { fail(e); return {}; });
  if (!a) return;
  const actions = {
    pending: [['confirmed', 'Confirm', 'brand'], ['cancelled', 'Decline', 'outline-danger']],
    confirmed: [['completed', 'Mark completed', 'success'], ['no-show', 'No-show', 'outline-warning'], ['cancelled', 'Cancel', 'outline-danger']],
    completed: [], 'no-show': [['confirmed', 'Re-open', 'outline-secondary']],
    cancelled: [['confirmed', 'Restore', 'outline-secondary']],
  }[a.status];
  const m = openModal({
    title: `Appointment <span class="text-muted small">#${esc(a.reference)}</span>`,
    size: 'modal-lg',
    body: `
      <div class="row g-3">
        <div class="col-md-7">
          <div class="mb-2">${statusBadge(a.status)} <span class="small text-muted ms-2">${a.source === 'online' ? 'Booked online' : 'Booked by staff'}</span></div>
          <h5 class="mb-1"><a href="#/patient/${a.patient_id}" data-close>${esc(a.patient_name)}</a></h5>
          <div class="small text-muted mb-3"><i class="fa-solid fa-phone me-1"></i>${esc(a.patient_phone)}
            ${a.patient_email ? ` · <i class="fa-solid fa-envelope me-1"></i>${esc(a.patient_email)}` : ''}</div>
          <dl class="row small mb-0">
            <dt class="col-4">When</dt><dd class="col-8">${esc(fmtDate(a.date))}, ${fmtTime(a.start_time)}–${fmtTime(a.end_time)}</dd>
            <dt class="col-4">Doctor</dt><dd class="col-8">${esc(a.doctor_name)}</dd>
            <dt class="col-4">Service</dt><dd class="col-8">${esc(a.service_name)} (${a.duration_min} min)</dd>
            <dt class="col-4">Mode</dt><dd class="col-8 text-capitalize">${esc(a.mode)}</dd>
            <dt class="col-4">Reason</dt><dd class="col-8">${esc(a.reason) || '<span class="text-muted">—</span>'}</dd>
          </dl>
        </div>
        <div class="col-md-5">
          <div class="bg-light rounded p-3">
            <div class="small text-muted mb-1">Fee</div>
            <div class="d-flex gap-2 mb-2">
              <input type="number" min="0" step="1" class="form-control form-control-sm" id="appt-fee" value="${a.fee}">
              <select class="form-select form-select-sm" id="appt-pay">${options(['unpaid', 'paid', 'waived'].map((x) => ({ id: x, name: x })), a.payment_status)}</select>
            </div>
            <button class="btn btn-sm btn-outline-secondary w-100" id="save-pay">Save payment</button>
          </div>
        </div>
      </div>
      <hr>
      <div class="d-flex flex-wrap gap-2 mb-3">
        ${actions.map(([s, label, cls]) => `<button class="btn btn-sm btn-${cls}" data-status="${s}">${label}</button>`).join('')}
        ${['completed', 'cancelled'].includes(a.status) ? '' : '<button class="btn btn-sm btn-outline-brand" id="resched-toggle"><i class="fa-regular fa-calendar me-1"></i>Reschedule</button>'}
        ${isDoctor() ? `<a class="btn btn-sm btn-outline-dark ms-auto" href="#/patient/${a.patient_id}" data-close><i class="fa-solid fa-file-medical me-1"></i>Session notes</a>` : ''}
      </div>
      <form id="resched" class="d-none border rounded p-3">
        <div class="row g-2">
          ${isDoctor() ? '' : `<div class="col-md-4"><label class="form-label small">Doctor</label>
            <select name="doctor_id" class="form-select form-select-sm">${options(app.doctors.filter((d) => d.active || d.id === a.doctor_id), a.doctor_id)}</select></div>`}
          <div class="col-md-4"><label class="form-label small">Service</label>
            <select name="service_id" class="form-select form-select-sm">${options(app.services.filter((s) => s.active || s.id === a.service_id), a.service_id)}</select></div>
          <div class="col-md-4"><label class="form-label small">Date</label>
            <input name="date" type="date" class="form-control form-control-sm" value="${a.date}" required></div>
        </div>
        <div class="mt-2 small text-muted">Free times:</div>
        <div id="resched-slots" class="d-flex flex-wrap gap-1 my-2"></div>
        <div class="row g-2 align-items-end">
          <div class="col-auto"><label class="form-label small">Or enter time</label>
            <input name="time" type="time" class="form-control form-control-sm" value="${a.start_time}" required></div>
          <div class="col-auto"><button class="btn btn-sm btn-brand" type="submit">Save new time</button></div>
        </div>
        <div data-error class="mt-2"></div>
      </form>`,
  });

  $$('[data-close]', m).forEach((el) => el.addEventListener('click', closeModal));
  const after = (msg) => { closeModal(); toast(msg); refresh(); };

  $$('[data-status]', m).forEach((b) => {
    b.onclick = async () => {
      try {
        await api('PATCH', `/api/appointments/${a.id}`, { status: b.dataset.status });
        after(`Marked as ${b.dataset.status}.`);
      } catch (e) { fail(e); }
    };
  });
  $('#save-pay', m).onclick = async () => {
    try {
      await api('PATCH', `/api/appointments/${a.id}`, { fee: $('#appt-fee', m).value, payment_status: $('#appt-pay', m).value });
      after('Payment updated.');
    } catch (e) { fail(e); }
  };

  const form = $('#resched', m);
  const toggle = $('#resched-toggle', m);
  if (toggle) {
    toggle.onclick = () => { form.classList.toggle('d-none'); loadFreeSlots(); };
  }
  async function loadFreeSlots() {
    const f = formData(form);
    const doctorId = f.doctor_id || a.doctor_id;
    const box = $('#resched-slots', form);
    if (!f.date) { box.innerHTML = ''; return; }
    try {
      const { slots } = await api('GET', `/api/slots?doctor_id=${doctorId}&service_id=${f.service_id}&date=${f.date}&exclude_id=${a.id}`);
      box.innerHTML = slots.map((t) => `<button type="button" class="btn btn-sm btn-outline-brand" data-t="${t}">${fmtTime(t)}</button>`).join('')
        || '<span class="small text-muted">No free slots in working hours on this date.</span>';
      $$('[data-t]', box).forEach((b) => { b.onclick = () => { form.time.value = b.dataset.t; }; });
    } catch (e) { box.innerHTML = `<span class="small text-danger">${esc(e.message)}</span>`; }
  }
  $$('select, input[type=date]', form).forEach((el) => el.addEventListener('change', loadFreeSlots));
  onSubmit(form, async (f) => {
    const body = { ...f, doctor_id: f.doctor_id || a.doctor_id };
    try {
      await api('PATCH', `/api/appointments/${a.id}`, body);
    } catch (e) {
      if (e.data?.code !== 'outside_hours' || !confirm(`${e.message}\n\nSave anyway?`)) throw e;
      await api('PATCH', `/api/appointments/${a.id}`, { ...body, force: true });
    }
    after('Appointment rescheduled.');
  });
}

/** New appointment modal. preset: { patient, doctor_id, date, time } */
function newAppointment(preset = {}) {
  const doctors = app.doctors.filter((d) => d.active);
  const doctorId = isDoctor() ? app.user.doctor_id : preset.doctor_id || doctors[0]?.id;
  const m = openModal({
    title: 'New appointment',
    size: 'modal-lg',
    body: `<form id="new-appt">
      <div class="mb-3">
        <label class="form-label">Patient</label>
        ${preset.patient
          ? `<div class="form-control bg-light">${esc(preset.patient.name)} · ${esc(preset.patient.phone)}</div>`
          : `<div class="input-group mb-2"><span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
               <input class="form-control" id="pt-search" placeholder="Search existing patient by name or phone"></div>
             <div id="pt-results" class="list-group mb-2"></div>
             <div id="pt-chosen"></div>
             <div class="row g-2" id="pt-new">
               <div class="col-12 small text-muted">…or enter a new patient:</div>
               <div class="col-md-4"><input name="p_name" class="form-control" placeholder="Full name"></div>
               <div class="col-md-4"><input name="p_phone" class="form-control" placeholder="Phone"></div>
               <div class="col-md-4"><input name="p_email" class="form-control" placeholder="Email (optional)"></div>
             </div>`}
        <input type="hidden" name="patient_id" value="${preset.patient ? preset.patient.id : ''}">
      </div>
      <div class="row g-3">
        ${isDoctor() ? '' : `<div class="col-md-4"><label class="form-label">Doctor</label>
          <select name="doctor_id" class="form-select">${options(doctors, doctorId)}</select></div>`}
        <div class="col-md-4"><label class="form-label">Service</label>
          <select name="service_id" class="form-select">${options(app.services.filter((s) => s.active), app.services[0]?.id,
            (s) => `${s.name} (${s.duration_min} min)`)}</select></div>
        <div class="col-md-4"><label class="form-label">Date</label>
          <input name="date" type="date" class="form-control" value="${preset.date || localDate()}" required></div>
      </div>
      <div class="small text-muted mt-3">Free times:</div>
      <div id="new-slots" class="d-flex flex-wrap gap-1 my-2"></div>
      <div class="row g-3">
        <div class="col-md-3"><label class="form-label">Time</label><input name="time" type="time" class="form-control" value="${preset.time || ''}" required></div>
        <div class="col-md-3"><label class="form-label">Mode</label>
          <select name="mode" class="form-select"><option value="in-person">In person</option><option value="online">Online</option></select></div>
        <div class="col-md-6"><label class="form-label">Reason / notes</label><input name="reason" class="form-control" maxlength="1000"></div>
      </div>
      <div data-error class="mt-3"></div>
      <div class="text-end mt-3"><button class="btn btn-brand" type="submit">Book appointment</button></div>
    </form>`,
  });
  const form = $('#new-appt', m);

  const search = $('#pt-search', m);
  if (search) {
    let timer;
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = search.value.trim();
        const box = $('#pt-results', m);
        if (q.length < 2) { box.innerHTML = ''; return; }
        const { patients } = await api('GET', `/api/patients?q=${encodeURIComponent(q)}`);
        box.innerHTML = patients.slice(0, 6).map((p) => `<button type="button" class="list-group-item list-group-item-action" data-pid="${p.id}"
          data-label="${esc(p.name)} · ${esc(p.phone)}">${esc(p.name)} <span class="text-muted small">${esc(p.phone)}</span></button>`).join('')
          || '<div class="small text-muted">No match — fill in the new patient fields below.</div>';
        $$('[data-pid]', box).forEach((b) => {
          b.onclick = () => {
            form.patient_id.value = b.dataset.pid;
            box.innerHTML = '';
            search.value = '';
            $('#pt-new', m).classList.add('d-none');
            $('#pt-chosen', m).innerHTML = `<div class="alert alert-success py-2 d-flex justify-content-between">${esc(b.dataset.label)}
              <a href="#" id="pt-clear">change</a></div>`;
            $('#pt-clear', m).onclick = (ev) => {
              ev.preventDefault();
              form.patient_id.value = '';
              $('#pt-chosen', m).innerHTML = '';
              $('#pt-new', m).classList.remove('d-none');
            };
          };
        });
      }, 250);
    };
  }

  async function loadSlots() {
    const f = formData(form);
    const box = $('#new-slots', m);
    try {
      const { slots } = await api('GET', `/api/slots?doctor_id=${f.doctor_id || doctorId}&service_id=${f.service_id}&date=${f.date}`);
      box.innerHTML = slots.map((t) => `<button type="button" class="btn btn-sm btn-outline-brand" data-t="${t}">${fmtTime(t)}</button>`).join('')
        || '<span class="small text-muted">No free slots in working hours on this date.</span>';
      $$('[data-t]', box).forEach((b) => {
        b.onclick = () => {
          form.time.value = b.dataset.t;
          $$('[data-t]', box).forEach((x) => x.classList.replace('btn-brand', 'btn-outline-brand'));
          b.classList.replace('btn-outline-brand', 'btn-brand');
        };
      });
    } catch (e) { box.innerHTML = `<span class="small text-danger">${esc(e.message)}</span>`; }
  }
  $$('select[name=doctor_id], select[name=service_id], input[name=date]', form).forEach((el) => el.addEventListener('change', loadSlots));
  loadSlots();

  onSubmit(form, async (f) => {
    const body = {
      doctor_id: f.doctor_id || doctorId, service_id: f.service_id, date: f.date, time: f.time, mode: f.mode, reason: f.reason,
    };
    if (f.patient_id) body.patient_id = f.patient_id;
    else body.patient = { name: f.p_name, phone: f.p_phone, email: f.p_email };
    try {
      await api('POST', '/api/appointments', body);
    } catch (e) {
      if (e.data?.code !== 'outside_hours' || !confirm(`${e.message}\n\nBook anyway?`)) throw e;
      await api('POST', '/api/appointments', { ...body, force: true });
    }
    closeModal();
    toast('Appointment booked.');
    refresh();
  });
}

// ---------------------------------------------------------------- Dashboard
function greeting() {
  const h = new Date().getHours();
  return `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}`;
}

async function renderDashboard() {
  const d = await api('GET', '/api/dashboard');
  const active = d.todays.filter((a) => a.status !== 'cancelled');
  const stats = [
    ['Today', active.length, 'fa-calendar-day'],
    ['Awaiting confirmation', d.pending.length, 'fa-hourglass-half'],
    ['Next 7 days', d.upcomingCount, 'fa-calendar-week'],
  ];
  if (d.month) {
    stats.push(['Revenue this month', money$(d.month.revenue), 'fa-wallet']);
  }
  view().innerHTML = `
    ${header(`${greeting()}, ${esc(app.user.name)}`,
      '<button class="btn btn-brand" id="new-appt-btn"><i class="fa-solid fa-plus me-1"></i>New appointment</button>')}
    <div class="row g-3 mb-4">${stats.map(([label, value, icon]) => `
      <div class="col-6 col-xl-3"><div class="card stat h-100">
        <div class="d-flex justify-content-between"><div><div class="value">${esc(value)}</div><div class="label">${label}</div></div>
        <i class="fa-solid ${icon} fa-lg text-brand opacity-50"></i></div></div></div>`).join('')}</div>
    <div class="row g-4">
      <div class="col-xl-7">
        <div class="card p-3 h-100">
          <h2 class="h5 mb-3">Today · ${esc(fmtDate(d.today, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
          ${d.todays.length ? `<div class="list-group list-group-flush">${d.todays.map((a) => `
            <a href="#" class="list-group-item list-group-item-action d-flex align-items-center gap-3 px-1" data-appt="${a.id}">
              <span class="timeline-time">${fmtTime(a.start_time)}</span>
              <span class="flex-grow-1"><span class="fw-semibold">${esc(a.patient_name)}</span>
                <span class="small text-muted d-block">${esc(a.service_name)}${isDoctor() ? '' : ` · ${esc(a.doctor_name)}`}${a.mode === 'online' ? ' · online' : ''}</span></span>
              ${statusBadge(a.status)}</a>`).join('')}</div>` : empty('No appointments today.')}
        </div>
      </div>
      <div class="col-xl-5">
        <div class="card p-3 h-100">
          <h2 class="h5 mb-3">Awaiting confirmation</h2>
          ${d.pending.length ? d.pending.map((a) => `
            <div class="border rounded p-2 mb-2 d-flex align-items-center gap-2">
              <div class="flex-grow-1" role="button" data-appt="${a.id}">
                <div class="fw-semibold">${esc(a.patient_name)}</div>
                <div class="small text-muted">${esc(fmtDate(a.date))} ${fmtTime(a.start_time)} · ${esc(a.doctor_name)}</div>
              </div>
              <button class="btn btn-sm btn-brand" data-confirm="${a.id}" title="Confirm"><i class="fa-solid fa-check"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-decline="${a.id}" title="Decline"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('') : empty('Nothing waiting. 🎉')}
        </div>
      </div>
    </div>
    ${d.month ? `<div class="row g-3 mt-1">
      ${[['This month so far', d.month.total], ['Completed', d.month.completed || 0], ['No-shows', d.month.no_show || 0], ['Total patients', d.patientCount]]
        .map(([l, v]) => `<div class="col-6 col-xl-3"><div class="card stat"><div class="value h4 mb-0">${esc(v)}</div><div class="label">${l}</div></div></div>`).join('')}
    </div>` : ''}`;

  $('#new-appt-btn').onclick = () => newAppointment();
  $$('[data-appt]').forEach((el) => {
    el.onclick = (ev) => { ev.preventDefault(); openAppointment(Number(el.dataset.appt)); };
  });
  const setStatus = async (id, status) => {
    try {
      await api('PATCH', `/api/appointments/${id}`, { status });
      toast(status === 'confirmed' ? 'Appointment confirmed.' : 'Appointment declined.');
      refresh();
    } catch (e) { fail(e); }
  };
  $$('[data-confirm]').forEach((b) => { b.onclick = () => setStatus(b.dataset.confirm, 'confirmed'); });
  $$('[data-decline]').forEach((b) => {
    b.onclick = () => { if (confirm('Decline this booking request?')) setStatus(b.dataset.decline, 'cancelled'); };
  });
}

// ---------------------------------------------------------------- Day view
let calendarDate = localDate();
async function renderCalendar() {
  const doctors = isDoctor() ? app.doctors.filter((d) => d.id === app.user.doctor_id) : app.doctors.filter((d) => d.active);
  const { appointments } = await api('GET', `/api/appointments?from=${calendarDate}&to=${calendarDate}`);
  const nav = `
    <div class="btn-group"><button class="btn btn-outline-secondary" data-shift="-1"><i class="fa-solid fa-chevron-left"></i></button>
      <button class="btn btn-outline-secondary" data-shift="0">Today</button>
      <button class="btn btn-outline-secondary" data-shift="1"><i class="fa-solid fa-chevron-right"></i></button></div>
    <input type="date" class="form-control" style="width:auto" id="cal-date" value="${calendarDate}">
    <button class="btn btn-brand" id="new-appt-btn"><i class="fa-solid fa-plus me-1"></i>New</button>`;
  view().innerHTML = `${header(esc(fmtDate(calendarDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), nav)}
    <div class="row g-3">${doctors.map((doc) => {
      const list = appointments.filter((a) => a.doctor_id === doc.id);
      return `<div class="col-lg-${Math.max(4, 12 / Math.max(doctors.length, 1))}">
        <div class="card p-3 h-100">
          <div class="d-flex align-items-center gap-2 mb-3"><span class="doctor-avatar" style="width:36px;height:36px;font-size:.9rem">${esc(initials(doc.name))}</span>
            <div class="fw-semibold">${esc(doc.name)}</div><span class="ms-auto small text-muted">${list.filter((a) => a.status !== 'cancelled').length} appts</span></div>
          ${list.length ? list.map((a) => `
            <div class="border rounded p-2 mb-2 ${a.status === 'cancelled' ? 'opacity-50' : ''}" role="button" data-appt="${a.id}">
              <div class="d-flex justify-content-between"><strong class="small">${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}</strong>${statusBadge(a.status)}</div>
              <div>${esc(a.patient_name)}</div><div class="small text-muted">${esc(a.service_name)}${a.mode === 'online' ? ' · online' : ''}</div>
            </div>`).join('') : '<div class="text-muted small">No appointments.</div>'}
          <button class="btn btn-sm btn-outline-brand mt-2" data-new-for="${doc.id}"><i class="fa-solid fa-plus me-1"></i>Add</button>
        </div></div>`;
    }).join('')}</div>`;

  $$('[data-shift]').forEach((b) => {
    b.onclick = () => {
      calendarDate = b.dataset.shift === '0' ? localDate() : addDays(calendarDate, Number(b.dataset.shift));
      renderCalendar().catch(fail);
    };
  });
  $('#cal-date').onchange = (ev) => { if (ev.target.value) { calendarDate = ev.target.value; renderCalendar().catch(fail); } };
  $('#new-appt-btn').onclick = () => newAppointment({ date: calendarDate });
  $$('[data-new-for]').forEach((b) => { b.onclick = () => newAppointment({ date: calendarDate, doctor_id: Number(b.dataset.newFor) }); });
  bindAppointmentRows(view());
}

// ---------------------------------------------------------------- Appointment list
const apptFilters = { range: 'upcoming', doctor_id: '', status: '', q: '', from: '', to: '' };
async function renderAppointments() {
  const today = localDate();
  const ranges = {
    today: [today, today, 'asc'],
    upcoming: [today, '', 'asc'],
    week: [today, addDays(today, 6), 'asc'],
    past: ['', addDays(today, -1), 'desc'],
    all: ['', '', 'desc'],
    custom: [apptFilters.from, apptFilters.to, 'asc'],
  };
  const [from, to, order] = ranges[apptFilters.range];
  const qs = new URLSearchParams({ order });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  for (const k of ['doctor_id', 'status', 'q']) if (apptFilters[k]) qs.set(k, apptFilters[k]);
  const { appointments } = await api('GET', `/api/appointments?${qs}`);

  view().innerHTML = `${header('Appointments', '<button class="btn btn-brand" id="new-appt-btn"><i class="fa-solid fa-plus me-1"></i>New appointment</button>')}
    <div class="card p-3 mb-3">
      <form class="row g-2 align-items-end" id="filters">
        <div class="col-md-2"><label class="form-label small">Period</label>
          <select name="range" class="form-select form-select-sm">${options(
            [['today', 'Today'], ['week', 'Next 7 days'], ['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All'], ['custom', 'Custom…']]
              .map(([id, name]) => ({ id, name })), apptFilters.range)}</select></div>
        <div class="col-md-2 ${apptFilters.range === 'custom' ? '' : 'd-none'}"><label class="form-label small">From</label>
          <input name="from" type="date" class="form-control form-control-sm" value="${esc(apptFilters.from)}"></div>
        <div class="col-md-2 ${apptFilters.range === 'custom' ? '' : 'd-none'}"><label class="form-label small">To</label>
          <input name="to" type="date" class="form-control form-control-sm" value="${esc(apptFilters.to)}"></div>
        ${isDoctor() ? '' : `<div class="col-md-2"><label class="form-label small">Doctor</label>
          <select name="doctor_id" class="form-select form-select-sm"><option value="">All doctors</option>${options(app.doctors, apptFilters.doctor_id)}</select></div>`}
        <div class="col-md-2"><label class="form-label small">Status</label>
          <select name="status" class="form-select form-select-sm"><option value="">Any status</option>${options(STATUSES.map((s) => ({ id: s, name: s })), apptFilters.status)}</select></div>
        <div class="col-md"><label class="form-label small">Search</label>
          <input name="q" class="form-control form-control-sm" placeholder="Patient name, phone or reference" value="${esc(apptFilters.q)}"></div>
      </form>
    </div>
    <div class="card p-2">${appointmentTable(appointments)}</div>
    <div class="small text-muted mt-2">${appointments.length} appointment(s)</div>`;

  const form = $('#filters');
  const apply = () => { Object.assign(apptFilters, formData(form)); renderAppointments().catch(fail); };
  $$('select, input[type=date]', form).forEach((el) => el.addEventListener('change', apply));
  let timer;
  form.q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 350); });
  form.onsubmit = (ev) => { ev.preventDefault(); apply(); };
  if (apptFilters.q) { form.q.focus(); form.q.setSelectionRange(form.q.value.length, form.q.value.length); }
  $('#new-appt-btn').onclick = () => newAppointment();
  bindAppointmentRows(view());
}

// ---------------------------------------------------------------- Patients
let patientQuery = '';
async function renderPatients() {
  const { patients } = await api('GET', `/api/patients?q=${encodeURIComponent(patientQuery)}`);
  view().innerHTML = `${header('Patients', '<button class="btn btn-brand" id="new-pt"><i class="fa-solid fa-user-plus me-1"></i>New patient</button>')}
    <div class="card p-3 mb-3"><input class="form-control" id="pt-q" placeholder="Search by name, phone or email" value="${esc(patientQuery)}"></div>
    <div class="card p-2">${patients.length ? `<div class="table-responsive"><table class="table table-hover mb-0">
      <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Visits</th><th>Last visit</th><th>Next visit</th></tr></thead>
      <tbody>${patients.map((p) => `<tr data-pid="${p.id}">
        <td class="fw-semibold">${esc(p.name)}</td><td>${esc(p.phone)}</td><td>${esc(p.email)}</td><td>${p.visit_count}</td>
        <td>${esc(fmtDate(p.last_visit)) || '—'}</td><td>${esc(fmtDate(p.next_visit)) || '—'}</td></tr>`).join('')}</tbody></table></div>`
      : empty(patientQuery ? 'No patients match your search.' : 'No patients yet.')}</div>`;
  const q = $('#pt-q');
  let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { patientQuery = q.value.trim(); renderPatients().catch(fail); }, 350); };
  if (patientQuery) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  $$('[data-pid]').forEach((tr) => { tr.onclick = () => { location.hash = `#/patient/${tr.dataset.pid}`; }; });
  $('#new-pt').onclick = () => patientForm();
}

function patientForm(p = {}) {
  const m = openModal({
    title: p.id ? 'Edit patient' : 'New patient',
    size: 'modal-lg',
    body: `<form id="pt-form" class="row g-3">
      <div class="col-md-6"><label class="form-label">Full name *</label><input name="name" class="form-control" required value="${esc(p.name)}"></div>
      <div class="col-md-6"><label class="form-label">Phone *</label><input name="phone" class="form-control" required value="${esc(p.phone)}"></div>
      <div class="col-md-6"><label class="form-label">Email</label><input name="email" type="email" class="form-control" value="${esc(p.email)}"></div>
      <div class="col-md-3"><label class="form-label">Date of birth</label><input name="dob" type="date" class="form-control" value="${esc(p.dob)}"></div>
      <div class="col-md-3"><label class="form-label">Gender</label><select name="gender" class="form-select">
        ${options(['', 'Female', 'Male', 'Other', 'Prefer not to say'].map((g) => ({ id: g, name: g || '—' })), p.gender)}</select></div>
      <div class="col-md-6"><label class="form-label">Address</label><input name="address" class="form-control" value="${esc(p.address)}"></div>
      <div class="col-md-6"><label class="form-label">Emergency contact</label><input name="emergency_contact" class="form-control" placeholder="Name & phone" value="${esc(p.emergency_contact)}"></div>
      <div class="col-12"><label class="form-label">Admin notes <span class="small text-muted">(non-clinical, visible to all staff)</span></label>
        <textarea name="notes" class="form-control" rows="2">${esc(p.notes)}</textarea></div>
      <div class="col-12" data-error></div>
      <div class="col-12 text-end"><button class="btn btn-brand" type="submit">Save</button></div>
    </form>`,
  });
  onSubmit($('#pt-form', m), async (f) => {
    const r = p.id ? await api('PATCH', `/api/patients/${p.id}`, f) : await api('POST', '/api/patients', f);
    closeModal();
    toast('Patient saved.');
    if (p.id) refresh(); else location.hash = `#/patient/${r.patient.id}`;
  });
}

async function renderPatient(id) {
  const { patient: p, appointments } = await api('GET', `/api/patients/${id}`);
  const canNotes = isAdmin() || isDoctor();
  const notes = canNotes ? (await api('GET', `/api/patients/${id}/notes`)).notes : [];
  const age = p.dob ? Math.floor((Date.now() - new Date(`${p.dob}T00:00:00`)) / 3.15576e10) : null;
  const myAppts = appointments.filter((a) => !isDoctor() || a.doctor_id === app.user.doctor_id);

  view().innerHTML = `
    <a href="#/patients" class="small text-secondary"><i class="fa-solid fa-arrow-left me-1"></i>All patients</a>
    ${header(esc(p.name), `<button class="btn btn-outline-secondary" id="edit-pt"><i class="fa-solid fa-pen me-1"></i>Edit</button>
      <button class="btn btn-brand" id="book-pt"><i class="fa-solid fa-plus me-1"></i>Book appointment</button>`)}
    <div class="row g-4">
      <div class="col-lg-4">
        <div class="card p-3 mb-4">
          <dl class="row small mb-0">
            <dt class="col-5">Phone</dt><dd class="col-7"><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></dd>
            <dt class="col-5">Email</dt><dd class="col-7 text-break">${esc(p.email) || '—'}</dd>
            <dt class="col-5">Date of birth</dt><dd class="col-7">${p.dob ? `${esc(fmtDate(p.dob))} (${age})` : '—'}</dd>
            <dt class="col-5">Gender</dt><dd class="col-7">${esc(p.gender) || '—'}</dd>
            <dt class="col-5">Address</dt><dd class="col-7">${esc(p.address) || '—'}</dd>
            <dt class="col-5">Emergency</dt><dd class="col-7">${esc(p.emergency_contact) || '—'}</dd>
            <dt class="col-5">Registered</dt><dd class="col-7">${esc(fmtDate(p.created_at.slice(0, 10)))}</dd>
          </dl>
          ${p.notes ? `<div class="alert alert-light small mt-3 mb-0">${esc(p.notes)}</div>` : ''}
          ${isAdmin() && !appointments.length ? '<button class="btn btn-sm btn-outline-danger mt-3" id="del-pt">Delete patient</button>' : ''}
        </div>
      </div>
      <div class="col-lg-8">
        <div class="card p-3 mb-4"><h2 class="h5 mb-3">Appointments</h2>
          ${appointmentTable(appointments, { emptyMsg: 'No appointments yet.', hidePatient: true })}</div>
        ${canNotes ? `<div class="card p-3">
          <div class="d-flex align-items-center mb-3"><h2 class="h5 mb-0"><i class="fa-solid fa-lock me-2 text-muted small"></i>Session notes</h2>
            <span class="small text-muted ms-2">Confidential${isDoctor() ? ' — only you and the admin can read your notes' : ''}</span></div>
          ${isDoctor() ? `<form id="note-form" class="mb-3">
            <select name="appointment_id" class="form-select form-select-sm mb-2"><option value="">General note (not linked to a visit)</option>
              ${options(myAppts, myAppts.find((a) => a.date <= localDate() && a.status !== 'cancelled')?.id, (a) => `${fmtDate(a.date)} ${fmtTime(a.start_time)} – ${a.service_name}`)}</select>
            <textarea name="content" class="form-control mb-2" rows="4" placeholder="Presenting complaints, mental status exam, assessment, plan, medication…" required></textarea>
            <div data-error></div>
            <button class="btn btn-sm btn-brand" type="submit">Save note</button></form>` : ''}
          ${notes.length ? notes.map((n) => `<div class="border rounded p-3 mb-2" data-note="${n.id}">
            <div class="small text-muted mb-2 d-flex">
              <span>${esc(n.doctor_name)} · ${esc(new Date(`${n.created_at.replace(' ', 'T')}Z`).toLocaleString())}
              ${n.appointment_date ? ` · visit ${esc(fmtDate(n.appointment_date))}` : ''}${n.updated_at !== n.created_at ? ' · edited' : ''}</span>
              ${isDoctor() && n.doctor_id === app.user.doctor_id ? `<span class="ms-auto">
                <a href="#" data-edit-note class="me-2">Edit</a><a href="#" data-del-note class="text-danger">Delete</a></span>` : ''}
            </div>
            <div class="note-card">${esc(n.content)}</div></div>`).join('') : '<div class="text-muted small">No notes yet.</div>'}
        </div>` : ''}
      </div>
    </div>`;

  $('#edit-pt').onclick = () => patientForm(p);
  $('#book-pt').onclick = () => newAppointment({ patient: p });
  bindAppointmentRows(view());
  const del = $('#del-pt');
  if (del) {
    del.onclick = async () => {
      if (!confirm('Delete this patient permanently?')) return;
      try { await api('DELETE', `/api/patients/${p.id}`); toast('Patient deleted.'); location.hash = '#/patients'; } catch (e) { fail(e); }
    };
  }
  const noteForm = $('#note-form');
  if (noteForm) {
    onSubmit(noteForm, async (f) => {
      await api('POST', `/api/patients/${p.id}/notes`, { content: f.content, appointment_id: f.appointment_id || null });
      toast('Note saved.');
      refresh();
    });
  }
  $$('[data-note]').forEach((card) => {
    const noteId = card.dataset.note;
    const edit = $('[data-edit-note]', card);
    if (!edit) return;
    edit.onclick = (ev) => {
      ev.preventDefault();
      const body = $('.note-card', card);
      body.outerHTML = `<form class="note-edit"><textarea class="form-control mb-2" rows="5" name="content">${esc(body.textContent)}</textarea>
        <div data-error></div><button class="btn btn-sm btn-brand" type="submit">Save</button>
        <button class="btn btn-sm btn-link" type="button" data-cancel>Cancel</button></form>`;
      const f = $('.note-edit', card);
      $('[data-cancel]', f).onclick = refresh;
      onSubmit(f, async (data) => { await api('PATCH', `/api/notes/${noteId}`, data); toast('Note updated.'); refresh(); });
    };
    $('[data-del-note]', card).onclick = async (ev) => {
      ev.preventDefault();
      if (!confirm('Delete this note? This cannot be undone.')) return;
      try { await api('DELETE', `/api/notes/${noteId}`); toast('Note deleted.'); refresh(); } catch (e) { fail(e); }
    };
  });
}

// ---------------------------------------------------------------- Working hours & leave
let scheduleDoctorId = null;
async function renderSchedule() {
  const doctors = isDoctor() ? app.doctors.filter((d) => d.id === app.user.doctor_id) : app.doctors;
  if (!doctors.length) { view().innerHTML = empty('No doctors yet.'); return; }
  if (!doctors.some((d) => d.id === scheduleDoctorId)) scheduleDoctorId = doctors[0].id;
  const s = await api('GET', `/api/doctors/${scheduleDoctorId}/schedule`);

  const blocksFor = (wd) => s.availability.filter((b) => b.weekday === wd);
  const blockRow = (b = {}) => `<div class="d-flex gap-2 align-items-center mb-2" data-block>
      <input type="time" class="form-control form-control-sm" style="max-width:130px" data-start value="${b.start_time || '10:00'}">
      <span class="text-muted">to</span>
      <input type="time" class="form-control form-control-sm" style="max-width:130px" data-end value="${b.end_time || '13:00'}">
      <button type="button" class="btn btn-sm btn-link text-danger" data-remove title="Remove"><i class="fa-solid fa-trash"></i></button></div>`;

  view().innerHTML = `${header('Working Hours & Leave', isDoctor() ? '' : `<select class="form-select" id="sched-doc">${options(doctors, scheduleDoctorId)}</select>`)}
    <div class="row g-4">
      <div class="col-xl-7"><div class="card p-3">
        <h2 class="h5">Weekly hours</h2>
        <p class="small text-muted">Patients can only book online inside these hours. Add a second block for a lunch break.</p>
        <form id="hours-form">
          ${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<div class="row border-bottom py-2" data-day="${wd}">
            <div class="col-sm-3 fw-semibold pt-1">${WEEKDAYS[wd]}</div>
            <div class="col-sm-9"><div data-blocks>${blocksFor(wd).map(blockRow).join('')}</div>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-add><i class="fa-solid fa-plus me-1"></i>Add hours</button>
              ${blocksFor(wd).length ? '' : '<span class="small text-muted ms-2" data-off>Day off</span>'}</div></div>`).join('')}
          <div data-error class="mt-3"></div>
          <button class="btn btn-brand mt-3" type="submit">Save weekly hours</button>
        </form>
      </div></div>
      <div class="col-xl-5"><div class="card p-3">
        <h2 class="h5">Leave / days off</h2>
        <p class="small text-muted">No online bookings will be offered on these dates.</p>
        <form id="leave-form" class="row g-2 mb-3">
          <div class="col-6"><label class="form-label small">From</label><input name="start_date" type="date" class="form-control form-control-sm" required min="${localDate()}"></div>
          <div class="col-6"><label class="form-label small">To</label><input name="end_date" type="date" class="form-control form-control-sm" required min="${localDate()}"></div>
          <div class="col-12"><input name="reason" class="form-control form-control-sm" placeholder="Reason (optional)"></div>
          <div class="col-12" data-error></div>
          <div class="col-12"><button class="btn btn-sm btn-brand" type="submit">Add leave</button></div>
        </form>
        ${s.time_off.length ? `<ul class="list-group">${s.time_off.map((t) => `<li class="list-group-item d-flex align-items-center">
          <div><div>${esc(fmtDate(t.start_date))}${t.end_date !== t.start_date ? ` → ${esc(fmtDate(t.end_date))}` : ''}</div>
          <div class="small text-muted">${esc(t.reason)}</div></div>
          <button class="btn btn-sm btn-link text-danger ms-auto" data-del-leave="${t.id}"><i class="fa-solid fa-trash"></i></button></li>`).join('')}</ul>`
          : '<div class="small text-muted">No upcoming leave.</div>'}
      </div></div>
    </div>`;

  const sel = $('#sched-doc');
  if (sel) sel.onchange = () => { scheduleDoctorId = Number(sel.value); renderSchedule().catch(fail); };

  const hours = $('#hours-form');
  hours.addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-add]');
    const rm = ev.target.closest('[data-remove]');
    if (add) {
      const day = add.closest('[data-day]');
      const blocks = $('[data-blocks]', day);
      const last = $$('[data-end]', blocks).pop();
      blocks.insertAdjacentHTML('beforeend', blockRow(last ? { start_time: '14:00', end_time: '18:00' } : {}));
      $('[data-off]', day)?.remove();
    }
    if (rm) rm.closest('[data-block]').remove();
  });
  onSubmit(hours, async () => {
    const availability = $$('[data-day]', hours).flatMap((day) => $$('[data-block]', day).map((b) => ({
      weekday: Number(day.dataset.day), start_time: $('[data-start]', b).value, end_time: $('[data-end]', b).value,
    })));
    await api('PUT', `/api/doctors/${scheduleDoctorId}/availability`, { availability });
    toast('Working hours saved.');
    refresh();
  });

  onSubmit($('#leave-form'), async (f) => {
    const r = await api('POST', `/api/doctors/${scheduleDoctorId}/time-off`, f);
    toast('Leave added.');
    if (r.clashing_appointments) {
      alert(`Note: there are ${r.clashing_appointments} existing appointment(s) during this leave. Please reschedule or cancel them from Appointments.`);
    }
    refresh();
  });
  $$('[data-del-leave]').forEach((b) => {
    b.onclick = async () => {
      try { await api('DELETE', `/api/time-off/${b.dataset.delLeave}`); toast('Leave removed.'); refresh(); } catch (e) { fail(e); }
    };
  });
}

// ---------------------------------------------------------------- Admin: doctors
async function renderDoctors() {
  await loadReference();
  view().innerHTML = `${header('Doctors', '<button class="btn btn-brand" id="add-doc"><i class="fa-solid fa-plus me-1"></i>Add doctor</button>')}
    <div class="row g-3">${app.doctors.map((d) => `<div class="col-md-6 col-xl-4"><div class="card p-3 h-100 ${d.active ? '' : 'opacity-50'}">
      <div class="d-flex align-items-center gap-3 mb-2"><span class="doctor-avatar">${esc(initials(d.name))}</span>
        <div><div class="fw-semibold">${esc(d.name)}</div><div class="small text-muted">${esc(d.title)}</div></div>
        ${d.active ? '' : '<span class="badge text-bg-secondary ms-auto">Inactive</span>'}</div>
      <div class="small mb-1">${esc(d.qualifications)}</div>
      <div class="small text-muted mb-3"><i class="fa-solid fa-envelope me-1"></i>${esc(d.email || 'no login')}</div>
      <div class="mt-auto d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" data-edit="${d.id}">Edit</button>
        <a class="btn btn-sm btn-outline-secondary" href="#/schedule" data-sched="${d.id}">Hours & leave</a>
      </div></div></div>`).join('')}</div>`;
  $('#add-doc').onclick = () => doctorForm();
  $$('[data-edit]').forEach((b) => { b.onclick = () => doctorForm(app.doctors.find((d) => d.id === Number(b.dataset.edit))); });
  $$('[data-sched]').forEach((b) => { b.onclick = () => { scheduleDoctorId = Number(b.dataset.sched); }; });
}

function doctorForm(d = {}) {
  const m = openModal({
    title: d.id ? 'Edit doctor' : 'Add doctor',
    body: `<form id="doc-form" class="row g-3">
      <div class="col-12"><label class="form-label">Name *</label><input name="name" class="form-control" required value="${esc(d.name)}" placeholder="Dr. Full Name"></div>
      <div class="col-12"><label class="form-label">Title</label><input name="title" class="form-control" value="${esc(d.title || 'Consultant Psychiatrist')}"></div>
      <div class="col-12"><label class="form-label">Qualifications</label><input name="qualifications" class="form-control" value="${esc(d.qualifications)}"></div>
      <div class="col-12"><label class="form-label">Short bio <span class="small text-muted">(shown on booking site)</span></label>
        <textarea name="bio" class="form-control" rows="3">${esc(d.bio)}</textarea></div>
      <div class="col-12"><hr class="my-1"><div class="small text-muted">Login</div></div>
      <div class="col-md-6"><label class="form-label">Email *</label><input name="email" type="email" class="form-control" required value="${esc(d.email)}"></div>
      <div class="col-md-6"><label class="form-label">${d.id ? 'New password' : 'Password *'}</label>
        <input name="password" type="password" class="form-control" minlength="8" ${d.id ? 'placeholder="Leave blank to keep"' : 'required'} autocomplete="new-password"></div>
      ${d.id ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="doc-active" ${d.active ? 'checked' : ''}>
        <label class="form-check-label" for="doc-active">Active (accepting appointments, can log in)</label></div></div>` : ''}
      <div class="col-12" data-error></div>
      <div class="col-12 text-end"><button class="btn btn-brand" type="submit">Save</button></div>
    </form>`,
  });
  onSubmit($('#doc-form', m), async (f) => {
    if (d.id) {
      f.active = Boolean(f.active);
      if (!f.password) delete f.password;
      await api('PATCH', `/api/doctors/${d.id}`, f);
    } else {
      await api('POST', '/api/doctors', f);
    }
    closeModal();
    toast('Doctor saved.');
    refresh();
  });
}

// ---------------------------------------------------------------- Admin: services
async function renderServices() {
  await loadReference();
  view().innerHTML = `${header('Services & Fees', '<button class="btn btn-brand" id="add-svc"><i class="fa-solid fa-plus me-1"></i>Add service</button>')}
    <div class="card p-2"><div class="table-responsive"><table class="table table-hover mb-0">
      <thead><tr><th>Service</th><th>Duration</th><th>Fee</th><th>Status</th></tr></thead>
      <tbody>${app.services.map((s) => `<tr data-svc="${s.id}" class="${s.active ? '' : 'text-muted'}">
        <td><div class="fw-semibold">${esc(s.name)}</div><div class="small text-muted">${esc(s.description)}</div></td>
        <td>${s.duration_min} min</td><td>${money$(s.price)}</td>
        <td>${s.active ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Hidden</span>'}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#add-svc').onclick = () => serviceForm();
  $$('[data-svc]').forEach((tr) => { tr.onclick = () => serviceForm(app.services.find((s) => s.id === Number(tr.dataset.svc))); });
}

function serviceForm(s = {}) {
  const m = openModal({
    title: s.id ? 'Edit service' : 'Add service',
    body: `<form id="svc-form" class="row g-3">
      <div class="col-12"><label class="form-label">Name *</label><input name="name" class="form-control" required value="${esc(s.name)}"></div>
      <div class="col-12"><label class="form-label">Description</label><input name="description" class="form-control" value="${esc(s.description)}"></div>
      <div class="col-6"><label class="form-label">Duration (minutes) *</label><input name="duration_min" type="number" min="5" max="480" class="form-control" required value="${s.duration_min || 30}"></div>
      <div class="col-6"><label class="form-label">Fee (${esc(app.settings.currency)})</label><input name="price" type="number" min="0" class="form-control" value="${s.price ?? 0}"></div>
      ${s.id ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="svc-active" ${s.active ? 'checked' : ''}>
        <label class="form-check-label" for="svc-active">Active (bookable)</label></div></div>` : ''}
      <div class="col-12" data-error></div>
      <div class="col-12 text-end"><button class="btn btn-brand" type="submit">Save</button></div>
    </form>`,
  });
  onSubmit($('#svc-form', m), async (f) => {
    if (s.id) f.active = Boolean(f.active);
    await (s.id ? api('PATCH', `/api/services/${s.id}`, f) : api('POST', '/api/services', f));
    closeModal();
    toast('Service saved.');
    refresh();
  });
}

// ---------------------------------------------------------------- Admin: staff accounts
async function renderUsers() {
  const { users } = await api('GET', '/api/users');
  view().innerHTML = `${header('Staff Accounts', '<button class="btn btn-brand" id="add-user"><i class="fa-solid fa-plus me-1"></i>Add admin / receptionist</button>')}
    <p class="small text-muted">Doctors' logins are managed from the <a href="#/doctors">Doctors</a> page. Receptionists can manage appointments and patients but cannot read session notes or change settings.</p>
    <div class="card p-2"><div class="table-responsive"><table class="table table-hover mb-0">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
      <tbody>${users.map((u) => `<tr data-user="${u.id}">
        <td class="fw-semibold">${esc(u.name)}${u.id === app.user.id ? ' <span class="small text-muted">(you)</span>' : ''}</td>
        <td>${esc(u.email)}</td><td class="text-capitalize">${esc(u.role)}</td>
        <td>${u.active ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Disabled</span>'}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#add-user').onclick = () => userForm();
  $$('[data-user]').forEach((tr) => {
    tr.onclick = () => {
      const u = users.find((x) => x.id === Number(tr.dataset.user));
      if (u.role === 'doctor') { location.hash = '#/doctors'; return; }
      userForm(u);
    };
  });
}

function userForm(u = {}) {
  const m = openModal({
    title: u.id ? 'Edit account' : 'Add account',
    body: `<form id="user-form" class="row g-3">
      <div class="col-12"><label class="form-label">Name *</label><input name="name" class="form-control" required value="${esc(u.name)}"></div>
      <div class="col-12"><label class="form-label">Email *</label><input name="email" type="email" class="form-control" required value="${esc(u.email)}"></div>
      <div class="col-md-6"><label class="form-label">Role</label><select name="role" class="form-select">
        ${options([{ id: 'receptionist', name: 'Receptionist' }, { id: 'admin', name: 'Admin' }], u.role || 'receptionist')}</select></div>
      <div class="col-md-6"><label class="form-label">${u.id ? 'New password' : 'Password *'}</label>
        <input name="password" type="password" class="form-control" minlength="8" ${u.id ? 'placeholder="Leave blank to keep"' : 'required'} autocomplete="new-password"></div>
      ${u.id ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="u-active" ${u.active ? 'checked' : ''}>
        <label class="form-check-label" for="u-active">Active (can log in)</label></div></div>` : ''}
      <div class="col-12" data-error></div>
      <div class="col-12 text-end"><button class="btn btn-brand" type="submit">Save</button></div>
    </form>`,
  });
  onSubmit($('#user-form', m), async (f) => {
    if (u.id) {
      f.active = Boolean(f.active);
      if (!f.password) delete f.password;
      await api('PATCH', `/api/users/${u.id}`, f);
    } else {
      await api('POST', '/api/users', f);
    }
    closeModal();
    toast('Account saved.');
    refresh();
  });
}

// ---------------------------------------------------------------- Admin: reports
const reportRange = { from: '', to: '' };
async function renderReports() {
  const qs = new URLSearchParams();
  if (reportRange.from) qs.set('from', reportRange.from);
  if (reportRange.to) qs.set('to', reportRange.to);
  const r = await api('GET', `/api/reports?${qs}`);
  const t = r.totals;
  const n = (v) => v || 0;
  const statTable = (rows) => `<div class="table-responsive"><table class="table table-sm mb-0">
    <thead><tr><th></th><th class="text-end">Total</th><th class="text-end">Completed</th><th class="text-end">Upcoming</th>
      <th class="text-end">Cancelled</th><th class="text-end">No-show</th><th class="text-end">Collected</th><th class="text-end">Outstanding</th></tr></thead>
    <tbody>${rows.map((x) => `<tr><td>${esc(x.name)}</td><td class="text-end">${n(x.total)}</td><td class="text-end">${n(x.completed)}</td>
      <td class="text-end">${n(x.upcoming)}</td><td class="text-end">${n(x.cancelled)}</td><td class="text-end">${n(x.no_show)}</td>
      <td class="text-end">${money$(x.revenue)}</td><td class="text-end">${money$(x.outstanding)}</td></tr>`).join('')}</tbody></table></div>`;

  view().innerHTML = `${header('Reports', `<form id="rep-form" class="d-flex gap-2 align-items-center">
      <input type="date" name="from" class="form-control form-control-sm" value="${r.from}">
      <span class="text-muted">to</span><input type="date" name="to" class="form-control form-control-sm" value="${r.to}">
      <button class="btn btn-sm btn-brand">Apply</button></form>`)}
    <div class="row g-3 mb-4">${[
      ['Appointments', n(t.total)], ['Completed', n(t.completed)], ['No-shows', n(t.no_show)], ['Cancelled', n(t.cancelled)],
      ['Unique patients', n(t.patients)], ['New patients', r.newPatients], ['Booked online', n(t.online_bookings)],
      ['Collected', money$(t.revenue)], ['Outstanding (completed, unpaid)', money$(t.outstanding)],
    ].map(([l, v]) => `<div class="col-6 col-md-4 col-xl"><div class="card stat h-100"><div class="value h4 mb-0">${esc(v)}</div><div class="label">${l}</div></div></div>`).join('')}</div>
    <div class="card p-3 mb-4"><h2 class="h5">By doctor</h2>${statTable(r.byDoctor)}</div>
    <div class="card p-3"><h2 class="h5">By service</h2>${statTable(r.byService)}</div>`;
  $('#rep-form').onsubmit = (ev) => { ev.preventDefault(); Object.assign(reportRange, formData(ev.target)); renderReports().catch(fail); };
}

// ---------------------------------------------------------------- Admin: settings
async function renderSettings() {
  const { settings: s } = await api('GET', '/api/settings');
  const field = (key, label, type = 'text', extra = '') => `<div class="col-md-6"><label class="form-label">${label}</label>
    <input name="${key}" type="${type}" class="form-control" value="${esc(s[key])}" ${extra}></div>`;
  const toggle = (key, label) => `<div class="col-md-6"><div class="form-check form-switch mt-md-4">
    <input class="form-check-input" type="checkbox" name="${key}" id="set-${key}" ${s[key] === '1' ? 'checked' : ''}>
    <label class="form-check-label" for="set-${key}">${label}</label></div></div>`;
  view().innerHTML = `${header('Clinic Settings')}
    <form id="settings-form" class="card p-4"><div class="row g-3">
      <div class="col-12"><h2 class="h6 text-uppercase text-muted">Clinic details</h2></div>
      ${field('clinic_name', 'Clinic name', 'text', 'required')}
      ${field('clinic_tagline', 'Tagline')}
      ${field('clinic_phone', 'Phone')}
      ${field('clinic_email', 'Email', 'email')}
      ${field('clinic_address', 'Address')}
      ${field('currency', 'Currency code (e.g. INR, USD)', 'text', 'maxlength="3"')}
      <div class="col-12 mt-4"><h2 class="h6 text-uppercase text-muted">Online booking</h2></div>
      ${toggle('online_booking_enabled', 'Allow patients to book online')}
      ${toggle('auto_confirm_online', 'Auto-confirm online bookings (otherwise staff confirm them)')}
      ${field('slot_interval_min', 'Slot interval (minutes)', 'number', 'min="5" max="240"')}
      ${field('booking_window_days', 'How far ahead patients can book (days)', 'number', 'min="1" max="365"')}
      ${field('min_notice_hours', 'Minimum notice for booking/cancelling (hours)', 'number', 'min="0" max="168"')}
      <div class="col-12" data-error></div>
      <div class="col-12"><button class="btn btn-brand" type="submit">Save settings</button></div>
    </div></form>
    <div class="card p-4 mt-4">
      <h2 class="h6 text-uppercase text-muted">Backup</h2>
      <p class="small text-muted mb-3">The app saves a backup automatically every day. You can also download a full copy of all clinic data
        (appointments, patients, notes) to keep somewhere safe — for example once a week. Keep this file private: it contains patient records.</p>
      <a class="btn btn-outline-secondary align-self-start" href="/api/backup"><i class="fa-solid fa-download me-1"></i>Download backup</a>
    </div>`;
  const form = $('#settings-form');
  onSubmit(form, async (f) => {
    f.online_booking_enabled = form.online_booking_enabled.checked ? '1' : '0';
    f.auto_confirm_online = form.auto_confirm_online.checked ? '1' : '0';
    f.currency = (f.currency || 'INR').toUpperCase();
    app.settings = (await api('PUT', '/api/settings', f)).settings;
    $$('[data-clinic-name]').forEach((el) => { el.textContent = app.settings.clinic_name; });
    toast('Settings saved.');
  });
}

// ---------------------------------------------------------------- Account
async function renderAccount() {
  const forced = app.user.must_change_password;
  view().innerHTML = `${header('My Account')}
    ${forced ? `<div class="alert alert-warning" style="max-width:480px"><i class="fa-solid fa-key me-2"></i>
      <strong>Please choose your own password.</strong> You are using a temporary password. Pick a new one (at least 8 characters) to continue.</div>` : ''}
    <div class="card p-4" style="max-width:480px">
      <div class="mb-3"><div class="fw-semibold">${esc(app.user.name)}</div><div class="small text-muted">${esc(app.user.email)} · ${esc(app.user.role)}</div></div>
      <form id="pw-form">
        <h2 class="h6">Change password</h2>
        <input name="current_password" type="password" class="form-control mb-2" placeholder="Current password" required autocomplete="current-password">
        <input name="new_password" type="password" class="form-control mb-2" placeholder="New password (min 8 characters)" minlength="8" required autocomplete="new-password">
        <div data-error></div>
        <button class="btn btn-brand" type="submit">Update password</button>
      </form>
    </div>`;
  const form = $('#pw-form');
  onSubmit(form, async (f) => {
    await api('POST', '/api/auth/change-password', f);
    form.reset();
    toast('Password updated.');
    if (forced) {
      app.user.must_change_password = 0;
      await loadReference();
      location.hash = '#/dashboard';
      route();
    }
  });
}

boot();
