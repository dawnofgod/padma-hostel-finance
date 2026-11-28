// Builds the HTML for every PDF report and decides where each one lives.
//
//   <Documents>\PADMA HOSTEL FINANCE\
//     Padma Boys Hostel\                       (and Padma Girls Hostel\)
//       2083\
//         07 Kartik\
//           Monthly Fee\                       Monthly Fee Record - Kartik 2083.pdf
//           Income Record\                     Income Record - Kartik 2083.pdf
//           Expenditure Record\                Expenditure Record - Kartik 2083.pdf
//           Admission Forms\                   <Student> - Admission Form.pdf
//           Profit or Loss and Revenue Record\ Monthly + Yearly reports
//
// buildReports() is a pure function of the data, so the app can compare it with what is
// already on disk and only rewrite the PDFs that actually changed.
const dates = require('./dates');
const logic = require('./logic');

const { MONTHS } = dates;
const { pad, sum } = logic;

const F_FEE = 'Monthly Fee';
const F_INC = 'Income Record';
const F_EXP = 'Expenditure Record';
const F_ADM = 'Admission Forms';
const F_PL = 'Profit or Loss and Revenue Record';

let LOGO = '';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byDate = (a, b) => (a.dateBS === b.dateBS ? String(a.id).localeCompare(String(b.id)) : a.dateBS < b.dateBS ? -1 : 1);
const safeName = (s) => String(s || 'Student').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Student';
const signed = (n) => (n < 0 ? '− ' : '') + money(Math.abs(n));

