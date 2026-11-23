'use strict';
const P = window.padma;
const D = P.dates;
const DEP = P.logic.DEPOSIT_CAT;
const BR = P.logic.BRANCHES;
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'Rs. ' + (Number(n) || 0).toLocaleString('en-IN');
const num = (v) => Number(v) || 0;
const sumOf = (rows) => rows.reduce((a, r) => a + num(r.amount), 0);
const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isRef = (r) => !!r.refundable || r.category === DEP;
const ym = (d) => String(d || '').slice(0, 7);

let token = null, S = null, branch = 'PHB-01', tab = 'dashboard', STATUS = {}, INFO = {};
const view = { dash: { y: 0, m: 0 }, fee: { y: 0, m: 0 }, inc: { y: 0, m: 0 }, exp: { y: 0, m: 0 }, stuQ: '' };
let photoData = '', lastAdm = null;
const pickers = {};

const B = () => S.branches[branch];
const nowBs = () => D.today();
const monthName = (m) => D.MONTHS[m - 1];
const bedPrice = (beds) => S.settings.bedPrices[P.logic.bedTypeOf(beds)] || 0;

// ---------- feedback ----------
let toastTimer;
function toast(msg, bad) {
  const t = $('toast');
  t.className = 'fixed bottom-6 right-6 z-[70] card px-4 py-3 shadow-xl text-sm ' + (bad ? 'toast-err' : 'toast-ok');
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}
function modal({ title, body, ok = 'Save', cancel = 'Cancel', onOk, wide }) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><div class="modal" ${wide ? 'style="max-width:680px"' : ''}><h3>${esc(title)}</h3><div id="mBody">${body}</div><div id="mErr" class="text-xs text-rose-600 mt-2 hidden"></div><div class="flex justify-end gap-2 mt-5">${cancel ? '<button class="btn px-4 py-2 rounded-md border border-slate-300 bg-white text-sm" id="mCancel">' + esc(cancel) + '</button>' : ''}<button class="btn px-4 py-2 rounded-md text-white text-sm font-semibold dynamic-bg" id="mOk">${esc(ok)}</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  const first = root.querySelector('input,select'); if (first) first.focus();
  if ($('mCancel')) $('mCancel').onclick = close;
  $('mOk').onclick = async () => {
    const vals = {};
    root.querySelectorAll('[name]').forEach((el) => { vals[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
    try {
      const r = onOk ? await onOk(vals) : true;
      if (typeof r === 'string') { const e = $('mErr'); e.textContent = r; e.classList.remove('hidden'); return; }
      if (r !== false) close();
    } catch (e) { const er = $('mErr'); er.textContent = e.message || String(e); er.classList.remove('hidden'); }
  };
  root.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('mOk').click(); }));
  return close;
}
const confirmBox = (title, text, ok = 'Yes') => new Promise((res) => {
  modal({ title, body: `<p class="text-sm text-slate-600">${esc(text)}</p>`, ok, onOk: () => { res(true); }, });
  const c = $('mCancel'); const old = c.onclick; c.onclick = () => { old(); res(false); };
});
const field = (label, inner) => `<div class="mb-3"><label class="field-label">${esc(label)}</label>${inner}</div>`;
const inp = (name, val = '', extra = '') => `<input name="${name}" value="${esc(val)}" class="field-input" ${extra}>`;

async function persist() {
  try { STATUS = await P.save(token, S); updateSaveUi(); } catch (e) { toast('Could not store data: ' + e.message, true); }
}

// ---------- BS date picker ----------
function makePicker(id, value, y1, y2) {
  const el = $(id); if (!el) return;
  const t = nowBs().bs;
  const v = D.parse(value) || { year: t.year, month: t.month, day: t.day };
  y1 = y1 || D.MIN_YEAR; y2 = y2 || Math.min(D.MAX_YEAR, t.year + 5);
  let ys = ''; for (let y = y2; y >= y1; y--) ys += `<option value="${y}">${y}</option>`;
  el.innerHTML = `<select data-p="y">${ys}</select><select data-p="m">${D.MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select><select data-p="d"></select>`;
  const [sy, sm, sd] = el.querySelectorAll('select');
  const fillDays = () => {
    const n = D.daysInMonth(+sy.value, +sm.value); const cur = +sd.value || v.day;
    sd.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    sd.value = Math.min(cur, n);
  };
  sy.value = v.year; sm.value = v.month; fillDays();
  const api = {
    get: () => `${sy.value}-${pad(sm.value)}-${pad(sd.value)}`,
    set: (s) => { const p = D.parse(s); if (!p) return; sy.value = p.year; sm.value = p.month; fillDays(); sd.value = p.day; },
    onChange: null,
  };
  const ch = (ev) => { if (ev.target !== sd) fillDays(); if (api.onChange) api.onChange(api.get()); };
  el.addEventListener('change', ch);
  pickers[id] = api; return api;
}
const adOf = (bs) => { try { return D.bsToAdString(bs); } catch { return ''; } };

// ---------- clock / online / save ui ----------
function tickClock() {
  const t = nowBs(); const h12 = t.time.h % 12 || 12;
  $('clockTime').textContent = `${pad(h12)}:${pad(t.time.m)}:${pad(t.time.s)} ${t.time.h < 12 ? 'AM' : 'PM'}`;
  $('clockDate').textContent = `${D.WEEKDAYS[t.weekday]}, ${D.formatLong(t.bs.str)} B.S.`;
}
async function checkOnline() {
  let on = navigator.onLine; try { on = await P.isOnline(); } catch { /* ignore */ }
  $('onlineDot').className = 'pulse-dot ' + (on ? 'pulse-online' : 'pulse-offline');
  $('onlineText').textContent = on ? 'ONLINE' : 'OFFLINE';
}
function updateSaveUi() {
  const dirty = !!STATUS.dirty;
  $('saveLabel').textContent = STATUS.busy ? (STATUS.message || 'Saving…') : dirty ? '💾 Save ●' : '💾 Save';
  const last = STATUS.lastSaveAt ? new Date(STATUS.lastSaveAt) : null;
  const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
  const banner = $('saveBanner');
  if (dirty && (days === null || days >= 7)) {
    banner.classList.remove('hidden');
    $('saveBannerText').textContent = days === null ? 'You have entries that have never been saved into the month folders (PDF reports).' : `Last saved ${days} day(s) ago. Press Save to update this month's PDF reports.`;
  } else banner.classList.add('hidden');
  if (tab === 'settings') renderSettings();
}
async function doSave(web) {
  const btn = web ? $('webBtn') : $('saveBtn'); btn.disabled = true;
  try {
    if (web) {
      await P.backup.download(token);
      toast('Backup file downloaded. Keep a copy on a USB stick or in Google Drive.');
    } else {
      $('saveLabel').textContent = 'Saving…';
      STATUS = await P.reports.save(token);
      toast(STATUS.errors ? STATUS.message : `Saved. ${STATUS.changed} PDF(s) updated in the month folders.`, !!STATUS.errors);
    }
  } catch (e) { toast(e.message || String(e), true); }
  btn.disabled = false; $('webLabel').textContent = '⬇ Backup file'; updateSaveUi();
}

