'use strict';

const STEPS = ['Service', 'Doctor', 'Date & Time', 'Your Details'];
const state = { info: null, step: 0, service: null, doctor: null, date: null, time: null, days: [], booked: null };

const $ = (sel) => document.querySelector(sel);

async function init() {
  $('#year').textContent = new Date().getFullYear();
  try {
    state.info = await api('GET', '/api/public/info');
  } catch (e) {
    $('#wizard').innerHTML = `<div class="alert alert-danger mb-0">${esc(e.message)}</div>`;
    return;
  }
  const s = state.info.settings;
  document.title = `${s.clinic_name} – Book an Appointment`;
  document.querySelectorAll('[data-clinic-name]').forEach((el) => { el.textContent = s.clinic_name; });
  $('#tagline').textContent = s.clinic_tagline;
  $('#contact').innerHTML = [
    s.clinic_phone && `<li class="mb-2"><i class="fa-solid fa-phone me-2 text-brand"></i><a href="tel:${esc(s.clinic_phone)}">${esc(s.clinic_phone)}</a></li>`,
    s.clinic_email && `<li class="mb-2"><i class="fa-solid fa-envelope me-2 text-brand"></i><a href="mailto:${esc(s.clinic_email)}">${esc(s.clinic_email)}</a></li>`,
    s.clinic_address && `<li class="mb-2"><i class="fa-solid fa-location-dot me-2 text-brand"></i>${esc(s.clinic_address)}</li>`,
  ].filter(Boolean).join('') || '<li class="text-muted">Book online below.</li>';

  $('#doctor-list').innerHTML = state.info.doctors.map((d) => `
    <div class="col-md-6 col-lg-4">
      <div class="card h-100 p-4">
        <div class="d-flex align-items-center gap-3 mb-3">
          <span class="doctor-avatar">${esc(initials(d.name))}</span>
          <div><h3 class="h5 mb-0">${esc(d.name)}</h3><div class="text-muted small">${esc(d.title)}</div></div>
        </div>
        ${d.qualifications ? `<div class="small mb-2"><i class="fa-solid fa-graduation-cap me-1 text-brand"></i>${esc(d.qualifications)}</div>` : ''}
        <p class="text-secondary small flex-grow-1">${esc(d.bio)}</p>
        <button class="btn btn-outline-brand btn-sm align-self-start" data-book-doctor="${d.id}">Book appointment</button>
      </div>
    </div>`).join('');

  $('#service-list').innerHTML = state.info.services.map((sv) => `
    <div class="col-md-6 col-lg-4">
      <div class="card h-100 p-4 bg-brand-soft">
        <h3 class="h5">${esc(sv.name)}</h3>
        <p class="text-secondary small">${esc(sv.description)}</p>
        <div class="mt-auto d-flex justify-content-between small">
          <span><i class="fa-regular fa-clock me-1"></i>${sv.duration_min} min</span>
          <strong>${money(sv.price, s.currency)}</strong>
        </div>
      </div>
    </div>`).join('');

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-book-doctor]');
    if (!btn) return;
    state.doctor = state.info.doctors.find((d) => d.id === Number(btn.dataset.bookDoctor));
    state.step = state.service ? 2 : 0;
    render();
    $('#book').scrollIntoView({ behavior: 'smooth' });
  });

  $('#lookup-form').addEventListener('submit', onLookup);
  render();
}

function renderSteps() {
  $('#steps').innerHTML = STEPS.map((label, i) => {
    const cls = i === state.step ? 'active' : i < state.step ? 'done' : '';
    return `<div class="step ${cls}">${i < state.step ? '<i class="fa-solid fa-check me-1"></i>' : `${i + 1}. `}${label}</div>`;
  }).join('');
}

function backButton() {
  return state.step > 0 ? '<button class="btn btn-link text-secondary px-0 align-self-start" data-back><i class="fa-solid fa-arrow-left me-1"></i>Back</button>' : '';
}

function render() {
  const w = $('#wizard');
  if (state.info.settings.online_booking_enabled !== '1') {
    $('#steps').innerHTML = '';
    w.innerHTML = `<div class="text-center py-4"><i class="fa-solid fa-phone fa-2x text-brand mb-3"></i>
      <p class="mb-0">Online booking is currently unavailable. Please call the clinic to book.</p></div>`;
    return;
  }
  if (state.booked) return renderDone();
  renderSteps();
  [renderService, renderDoctor, renderDateTime, renderDetails][state.step](w);
  const back = w.querySelector('[data-back]');
  if (back) back.onclick = () => { state.step--; render(); };
}

function renderService(w) {
  const cur = state.info.settings.currency;
  w.innerHTML = `<h3 class="h5 mb-3">What kind of appointment do you need?</h3>
    <div class="row g-3">${state.info.services.map((s) => `
      <div class="col-md-4"><div class="card choice h-100 p-3 ${state.service?.id === s.id ? 'selected' : ''}" data-id="${s.id}">
        <div class="fw-semibold">${esc(s.name)}</div>
        <div class="small text-secondary my-2">${esc(s.description)}</div>
        <div class="small mt-auto"><i class="fa-regular fa-clock me-1"></i>${s.duration_min} min · ${money(s.price, cur)}</div>
      </div></div>`).join('')}</div>`;
  w.querySelectorAll('.choice').forEach((el) => {
    el.onclick = () => {
      state.service = state.info.services.find((s) => s.id === Number(el.dataset.id));
      state.time = null;
      state.step = state.doctor ? 2 : 1;
      render();
    };
  });
}