function totalsBy(rows, key = 'category') {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || '(none)';
    const e = m.get(k) || { name: k, count: 0, total: 0 };
    e.count += 1; e.total += r.amount;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

// ---------- html building blocks ----------
const CSS = (landscape) => `
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 13mm 11mm 15mm; }
* { box-sizing: border-box; }
body { font: 10pt/1.35 "Segoe UI", Calibri, Arial, sans-serif; color: #111; margin: 0; }
.head { border-bottom: 3px solid #78350f; padding-bottom: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
.org { font: 700 11pt Georgia, serif; letter-spacing: .08em; color: #78350f; }
.branch { font-size: 9.5pt; color: #555; }
h1 { font: 700 16pt Georgia, serif; margin: 2px 0 0; }
.sub { color: #444; font-size: 9.5pt; }
.logo { height: 17mm; width: 17mm; object-fit: contain; margin-left: 12px; }
h2 { font: 700 11pt "Segoe UI", Arial, sans-serif; margin: 16px 0 4px; color: #78350f; }
table { border-collapse: collapse; width: 100%; margin-top: 4px; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #8c8c8c; padding: 3.5px 6px; vertical-align: top; }
th { background: #fde9c8; font-weight: 700; text-align: left; }
td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
td.c, th.c { text-align: center; }
tr.total td { background: #e2efda; font-weight: 700; border-top: 2px solid #4d4d4d; }
tr.memo td { background: #fff4d6; font-style: italic; }
tr.alt td { background: #f7f7f7; }
.result { margin-top: 12px; padding: 9px 12px; border: 2px solid; font: 700 13pt Georgia, serif; display: flex; justify-content: space-between; }
.result.profit { border-color: #2e7d32; background: #e8f5e9; color: #1b5e20; }
.result.loss { border-color: #b71c1c; background: #fdecea; color: #7f1010; }
.banner { margin: 8px 0 2px; padding: 6px 10px; font-weight: 700; border-left: 6px solid; }
.banner.ok { border-color: #2e7d32; background: #e8f5e9; color: #1b5e20; }
.banner.warn { border-color: #e69f00; background: #fff4d6; color: #7a5200; }
.st-paid { color: #1b5e20; font-weight: 700; } .st-part { color: #7a5200; font-weight: 700; } .st-unpaid { color: #b71c1c; font-weight: 700; }
.foot { margin-top: 16px; font-size: 8pt; color: #666; border-top: 1px solid #bbb; padding-top: 4px; display: flex; justify-content: space-between; }
.empty { color: #666; font-style: italic; text-align: center; padding: 10px; }
`;

function page({ title, subtitle, body, landscape = false, branchName }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(landscape)}</style></head><body>
  <div class="head"><div><div class="org">PADMA HOSTEL FINANCE</div><div class="branch">${esc(branchName)}</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>${LOGO ? `<img class="logo" src="${LOGO}" alt="">` : ''}</div>
  ${body}
  <div class="foot"><span>${esc(branchName)} · all amounts in Rs. · dates in Bikram Sambat (B.S.)</span><span>Generated {{GENERATED}}</span></div>
  </body></html>`;
}

function table(headers, rows, totalRows) {
  const th = headers.map((h) => `<th class="${h.cls || ''}" ${h.w ? `style="width:${h.w}"` : ''}>${esc(h.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((cells, i) => `<tr class="${i % 2 ? 'alt' : ''}">${cells.map((c, j) => `<td class="${headers[j].cls || ''}">${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${headers.length}">No entries</td></tr>`;
  const tots = (totalRows || []).map((t) => `<tr class="${t.memo ? 'memo' : 'total'}">${t.cells.map((c, j) => `<td class="${headers[j].cls || ''}">${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}${tots}</tbody></table>`;
}

const monthTitle = (y, m) => `${MONTHS[m - 1]} ${y}`;

// ---------- individual reports ----------
function ledgerReport(kind, y, m, rows, br) {
  const isInc = kind === 'income';
  const revenueRows = isInc ? logic.revenueRows(rows) : rows;
  const deposits = isInc ? rows.filter(logic.isRefundable) : [];
  const headers = isInc
    ? [{ label: 'S.N.', cls: 'c', w: '7%' }, { label: 'Date (B.S.)', w: '16%' }, { label: 'Date (A.D.)', w: '13%' }, { label: 'Category', w: '20%' }, { label: 'Particulars' }, { label: 'Amount (Rs.)', cls: 'r', w: '15%' }]
    : [{ label: 'S.N.', cls: 'c', w: '7%' }, { label: 'Date (B.S.)', w: '16%' }, { label: 'Date (A.D.)', w: '13%' }, { label: 'Particulars', w: '22%' }, { label: 'Remarks' }, { label: 'Amount (Rs.)', cls: 'r', w: '15%' }];
  const totals = [{ cells: ['', '', '', '', isInc ? `TOTAL INCOME (REVENUE) – ${MONTHS[m - 1].toUpperCase()}` : `TOTAL EXPENDITURE – ${MONTHS[m - 1].toUpperCase()}`, money(sum(revenueRows))] }];
  if (deposits.length) totals.push({ memo: true, cells: ['', '', '', '', 'Security deposits received (refundable – not counted as revenue)', money(sum(deposits))] });
  const T = totalsBy(revenueRows);
  const body = `
    ${table(headers, rows.map((r, i) => [i + 1, esc(dates.formatBsLong(r.dateBS)), esc(r.dateAD), esc(r.category) + (logic.isRefundable(r) && isInc ? ' <i>(refundable)</i>' : ''), esc(r.description), money(r.amount)]), totals)}
    <h2>Summary by ${isInc ? 'category' : 'particulars'}</h2>
    ${table([{ label: isInc ? 'Category' : 'Particulars' }, { label: 'Entries', cls: 'c', w: '12%' }, { label: 'Amount (Rs.)', cls: 'r', w: '22%' }],
      T.map((t) => [esc(t.name), t.count, money(t.total)]), [{ cells: ['Total', revenueRows.length, money(sum(revenueRows))] }])}`;
  return page({
    title: `${isInc ? 'Income' : 'Expenditure'} Record – ${monthTitle(y, m)}`,
    subtitle: `${rows.length} entries  ·  Total Rs. ${money(sum(revenueRows))}`,
    body, branchName: br.name,
  });
}

function feeReport(br, y, m, status) {
  const complete = status.length > 0 && status.every((x) => x.status === 'paid');
  const unpaid = status.filter((x) => x.status !== 'paid').length;
  const label = { paid: 'Paid', part: 'Partly paid', unpaid: 'Not paid' };
  const rows = status.map((x, i) => [
    i + 1, esc(x.s.name), esc(x.s.phone), esc(x.s.room), `${x.s.bed} Bed`, money(x.expected), money(x.paid), money(x.due),
    esc(x.dates.map((d) => dates.formatBsLong(d)).join(', ') || '—'), `<span class="st-${x.status}">${label[x.status]}</span>`,
  ]);
  const body = `
    <div class="banner ${complete ? 'ok' : 'warn'}">${complete ? `✔ All ${status.length} students have paid the fee for ${monthTitle(y, m)}.` : `Incomplete – ${unpaid} of ${status.length} students still have a fee due for ${monthTitle(y, m)}. This file becomes final once everyone has paid.`}</div>
    ${table([{ label: 'S.N.', cls: 'c', w: '4%' }, { label: 'Student name', w: '16%' }, { label: 'Phone', w: '10%' }, { label: 'Room', cls: 'c', w: '6%' }, { label: 'Bed', cls: 'c', w: '6%' },
      { label: 'Monthly fee', cls: 'r', w: '10%' }, { label: 'Paid', cls: 'r', w: '10%' }, { label: 'Due', cls: 'r', w: '9%' }, { label: 'Date(s) received' }, { label: 'Status', w: '9%' }],
      rows, [{ cells: ['', 'TOTAL', '', '', '', money(sum(status, 'expected')), money(sum(status, 'paid')), money(sum(status, 'due')), '', ''] }])}`;
  return page({
    title: `Monthly Fee Record – ${monthTitle(y, m)}`,
    subtitle: `${status.length} students  ·  Collected Rs. ${money(sum(status, 'paid'))} of Rs. ${money(sum(status, 'expected'))}`,
    body, landscape: true, branchName: br.name,
  });
}

function monthlyPL(data, br, y, m) {
  const t = logic.periodTotals(data, y, m);
  const rev = logic.revenueRows(t.incomeRows);
  const fs = logic.feeStatus(data, `${y}-${pad(m)}`);
  const memo = t.deposits ? [{ memo: true, cells: ['Security deposits received (refundable – not counted as revenue)', t.incomeRows.filter(logic.isRefundable).length, money(t.deposits)] }] : [];
  const body = `
    <h2>Revenue (income)</h2>
    ${table([{ label: 'Category' }, { label: 'Entries', cls: 'c', w: '12%' }, { label: 'Amount (Rs.)', cls: 'r', w: '22%' }],
      totalsBy(rev).map((x) => [esc(x.name), x.count, money(x.total)]), [{ cells: ['TOTAL REVENUE', rev.length, money(t.revenue)] }, ...memo])}
    <h2>Expenditure</h2>
    ${table([{ label: 'Particulars' }, { label: 'Entries', cls: 'c', w: '12%' }, { label: 'Amount (Rs.)', cls: 'r', w: '22%' }],
      totalsBy(t.expenditureRows).map((x) => [esc(x.name), x.count, money(x.total)]), [{ cells: ['TOTAL EXPENDITURE', t.expenditureRows.length, money(t.expenditure)] }])}
    <div class="result ${t.net >= 0 ? 'profit' : 'loss'}"><span>${t.net >= 0 ? 'NET PROFIT' : 'NET LOSS'} – ${esc(monthTitle(y, m))}</span><span>Rs. ${money(Math.abs(t.net))}</span></div>
    ${fs.length ? `<h2>Monthly fee collection</h2>${table([{ label: 'Students', cls: 'c' }, { label: 'Fee expected (Rs.)', cls: 'r' }, { label: 'Fee collected (Rs.)', cls: 'r' }, { label: 'Fee still due (Rs.)', cls: 'r' }],
      [[fs.length, money(sum(fs, 'expected')), money(sum(fs, 'paid')), money(sum(fs, 'due'))]])}` : ''}`;
  return page({ title: `Profit or Loss and Revenue – ${monthTitle(y, m)}`, subtitle: `Monthly record  ·  Revenue Rs. ${money(t.revenue)}  ·  Expenditure Rs. ${money(t.expenditure)}`, body, branchName: br.name });
}

function yearlyPL(data, br, y, upto) {
  const monthRows = [];
  let revenue = 0, expenditure = 0, deposits = 0;
  const allRev = [], allExp = [];
  for (let m = 1; m <= upto; m++) {
    const t = logic.periodTotals(data, y, m);
    revenue += t.revenue; expenditure += t.expenditure; deposits += t.deposits;
    allRev.push(...logic.revenueRows(t.incomeRows)); allExp.push(...t.expenditureRows);
    monthRows.push([`${pad(m)} ${MONTHS[m - 1]}`, money(t.revenue), money(t.expenditure), signed(t.net), t.net > 0 ? 'Profit' : t.net < 0 ? 'Loss' : '—']);
  }
  const net = revenue - expenditure;
  const body = `
    <h2>Month-wise record</h2>
    ${table([{ label: 'Month' }, { label: 'Revenue / Income (Rs.)', cls: 'r', w: '24%' }, { label: 'Expenditure (Rs.)', cls: 'r', w: '24%' }, { label: 'Profit / (Loss) (Rs.)', cls: 'r', w: '24%' }, { label: 'Result', cls: 'c', w: '10%' }],
      monthRows, [{ cells: [`TOTAL (Baisakh – ${MONTHS[upto - 1]})`, money(revenue), money(expenditure), signed(net), net > 0 ? 'Profit' : net < 0 ? 'Loss' : '—'] }])}
    <div class="result ${net >= 0 ? 'profit' : 'loss'}"><span>${net >= 0 ? 'NET PROFIT' : 'NET LOSS'} – ${y} (till ${esc(MONTHS[upto - 1])})</span><span>Rs. ${money(Math.abs(net))}</span></div>
    <h2>Revenue by category – year to date</h2>
    ${table([{ label: 'Category' }, { label: 'Entries', cls: 'c', w: '12%' }, { label: 'Amount (Rs.)', cls: 'r', w: '22%' }], totalsBy(allRev).map((x) => [esc(x.name), x.count, money(x.total)]),
      [{ cells: ['Total revenue', allRev.length, money(revenue)] }, ...(deposits ? [{ memo: true, cells: ['Refundable security deposits received (not revenue)', '', money(deposits)] }] : [])])}
    <h2>Expenditure by particulars – year to date</h2>
    ${table([{ label: 'Particulars' }, { label: 'Entries', cls: 'c', w: '12%' }, { label: 'Amount (Rs.)', cls: 'r', w: '22%' }], totalsBy(allExp).map((x) => [esc(x.name), x.count, money(x.total)]), [{ cells: ['Total expenditure', allExp.length, money(expenditure)] }])}`;
  return page({ title: `Yearly Profit or Loss and Revenue – ${y}`, subtitle: `Year ${y} B.S., Baisakh to ${MONTHS[upto - 1]}  ·  Revenue Rs. ${money(revenue)}  ·  Expenditure Rs. ${money(expenditure)}`, body, branchName: br.name });
}

// Same sections as the form in the user's original app (letterhead, profile, guardian, hostel section, joining bill, signatures).
function admissionHtml(rec, br) {
  const opt = (pairs) => pairs.filter(([, v]) => String(v || '').trim()); // extra fields: shown only when filled in
  const kv = (pairs) => `<table class="kv">${pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v) || '-'}</td></tr>`).join('')}</table>`;
  const total = (Number(rec.admissionFee) || 0) + (Number(rec.deposit) || 0) + (Number(rec.formFee) || 0) + (Number(rec.bedFee) || 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Admission – ${esc(rec.name)}</title><style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { font: 10pt/1.35 "Segoe UI", Calibri, Arial, sans-serif; color: #141414; margin: 0; }
.band { background: #171717; color: #fff; padding: 9mm 14mm 6mm; display: flex; justify-content: space-between; align-items: center; }
.band .t { font: 700 16pt Helvetica, Arial, sans-serif; } .band .s { font-size: 9pt; margin-top: 2px; } .band .g { font-size: 8.5pt; text-align: right; }
.band img { height: 16mm; width: 16mm; object-fit: contain; background: #fff; border-radius: 3mm; margin-right: 8mm; }
.wrap { padding: 6mm 14mm 0; position: relative; }
h1 { font: 700 13pt Helvetica, Arial, sans-serif; margin: 0 0 3mm; padding-bottom: 2mm; border-bottom: 1px solid #c8c8c8; }
h2 { font: 700 10pt Helvetica, Arial, sans-serif; margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 1px solid #e0e0e0; }
.photo { position: absolute; right: 14mm; top: 17mm; width: 32mm; height: 32mm; border: 1px solid #b4b4b4; }
.photo img { width: 100%; height: 100%; object-fit: cover; }
table.kv { width: 100%; border-collapse: collapse; }
table.kv th { text-align: left; color: #5a5a5a; font-weight: 700; width: 40mm; padding: 1.2mm 0; font-size: 9.5pt; vertical-align: top; }
table.kv td { padding: 1.2mm 0; font-size: 9.5pt; }
table.bill { width: 100%; border-collapse: collapse; margin-top: 4mm; }
table.bill th { background: #171717; color: #fff; text-align: left; padding: 2mm 3mm; }
table.bill td { border: 1px solid #aaa; padding: 2mm 3mm; } td.r, th.r { text-align: right; }
table.bill tfoot td { background: #f5f5f5; font-weight: 700; }
.sign { display: flex; justify-content: space-between; margin-top: 22mm; font-size: 9pt; }
.sign div { width: 56mm; border-top: 1px solid #969696; padding-top: 1.5mm; }
.sign div:last-child { text-align: right; }
</style></head><body>
<div class="band"><div style="display:flex;align-items:center">${LOGO ? `<img src="${LOGO}" alt="">` : ''}<div><div class="t">Padma Hostel</div><div class="s">${esc(br.name)} (${esc(br.id)})</div></div></div><div class="g">Generated: {{GENERATED}}</div></div>
<div class="wrap">
<h1 style="margin-top:2mm">Student Admission Form &amp; Joining Bill</h1>
<div class="photo">${rec.photo ? `<img src="${rec.photo}" alt="">` : ''}</div>
<div style="width:140mm">
<h2 style="margin-top:0">Student Profile</h2>
${kv([['Full Name', rec.name], ...opt([['Name in Nepali', rec.nameNepali], ['Form No.', rec.formNo]]), ['Date of Birth (BS)', rec.dob], ['WhatsApp', rec.whatsapp], ['Email', rec.email], ['Blood Group', rec.bloodGroup]])}
</div>
${kv([['District', rec.district], ['Municipality', rec.municipality], ['Ward No.', rec.ward], ['Tole / Street', rec.street], ['Citizenship No.', rec.citizenship], ['Institute', rec.institute], ['Class Shift', rec.shift], ['Level / Course', rec.level], ['Food Preference', rec.foodPreference], ['Health Conditions', rec.health]])}
<h2>Guardian's Profile</h2>
${kv([["Father's Name", rec.fatherName], ...opt([["Father's Phone", rec.fatherPhone], ["Father's Occupation", rec.fatherOccupation]]), ["Mother's Name", rec.motherName], ...opt([["Mother's Phone", rec.motherPhone], ["Mother's Occupation", rec.motherOccupation]]), ['Local Guardian', rec.guardianName], ['Relation', rec.relation], ['Emergency Phone', rec.emergencyPhone], ['Occupation', rec.occupation], ['Address', rec.guardianAddress]])}
<h2>Official Hostel Section</h2>
${kv([['Booking Date (BS)', rec.bookingDate], ['Admission Date (BS)', rec.admissionDate], ['Assigned Room', rec.roomLabel], ['Bed No.', rec.roomNo], ...opt([['Stay Duration', rec.stayDuration]]), ['Approved By', rec.approvedBy]])}
<table class="bill"><thead><tr><th>Joining Bill Item</th><th class="r">Amount (Rs.)</th></tr></thead><tbody>
<tr><td>Admission Fee</td><td class="r">${money(rec.admissionFee)}</td></tr>
<tr><td>Security Deposit (refundable)</td><td class="r">${money(rec.deposit)}</td></tr>
<tr><td>Form Fee</td><td class="r">${money(rec.formFee)}</td></tr>
<tr><td>Bed / Room Fee</td><td class="r">${money(rec.bedFee)}</td></tr>${Number(rec.discount) ? `<tr><td>Discount given${rec.discountNote ? ' (' + esc(rec.discountNote) + ')' : ''} — already taken off the amounts above</td><td class="r">${money(rec.discount)}</td></tr>` : ''}</tbody>
<tfoot><tr><td>TOTAL</td><td class="r">${money(total)}</td></tr></tfoot></table>
<div class="sign"><div>Student / Guardian Signature</div><div>Authorized Signature (Padma Hostel)</div></div>
</div></body></html>`;
}

// month ("2083-07") an admission record belongs to
function recordYm(rec) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rec.admissionDateBS || '')) return rec.admissionDateBS.slice(0, 7);
  const t = rec.createdAt ? new Date(rec.createdAt) : null;
  if (t && !Number.isNaN(t.getTime())) { const b = dates.adToBs(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); return `${b.year}-${pad(b.month)}`; }
  return '';
}

// ---------- the full list of files that should exist ----------
function buildReports(state, nowYm, opts = {}) {
  LOGO = opts.logo || '';
  const files = [];
  const dirs = new Set();

  for (const br of Object.values(logic.BRANCHES)) {
    const data = state.branches[br.id];
    const months = new Set();
    const add = (ym) => { if (/^\d{4}-\d{2}$/.test(ym || '')) months.add(ym); };
    data.income.forEach((r) => add(logic.ymOf(r.dateBS)));
    data.expenditure.forEach((r) => add(logic.ymOf(r.dateBS)));
    data.fees.forEach((f) => add(f.forMonth));
    data.records.forEach((r) => add(recordYm(r)));
    add(nowYm);

    for (const ym of [...months].sort()) {
      const [y, m] = ym.split('-').map(Number);
      const base = `${br.name}/${y}/${pad(m)} ${MONTHS[m - 1]}`;
      [F_FEE, F_INC, F_EXP, F_ADM, F_PL].forEach((f) => dirs.add(`${base}/${f}`));

      const inc = data.income.filter((r) => logic.ymOf(r.dateBS) === ym).sort(byDate);
      const exp = data.expenditure.filter((r) => logic.ymOf(r.dateBS) === ym).sort(byDate);

      if (inc.length) files.push({ rel: `${base}/${F_INC}/Income Record - ${monthTitle(y, m)}.pdf`, html: ledgerReport('income', y, m, inc, br) });
      if (exp.length) files.push({ rel: `${base}/${F_EXP}/Expenditure Record - ${monthTitle(y, m)}.pdf`, html: ledgerReport('expenditure', y, m, exp, br) });

      if (data.fees.some((f) => f.forMonth === ym)) {
        const status = logic.feeStatus(data, ym);
        const complete = status.length > 0 && status.every((x) => x.status === 'paid');
        files.push({ rel: `${base}/${F_FEE}/Monthly Fee Record - ${monthTitle(y, m)}${complete ? '' : ' (INCOMPLETE)'}.pdf`, html: feeReport(br, y, m, status) });
      }

      const used = new Set();
      for (const rec of data.records.filter((r) => recordYm(r) === ym)) {
        let nm = safeName(rec.name), n = 1;
        while (used.has(nm.toLowerCase())) { n += 1; nm = `${safeName(rec.name)} (${n})`; }
        used.add(nm.toLowerCase());
        files.push({ rel: `${base}/${F_ADM}/${nm} - Admission Form.pdf`, html: admissionHtml(rec, br) });
      }

      if (inc.length || exp.length) {
        files.push({ rel: `${base}/${F_PL}/Monthly Profit or Loss - ${monthTitle(y, m)}.pdf`, html: monthlyPL(data, br, y, m) });
        files.push({ rel: `${base}/${F_PL}/Yearly Profit or Loss - ${y} (till ${MONTHS[m - 1]}).pdf`, html: yearlyPL(data, br, y, m) });
      }
    }
  }
  return { files, dirs: [...dirs] };
}

module.exports = { buildReports, admissionHtml, safeName, F_FEE, F_INC, F_EXP, F_ADM, F_PL };