// ---------- login ----------
let setupMode = false;
async function prepareLogin() {
  setupMode = await P.auth.needsSetup();
  if (setupMode) {
    $('loginNote').innerHTML = '<b>Welcome!</b> First time on this computer: choose a username and password for this app. You will use them every time you open it.';
    $('loginConfirmWrap').classList.remove('hidden');
    $('loginBtn').textContent = 'Create login & start →';
  }
}
async function login() {
  const showErr = (m) => { const e = $('loginErr'); e.textContent = m; e.classList.remove('hidden'); };
  let r;
  if (setupMode) {
    if ($('loginPass').value !== $('loginPass2').value) return showErr('The two passwords are not the same.');
    r = await P.auth.setup($('loginUser').value.trim(), $('loginPass').value);
  } else {
    r = await P.auth.login($('loginUser').value.trim(), $('loginPass').value);
  }
  if (!r.ok) { const e = $('loginErr'); e.textContent = r.error || 'Invalid credentials'; e.classList.remove('hidden'); return; }
  token = r.token; INFO.fallback = r.fallback;
  const d = await P.load(token);
  S = d.state; INFO.folder = d.folder; INFO.dbFile = d.dbFile; STATUS = d.status;
  $('loginScreen').classList.add('hidden'); $('app').classList.remove('hidden');
  initApp();
}

// ---------- shell ----------
function setBranch(id) {
  branch = id;
  document.body.classList.toggle('theme-phb', id === 'PHB-01');
  document.body.classList.toggle('theme-phg', id === 'PHG-02');
  document.querySelectorAll('.branch-btn').forEach((b) => b.classList.toggle('branch-active', b.dataset.branch === id));
  $('admBranch').textContent = BR[id].name;
  fillRoomSelect(); calcBill(); renderTab();
}
function setTab(t) {
  tab = t;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('tab-active', b.dataset.tab === t));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t));
  renderTab();
}
function renderTab() {
  ({ dashboard: renderDashboard, rooms: renderRooms, admission: renderAdmList, students: renderStudents, monthly: renderMonthly, income: () => renderLedger('income'), expenditure: () => renderLedger('expenditure'), settings: renderSettings }[tab])();
}

