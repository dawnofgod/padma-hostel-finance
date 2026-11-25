// The app's own database: one JSON file inside the app's private data folder
// (C:\Users\<you>\AppData\Roaming\PADMA HOSTEL FINANCE\padma-data-v3.json).
// Every change is written here at once, so closing the app never loses anything.
const fs = require('fs');
const path = require('path');
const dates = require('./dates');
const logic = require('./logic');
const seed = require('./seed');

const VERSION = 3;
const DEFAULT_BED_PRICES = { 1: 17000, 2: 14500, 3: 13500, 4: 12500 };
const DEFAULT_ADMISSION = { admissionFee: 5000, deposit: 5000, formFee: 200 };
const DEFAULT_CATEGORIES = {
  income: ['Monthly Fee', 'Extra Charge', 'Late Fee', 'Admission Fee', 'Form Fee', logic.DEPOSIT_CAT],
  expenditure: ['Vegetable', 'Water', 'Electricity', 'Grocery', 'Dairy', 'Utensils', 'Gas'],
};

const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function defaultBranch(id) {
  return { rooms: seed.buildDefaultRooms(id), records: [], students: [], income: [], expenditure: [], fees: [], lastLedgerExportAt: null };
}

function defaultState() {
  const categories = [];
  for (const t of Object.keys(DEFAULT_CATEGORIES)) DEFAULT_CATEGORIES[t].forEach((name) => categories.push({ type: t, name }));
  const branches = {};
  logic.BRANCH_IDS.forEach((b) => { branches[b] = defaultBranch(b); });
  return {
    version: VERSION,
    settings: { bedPrices: { ...DEFAULT_BED_PRICES }, admission: { ...DEFAULT_ADMISSION } },
    categories,
    branches,
  };
}

const num = (v) => Number(v) || 0;

function normalizeBranch(id, input) {
  const b = input && typeof input === 'object' ? input : {};
  const out = {
    rooms: Array.isArray(b.rooms) ? b.rooms : seed.buildDefaultRooms(id),
    records: Array.isArray(b.records) ? b.records : [],
    students: Array.isArray(b.students) ? b.students : [],
    income: Array.isArray(b.income) ? b.income : [],
    expenditure: Array.isArray(b.expenditure) ? b.expenditure : [],
    fees: Array.isArray(b.fees) ? b.fees : [],
    lastLedgerExportAt: b.lastLedgerExportAt || null,
  };
  for (const r of out.rooms) {
    if (!r.id) r.id = uid('ROOM');
    if (!Array.isArray(r.beds)) r.beds = [];
    r.label = r.label || ('Room ' + (r.number || ''));
    r.desc = r.desc || '';
    r.beds = r.beds.map((x) => ({ studentId: (x && x.studentId) || null, name: (x && x.name) || null, phone: (x && x.phone) || null }));
  }
  for (const r of out.records) {
    if (!r.id) r.id = uid('REC');
    ['admissionFee', 'deposit', 'formFee', 'bedFee'].forEach((k) => { r[k] = num(r[k]); });
  }
  for (const r of out.income) { r.amount = num(r.amount); r.ref = r.ref || ''; r.description = r.description || ''; if (!r.id) r.id = uid('INC'); }
  for (const r of out.expenditure) { r.amount = num(r.amount); r.description = r.description || ''; if (!r.id) r.id = uid('EXP'); }
  for (const f of out.fees) { f.amount = num(f.amount); f.expected = num(f.expected); if (!f.id) f.id = uid('FEE'); }
  const curYm = logic.ymOf(dates.today().bs.str);
  for (const st of out.students) {
    if (!st.id) st.id = uid('STU');
    st.bed = logic.bedTypeOf(st.bed); st.fee = num(st.fee);
    st.active = st.active === '0' ? '0' : '1';
    st.phone = st.phone || ''; st.room = st.room == null ? '' : String(st.room);
    if (!st.since) {
      const months = out.fees.filter((f) => f.studentId === st.id).map((f) => f.forMonth).filter(Boolean).sort();
      st.since = months[0] || curYm;
    }
    st.until = st.until || '';
  }
  return out;
}

function normalize(input) {
  const d = defaultState();
  const s = input && typeof input === 'object' ? input : {};
  const out = { version: VERSION, settings: {}, categories: [], branches: {} };
  const set = s.settings || {};
  out.settings.bedPrices = { ...DEFAULT_BED_PRICES };
  for (const k of [1, 2, 3, 4]) if (set.bedPrices && set.bedPrices[k] != null) out.settings.bedPrices[k] = num(set.bedPrices[k]);
  out.settings.admission = { ...DEFAULT_ADMISSION };
  for (const k of Object.keys(DEFAULT_ADMISSION)) if (set.admission && set.admission[k] != null) out.settings.admission[k] = num(set.admission[k]);
  out.categories = Array.isArray(s.categories) && s.categories.length ? s.categories.filter((c) => c && c.name && (c.type === 'income' || c.type === 'expenditure')) : d.categories;
  // the categories the app itself writes must always exist
  for (const name of [logic.DEPOSIT_CAT, 'Monthly Fee', 'Admission Fee', 'Form Fee']) {
    if (!out.categories.some((c) => c.type === 'income' && c.name === name)) out.categories.push({ type: 'income', name });
  }
  for (const id of logic.BRANCH_IDS) out.branches[id] = normalizeBranch(id, s.branches && s.branches[id]);
  return out;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Returns { state, origin } where origin says where the data came from.
function load(dbPath, { backupPath } = {}) {
  let src = readJson(dbPath);
  let origin = 'database';
  if (!src) { src = readJson(dbPath + '.bak'); origin = 'bak'; }
  if (!src && backupPath) { src = readJson(backupPath); origin = 'backup'; }
  if (!src || src.version !== VERSION) { src = null; origin = 'new'; }
  return { state: normalize(src), origin };
}

// Temp file first, previous version kept as .bak, then swap – a power cut can never leave a half-written database.
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function save(dbPath, state) {
  const json = JSON.stringify(state);
  if (fs.existsSync(dbPath)) { try { fs.copyFileSync(dbPath, dbPath + '.bak'); } catch { /* ignore */ } }
  atomicWrite(dbPath, json);
  return json;
}

module.exports = { VERSION, DEFAULT_BED_PRICES, DEFAULT_ADMISSION, DEFAULT_CATEGORIES, defaultState, normalize, load, save, atomicWrite, uid };
