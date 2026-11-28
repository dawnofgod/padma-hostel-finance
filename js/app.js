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
const view = { dash: { y: 0, m: 0 }, fee: { y: 0, m: 0 }, inc: { y: 0, m: 0 }, exp: { y: 0, m: 0 }, stuQ: '', bal: { scope: 'one', q: '', show: 'all' } };
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
function modal({ title, body, ok = 'Save', cancel = 'Cancel', onOk, wide, onCancel }) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-back"><div class="modal" ${wide ? 'style="max-width:680px"' : ''}><h3>${esc(title)}</h3><div id="mBody">${body}</div><div id="mErr" class="text-xs text-rose-600 mt-2 hidden"></div><div class="flex justify-end gap-2 mt-5">${cancel ? '<button class="btn px-4 py-2 rounded-md border border-slate-300 bg-white text-sm" id="mCancel">' + esc(cancel) + '</button>' : ''}<button class="btn px-4 py-2 rounded-md text-white text-sm font-semibold dynamic-bg" id="mOk">${esc(ok)}</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  const first = root.querySelector('input,select'); if (first) first.focus();
  if ($('mCancel')) $('mCancel').onclick = () => { close(); if (onCancel) onCancel(); };
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
      toast(STATUS.errors ? STATUS.message : (STATUS.drive ? `Saved and uploaded to Google Drive. ${STATUS.changed} PDF(s) updated.` + (STATUS.message ? ' ' + STATUS.message + '.' : '') : (STATUS.message ? STATUS.message + '.' : `Saved. ${STATUS.changed} PDF(s) updated in the month folders.`)), !!STATUS.errors || !!STATUS.message);
    }
  } catch (e) { toast(e.message || String(e), true); }
  btn.disabled = false; $('webLabel').textContent = '⬇ Backup file'; updateSaveUi();
}