function monthPicker(key, withAll, act) {
  const t = nowBs().bs; const v = view[key];
  if (!v.y) { v.y = t.year; v.m = t.month; }
  let ys = ''; for (let y = Math.min(D.MAX_YEAR, t.year + 2); y >= t.year - 6; y--) ys += `<option value="${y}" ${y === v.y ? 'selected' : ''}>${y}</option>`;
  return `<select class="field-input" style="width:auto" data-chg="${act}" data-k="${key}" data-f="y">${ys}</select>
  <select class="field-input" style="width:auto" data-chg="${act}" data-k="${key}" data-f="m">${withAll ? `<option value="0" ${!v.m ? 'selected' : ''}>Whole year</option>` : ''}${D.MONTHS.map((n, i) => `<option value="${i + 1}" ${v.m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
}

// ---------- totals ----------
function totals(b, y, m) {
  const inP = (r) => { const p = D.parse(r.dateBS); return p && p.year === y && (!m || p.month === m); };
  const inc = b.income.filter(inP), exp = b.expenditure.filter(inP);
  const revenue = sumOf(inc.filter((r) => !isRef(r))), expenditure = sumOf(exp);
  return { revenue, expenditure, net: revenue - expenditure, deposits: sumOf(inc.filter(isRef)) };
}
const feeRows = (b, ymStr) => P.logic.feeStatus({ students: b.students, fees: b.fees }, ymStr);
const netCls = (n) => (n < 0 ? 'text-rose-600' : 'text-emerald-600');

// ---------- DASHBOARD ----------
function renderDashboard() {
  const t = nowBs().bs; const v = view.dash; if (!v.y) { v.y = t.year; v.m = t.month; }
  const b = B(); const mt = totals(b, v.y, v.m), yt = totals(b, v.y, 0);
  const all = P.logic.BRANCHES;
  const other = Object.keys(all).map((id) => ({ id, m: totals(S.branches[id], v.y, v.m), y: totals(S.branches[id], v.y, 0) }));
  const stat = (label, val, cls, sub) => `<div class="card p-5"><div class="text-[11px] mono text-slate-500">${label}</div><div class="stat-num text-2xl font-bold mt-1 ${cls || ''}">${val}</div>${sub ? `<div class="text-xs text-slate-500 mt-1">${sub}</div>` : ''}</div>`;
  const beds = b.rooms.reduce((a, r) => a + r.beds.length, 0), occ = b.rooms.reduce((a, r) => a + r.beds.filter((x) => x.name).length, 0);
  const curYm = t.year + '-' + pad(t.month);
  const fr = feeRows(b, curYm);
  const cnt = { paid: 0, part: 0, unpaid: 0 }; fr.forEach((r) => { cnt[r.status] += 1; });
  const due = fr.reduce((a, r) => a + r.due + (r.status === 'unpaid' && !r.paid ? 0 : 0), 0);
  const heldAll = sumOf(b.income.filter((r) => isRef(r) && !r.refundedOn));
  // 12-month chart
  const mon = Array.from({ length: 12 }, (_, i) => totals(b, v.y, i + 1));
  const max = Math.max(1, ...mon.map((x) => Math.max(x.revenue, x.expenditure)));
  const bars = mon.map((x, i) => {
    const hr = Math.round((x.revenue / max) * 120), he = Math.round((x.expenditure / max) * 120), cx = 20 + i * 52;
    return `<rect x="${cx}" y="${140 - hr}" width="18" height="${hr}" fill="#10b981"><title>${monthName(i + 1)} revenue ${money(x.revenue)}</title></rect><rect x="${cx + 20}" y="${140 - he}" width="18" height="${he}" fill="#f43f5e"><title>${monthName(i + 1)} expenditure ${money(x.expenditure)}</title></rect><text x="${cx + 19}" y="156" font-size="9" text-anchor="middle" fill="#64748b">${monthName(i + 1).slice(0, 3)}</text>`;
  }).join('');
  $('tab-dashboard').innerHTML = `
  <div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><div class="text-lg font-bold">${esc(BR[branch].name)} — Dashboard</div><div class="text-xs text-slate-500 mono">Revenue excludes refundable security deposits.</div></div><div class="flex gap-2">${monthPicker('dash', false, 'dash')}</div></div>
  <div class="text-xs font-bold mono text-slate-400 uppercase mb-2">${monthName(v.m)} ${v.y} — monthly</div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">${stat('MONTHLY REVENUE', money(mt.revenue), 'text-emerald-600')}${stat('MONTHLY EXPENDITURE', money(mt.expenditure), 'text-rose-600')}${stat('MONTHLY NET PROFIT', money(mt.net), netCls(mt.net))}</div>
  <div class="text-xs font-bold mono text-slate-400 uppercase mb-2">Year ${v.y} — yearly</div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">${stat('YEARLY REVENUE', money(yt.revenue), 'text-emerald-600')}${stat('YEARLY EXPENDITURE', money(yt.expenditure), 'text-rose-600')}${stat('YEARLY NET PROFIT', money(yt.net), netCls(yt.net))}</div>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
    <div class="card p-5 lg:col-span-2"><div class="flex justify-between mb-2"><div class="font-bold text-sm">Revenue vs expenditure by month, ${v.y}</div><div class="text-xs"><span style="color:#10b981">■</span> Revenue &nbsp;<span style="color:#f43f5e">■</span> Expenditure</div></div><svg viewBox="0 0 640 165" class="w-full">${bars}<line x1="10" x2="630" y1="140" y2="140" stroke="#cbd5e1"/></svg></div>
    <div class="card p-5"><div class="font-bold text-sm mb-3">Right now</div>
      <div class="text-sm space-y-2"><div class="flex justify-between"><span class="text-slate-500">Beds occupied</span><b class="stat-num">${occ} / ${beds}</b></div>
      <div class="flex justify-between"><span class="text-slate-500">Fee ${monthName(t.month)}: paid</span><b class="stat-num text-emerald-600">${cnt.paid}</b></div>
      <div class="flex justify-between"><span class="text-slate-500">Part paid</span><b class="stat-num text-amber-600">${cnt.part}</b></div>
      <div class="flex justify-between"><span class="text-slate-500">Not paid</span><b class="stat-num text-rose-600">${cnt.unpaid}</b></div>
      <div class="flex justify-between"><span class="text-slate-500">Fee still due</span><b class="stat-num">${money(fr.reduce((a, r) => a + (r.status === 'unpaid' ? r.expected : r.due), 0))}</b></div>
      <div class="flex justify-between"><span class="text-slate-500">Deposits held</span><b class="stat-num">${money(heldAll)}</b></div></div></div>
  </div>
  <div class="card p-5"><div class="font-bold text-sm mb-3">Both hostels — ${monthName(v.m)} ${v.y} / year ${v.y}</div>
    <table class="sheet"><thead><tr><th>Hostel</th><th class="r">Month revenue</th><th class="r">Month expenditure</th><th class="r">Month net</th><th class="r">Year revenue</th><th class="r">Year expenditure</th><th class="r">Year net</th></tr></thead><tbody>
    ${other.map((o) => `<tr><td>${esc(BR[o.id].name)}</td><td class="r">${money(o.m.revenue)}</td><td class="r">${money(o.m.expenditure)}</td><td class="r ${netCls(o.m.net)}">${money(o.m.net)}</td><td class="r">${money(o.y.revenue)}</td><td class="r">${money(o.y.expenditure)}</td><td class="r ${netCls(o.y.net)}">${money(o.y.net)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Total</td>${['m', 'y'].map((k) => { const rv = other.reduce((a, o) => a + o[k].revenue, 0), ex = other.reduce((a, o) => a + o[k].expenditure, 0); return `<td class="r">${money(rv)}</td><td class="r">${money(ex)}</td><td class="r">${money(rv - ex)}</td>`; }).join('')}</tr></tfoot></table></div>`;
}

// ---------- ROOMS ----------
function renderRooms() {
  const b = B();
  const beds = b.rooms.reduce((a, r) => a + r.beds.length, 0), occ = b.rooms.reduce((a, r) => a + r.beds.filter((x) => x.name).length, 0);
  $('tab-rooms').innerHTML = `<div class="flex items-center justify-between mb-4 flex-wrap gap-2"><div><div class="text-lg font-bold">Room Watching — ${esc(BR[branch].name)}</div><div class="text-xs text-slate-500 mono">${occ} of ${beds} beds occupied · ${beds - occ} free · click a bed to manage it</div></div><button class="btn text-white text-sm px-4 py-2 rounded-md dynamic-bg font-semibold" data-act="room-add">＋ Add room</button></div>
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${b.rooms.map((r) => {
    const free = r.beds.filter((x) => !x.name).length;
    return `<div class="card p-4"><div class="flex justify-between items-start mb-2"><div><div class="font-bold">${esc(r.label)}</div><div class="text-[11px] mono text-slate-500">${r.beds.length} Bed room · ${money(bedPrice(r.beds.length))}/month</div></div><div class="flex gap-2 items-center"><span class="chip" style="background:${free ? '#d1fae5' : '#ffe4e6'};color:${free ? '#065f46' : '#9f1239'}">${free ? free + ' free' : 'Full'}</span><span class="link" data-act="room-edit" data-id="${esc(r.id)}">Edit</span></div></div>
    <div class="grid grid-cols-2 gap-2">${r.beds.map((x, i) => x.name ? `<div class="bed-card bed-taken cursor-pointer" data-act="bed" data-id="${esc(r.id)}" data-i="${i}"><div class="text-[10px] mono text-slate-500">BED ${i + 1}</div><div class="font-semibold">${esc(x.name)}</div>${x.phone ? `<div class="text-[11px] text-slate-500">${esc(x.phone)}</div>` : ''}</div>` : `<div class="bed-card bed-free" data-act="bed" data-id="${esc(r.id)}" data-i="${i}"><div class="text-[10px] mono">BED ${i + 1}</div><div>Vacant</div></div>`).join('')}</div></div>`;
  }).join('')}</div>`;
}
const findRoom = (id) => B().rooms.find((r) => r.id === id);
function bedModal(roomId, i) {
  const room = findRoom(roomId); const bed = room.beds[i];
  if (!bed.name) {
    modal({ title: `${room.label} — Bed ${i + 1} (vacant)`, body: `<p class="text-sm text-slate-600 mb-3">Best way to fill it: a full admission (keeps the form, bill and fee records).</p>${field('Or just note an occupant name', inp('name', ''))}`, ok: 'Note name only', cancel: 'Close', onOk: async (v) => { if (!v.name.trim()) { goAdmit(room, i); return; } bed.name = v.name.trim(); await persist(); renderRooms(); } });
    const extra = document.createElement('button'); extra.className = 'btn px-4 py-2 rounded-md text-white text-sm font-semibold dynamic-bg'; extra.textContent = 'Admit student here →';
    extra.onclick = () => { $('modalRoot').innerHTML = ''; goAdmit(room, i); };
    $('mOk').parentNode.insertBefore(extra, $('mOk'));
    return;
  }
  const linked = bed.studentId && B().students.find((s) => s.id === bed.studentId);
  modal({ title: `${room.label} — Bed ${i + 1}`, body: `<div class="text-sm mb-3"><b>${esc(bed.name)}</b>${bed.phone ? ' · ' + esc(bed.phone) : ''}</div><p class="text-xs text-slate-500">${linked ? 'Registered in the Students list (included in Monthly Fee).' : 'Not in the Students list yet, so no monthly fee is tracked for this person.'}</p>
  <div class="flex flex-wrap gap-2 mt-4">${linked ? '' : '<button class="btn px-3 py-2 text-sm rounded-md border border-slate-300" id="bReg">＋ Add to Students list</button>'}<button class="btn px-3 py-2 text-sm rounded-md border border-rose-300 text-rose-700" id="bVac">Vacate bed</button></div>`, ok: 'Close', cancel: null, onOk: () => true });
  if ($('bReg')) $('bReg').onclick = () => { $('modalRoot').innerHTML = ''; studentModal(null, { name: bed.name, phone: bed.phone || '', room: room.number, bed: P.logic.bedTypeOf(room.beds.length), _bed: [roomId, i] }); };
  $('bVac').onclick = async () => {
    $('modalRoot').innerHTML = '';
    if (!(await confirmBox('Vacate bed?', `${bed.name} leaves ${room.label}, Bed ${i + 1}. Their payment history stays.`, 'Vacate'))) return;
    if (linked) { linked.active = '0'; linked.until = ym(nowBs().bs.str); }
    room.beds[i] = { studentId: null, name: null, phone: null };
    await persist(); renderRooms(); toast('Bed vacated.');
  };
}
function goAdmit(room, i) { setTab('admission'); $('admRoom').value = room.id; onRoomChange(); $('admBed').value = String(i); }
function roomModal(id) {
  const r = id ? findRoom(id) : null;
  modal({ title: r ? 'Edit room' : 'Add room', body: field('Room number / code', inp('number', r ? r.number : '')) + field('Display name', inp('label', r ? r.label : '')) + field('Number of beds', inp('beds', r ? r.beds.length : 2, 'type="number" min="1" max="12"')) + (r ? '<div class="mt-3"><button class="link link-red" id="rDel">Delete this room</button></div>' : ''),
    onOk: async (v) => {
      const n = Math.max(1, Math.min(12, num(v.beds))); const number = v.number.trim(); if (!number) return 'Enter a room number.';
      if (B().rooms.some((x) => x.number === number && (!r || x.id !== r.id))) return 'That room number already exists.';
      if (r) { if (n < r.beds.length && r.beds.slice(n).some((x) => x.name)) return 'Vacate the beds you are removing first.'; r.number = number; r.label = v.label.trim() || 'Room ' + number; r.beds = r.beds.slice(0, n); while (r.beds.length < n) r.beds.push({ studentId: null, name: null, phone: null }); }
      else B().rooms.push({ id: uid('ROOM'), number, label: v.label.trim() || 'Room ' + number, desc: '', beds: Array.from({ length: n }, () => ({ studentId: null, name: null, phone: null })) });
      await persist(); renderRooms(); fillRoomSelect();
    } });
  if (r) $('rDel').onclick = async () => {
    if (r.beds.some((x) => x.name)) { toast('Vacate all beds first.', true); return; }
    B().rooms = B().rooms.filter((x) => x.id !== r.id); await persist(); $('modalRoot').innerHTML = ''; renderRooms(); fillRoomSelect();
  };
}

// ---------- ADMISSION ----------
function fillRoomSelect() {
  const sel = $('admRoom'); if (!sel) return; const cur = sel.value;
  sel.innerHTML = '<option value="">Select room</option>' + B().rooms.map((r) => { const f = r.beds.filter((x) => !x.name).length; return `<option value="${esc(r.id)}" ${f ? '' : 'disabled'}>${esc(r.label)} — ${f} free</option>`; }).join('');
  if (B().rooms.some((r) => r.id === cur)) sel.value = cur;
  onRoomChange();
}
function onRoomChange() {
  const room = findRoom($('admRoom').value); const bs = $('admBed');
  if (!room) { bs.innerHTML = '<option value="">—</option>'; calcBill(); return; }
  bs.innerHTML = room.beds.map((x, i) => (x.name ? '' : `<option value="${i}">Bed ${i + 1}</option>`)).join('');
  $('admMonthlyRent').value = bedPrice(room.beds.length); calcBill();
}
function calcBill() {
  const a = num(S.settings.admission.admissionFee), f = num(S.settings.admission.formFee);
  if (document.activeElement !== $('admDeposit') && $('admDeposit').dataset.touched !== '1') $('admDeposit').value = S.settings.admission.deposit;
  const dep = num($('admDeposit').value), rent = num($('admMonthlyRent').value);
  $('calcAdm').textContent = money(a); $('calcDep').textContent = money(dep); $('calcForm').textContent = money(f); $('calcBed').textContent = money(rent); $('calcTotal').textContent = money(a + dep + f + rent);
}
function clearAdmission() {
  document.querySelectorAll('#tab-admission input[type=text], #tab-admission input:not([type]), #tab-admission input[type=number]').forEach((i) => { if (!['admMonthlyRent', 'admDeposit'].includes(i.id)) i.value = ''; });
  $('admBloodGroup').value = ''; photoData = ''; $('photoPreview').classList.add('hidden'); $('photoPlaceholder').classList.remove('hidden');
  const t = nowBs().bs.str; pickers.admBookingPicker.set(t); pickers.admAdmissionPicker.set(t); $('admDeposit').dataset.touched = ''; $('admPaid').checked = true;
  $('admBookingAD').textContent = adOf(t); $('admAdmissionAD').textContent = adOf(t); fillRoomSelect();
}
function readPhoto(file) {
  if (!file) return; const fr = new FileReader();
  fr.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 420 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photoData = c.toDataURL('image/jpeg', 0.82); $('photoPreview').src = photoData; $('photoPreview').classList.remove('hidden'); $('photoPlaceholder').classList.add('hidden'); }; img.src = fr.result; };
  fr.readAsDataURL(file);
}
async function saveAdmission() {
  const name = $('admName').value.trim().toUpperCase(); const room = findRoom($('admRoom').value); const bedIdx = $('admBed').value;
  document.querySelectorAll('.field-err').forEach((e) => e.classList.remove('field-err'));
  if (!name) { $('admName').classList.add('field-err'); toast('Enter the student\'s full name.', true); return; }
  if (!room || bedIdx === '' || room.beds[+bedIdx].name) { $('admRoom').classList.add('field-err'); toast('Choose a room with a free bed.', true); return; }
  const adm = pickers.admAdmissionPicker.get(); const b = B(); const id = uid('REC'); const stuId = uid('STU');
  const fees = { admissionFee: num(S.settings.admission.admissionFee), formFee: num(S.settings.admission.formFee), deposit: num($('admDeposit').value), bedFee: num($('admMonthlyRent').value) };
  const food = (document.querySelector('input[name=admFood]:checked') || {}).value || '';
  const g = (x) => $(x).value.trim();
  const rec = { id, studentId: stuId, roomId: room.id, bedIndex: +bedIdx, name, dob: pickers.admDobPicker.get(), whatsapp: g('admWhatsapp'), email: g('admEmail'), bloodGroup: $('admBloodGroup').value, district: g('admDistrict'), municipality: g('admMunicipality'), ward: g('admWard'), street: g('admStreet'), citizenship: g('admCitizenship'), institute: g('admInstitute'), shift: g('admShift'), level: g('admLevel'), foodPreference: food, health: g('admHealth'), fatherName: g('admFather'), motherName: g('admMother'), guardianName: g('admGuardian'), relation: g('admRelation'), emergencyPhone: g('admEmergencyPhone'), occupation: g('admOccupation'), guardianAddress: g('admGuardianAddress'), bookingDate: pickers.admBookingPicker.get(), admissionDate: adm, admissionDateBS: adm, roomLabel: room.label, roomNo: 'Bed ' + (+bedIdx + 1), approvedBy: g('admApprovedBy'), photo: photoData, paid: $('admPaid').checked, createdAt: new Date().toISOString(), ...fees };
  b.records.push(rec);
  b.students.push({ id: stuId, name, phone: rec.whatsapp, room: room.number, bed: P.logic.bedTypeOf(room.beds.length), fee: fees.bedFee, active: '1', since: ym(adm), until: '', recordId: id, roomId: room.id });
  room.beds[+bedIdx] = { studentId: stuId, name, phone: rec.whatsapp };
  if ($('admPaid').checked) {
    const ref = 'adm:' + id; const ad = adOf(adm);
    const inc = (category, amount, refundable) => { if (amount > 0) b.income.push({ id: uid('INC'), dateBS: adm, dateAD: ad, category, description: `${name} — ${room.label} (admission)`, amount, ref, refundable: !!refundable }); };
    inc('Admission Fee', fees.admissionFee); inc('Form Fee', fees.formFee); inc(DEP, fees.deposit, true);
    if (fees.bedFee > 0) {
      const fid = uid('FEE');
      b.fees.push({ id: fid, studentId: stuId, studentName: name, room: room.number, bed: P.logic.bedTypeOf(room.beds.length), forMonth: ym(adm), expected: fees.bedFee, amount: fees.bedFee, dateBS: adm, dateAD: ad, ref });
      b.income.push({ id: uid('INC'), dateBS: adm, dateAD: ad, category: 'Monthly Fee', description: `${name} — ${room.label} — ${monthName(+adm.slice(5, 7))} fee (first month)`, amount: fees.bedFee, ref, refundable: false });
    }
  }
  await persist(); lastAdm = id;
  $('admDoneText').textContent = `✔ ${name} admitted to ${room.label}, Bed ${+bedIdx + 1}.`; $('admDone').classList.remove('hidden');
  clearAdmission(); renderAdmList(); toast('Admission saved.');
}
function renderAdmList() {
  let box = $('admList'); if (!box) { box = document.createElement('div'); box.id = 'admList'; box.className = 'card p-5 mt-6'; $('tab-admission').appendChild(box); }
  const recs = [...B().records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  box.innerHTML = `<div class="font-bold mb-3">Admissions — ${esc(BR[branch].name)} (${recs.length})</div>` + (recs.length ? `<div class="scroll"><table class="sheet"><thead><tr><th>Date (BS)</th><th>Student</th><th>Room</th><th class="r">Joining bill</th><th></th></tr></thead><tbody>${recs.map((r) => `<tr><td>${esc(r.admissionDate)}</td><td>${esc(r.name)}</td><td>${esc(r.roomLabel)} · ${esc(r.roomNo)}</td><td class="r">${money(num(r.admissionFee) + num(r.deposit) + num(r.formFee) + num(r.bedFee))}</td><td class="r"><span class="link" data-act="adm-pdf" data-id="${esc(r.id)}">Open PDF</span> &nbsp; <span class="link link-red" data-act="adm-del" data-id="${esc(r.id)}">Delete</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="text-sm text-slate-500">No admissions yet.</div>');
}
async function deleteAdmission(id) {
  const b = B(); const rec = b.records.find((r) => r.id === id); if (!rec) return;
  if (!(await confirmBox('Delete admission?', `This removes ${rec.name}'s admission form, the income entries and fee records created by it, and frees the bed.`, 'Delete'))) return;
  const ref = 'adm:' + id;
  b.income = b.income.filter((r) => r.ref !== ref); b.fees = b.fees.filter((f) => f.ref !== ref);
  b.students = b.students.filter((s) => s.id !== rec.studentId); b.records = b.records.filter((r) => r.id !== id);
  b.rooms.forEach((r) => r.beds.forEach((x, i) => { if (x.studentId === rec.studentId) r.beds[i] = { studentId: null, name: null, phone: null }; }));
  await persist(); renderAdmList(); fillRoomSelect(); toast('Admission deleted.');
}

// ---------- STUDENTS ----------
function renderStudents() {
  const b = B(); const q = view.stuQ.toLowerCase();
  const list = b.students.filter((s) => !q || (s.name + ' ' + s.phone + ' ' + s.room).toLowerCase().includes(q)).sort((a, c) => a.name.localeCompare(c.name));
  $('tab-students').innerHTML = `<div class="flex items-center justify-between mb-4 flex-wrap gap-2"><div><div class="text-lg font-bold">Students — ${esc(BR[branch].name)}</div><div class="text-xs text-slate-500 mono">${b.students.filter((s) => s.active === '1').length} active · ${b.students.length} total</div></div><div class="flex gap-2"><input class="field-input" style="width:220px" placeholder="Search name / phone / room" value="${esc(view.stuQ)}" data-chg="stuq"><button class="btn text-white text-sm px-4 py-2 rounded-md dynamic-bg font-semibold" data-act="stu-add">＋ Add student</button></div></div>
  <div class="card p-2"><div class="scroll"><table class="sheet"><thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Room</th><th>Bed type</th><th class="r">Monthly fee</th><th>Since</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.room)}</td><td>${s.bed} Bed</td><td class="r">${money(s.fee)}</td><td>${esc(s.since)}</td><td>${s.active === '1' ? '<span class="tag tag-paid">Active</span>' : '<span class="tag tag-unpaid">Left ' + esc(s.until) + '</span>'}</td><td class="r"><span class="link" data-act="stu-edit" data-id="${esc(s.id)}">Edit</span> &nbsp; <span class="link" data-act="stu-toggle" data-id="${esc(s.id)}">${s.active === '1' ? 'Mark left' : 'Re-activate'}</span> &nbsp; <span class="link link-red" data-act="stu-del" data-id="${esc(s.id)}">Delete</span></td></tr>`).join('') || '<tr><td colspan="9" class="text-slate-500">No students. Admit one from the Admissions tab, or add manually.</td></tr>'}
  </tbody></table></div></div>`;
}
function studentModal(id, pre) {
  const s = id ? B().students.find((x) => x.id === id) : (pre || {});
  const bedOpts = (cur) => [1, 2, 3, 4].map((n) => `<option value="${n}" ${+cur === n ? 'selected' : ''}>${n} Bed — ${money(S.settings.bedPrices[n])}</option>`).join('');
  modal({ title: id ? 'Edit student' : 'Add student', body: field('Student name', inp('name', s.name || '')) + field('Phone number', inp('phone', s.phone || '')) + field('Room no.', inp('room', s.room || '')) + field('Bed type (sets the fee)', `<select name="bed" class="field-input">${bedOpts(s.bed || 2)}</select>`) + field('Monthly fee (Rs.) — leave blank to use the bed rate', inp('fee', s.fee || '', 'type="number"')),
    onOk: async (v) => {
      if (!v.name.trim()) return 'Enter the student name.';
      const bed = +v.bed; const fee = num(v.fee) || S.settings.bedPrices[bed];
      if (id) Object.assign(s, { name: v.name.trim(), phone: v.phone.trim(), room: v.room.trim(), bed, fee });
      else {
        const stu = { id: uid('STU'), name: v.name.trim(), phone: v.phone.trim(), room: v.room.trim(), bed, fee, active: '1', since: ym(nowBs().bs.str), until: '' };
        B().students.push(stu);
        if (pre && pre._bed) { const r = findRoom(pre._bed[0]); r.beds[pre._bed[1]] = { studentId: stu.id, name: stu.name, phone: stu.phone }; stu.roomId = r.id; }
      }
      await persist(); renderTab();
    } });
}

// ---------- MONTHLY FEE ----------
function renderMonthly() {
  const b = B(); const v = view.fee; const t = nowBs().bs; if (!v.y) { v.y = t.year; v.m = t.month; }
  const key = v.y + '-' + pad(v.m); const rows = feeRows(b, key);
  const exp = rows.reduce((a, r) => a + r.expected, 0), got = rows.reduce((a, r) => a + r.paid, 0);
  const allPaid = rows.length && rows.every((r) => r.status === 'paid');
  const pays = b.fees.filter((f) => f.forMonth === key).sort((a, c) => (a.dateBS < c.dateBS ? -1 : 1));
  $('tab-monthly').innerHTML = `<div class="flex items-center justify-between mb-4 flex-wrap gap-2"><div><div class="text-lg font-bold">Monthly Fee — ${esc(BR[branch].name)}</div><div class="text-xs text-slate-500 mono">${allPaid ? 'Everyone has paid — the PDF is marked final.' : 'The PDF stays marked (INCOMPLETE) until everyone has paid.'}</div></div><div class="flex gap-2">${monthPicker('fee', false, 'fee')}</div></div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">${[['EXPECTED', exp, ''], ['COLLECTED', got, 'text-emerald-600'], ['DUE', Math.max(0, exp - got), 'text-rose-600'], ['STUDENTS', rows.length, '']].map(([l, n, c]) => `<div class="card p-4"><div class="text-[11px] mono text-slate-500">${l}</div><div class="stat-num text-xl font-bold ${c}">${l === 'STUDENTS' ? n : money(n)}</div></div>`).join('')}</div>
  <div class="card p-2 mb-5"><div class="scroll"><table class="sheet"><thead><tr><th>#</th><th>Student</th><th>Phone</th><th>Room</th><th>Bed</th><th class="r">Fee</th><th class="r">Paid</th><th class="r">Due</th><th>Status</th><th>Paid on</th><th></th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.s.name)}</td><td>${esc(r.s.phone)}</td><td>${esc(r.s.room)}</td><td>${r.s.bed} Bed</td><td class="r">${money(r.expected)}</td><td class="r">${money(r.paid)}</td><td class="r">${money(r.status === 'unpaid' ? r.expected : r.due)}</td><td><span class="tag tag-${r.status}">${r.status === 'paid' ? 'Paid' : r.status === 'part' ? 'Part paid' : 'Not paid'}</span></td><td>${esc(r.dates.map((d) => d.slice(5)).join(', '))}</td><td class="r">${r.status === 'paid' ? '' : `<span class="link" data-act="fee-pay" data-id="${esc(r.s.id)}">Receive payment</span>`}</td></tr>`).join('') || '<tr><td colspan="11" class="text-slate-500">No students expected to pay in this month.</td></tr>'}
  </tbody></table></div></div>
  <div class="card p-5"><div class="font-bold text-sm mb-3">Payments received for ${monthName(v.m)} ${v.y}</div>${pays.length ? `<table class="sheet"><thead><tr><th>Date (BS)</th><th>Student</th><th class="r">Amount</th><th></th></tr></thead><tbody>${pays.map((f) => `<tr><td>${esc(f.dateBS)}</td><td>${esc(f.studentName)}</td><td class="r">${money(f.amount)}</td><td class="r">${f.ref && f.ref.startsWith('adm:') ? '<span class="text-xs text-slate-400">via admission</span>' : `<span class="link link-red" data-act="fee-undo" data-id="${esc(f.id)}">Undo</span>`}</td></tr>`).join('')}</tbody></table>` : '<div class="text-sm text-slate-500">No payments yet.</div>'}</div>`;
}
function payModal(stuId) {
  const v = view.fee; const key = v.y + '-' + pad(v.m); const row = feeRows(B(), key).find((r) => r.s.id === stuId); if (!row) return;
  const due = row.status === 'unpaid' ? row.expected : row.due;
  modal({ title: `Receive fee — ${row.s.name}`, body: `<div class="text-xs text-slate-500 mb-3">${monthName(v.m)} ${v.y} · Room ${esc(row.s.room)} · ${row.s.bed} Bed · fee ${money(row.expected)}</div>${field('Amount received (Rs.)', inp('amount', due, 'type="number"'))}${field('Date received (B.S.)', '<div id="payDate" class="bs-date-group"></div>')}`,
    onOk: async (val) => {
      const amount = num(val.amount); if (amount <= 0) return 'Enter an amount.';
      const dt = pickers.payDate.get(); const fid = uid('FEE'); const b = B();
      b.fees.push({ id: fid, studentId: row.s.id, studentName: row.s.name, room: row.s.room, bed: row.s.bed, forMonth: key, expected: row.expected, amount, dateBS: dt, dateAD: adOf(dt), ref: 'fee:' + fid });
      b.income.push({ id: uid('INC'), dateBS: dt, dateAD: adOf(dt), category: 'Monthly Fee', description: `${row.s.name} — Room ${row.s.room} — ${monthName(v.m)} fee`, amount, ref: 'fee:' + fid, refundable: false });
      await persist(); renderMonthly(); toast('Payment recorded in Income.');
    } });
  makePicker('payDate', nowBs().bs.str);
}

// ---------- INCOME / EXPENDITURE ----------
function catsOf(type) { return S.categories.filter((c) => c.type === type).map((c) => c.name); }
function renderLedger(type) {
  const inc = type === 'income'; const b = B(); const key = inc ? 'inc' : 'exp'; const v = view[key]; const t = nowBs().bs; if (!v.y) { v.y = t.year; v.m = t.month; }
  const rows = b[type].filter((r) => { const p = D.parse(r.dateBS); return p && p.year === v.y && (!v.m || p.month === v.m); }).sort((a, c) => (a.dateBS === c.dateBS ? 0 : a.dateBS < c.dateBS ? -1 : 1));
  const total = sumOf(inc ? rows.filter((r) => !isRef(r)) : rows); const dep = inc ? sumOf(rows.filter(isRef)) : 0;
  const cats = catsOf(type); const el = $('tab-' + type);
  el.innerHTML = `<div class="flex items-center justify-between mb-4 flex-wrap gap-2"><div><div class="text-lg font-bold">${inc ? 'Income' : 'Expenditure'} Ledger — ${esc(BR[branch].name)}</div><div class="text-xs text-slate-500 mono">${inc ? 'Refundable deposits are listed but not counted as revenue.' : 'Choose the particulars from the list or add a new one.'}</div></div><div class="flex gap-2">${monthPicker(key, true, 'led')}</div></div>
  <div class="card p-4 mb-4"><div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
    <div class="md:col-span-3"><label class="field-label">DATE (B.S.)</label><div id="${type}Date" class="bs-date-group"></div></div>
    <div class="md:col-span-3"><label class="field-label">${inc ? 'CATEGORY' : 'PARTICULARS'}</label><div class="flex gap-1"><select id="${type}Cat" class="field-input">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select><button class="btn px-2 rounded-md border border-slate-300 bg-white" data-act="cat-add" data-type="${type}" title="Add a new one">＋</button></div></div>
    <div class="md:col-span-3"><label class="field-label">DETAILS</label><input id="${type}Desc" class="field-input" placeholder="optional note"></div>
    <div class="md:col-span-2"><label class="field-label">AMOUNT (Rs.)</label><input id="${type}Amt" type="number" min="0" class="field-input"></div>
    <div class="md:col-span-1"><button class="btn w-full text-white py-2 rounded-md dynamic-bg font-semibold" data-act="led-add" data-type="${type}">Add</button></div></div></div>
  <div class="card p-2"><div class="scroll"><table class="sheet"><thead><tr><th>#</th><th>Date (B.S.)</th><th>Date (A.D.)</th><th>${inc ? 'Category' : 'Particulars'}</th><th>Details</th><th class="r">Amount</th><th></th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.dateBS)}</td><td>${esc(r.dateAD)}</td><td>${esc(r.category)}${inc && isRef(r) ? ` <span class="tag tag-part">refundable${r.refundedOn ? ' · returned ' + esc(r.refundedOn) : ''}</span>` : ''}</td><td>${esc(r.description)}</td><td class="r">${money(r.amount)}</td><td class="r">${r.ref ? '<span class="text-xs text-slate-400" title="Created by Monthly Fee / Admission — change it there">🔒 auto</span>' : ''} ${inc && isRef(r) ? `<span class="link" data-act="dep-ret" data-id="${esc(r.id)}">${r.refundedOn ? 'Un-mark' : 'Mark returned'}</span> ` : ''}${r.ref ? '' : `<span class="link" data-act="led-edit" data-type="${type}" data-id="${esc(r.id)}">Edit</span> &nbsp; <span class="link link-red" data-act="led-del" data-type="${type}" data-id="${esc(r.id)}">Delete</span>`}</td></tr>`).join('') || '<tr><td colspan="7" class="text-slate-500">No entries for this period.</td></tr>'}
  </tbody><tfoot><tr><td colspan="5">Total${inc ? ' revenue' : ''} — ${v.m ? monthName(v.m) + ' ' : ''}${v.y}${dep ? ` &nbsp;<span class="text-xs font-normal">(+ ${money(dep)} refundable deposits not counted)</span>` : ''}</td><td class="r">${money(total)}</td><td></td></tr></tfoot></table></div></div>`;
  const keep = pickers[type + 'Date'] ? pickers[type + 'Date'].get() : null;
  makePicker(type + 'Date', keep || t.year + '-' + pad(t.month) + '-' + pad(t.day));
}
function ledgerAdd(type) {
  const amount = num($(type + 'Amt').value); if (amount <= 0) { toast('Enter an amount.', true); return; }
  const dt = pickers[type + 'Date'].get(); const cat = $(type + 'Cat').value;
  B()[type].push({ id: uid(type === 'income' ? 'INC' : 'EXP'), dateBS: dt, dateAD: adOf(dt), category: cat, description: $(type + 'Desc').value.trim(), amount, ref: '', refundable: cat === DEP });
  persist().then(() => { view[type === 'income' ? 'inc' : 'exp'].y = +dt.slice(0, 4); view[type === 'income' ? 'inc' : 'exp'].m = +dt.slice(5, 7); renderLedger(type); toast('Entry added.'); });
}
function ledgerEdit(type, id) {
  const r = B()[type].find((x) => x.id === id); if (!r) return;
  modal({ title: 'Edit entry', body: field('Date (B.S.)', '<div id="edDate" class="bs-date-group"></div>') + field(type === 'income' ? 'Category' : 'Particulars', `<select name="cat" class="field-input">${catsOf(type).map((c) => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`) + field('Details', inp('desc', r.description)) + field('Amount', inp('amount', r.amount, 'type="number"')),
    onOk: async (v) => { if (num(v.amount) <= 0) return 'Enter an amount.'; const dt = pickers.edDate.get(); Object.assign(r, { dateBS: dt, dateAD: adOf(dt), category: v.cat, description: v.desc.trim(), amount: num(v.amount), refundable: v.cat === DEP }); await persist(); renderLedger(type); } });
  makePicker('edDate', r.dateBS);
}
function catModal(type) {
  modal({ title: type === 'income' ? 'New income category' : 'New expenditure particular', body: field('Name', inp('name', '')), onOk: async (v) => {
    const n = v.name.trim(); if (!n) return 'Enter a name.'; if (catsOf(type).some((c) => c.toLowerCase() === n.toLowerCase())) return 'It already exists.';
    S.categories.push({ type, name: n }); await persist(); if (tab === 'settings') renderSettings(); else { const k = pickers[type + 'Date'].get(); renderLedger(type); pickers[type + 'Date'].set(k); $(type + 'Cat').value = n; }
  } });
}

// ---------- SETTINGS ----------
function renderSettings() {
  const s = S.settings; const protectedCats = new Set([DEP, 'Monthly Fee', 'Admission Fee', 'Form Fee']);
  const catList = (type) => `<div class="flex flex-wrap gap-2">${S.categories.filter((c) => c.type === type).map((c) => `<span class="chip" style="background:#f1f5f9">${esc(c.name)}${protectedCats.has(c.name) && type === 'income' ? '' : ` <span class="link link-red" data-act="cat-del" data-type="${type}" data-name="${esc(c.name)}">✕</span>`}</span>`).join('')}</div><button class="link mt-3" data-act="cat-add" data-type="${type}">＋ Add ${type === 'income' ? 'income category' : 'expenditure particular'}</button>`;
  const last = STATUS.lastSaveAt ? new Date(STATUS.lastSaveAt).toLocaleString() : 'never';
  $('tab-settings').innerHTML = `<div class="text-lg font-bold mb-4">Settings</div><div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <div class="card p-5"><div class="font-bold mb-3">Bed rates (per month)</div><div class="grid grid-cols-2 gap-3">${[1, 2, 3, 4].map((n) => `<div><label class="field-label">${n} BED ROOM</label><input type="number" class="field-input" id="bp${n}" value="${s.bedPrices[n]}"></div>`).join('')}</div>
    <div class="font-bold mt-5 mb-3">Admission charges</div><div class="grid grid-cols-3 gap-3"><div><label class="field-label">ADMISSION FEE</label><input type="number" class="field-input" id="sAdm" value="${s.admission.admissionFee}"></div><div><label class="field-label">DEPOSIT</label><input type="number" class="field-input" id="sDep" value="${s.admission.deposit}"></div><div><label class="field-label">FORM FEE</label><input type="number" class="field-input" id="sForm" value="${s.admission.formFee}"></div></div>
    <button class="btn text-white text-sm px-4 py-2 rounded-md dynamic-bg font-semibold mt-4" data-act="set-save">Save settings</button><div class="text-xs text-slate-500 mt-2">New rates apply to new admissions and new students. Existing students keep their fee (edit it in Students).</div></div>
  <div class="card p-5"><div class="font-bold mb-3">Income categories</div>${catList('income')}<div class="font-bold mt-6 mb-3">Expenditure particulars</div>${catList('expenditure')}</div>
  <div class="card p-5"><div class="font-bold mb-3">Saving, folder &amp; backup</div><div class="text-sm space-y-1"><div>Data is stored inside the app on this computer the moment you type it — closing the app loses nothing.</div><div>Press <b>💾 Save</b> to write the PDF reports and a data backup into your save folder. Choose a folder inside <b>Google Drive</b> (Google Drive for Desktop) and Google uploads everything automatically. Last saved: <b>${esc(last)}</b>${STATUS.dirty ? ' · <span class="text-amber-600">unsaved changes</span>' : ''}</div></div>
    <div class="text-xs mono text-slate-600 mt-3 break-all" id="driveInfo">Save folder: checking…</div>
    <div class="flex flex-wrap gap-2 mt-3"><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="open-folder">📂 Choose save folder</button><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="regen">Rebuild all PDFs</button></div>
    <div class="font-bold mt-5 mb-2">Backup file</div>
    <div class="text-xs text-slate-500">Download one file with all data, or restore from a backup. You can also restore the data of the old desktop app: <span class="mono">Documents\\PADMA HOSTEL FINANCE\\Backup\\padma-data.json</span></div>
    <div class="flex flex-wrap gap-2 mt-3"><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="bk-download">⬇ Download backup file</button><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="bk-restore">⬆ Restore from backup…</button><input type="file" id="bkFile" accept=".json,application/json" class="hidden"></div>
    <div class="text-xs text-slate-400 mt-4">App version ${esc(P.version)}</div></div>
  <div class="card p-5"><div class="font-bold mb-3">Login (change username / password)</div>${field('Current password', '<input type="password" class="field-input" id="acOld">')}${field('New username', '<input class="field-input" id="acUser">')}${field('New password (min 6 characters)', '<input type="password" class="field-input" id="acNew">')}<button class="btn text-white text-sm px-4 py-2 rounded-md dynamic-bg font-semibold" data-act="acc-save">Update login</button>${INFO.fallback ? '<div class="text-xs text-amber-700 mt-2">Default login admin/admin is active — please change it.</div>' : ''}</div></div>`;
  P.backup.folderInfo(token).then((f) => {
    const e = $('driveInfo'); if (!e) return;
    if (!f.supported) { e.innerHTML = '<span class="text-rose-600">Saving into a folder needs Microsoft Edge or Google Chrome. Use “Download backup file” instead.</span>'; return; }
    if (!f.name) { e.innerHTML = '<span class="text-amber-700">Save folder: not chosen yet — press “Choose save folder”.</span>'; return; }
    const auto = f.lastAutoBackup ? ' · automatic data backup: ' + new Date(f.lastAutoBackup).toLocaleString() : '';
    e.innerHTML = 'Save folder: <b>' + esc(f.name) + '</b>' + (f.permission === 'granted' ? ' · ✔ allowed' + esc(auto) : ' · <span class="text-amber-700">permission needed — it will be asked when you press Save</span>');
  }).catch(() => {});
}

async function restoreFrom(file) {
  if (!file) return;
  try {
    const { data, summary: m } = await P.backup.read(token, file);
    const ok = await confirmBox('Restore this backup?', `The file "${file.name}" has ${m.students} students, ${m.admissions} admissions, ${m.fees} fee payments, ${m.income} income and ${m.expenditure} expenditure entries. ALL data now in the app will be replaced by it. (Tip: press “Download backup file” first if you want to keep the current data.)`, 'Replace & restore');
    if (!ok) return;
    S = await P.backup.restore(token, data);
    STATUS = await P.reports.status(token);
    setBranch(branch); updateSaveUi();
    toast('Backup restored.');
  } catch (e) { toast(e.message || String(e), true); }
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act; const id = el.dataset.id; const type = el.dataset.type;
  try {
    if (a === 'room-add') roomModal(null);
    else if (a === 'room-edit') roomModal(id);
    else if (a === 'bed') bedModal(id, +el.dataset.i);
    else if (a === 'adm-pdf') await P.openAdmission(token, branch, id);
    else if (a === 'adm-del') await deleteAdmission(id);
    else if (a === 'stu-add') studentModal(null);
    else if (a === 'stu-edit') studentModal(id);
    else if (a === 'stu-toggle') { const s = B().students.find((x) => x.id === id); if (s.active === '1') { s.active = '0'; s.until = ym(nowBs().bs.str); B().rooms.forEach((r) => r.beds.forEach((x, i) => { if (x.studentId === id) r.beds[i] = { studentId: null, name: null, phone: null }; })); } else { s.active = '1'; s.until = ''; } await persist(); renderStudents(); }
    else if (a === 'stu-del') { if (await confirmBox('Delete student?', 'Their past payments stay in the records. This only removes them from the list.', 'Delete')) { B().students = B().students.filter((x) => x.id !== id); B().rooms.forEach((r) => r.beds.forEach((x, i) => { if (x.studentId === id) r.beds[i] = { studentId: null, name: null, phone: null }; })); await persist(); renderStudents(); } }
    else if (a === 'fee-pay') payModal(id);
    else if (a === 'fee-undo') { if (await confirmBox('Undo payment?', 'The payment and its income entry will be removed.', 'Undo')) { const f = B().fees.find((x) => x.id === id); B().fees = B().fees.filter((x) => x.id !== id); B().income = B().income.filter((r) => r.ref !== (f && f.ref)); await persist(); renderMonthly(); } }
    else if (a === 'led-add') ledgerAdd(type);
    else if (a === 'led-edit') ledgerEdit(type, id);
    else if (a === 'led-del') { if (await confirmBox('Delete entry?', 'This entry will be removed from the ledger.', 'Delete')) { B()[type] = B()[type].filter((r) => r.id !== id); await persist(); renderLedger(type); } }
    else if (a === 'dep-ret') { const r = B().income.find((x) => x.id === id); r.refundedOn = r.refundedOn ? '' : nowBs().bs.str; await persist(); renderLedger('income'); }
    else if (a === 'cat-add') catModal(type);
    else if (a === 'cat-del') { S.categories = S.categories.filter((c) => !(c.type === type && c.name === el.dataset.name)); await persist(); renderSettings(); }
    else if (a === 'set-save') { [1, 2, 3, 4].forEach((n) => { S.settings.bedPrices[n] = num($('bp' + n).value); }); S.settings.admission = { admissionFee: num($('sAdm').value), deposit: num($('sDep').value), formFee: num($('sForm').value) }; await persist(); $('admDeposit').dataset.touched = ''; toast('Settings saved.'); }
    else if (a === 'open-folder') { const name = await P.backup.chooseFolder(token); toast('Save folder set: ' + name + '. Press 💾 Save to write the reports there.'); renderSettings(); }
    else if (a === 'bk-download') { await P.backup.download(token); toast('Backup file downloaded.'); }
    else if (a === 'bk-restore') { const fi = $('bkFile'); fi.value = ''; fi.onchange = () => restoreFrom(fi.files[0]); fi.click(); }
    else if (a === 'regen') { toast('Rebuilding all PDFs…'); STATUS = await P.reports.regenerate(token); updateSaveUi(); toast(STATUS.errors ? STATUS.message : 'All PDFs rebuilt.', !!STATUS.errors); }
    else if (a === 'acc-save') { const r = await P.auth.change(token, $('acOld').value, $('acUser').value.trim(), $('acNew').value); toast(r === true || (r && r.ok !== false) ? 'Login updated.' : (r.error || 'Could not update.'), r && r.ok === false); }
  } catch (err) { toast(err.message || String(err), true); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]'); if (!el) return; const k = el.dataset.chg;
  if (k === 'stuq') { view.stuQ = el.value; renderStudents(); const i = document.querySelector('[data-chg=stuq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
  const v = view[el.dataset.k]; v[el.dataset.f] = +el.value;
  if (k === 'dash') renderDashboard(); else if (k === 'fee') renderMonthly(); else if (k === 'led') renderLedger(tab);
});

function initApp() {
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.querySelectorAll('.branch-btn').forEach((b) => b.addEventListener('click', () => setBranch(b.dataset.branch)));
  $('saveBtn').onclick = () => doSave(false); $('webBtn').onclick = () => doSave(true); $('saveBannerBtn').onclick = () => doSave(false);
  $('logoutBtn').onclick = async () => { await P.auth.logout(token); location.reload(); };
  const t = nowBs().bs.str;
  makePicker('admDobPicker', '2060-01-01', 1990, nowBs().bs.year); makePicker('admBookingPicker', t); makePicker('admAdmissionPicker', t);
  pickers.admBookingPicker.onChange = (s) => { $('admBookingAD').textContent = adOf(s); };
  pickers.admAdmissionPicker.onChange = (s) => { $('admAdmissionAD').textContent = adOf(s); };
  $('admBookingAD').textContent = adOf(t); $('admAdmissionAD').textContent = adOf(t);
  $('admRoom').onchange = onRoomChange; $('admMonthlyRent').oninput = calcBill; $('admDeposit').oninput = () => { $('admDeposit').dataset.touched = '1'; calcBill(); };
  $('photoBox').onclick = () => $('admPhotoInput').click(); $('admPhotoInput').onchange = (e) => readPhoto(e.target.files[0]);
  $('admClearBtn').onclick = clearAdmission; $('admSaveBtn').onclick = saveAdmission;
  $('admDonePdf').onclick = () => lastAdm && P.openAdmission(token, branch, lastAdm).catch((e) => toast(e.message, true));
  P.onReports((s) => { STATUS = s; updateSaveUi(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(false); } });
  tickClock(); setInterval(tickClock, 1000); checkOnline(); setInterval(checkOnline, 5000);
  window.addEventListener('online', checkOnline); window.addEventListener('offline', checkOnline);
  setInterval(updateSaveUi, 600000);
  setBranch('PHB-01'); setTab('dashboard'); updateSaveUi();
}

$('loginBtn').onclick = login;
prepareLogin();
['loginUser', 'loginPass', 'loginPass2'].forEach((i) => $(i).addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); }));
$('loginUser').focus();