function renderDoctor(w) {
  w.innerHTML = `${backButton()}<h3 class="h5 mb-3">Choose your doctor</h3>
    <div class="row g-3">${state.info.doctors.map((d) => `
      <div class="col-md-4"><div class="card choice h-100 p-3 text-center ${state.doctor?.id === d.id ? 'selected' : ''}" data-id="${d.id}">
        <span class="doctor-avatar mx-auto mb-2">${esc(initials(d.name))}</span>
        <div class="fw-semibold">${esc(d.name)}</div><div class="small text-secondary">${esc(d.title)}</div>
      </div></div>`).join('')}</div>`;
  w.querySelectorAll('.choice').forEach((el) => {
    el.onclick = () => {
      state.doctor = state.info.doctors.find((d) => d.id === Number(el.dataset.id));
      state.time = null;
      state.step = 2;
      render();
    };
  });
}

async function renderDateTime(w) {
  w.innerHTML = `${backButton()}<h3 class="h5 mb-1">Pick a date and time</h3>
    <p class="small text-secondary">${esc(state.service.name)} with ${esc(state.doctor.name)} · ${state.service.duration_min} min</p>
    <div id="days" class="day-scroller mb-3"><div class="spinner-border spinner-border-sm text-secondary"></div></div>
    <div id="slots"></div>`;
  try {
    const { days } = await api('GET', `/api/public/days?doctor_id=${state.doctor.id}&service_id=${state.service.id}`);
    state.days = days;
  } catch (e) {
    w.querySelector('#days').innerHTML = `<div class="alert alert-danger w-100">${esc(e.message)}</div>`;
    return;
  }
  if (!state.days.length) {
    w.querySelector('#days').innerHTML = '<div class="alert alert-warning w-100 mb-0">No free slots in the coming weeks. Please choose another doctor or call the clinic.</div>';
    return;
  }
  if (!state.days.some((d) => d.date === state.date)) state.date = state.days[0].date;
  const daysEl = w.querySelector('#days');
  daysEl.innerHTML = state.days.map((d) => `
    <button class="btn day-btn ${d.date === state.date ? 'btn-brand' : 'btn-outline-secondary'}" data-date="${d.date}">
      ${esc(fmtDate(d.date, { weekday: 'short' }))}<br><strong>${esc(fmtDate(d.date, { day: 'numeric', month: 'short' }))}</strong>
      <small>${d.slots} free</small>
    </button>`).join('');
  daysEl.querySelectorAll('[data-date]').forEach((b) => {
    b.onclick = () => { state.date = b.dataset.date; state.time = null; renderDateTime(w); };
  });
  daysEl.querySelector('.btn-brand')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  loadSlots(w.querySelector('#slots'));
}