// ---------- login ----------
// Staff log in with the username + password the admin made for them (first time online, then also offline).
let ACC = {};
const showErr = (m) => { const e = $('loginErr'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
function step(id) {
  document.querySelectorAll('.gate-step').forEach((el) => el.classList.toggle('hidden', el.id !== 'step' + id));
  showErr('');
  if (id === 'Login') setTimeout(() => $('loginUser').focus(), 30);
}
async function prepareLogin() {
  P.account.env().then((env) => { if (env === 'test') { $('envBadge').classList.remove('hidden'); document.title = 'Padma Hostel Finance TEST'; } });
  ACC = await P.account.info();
  if (ACC.username) $('loginUser').value = ACC.username;
  step('Login');
}
async function login() {
  $('loginBtn').disabled = true;
  try {
    const r = await P.account.login($('loginUser').value.trim(), $('loginPass').value);
    if (!r.ok) return showErr(r.error || 'Wrong username or password.');
    token = r.token; INFO.fallback = false;
    const d = await P.load(token);
    S = d.state; INFO.folder = d.folder; INFO.dbFile = d.dbFile; STATUS = d.status;
    ACC = await P.account.info();
    $('loginPass').value = '';
    $('loginScreen').classList.add('hidden'); $('app').classList.remove('hidden');
    initApp();
  } finally { $('loginBtn').disabled = false; }
}
function applyBranding() {
  $('hdrSub').textContent = ACC.env === 'test' ? 'Finance Console · TEST' : 'Finance Console';
  const who = ACC.profile ? ' · ' + ACC.profile : '';
  $('hdrSub').title = (ACC.email || '') + who;
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
  ({ dashboard: renderDashboard, rooms: renderRooms, admission: renderAdmList, students: renderStudents, monthly: renderMonthly, income: () => renderLedger('income'), expenditure: () => renderLedger('expenditure'), settings: renderSettings, balance: renderBalance }[tab])();
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
// all fees still unpaid from each student's first month up to this month
function dueAllMonths(b, curYm) {
  const since = b.students.map((s) => String(s.since || '')).filter((x) => /^\d{4}-\d{2}$/.test(x)).sort()[0];
  let total = 0; const who = new Set();
  if (!since) return { total, students: 0 };
  let [y, m] = since.split('-').map(Number); let guard = 0;
  while (`${y}-${pad(m)}` <= curYm && guard++ < 120) {
    feeRows(b, `${y}-${pad(m)}`).forEach((r) => { const d = r.status === 'unpaid' ? r.expected : r.due; if (d > 0) { total += d; who.add(r.s.id); } });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return { total, students: who.size };
}
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
  const dueAll = dueAllMonths(b, curYm);
  const heldBoth = Object.keys(all).reduce((a, id) => a + sumOf(S.branches[id].income.filter((r) => isRef(r) && !r.refundedOn)), 0);
  const dueBoth = Object.keys(all).reduce((a, id) => a + dueAllMonths(S.branches[id], curYm).total, 0);
  // 12-month chart
  const mon = Array.from({ length: 12 }, (_, i) => totals(b, v.y, i + 1));
  const max = Math.max(1, ...mon.map((x) => Math.max(x.revenue, x.expenditure)));
  const bars = mon.map((x, i) => {
    const hr = Math.round((x.revenue / max) * 120), he = Math.round((x.expenditure / max) * 120), cx = 20 + i * 52;
    return `<rect x="${cx}" y="${140 - hr}" width="18" height="${hr}" fill="#10b981"><title>${monthName(i + 1)} revenue ${money(x.revenue)}</title></rect><rect x="${cx + 20}" y="${140 - he}" width="18" height="${he}" fill="#f43f5e"><title>${monthName(i + 1)} expenditure ${money(x.expenditure)}</title></rect><text x="${cx + 19}" y="156" font-size="9" text-anchor="middle" fill="#64748b">${monthName(i + 1).slice(0, 3)}</text>`;
  }).join('');
  $('tab-dashboard').innerHTML = `
  <div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><div class="text-lg font-bold">${esc(BR[branch].name)} — Dashboard</div><div class="text-xs text-slate-500 mono">Revenue excludes refundable security deposits.</div></div><div class="flex gap-2">${monthPicker('dash', false, 'dash')}</div></div>
  <div class="text-xs font-bold mono text-slate-400 uppercase mb-2">Payable &amp; receivable — today</div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 cursor-pointer" data-act="go-balance" title="Open the Balance Sheet to see each student">
    ${stat('PAYABLE — DEPOSITS TO RETURN', money(heldAll), 'text-amber-700', `Refundable security deposits not returned yet (${b.income.filter((r) => isRef(r) && !r.refundedOn).length} students). Both hostels: ${money(heldBoth)}`)}
    ${stat('RECEIVABLE — FEES STILL DUE', money(dueAll.total), 'text-rose-600', `Unpaid monthly fees up to ${monthName(t.month)} ${t.year} (${dueAll.students} students). Both hostels: ${money(dueBoth)}`)}
  </div>
  <div class="text-xs text-slate-500 mb-5" style="margin-top:-.75rem">Click a box to see each student in the <span class="link" data-act="go-balance">Balance Sheet</span>.</div>
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


// ---------- BALANCE SHEET ----------
// Who you owe (deposits to give back) and who owes you (deposits not taken, unpaid monthly fees), by student.
const depositsOf = (b, s) => b.income.filter((r) => isRef(r) && (r.studentId === s.id || (s.recordId && r.ref === 'adm:' + s.recordId)));
function balanceRows(brId) {
  const b = S.branches[brId]; const t = nowBs().bs; const curYm = t.year + '-' + pad(t.month);
  const linked = new Set();
  const dep = []; const fee = new Map();
  for (const s of b.students) {
    const ds = depositsOf(b, s); ds.forEach((r) => linked.add(r.id));
    const rec = s.recordId ? b.records.find((r) => r.id === s.recordId) : null;
    const left = s.active !== '1';
    if (ds.length) {
      for (const r of ds) {
        const state = r.refundedOn ? 'returned' : left ? 'return-now' : 'held';
        dep.push({ br: brId, s, r, name: s.name, room: s.room, phone: s.phone, amount: num(r.amount), date: r.dateBS, returned: r.refundedOn || '', left, until: s.until, state });
      }
    } else if (!left) {
      const expect = rec ? num(rec.deposit) : num(S.settings.admission.deposit);
      dep.push({ br: brId, s, r: null, name: s.name, room: s.room, phone: s.phone, amount: expect, date: '', returned: '', left, until: s.until, state: expect > 0 ? 'not-taken' : 'none' });
    }
  }
  // deposits typed straight into the Income ledger and not linked to a student
  b.income.filter((r) => isRef(r) && !linked.has(r.id)).forEach((r) => dep.push({ br: brId, s: null, r, name: String(r.description || r.category).split(' — ')[0], room: '', phone: '', amount: num(r.amount), date: r.dateBS, returned: r.refundedOn || '', left: false, until: '', state: r.refundedOn ? 'returned' : 'held' }));
  // unpaid monthly fees, month by month
  const since = b.students.map((x) => String(x.since || '')).filter((x) => /^\d{4}-\d{2}$/.test(x)).sort()[0];
  if (since) {
    let [y, m] = since.split('-').map(Number); let guard = 0;
    while (`${y}-${pad(m)}` <= curYm && guard++ < 120) {
      const key = `${y}-${pad(m)}`;
      feeRows(b, key).forEach((r) => {
        const d = r.status === 'unpaid' ? r.expected : r.due;
        if (!fee.has(r.s.id)) fee.set(r.s.id, { br: brId, s: r.s, months: [], total: 0, paidMonths: 0 });
        const f = fee.get(r.s.id);
        if (d > 0) { f.months.push({ key, y, m, due: d, part: r.status === 'part' }); f.total += d; } else f.paidMonths += 1;
      });
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  }
  return { dep, fee: [...fee.values()] };
}
const BADGE = {
  returned: ['bal-green', '🟢 Returned'],
  held: ['bal-blue', '🔵 Taken — holding'],
  'return-now': ['bal-orange', '🟠 Left — return now'],
  'not-taken': ['bal-red', '🔴 Not taken'],
  none: ['bal-grey', '⚪ No deposit'],
  'fee-ok': ['bal-teal', '🟩 All paid'],
  'fee-part': ['bal-amber', '🟨 Part paid'],
  'fee-due': ['bal-purple', '🟪 Fee due'],
};
const badge = (k) => `<span class="bal-badge ${BADGE[k][0]}">${BADGE[k][1]}</span>`;
function balanceData() {
  const ids = view.bal.scope === 'both' ? Object.keys(BR) : [branch];
  const q = view.bal.q.toLowerCase();
  const hit = (x) => !q || `${x.name} ${x.room} ${x.phone}`.toLowerCase().includes(q);
  let dep = [], fee = [];
  ids.forEach((id) => { const r = balanceRows(id); dep = dep.concat(r.dep); fee = fee.concat(r.fee); });
  fee = fee.map((f) => ({ ...f, name: f.s.name, room: f.s.room, phone: f.s.phone || '', state: !f.total ? 'fee-ok' : f.months.every((x) => x.part) ? 'fee-part' : 'fee-due' }));
  const payable = sumOf(dep.filter((d) => d.state === 'held' || d.state === 'return-now'));
  const returnNow = sumOf(dep.filter((d) => d.state === 'return-now'));
  const depDue = sumOf(dep.filter((d) => d.state === 'not-taken'));
  const feeDue = fee.reduce((a, f) => a + f.total, 0);
  const order = { 'return-now': 0, 'not-taken': 1, held: 2, returned: 3, none: 4, 'fee-due': 0, 'fee-part': 1, 'fee-ok': 2 };
  const sorter = (a, c) => order[a.state] - order[c.state] || String(a.name).localeCompare(String(c.name));
  return { ids, payable, returnNow, depDue, feeDue, dep: dep.filter(hit).sort(sorter), fee: fee.filter(hit).sort(sorter), allDep: dep, allFee: fee };
}
function renderBalance() {
  const v = view.bal; const d = balanceData(); const both = v.scope === 'both';
  const t = nowBs().bs;
  const receivable = d.depDue + d.feeDue; const net = receivable - d.payable;
  const show = v.show;
  const depRows = d.dep.filter((x) => show === 'all' || (show === 'open' && x.state !== 'returned' && x.state !== 'none'));
  const feeRowsF = d.fee.filter((x) => show === 'all' || (show === 'open' && x.total > 0));
  const hcol = both ? '<th>Hostel</th>' : '';
  const hcell = (br) => (both ? `<td>${esc(BR[br].name.replace('Padma ', ''))}</td>` : '');
  const stuCell = (x) => `<td><b>${esc(x.name)}</b>${x.phone ? `<div class="text-xs text-slate-500">${esc(x.phone)}</div>` : ''}</td>`;
  const depAct = (x) => {
    if (x.state === 'not-taken' || x.state === 'none') return x.s ? `<span class="link" data-act="bal-dep-take" data-br="${x.br}" data-id="${esc(x.s.id)}">Receive deposit</span>` : '';
    if (x.state === 'returned') return `<span class="link" data-act="bal-dep-ret" data-br="${x.br}" data-id="${esc(x.r.id)}">Undo</span>`;
    return `<span class="link" data-act="bal-dep-ret" data-br="${x.br}" data-id="${esc(x.r.id)}">Mark returned</span>`;
  };
  const stayCell = (x) => (x.s ? (x.left ? `Left ${esc(x.until)}` : 'Staying') : '—');
  const card = (label, val, cls, sub) => `<div class="card p-5"><div class="text-[11px] mono text-slate-500">${label}</div><div class="stat-num text-2xl font-bold mt-1 ${cls}">${money(val)}</div><div class="text-xs text-slate-500 mt-1">${sub}</div></div>`;
  $('tab-balance').innerHTML = `
  <div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><div class="text-lg font-bold">Balance Sheet — ${both ? 'Both hostels' : esc(BR[branch].name)}</div><div class="text-xs text-slate-500 mono">Payable and receivable by student, as of today (${esc(t.str)}).</div></div>
    <div class="flex gap-2 flex-wrap items-center">
      <select class="field-input" style="width:auto" data-chg="bal" data-f="scope"><option value="one" ${!both ? 'selected' : ''}>This hostel</option><option value="both" ${both ? 'selected' : ''}>Both hostels</option></select>
      <select class="field-input" style="width:auto" data-chg="bal" data-f="show"><option value="all" ${show === 'all' ? 'selected' : ''}>Show everyone</option><option value="open" ${show === 'open' ? 'selected' : ''}>Only money pending</option></select>
      <input class="field-input" style="width:200px" placeholder="Search name / room / phone" value="${esc(v.q)}" data-chg="balq">
      <button class="btn text-sm px-4 py-2 rounded-md border font-semibold" data-act="bal-print">🖨 Print / PDF</button></div></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
    ${card('PAYABLE — WE MUST GIVE BACK', d.payable, 'text-amber-700', `Deposits we are holding. ${d.returnNow ? `<b class="text-rose-600">${money(d.returnNow)} for students who already left.</b>` : 'Nobody who left is waiting.'}`)}
    ${card('RECEIVABLE — STUDENTS MUST PAY US', receivable, 'text-rose-600', `Monthly fees ${money(d.feeDue)} + deposits not taken ${money(d.depDue)}`)}
    ${card('NET (RECEIVABLE − PAYABLE)', net, netCls(net), !net ? 'Nothing pending either way.' : net > 0 ? 'More is owed to us than we owe.' : 'We owe more than is owed to us.')}
  </div>
  <div class="card p-3 mb-5 text-xs flex flex-wrap gap-3 items-center"><b>Signs:</b> ${badge('returned')} ${badge('held')} ${badge('return-now')} ${badge('not-taken')} ${badge('none')} <span class="text-slate-400">|</span> ${badge('fee-ok')} ${badge('fee-part')} ${badge('fee-due')}</div>
  <div class="card p-2 mb-5"><div class="font-bold px-3 pt-3 pb-1">1. Security deposits <span class="text-xs font-normal text-slate-500">— who gave a deposit, who has not, and who must get it back</span></div><div class="scroll"><table class="sheet" id="balDep"><thead><tr><th>#</th>${hcol}<th>Student</th><th>Room</th><th>Stay</th><th>Sign</th><th class="r">Deposit</th><th>Taken on</th><th>Returned on</th><th></th></tr></thead><tbody>
  ${depRows.map((x, i) => `<tr><td>${i + 1}</td>${hcell(x.br)}${stuCell(x)}<td>${esc(x.room)}</td><td>${stayCell(x)}</td><td>${badge(x.state)}</td><td class="r">${x.state === 'none' ? '—' : money(x.amount)}</td><td>${esc(x.date) || '—'}</td><td>${esc(x.returned) || '—'}</td><td class="r noprint">${depAct(x)}</td></tr>`).join('') || `<tr><td colspan="${both ? 10 : 9}" class="text-slate-500">Nothing to show.</td></tr>`}
  </tbody></table></div></div>
  <div class="card p-2"><div class="font-bold px-3 pt-3 pb-1">2. Monthly fees <span class="text-xs font-normal text-slate-500">— who has paid and who still owes, up to ${monthName(t.month)} ${t.year}</span></div><div class="scroll"><table class="sheet" id="balFee"><thead><tr><th>#</th>${hcol}<th>Student</th><th>Room</th><th>Sign</th><th>Unpaid months</th><th class="r">Amount due</th><th></th></tr></thead><tbody>
  ${feeRowsF.map((x, i) => `<tr><td>${i + 1}</td>${hcell(x.br)}${stuCell(x)}<td>${esc(x.room)}</td><td>${badge(x.state)}</td><td>${x.months.length ? x.months.map((mm) => `${monthName(mm.m)}${mm.y !== t.year ? ' ' + mm.y : ''}${mm.part ? ' (part)' : ''}`).join(', ') : '—'}</td><td class="r">${x.total ? `<b class="text-rose-600">${money(x.total)}</b>` : money(0)}</td><td class="r noprint">${x.total ? `<span class="link" data-act="bal-fee" data-br="${x.br}" data-k="${x.months[0].key}">Collect</span>` : ''}</td></tr>`).join('') || `<tr><td colspan="${both ? 8 : 7}" class="text-slate-500">Nothing to show.</td></tr>`}
  </tbody></table></div></div>`;
}
function balancePrint() {
  const w = window.open('', '_blank'); if (!w) throw new Error('Allow pop-ups to print.');
  const t = nowBs().bs; const both = view.bal.scope === 'both';
  const cards = [...document.querySelectorAll('#tab-balance .grid .card')].map((c) => c.outerHTML).join('');
  const tables = ['balDep', 'balFee'].map((id) => { const el = $(id).closest('.card').cloneNode(true); el.querySelectorAll('.noprint, th:last-child').forEach((n) => { n.textContent = ''; }); return el.outerHTML; }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Balance Sheet ${esc(t.str)}</title><style>
  body{font:12px/1.4 system-ui,Segoe UI,Arial;color:#0f172a;margin:24px}h1{font-size:18px;margin:0 0 4px}.card{border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;vertical-align:top}.r{text-align:right}.text-xs{font-size:11px;color:#64748b}
  .stat-num{font-size:18px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.bal-badge{padding:1px 6px;border-radius:9px;font-size:11px;white-space:nowrap}
  .bal-green{background:#dcfce7;color:#166534}.bal-blue{background:#dbeafe;color:#1e40af}.bal-orange{background:#ffedd5;color:#9a3412}.bal-red{background:#fee2e2;color:#991b1b}.bal-grey{background:#f1f5f9;color:#475569}.bal-teal{background:#ccfbf1;color:#115e59}.bal-amber{background:#fef9c3;color:#854d0e}.bal-purple{background:#f3e8ff;color:#6b21a8}.text-rose-600{color:#e11d48}.text-amber-700{color:#b45309}.text-emerald-600{color:#059669}
  </style></head><body><h1>Padma Hostel — Balance Sheet</h1><div class="text-xs">${both ? 'Both hostels' : esc(BR[branch].name)} · as of ${esc(t.str)} B.S.</div><div class="grid" style="margin:12px 0">${cards}</div>${tables}<script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}
function depositModal(brId, stuId) {
  const b = S.branches[brId]; const s = b.students.find((x) => x.id === stuId); if (!s) return;
  const rec = s.recordId ? b.records.find((r) => r.id === s.recordId) : null;
  modal({ title: `Receive deposit — ${s.name}`, body: `<div class="text-xs text-slate-500 mb-3">${esc(BR[brId].name)} · Room ${esc(s.room)}</div>${field('Deposit received (Rs.)', inp('amount', rec ? num(rec.deposit) || S.settings.admission.deposit : S.settings.admission.deposit, 'type="number"'))}${field('Date received (B.S.)', '<div id="depDate" class="bs-date-group"></div>')}`,
    onOk: async (val) => {
      const amount = num(val.amount); if (amount <= 0) return 'Enter an amount.';
      const dt = pickers.depDate.get(); const id = uid('INC');
      b.income.push({ id, dateBS: dt, dateAD: adOf(dt), category: DEP, description: `${s.name} — Room ${s.room} (deposit)`, amount, ref: 'dep:' + id, refundable: true, studentId: s.id });
      await persist(); renderBalance(); toast('Deposit recorded. It shows in Income as refundable.');
    } });
  makePicker('depDate', nowBs().bs.str);
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
  $('admBloodGroup').value = ''; photoData = ''; resetScan(); $('photoPreview').classList.add('hidden'); $('photoPlaceholder').classList.remove('hidden');
  const t = nowBs().bs.str; pickers.admBookingPicker.set(t); pickers.admAdmissionPicker.set(t); $('admDeposit').dataset.touched = ''; $('admPaid').checked = true;
  $('admBookingAD').textContent = adOf(t); $('admAdmissionAD').textContent = adOf(t); fillRoomSelect();
}
function readPhoto(file) {
  if (!file) return; const fr = new FileReader();
  fr.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 420 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photoData = c.toDataURL('image/jpeg', 0.82); $('photoPreview').src = photoData; $('photoPreview').classList.remove('hidden'); $('photoPlaceholder').classList.add('hidden'); }; img.src = fr.result; };
  fr.readAsDataURL(file);
}
// ---------- SCAN OLD PAPER FORM ----------
let scanState = null;
function resetScan() {
  scanState = null;
  document.querySelectorAll('#tab-admission .scan-filled, #tab-admission .scan-check').forEach((e) => e.classList.remove('scan-filled', 'scan-check'));
  const st = $('scanStatus'), im = $('scanImg'); if (st) { st.classList.add('hidden'); st.innerHTML = ''; } if (im) { im.classList.add('hidden'); im.removeAttribute('src'); }
}
// "02/01/2004", "2004-01-02", "2080/05/12" … → B.S. "YYYY-MM-DD" (converting from A.D. when needed)
function writtenToBs(raw, cal) {
  const n = String(raw || '').match(/\d+/g); if (!n || n.length < 3) return null;
  let y, m, d, guess = false;
  if (n[0].length === 4) { y = +n[0]; m = +n[1]; d = +n[2]; } else if (n[2].length === 4) { y = +n[2]; m = +n[1]; d = +n[0]; guess = true; } else return null;
  if (m > 12 && d <= 12) { [m, d] = [d, m]; }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 32)) return null;
  const isBs = y >= 2060 || (y >= 2040 && cal === 'BS');
  try {
    if (isBs) return { bs: `${y}-${pad(m)}-${pad(Math.min(d, D.daysInMonth(y, m)))}`, guess, from: 'B.S.' };
    const b = D.adToBs(y, m, d); return { bs: `${b.year}-${pad(b.month)}-${pad(b.day)}`, guess, from: `A.D. ${d}/${m}/${y}` };
  } catch { return null; }
}
function fillFromScan(f) {
  const unsure = new Set((f.unsure || []).map(String));
  const filled = [], check = [];
  const put = (id, val, key) => {
    const v = String(val || '').trim(); if (!v) return;
    const el = $(id); if (!el) return;
    el.value = v; el.classList.add(unsure.has(key) ? 'scan-check' : 'scan-filled'); (unsure.has(key) ? check : filled).push(key);
  };
  // names written one letter per box: "A R U N  P O U D E L" → "ARUN POUDEL" (a wider gap = new word)
  let nm = String(f.name || '').toUpperCase().trim();
  if (nm && nm.split(/\s+/).every((w) => w.length === 1)) {
    const words = nm.split(/\s{2,}/).map((w) => w.replace(/\s+/g, ''));
    if (words.length === 1) unsure.add('name');
    nm = words.join(' ');
  }
  put('admName', nm.replace(/\s+/g, ' '), 'name');
  put('admNameNp', f.nameNepali, 'nameNepali'); put('admFormNo', f.formNo, 'formNo');
  put('admWhatsapp', f.phone, 'phone'); put('admEmail', f.email, 'email');
  put('admDistrict', f.district, 'district'); put('admMunicipality', f.municipality, 'municipality'); put('admWard', f.ward, 'ward'); put('admStreet', f.street, 'street');
  put('admCitizenship', f.citizenship, 'citizenship'); put('admInstitute', f.institute, 'institute'); put('admShift', f.classTime, 'classTime'); put('admLevel', f.level, 'level');
  put('admHealth', /^(none|no|nil|n\/a)$/i.test(String(f.health || '').trim()) ? 'None' : f.health, 'health'); put('admStay', f.stayDuration, 'stayDuration');
  put('admFather', f.fatherName, 'fatherName'); put('admFatherPhone', f.fatherPhone, 'fatherPhone'); put('admFatherOccupation', f.fatherOccupation, 'fatherOccupation');
  put('admMother', f.motherName, 'motherName'); put('admMotherPhone', f.motherPhone, 'motherPhone'); put('admMotherOccupation', f.motherOccupation, 'motherOccupation');
  put('admGuardian', f.guardianName || f.spouseName, 'guardianName'); put('admRelation', f.relation, 'relation');
  put('admEmergencyPhone', f.guardianPhone || f.fatherPhone, 'guardianPhone'); put('admOccupation', f.guardianOccupation, 'guardianOccupation'); put('admGuardianAddress', f.guardianAddress, 'guardianAddress');
  put('admApprovedBy', f.approvedBy, 'approvedBy');
  const bg = String(f.bloodGroup || '').toUpperCase().replace(/\s/g, '').replace('VE', '').replace('POSITIVE', '+').replace('NEGATIVE', '-');
  if ([...$('admBloodGroup').options].some((o) => o.value === bg)) { $('admBloodGroup').value = bg; $('admBloodGroup').classList.add(unsure.has('bloodGroup') ? 'scan-check' : 'scan-filled'); }
  const food = { vegetarian: 'Vegetarian', 'only egg': 'Only Egg', 'non-vegetarian': 'Non-Vegetarian', 'non vegetarian': 'Non-Vegetarian' }[String(f.food || '').toLowerCase().trim()];
  if (food) { const r = document.querySelector(`input[name=admFood][value="${food}"]`); if (r) r.checked = true; }
  // dates
  const notes = [];
  const setDate = (pickerId, adSpan, raw, label) => {
    const r = writtenToBs(raw, f.dateCalendar); if (!r) return false;
    pickers[pickerId].set(r.bs); const box = $(pickerId); box.classList.add('scan-check');
    if (adSpan) $(adSpan).textContent = adOf(r.bs);
    notes.push(`${label}: written as “${esc(raw)}” → ${esc(D.formatLong(r.bs))} B.S.${r.guess ? ' (day/month order guessed — please check)' : ''}`);
    return true;
  };
  setDate('admDobPicker', null, f.dob, 'Date of birth');
  if (!setDate('admBookingPicker', 'admBookingAD', f.bookingDate, 'Booking date')) setDate('admBookingPicker', 'admBookingAD', f.applicationDate, 'Booking date (from form date)');
  if (!setDate('admAdmissionPicker', 'admAdmissionAD', f.admissionDate, 'Admission date')) setDate('admAdmissionPicker', 'admAdmissionAD', f.applicationDate, 'Admission date (from form date)');
  // room from the official box, if written and free
  const rn = String(f.roomNo || '').replace(/[^0-9A-Za-z-]/g, '');
  if (rn) {
    const room = B().rooms.find((r) => String(r.number).toLowerCase() === rn.toLowerCase());
    if (room && room.beds.some((x) => !x.name)) { $('admRoom').value = room.id; onRoomChange(); $('admRoom').classList.add('scan-check'); notes.push(`Room ${esc(rn)} selected from the form — choose the bed.`); }
    else notes.push(`The form says room <b>${esc(rn)}</b>, but ${room ? 'it has no free bed' : 'that room is not in this branch'} — choose the room yourself.`);
  }
  const fee = Number(String(f.monthlyFee || '').replace(/[^0-9.]/g, ''));
  if (fee > 0) { $('admMonthlyRent').value = fee; $('admMonthlyRent').classList.add('scan-check'); calcBill(); }
  // hostel on the form vs. branch selected now
  const hn = String(f.hostelName || '').toUpperCase();
  const wantGirls = /GIRL/.test(hn), wantBoys = /BOY/.test(hn);
  const isGirls = /GIRL/i.test(BR[branch].name);
  const branchWarn = (wantGirls && !isGirls) || (wantBoys && isGirls) ? `<div class="mt-2 p-2 rounded bg-rose-50 text-rose-700"><b>Careful:</b> this form is for <b>${esc(f.hostelName)}</b>, but <b>${esc(BR[branch].name)}</b> is selected at the top. Switch branch before saving.</div>` : '';
  // old students already paid their joining bill long ago → don't add it to today's income
  $('admPaid').checked = false; calcBill();
  return { filled: filled.length, check, notes, branchWarn };
}
async function scanForm(file) {
  if (!file) return;
  const st = $('scanStatus'), btn = $('scanBtn');
  st.classList.remove('hidden'); st.className = 'text-xs mt-3 text-slate-600'; st.textContent = 'Reading the form… (5–20 seconds)';
  btn.disabled = true;
  try {
    const out = await P.scan.read(token, file);
    clearAdmission();
    scanState = { at: new Date().toISOString() };
    const im = $('scanImg'); im.src = out.image; im.classList.remove('hidden');
    const r = fillFromScan(out.fields);
    st.className = 'text-xs mt-3 text-slate-700';
    st.innerHTML = `<div class="p-2 rounded bg-emerald-50 text-emerald-800"><b>✔ Filled ${r.filled + r.check.length} boxes.</b> Compare with the photo below, then choose the room and bed and press 💾 Save Admission.</div>`
      + `<div class="mt-2"><span class="px-1 rounded" style="background:#fefce8">yellow</span> = read from the form · <span class="px-1 rounded" style="background:#fff7ed;outline:2px solid #f59e0b">orange</span> = hard to read or a date — please check.</div>`
      + (r.notes.length ? '<ul class="mt-2 list-disc pl-4 space-y-1">' + r.notes.map((n) => `<li>${n}</li>`).join('') + '</ul>' : '')
      + '<div class="mt-2 p-2 rounded bg-amber-50 text-amber-800">“Payment received” has been <b>unticked</b>: an old student paid the joining bill long ago, so it should not be added to today\'s income. Tick it only if they are paying now. Monthly fees will be tracked from this month.</div>'
      + r.branchWarn;
    toast('Form read. Please check the highlighted boxes.');
  } catch (e) {
    st.className = 'text-xs mt-3 p-2 rounded bg-rose-50 text-rose-700'; st.textContent = e.message || String(e);
  } finally { btn.disabled = false; }
}
// Old students entered from a scanned form (joining bill not paid now): monthly fees are tracked from the
// current month, so months before this app was used don't show up as unpaid.
function feeSince(adm) {
  const a = ym(adm), now = ym(nowBs().bs.str);
  return scanState && !$('admPaid').checked && a < now ? now : a;
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
  const rec = { id, studentId: stuId, roomId: room.id, bedIndex: +bedIdx, name, dob: pickers.admDobPicker.get(), whatsapp: g('admWhatsapp'), email: g('admEmail'), bloodGroup: $('admBloodGroup').value, district: g('admDistrict'), municipality: g('admMunicipality'), ward: g('admWard'), street: g('admStreet'), citizenship: g('admCitizenship'), institute: g('admInstitute'), shift: g('admShift'), level: g('admLevel'), foodPreference: food, health: g('admHealth'), fatherName: g('admFather'), motherName: g('admMother'), guardianName: g('admGuardian'), relation: g('admRelation'), emergencyPhone: g('admEmergencyPhone'), occupation: g('admOccupation'), guardianAddress: g('admGuardianAddress'), nameNepali: g('admNameNp'), formNo: g('admFormNo'), fatherPhone: g('admFatherPhone'), fatherOccupation: g('admFatherOccupation'), motherPhone: g('admMotherPhone'), motherOccupation: g('admMotherOccupation'), stayDuration: g('admStay'), scanned: !!scanState, bookingDate: pickers.admBookingPicker.get(), admissionDate: adm, admissionDateBS: adm, roomLabel: room.label, roomNo: 'Bed ' + (+bedIdx + 1), approvedBy: g('admApprovedBy'), photo: photoData, paid: $('admPaid').checked, createdAt: new Date().toISOString(), ...fees };
  b.records.push(rec);
  b.students.push({ id: stuId, name, phone: rec.whatsapp, room: room.number, bed: P.logic.bedTypeOf(room.beds.length), fee: fees.bedFee, active: '1', since: feeSince(adm), until: '', recordId: id, roomId: room.id });
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
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.dateBS)}</td><td>${esc(r.dateAD)}</td><td>${esc(r.category)}${inc && isRef(r) ? ` <span class="tag tag-part">refundable${r.refundedOn ? ' · returned ' + esc(r.refundedOn) : ''}</span>` : ''}</td><td>${esc(r.description)}</td><td class="r">${money(r.amount)}</td><td class="r">${r.ref ? '<span class="text-xs text-slate-400" title="Created by Monthly Fee / Admission">auto</span> &nbsp; ' : ''}${inc && isRef(r) ? `<span class="link" data-act="dep-ret" data-id="${esc(r.id)}">${r.refundedOn ? 'Un-mark' : 'Mark returned'}</span> &nbsp; ` : ''}${r.ref ? '' : `<span class="link" data-act="led-edit" data-type="${type}" data-id="${esc(r.id)}">Edit</span> &nbsp; `}<span class="link link-red" data-act="led-del" data-type="${type}" data-id="${esc(r.id)}">Delete</span></td></tr>`).join('') || '<tr><td colspan="7" class="text-slate-500">No entries for this period.</td></tr>'}
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
    <div class="font-bold mt-5 mb-2">Google Drive backup</div>
    <div class="text-xs text-slate-500">Every 💾 Save also uploads the data backup and PDF reports to your own folder in Padma Hostel's Google Drive, and the data backup is uploaded automatically about 20 seconds after each change (needs internet).</div>
    <div class="text-xs mono text-slate-600 mt-2 break-all" id="gdInfo">Google Drive: checking…</div>
    <div class="flex flex-wrap gap-2 mt-3" id="gdBtns"><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="cl-check">↻ Check now</button></div>
    <div class="font-bold mt-5 mb-2">Backup file</div>
    <div class="text-xs text-slate-500">Download one file with all data, or restore from a backup. You can also restore a backup file from Padma Hostel Finance or the old desktop app.</div>
    <div class="flex flex-wrap gap-2 mt-3"><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="bk-download">⬇ Download backup file</button><button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="bk-restore">⬆ Restore from backup…</button><input type="file" id="bkFile" accept=".json,application/json" class="hidden"></div>
    <div class="text-xs text-slate-400 mt-4">App version ${esc(P.version)}</div></div>
  <div class="card p-5"><div class="font-bold mb-3">My account</div>
    <div class="text-sm mb-1">Name: <b>${esc(ACC.profile)}</b></div><div class="text-sm mb-3">Username: <b>${esc(ACC.username)}</b></div>
    <div class="text-xs text-slate-500 mb-4">Your name and username are set by the admin. Your data and backups are kept in your own folder.</div>
    <button class="btn text-sm px-3 py-2 rounded-md border border-slate-300 bg-white" data-act="restore-drive">⤓ Bring my data from my online backup</button>
    <div class="border-t border-slate-200 mt-5 pt-4"><div class="font-bold text-sm text-rose-700 mb-1">Start fresh</div><div class="text-xs text-slate-500 mb-3">Deletes all students, admissions, fees, income and expenses of both hostels (for example after a trial). Rooms and settings stay. The admin's copy is cleared too.</div>
    <button class="btn text-sm px-3 py-2 rounded-md border border-rose-300 bg-white text-rose-700" data-act="reset-all">🗑 Delete all records</button></div></div>
  <div class="card p-5"><div class="font-bold mb-3">Change my password</div>${field('Current password', '<input type="password" class="field-input" id="acOld">')}${field('New password (min 6 characters)', '<input type="password" class="field-input" id="acNew">')}<button class="btn text-white text-sm px-4 py-2 rounded-md dynamic-bg font-semibold" data-act="acc-save">Change password</button><div class="text-xs text-slate-500 mt-2">Needs internet. If you forget your password, the admin can set a new one.</div></div></div>`;
  const gdRender = (g) => {
    const e = $('gdInfo'); if (!e) return;
    const when = (t) => (t ? new Date(t).toLocaleString() : 'not yet');
    e.innerHTML = 'Logged in as <b>' + esc(g.username) + '</b><br>' + (g.driveReady ? 'Google Drive backup: <b>ready</b>' + (g.folderName ? ' · folder <b>' + esc(g.folderName) + '</b>' : '') + ' · last full upload: ' + esc(when(g.lastSync)) + (g.lastBackup ? ' · last automatic data backup: ' + esc(when(g.lastBackup)) : '') : (g.driveOff ? '<span class="text-slate-600">Google Drive backup is turned off for your account by the admin. Your data is safe on this computer and the admin still receives your records.</span>' : '<span class="text-amber-700">Google Drive backup: not connected yet (the admin connects it in the admin panel). Your data is safe on this computer.</span>'));
  };
  P.account.info().then((g) => { gdRender(g); if (navigator.onLine) P.account.ping().then(gdRender).catch(() => {}); }).catch(() => {});
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
    applyBranding(); setBranch(branch); updateSaveUi();
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
    else if (a === 'led-del') {
      const r = B()[type].find((x) => x.id === id); if (!r) return;
      const isFee = r.ref && (r.ref.startsWith('fee:') || (r.ref.startsWith('adm:') && r.category === 'Monthly Fee'));
      const msg = isFee ? 'This removes the entry from Income and the matching fee payment, so the student shows as not paid again for that month.'
        : r.ref ? 'This entry was made by an admission. It is removed from the ledger only (the admission form stays; delete it under Admissions if it was a trial).'
        : 'This entry will be removed from the ledger.';
      if (!(await confirmBox('Delete entry?', `${r.category} · ${money(r.amount)} · ${r.dateBS}. ${msg}`, 'Delete'))) return;
      B()[type] = B()[type].filter((x) => x.id !== id);
      if (isFee) B().fees = B().fees.filter((f) => f.ref !== r.ref);
      await persist(); renderLedger(type); toast('Entry deleted.');
    }
    else if (a === 'go-balance') setTab('balance');
    else if (a === 'bal-print') balancePrint();
    else if (a === 'bal-dep-take') depositModal(el.dataset.br, id);
    else if (a === 'bal-dep-ret') {
      const r = S.branches[el.dataset.br].income.find((x) => x.id === id); if (!r) return;
      if (!r.refundedOn && !(await confirmBox('Deposit returned?', `Mark ${money(r.amount)} (${esc(r.description || '')}) as given back today?`, 'Yes, returned'))) return;
      r.refundedOn = r.refundedOn ? '' : nowBs().bs.str; await persist(); renderBalance(); toast(r.refundedOn ? 'Marked as returned.' : 'Back to holding.');
    }
    else if (a === 'bal-fee') { const [y, m] = el.dataset.k.split('-').map(Number); view.fee.y = y; view.fee.m = m; if (el.dataset.br !== branch) setBranch(el.dataset.br); setTab('monthly'); }
    else if (a === 'dep-ret') { const r = B().income.find((x) => x.id === id); r.refundedOn = r.refundedOn ? '' : nowBs().bs.str; await persist(); renderLedger('income'); }
    else if (a === 'cat-add') catModal(type);
    else if (a === 'cat-del') { S.categories = S.categories.filter((c) => !(c.type === type && c.name === el.dataset.name)); await persist(); renderSettings(); }
    else if (a === 'set-save') { [1, 2, 3, 4].forEach((n) => { S.settings.bedPrices[n] = num($('bp' + n).value); }); S.settings.admission = { admissionFee: num($('sAdm').value), deposit: num($('sDep').value), formFee: num($('sForm').value) }; await persist(); $('admDeposit').dataset.touched = ''; toast('Settings saved.'); }
    else if (a === 'open-folder') { const name = await P.backup.chooseFolder(token); toast('Save folder set: ' + name + '. Press 💾 Save to write the reports there.'); renderSettings(); }
    else if (a === 'cl-check') { if (!navigator.onLine) throw new Error('No internet right now.'); const g = await P.account.ping(); toast(g.driveReady ? 'Connected. Google Drive backup is ready.' : 'Connected. Google Drive backup is not ready yet.'); renderSettings(); }
    else if (a === 'bk-download') { await P.backup.download(token); toast('Backup file downloaded.'); }
    else if (a === 'bk-restore') { const fi = $('bkFile'); fi.value = ''; fi.onchange = () => restoreFrom(fi.files[0]); fi.click(); }
    else if (a === 'regen') { toast('Rebuilding all PDFs…'); STATUS = await P.reports.regenerate(token); updateSaveUi(); toast(STATUS.errors ? STATUS.message : 'All PDFs rebuilt.', !!STATUS.errors); }
    else if (a === 'acc-save') { await P.account.changePassword(token, $('acOld').value, $('acNew').value); $('acOld').value = ''; $('acNew').value = ''; toast('Password changed.'); }
    else if (a === 'reset-all') {
      modal({ title: 'Delete all records?', ok: 'Delete everything', body: '<p class="text-sm text-slate-600 mb-3">All students, admissions, fees, income and expenses of <b>both hostels</b> are deleted. Rooms and settings stay. A safety copy is kept on this computer.</p>' + field('Type DELETE to confirm', '<input name="c" class="field-input" autocomplete="off">'),
        onOk: async (v) => {
          if (String(v.c).trim().toUpperCase() !== 'DELETE') return 'Type DELETE in capital letters to confirm.';
          S = await P.resetAll(token); STATUS = await P.reports.status(token);
          applyBranding(); setBranch(branch); setTab('dashboard'); toast('All records deleted. You can start fresh.');
          return true;
        } });
    }
    else if (a === 'restore-drive') {
      if (!navigator.onLine) throw new Error('This needs internet.');
      if (!(await confirmBox('Bring my data from the online backup?', 'Replace the data on this computer with your latest online backup (for example on a new laptop)? Changes made here after that backup will be lost.', 'Replace'))) return;
      const r = await P.restoreFromDrive(token); const d = await P.load(token); S = d.state; STATUS = await P.reports.status(token);
      applyBranding(); setBranch(branch); setTab('settings'); toast(`Done: ${r.students} students, ${r.records} records.`);
    }
  } catch (err) { toast(err.message || String(err), true); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]'); if (!el) return; const k = el.dataset.chg;
  if (k === 'balq') { view.bal.q = el.value; renderBalance(); return; }
  if (k === 'bal') { view.bal[el.dataset.f] = el.value; renderBalance(); return; }
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
$('scanBtn').onclick = () => { const fi = $('scanInput'); fi.value = ''; fi.click(); };
$('scanInput').onchange = () => scanForm($('scanInput').files[0]);
$('scanImg').onclick = () => { const z = document.createElement('div'); z.className = 'scan-zoom'; z.innerHTML = `<img src="${$('scanImg').src}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); };
  $('admDonePdf').onclick = () => lastAdm && P.openAdmission(token, branch, lastAdm).catch((e) => toast(e.message, true));
  P.onReports((s) => { STATUS = s; updateSaveUi(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(false); } });
  tickClock(); setInterval(tickClock, 1000); checkOnline(); setInterval(checkOnline, 5000);
  window.addEventListener('online', checkOnline); window.addEventListener('offline', checkOnline);
  setInterval(updateSaveUi, 600000);
  applyBranding(); setBranch(branch); setTab('dashboard'); updateSaveUi();
  if (ACC.env === 'test') { const t = document.createElement('div'); t.className = 'text-center text-xs font-bold text-white bg-orange-600 py-1'; t.textContent = 'TEST COPY — separate test data'; document.body.prepend(t); }
}

$('loginBtn').onclick = login;
prepareLogin();
// ---------- frozen account lock ----------
function frozenLock(on) {
  let el = document.getElementById('frozenLock');
  if (!on) { if (el) el.remove(); return; }
  if (el) return;
  el = document.createElement('div'); el.id = 'frozenLock';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px;max-width:440px;text-align:center"><div style="font-size:44px">❄</div><h2 style="font-size:22px;font-weight:700;margin:8px 0">Account frozen</h2><p style="color:#475569">This account has been frozen by the admin. Please contact the admin. Your data is safe on this computer.</p><button id="frozenCheck" class="btn mt-4 text-white px-4 py-2 rounded-md font-semibold dynamic-bg">Check again</button><div id="frozenMsg" style="font-size:12px;color:#64748b;margin-top:10px"></div></div>';
  document.body.appendChild(el);
  document.getElementById('frozenCheck').onclick = async () => {
    const m = document.getElementById('frozenMsg'); m.textContent = navigator.onLine ? 'Checking…' : 'No internet: connect and try again.';
    if (!navigator.onLine) return;
    await P.account.ping(); if (await P.account.isFrozen()) m.textContent = 'Still frozen. Please contact the admin.';
  };
}
P.account.onFrozen(frozenLock);
P.account.isFrozen().then((f) => { frozenLock(f); }).catch(() => {});
P.account.ping().catch(() => {});
// removed by the admin or password reset: back to the login screen (the data stays on this computer)
P.account.onRemoved((msg) => { alertRemoved(msg); });
// the admin reset this account's records (e.g. after a trial)
P.account.onReset(async () => {
  if ($('app').classList.contains('hidden') || !token) return;
  const d = await P.load(token); S = d.state; STATUS = d.status;
  applyBranding(); setBranch(branch); setTab('dashboard'); toast('The admin reset your records. You can start fresh.');
});
function alertRemoved(msg) {
  if (!$('app').classList.contains('hidden')) { toast(msg || 'This account was removed by the admin.', true); setTimeout(() => location.reload(), 4000); }
  else prepareLogin().then(() => showErr(msg || ''));
}
['loginUser', 'loginPass'].forEach((i) => $(i).addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); }));
$('loginUser').focus();
