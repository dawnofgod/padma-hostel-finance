// Business rules shared by the screens (via preload), the PDF reports and the tests.
const dates = require('./dates');

const pad = (n) => String(n).padStart(2, '0');

const BRANCHES = {
  'PHB-01': { id: 'PHB-01', name: 'Padma Boys Hostel', short: 'Boys' },
  'PHG-02': { id: 'PHG-02', name: 'Padma Girls Hostel', short: 'Girls' },
};
const BRANCH_IDS = Object.keys(BRANCHES);

// Money taken as a refundable deposit is not the hostel's revenue.
const DEPOSIT_CAT = 'Security Deposit (Refundable)';
const isRefundable = (r) => !!r.refundable || r.category === DEPOSIT_CAT;
const revenueRows = (rows) => rows.filter((r) => !isRefundable(r));
const sum = (rows, f = 'amount') => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);

const ymOf = (dateBS) => String(dateBS || '').slice(0, 7);
function prevYm(ym) {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${pad(m)}`;
}

// A room with 1, 2, 3 or 4+ beds is a "1 Bed" ... "4 Bed" room for pricing.
const bedTypeOf = (bedCount) => Math.min(4, Math.max(1, Number(bedCount) || 1));

// Was this student expected to pay the fee for month `ym` ("2083-07")?
function expectedIn(s, ym) {
  if (s.since && ym < s.since) return false;
  if (s.active === '0') return !!s.until && ym <= s.until;
  return !s.until || ym <= s.until;
}

// Fee position of every relevant student of one branch for month `ym`.
function feeStatus(branch, ym) {
  const payments = branch.fees.filter((f) => f.forMonth === ym);
  const rows = new Map();
  for (const s of branch.students) {
    if (expectedIn(s, ym) || payments.some((p) => p.studentId === s.id)) rows.set(s.id, { s, pays: [] });
  }
  for (const p of payments) {
    if (!rows.has(p.studentId)) {
      // the student record was deleted later – keep the payment visible
      rows.set(p.studentId, { s: { id: p.studentId, name: p.studentName, phone: '', room: p.room, bed: p.bed, fee: Number(p.expected) || p.amount }, pays: [] });
    }
    rows.get(p.studentId).pays.push(p);
  }
  return [...rows.values()].map(({ s, pays }) => {
    const paid = sum(pays);
    const exp = Math.max(0, ...pays.map((p) => Number(p.expected) || 0)) || Number(s.fee) || 0;
    const due = Math.max(0, exp - paid);
    return {
      s, expected: exp, paid, due,
      status: paid <= 0 ? 'unpaid' : due > 0 ? 'part' : 'paid',
      dates: pays.map((p) => p.dateBS).sort(),
    };
  }).sort((a, b) => String(a.s.room).localeCompare(String(b.s.room), undefined, { numeric: true }) || a.s.name.localeCompare(b.s.name));
}

// Revenue / expenditure / net profit of one branch for a period. month = 0 means the whole year.
function periodTotals(branch, year, month = 0) {
  const inPeriod = (r) => {
    const b = dates.parseBs(r.dateBS);
    return !!b && b.year === year && (!month || b.month === month);
  };
  const inc = branch.income.filter(inPeriod);
  const exp = branch.expenditure.filter(inPeriod);
  const revenue = sum(revenueRows(inc));
  const expenditure = sum(exp);
  return { revenue, expenditure, net: revenue - expenditure, deposits: sum(inc.filter(isRefundable)), incomeRows: inc, expenditureRows: exp };
}

module.exports = {
  pad, BRANCHES, BRANCH_IDS, DEPOSIT_CAT, isRefundable, revenueRows, sum,
  ymOf, prevYm, bedTypeOf, expectedIn, feeStatus, periodTotals,
};