async function loadSlots(el) {
  el.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary"></div>';
  const { slots } = await api('GET',
    `/api/public/slots?doctor_id=${state.doctor.id}&service_id=${state.service.id}&date=${state.date}`);
  const groups = { Morning: [], Afternoon: [], Evening: [] };
  for (const t of slots) {
    const h = Number(t.slice(0, 2));
    groups[h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'].push(t);
  }
  el.innerHTML = `<div class="fw-semibold mb-2">${esc(fmtDate(state.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>` +
    (Object.entries(groups).filter(([, ts]) => ts.length).map(([label, ts]) => `
      <div class="small text-muted mt-2 mb-1">${label}</div>
      <div class="d-flex flex-wrap gap-2">${ts.map((t) => `
        <button class="btn btn-sm slot-btn btn-outline-brand" data-time="${t}">${fmtTime(t)}</button>`).join('')}</div>`).join('')
      || '<div class="text-muted">No slots left on this day.</div>');
  el.querySelectorAll('[data-time]').forEach((b) => {
    b.onclick = () => { state.time = b.dataset.time; state.step = 3; render(); };
  });
}

function renderDetails(w) {
  const s = state.info.settings;
  w.innerHTML = `${backButton()}
    <div class="alert bg-brand-soft border-0 d-flex flex-wrap gap-3 align-items-center">
      <span><i class="fa-regular fa-calendar me-1"></i>${esc(fmtDate(state.date))}</span>
      <span><i class="fa-regular fa-clock me-1"></i>${fmtTime(state.time)}</span>
      <span><i class="fa-solid fa-user-doctor me-1"></i>${esc(state.doctor.name)}</span>
      <span><i class="fa-solid fa-notes-medical me-1"></i>${esc(state.service.name)} · ${money(state.service.price, s.currency)}</span>
    </div>
    <form id="details-form" class="row g-3" novalidate>
      <div class="col-md-6"><label class="form-label">Full name *</label><input name="name" class="form-control" required maxlength="120" autocomplete="name"></div>
      <div class="col-md-6"><label class="form-label">Phone number *</label><input name="phone" type="tel" class="form-control" required autocomplete="tel"></div>
      <div class="col-md-6"><label class="form-label">Email <span class="text-muted small">(optional)</span></label><input name="email" type="email" class="form-control" autocomplete="email"></div>
      <div class="col-md-6"><label class="form-label">Consultation mode</label>
        <select name="mode" class="form-select"><option value="in-person">In person at the clinic</option><option value="online">Online (video call)</option></select></div>
      <div class="col-12"><label class="form-label">Anything you'd like the doctor to know? <span class="text-muted small">(optional)</span></label>
        <textarea name="reason" class="form-control" rows="3" maxlength="1000"></textarea></div>
      <div class="col-12"><div class="form-check">
        <input class="form-check-input" type="checkbox" name="consent" id="consent" required>
        <label class="form-check-label small" for="consent">I agree to the clinic storing my details to manage my appointment, as described in the
          <a href="/privacy" target="_blank">privacy policy</a>.</label></div></div>
      <div class="col-12"><div id="form-error"></div>
        <button class="btn btn-brand btn-lg px-4" type="submit">Confirm booking</button></div>
    </form>`;
  w.querySelector('#details-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter;
    if (!ev.target.consent.checked) {
      w.querySelector('#form-error').innerHTML = '<div class="alert alert-warning">Please tick the box to agree to the privacy policy.</div>';
      return;
    }
    btn.disabled = true;
    try {
      const { appointment } = await api('POST', '/api/public/book', {
        ...formData(ev.target), consent: ev.target.consent.checked, doctor_id: state.doctor.id, service_id: state.service.id, date: state.date, time: state.time,
      });
      state.booked = appointment;
      render();
    } catch (e) {
      w.querySelector('#form-error').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      btn.disabled = false;
      if (e.status === 409) { state.time = null; setTimeout(() => { state.step = 2; render(); }, 1800); }
    }
  });
}

function renderDone() {
  const a = state.booked;
  $('#steps').innerHTML = '';
  $('#wizard').innerHTML = `
    <div class="text-center py-3">
      <i class="fa-solid fa-circle-check fa-3x text-brand mb-3"></i>
      <h3 class="h4">${a.status === 'confirmed' ? 'Your appointment is confirmed' : 'Booking request received'}</h3>
      <p class="text-secondary">${a.status === 'confirmed' ? 'We look forward to seeing you.'
        : 'The clinic will confirm your appointment shortly.'}</p>
      <div class="display-6 fw-bold my-3">${esc(a.reference)}</div>
      <p class="small text-muted">Your booking reference — please keep it to check or cancel your booking.</p>
      <ul class="list-unstyled my-4">
        <li><strong>${esc(fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</strong> at <strong>${fmtTime(a.start_time)}</strong></li>
        <li>${esc(a.service_name)} with ${esc(a.doctor_name)} (${a.mode === 'online' ? 'online' : 'in person'})</li>
      </ul>
      <button class="btn btn-outline-brand" id="book-another">Book another appointment</button>
    </div>`;
  $('#book-another').onclick = () => {
    Object.assign(state, { step: 0, service: null, doctor: null, date: null, time: null, booked: null });
    render();
  };
}

function bookingCard(a, phone) {
  const canCancel = ['pending', 'confirmed'].includes(a.status);
  return `<div class="card p-3">
    <div class="d-flex justify-content-between align-items-start">
      <div>
        <div class="fw-semibold">${esc(a.service_name)} with ${esc(a.doctor_name)}</div>
        <div class="text-secondary small">${esc(fmtDate(a.date))} · ${fmtTime(a.start_time)}–${fmtTime(a.end_time)} · ${esc(a.mode)}</div>
        <div class="small mt-1">Ref <strong>${esc(a.reference)}</strong></div>
      </div>
      ${statusBadge(a.status)}
    </div>
    ${canCancel ? `<button class="btn btn-sm btn-outline-danger mt-3 align-self-start" data-cancel="${esc(a.reference)}" data-phone="${esc(phone)}">Cancel this booking</button>` : ''}
  </div>`;
}

async function onLookup(ev) {
  ev.preventDefault();
  const out = $('#lookup-result');
  const data = formData(ev.target);
  try {
    const { appointment } = await api('POST', '/api/public/lookup', data);
    out.innerHTML = bookingCard(appointment, data.phone);
    const btn = out.querySelector('[data-cancel]');
    if (btn) {
      btn.onclick = async () => {
        if (!confirm('Cancel this appointment?')) return;
        try {
          const r = await api('POST', '/api/public/cancel', data);
          out.innerHTML = bookingCard(r.appointment, data.phone);
        } catch (e) {
          out.insertAdjacentHTML('beforeend', `<div class="alert alert-danger mt-2">${esc(e.message)}</div>`);
        }
      };
    }
  } catch (e) {
    out.innerHTML = `<div class="alert alert-warning">${e.status === 404
      ? 'No booking found. Please check the reference and phone number.' : esc(e.message)}</div>`;
  }
}

init();
