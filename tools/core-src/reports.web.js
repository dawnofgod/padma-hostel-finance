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

// Looks like Padma's printed paper "Student Application Form" (green frame, boxes, official section),
// filled in with the saved details. Page 2 is the joining bill.
function admissionHtml(rec, br) {
  const rs = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
  const v = (x) => esc(String(x == null ? '' : x).trim());
  const hostel = String(br.name || 'Padma Hostel').toUpperCase();
  const name = String(rec.name || '').toUpperCase();
  const boxes = Math.max(18, name.length);
  const letters = Array.from({ length: boxes }, (_, i) => `<span>${esc(name[i] || '')}</span>`).join('');
  const food = String(rec.foodPreference || '').toLowerCase();
  const tick = (k) => `<span class="chk">${food === k ? '✓' : ''}</span>`;
  const f = (label, val, grow = 1, lw) => `<div class="f" style="flex:${grow}"><label${lw ? ` style="min-width:${lw}"` : ''}>${label}</label><div class="bx">${v(val)}</div></div>`;
  const row = (...cells) => `<div class="row">${cells.join('')}</div>`;
  const total = (Number(rec.admissionFee) || 0) + (Number(rec.deposit) || 0) + (Number(rec.formFee) || 0) + (Number(rec.bedFee) || 0);
  const monthly = Number(rec.monthlyRent) || Number(rec.bedFee) || 0;
  const appDate = rec.applicationDate || rec.bookingDate || rec.admissionDate || '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Admission – ${esc(rec.name)}</title><style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 9.5pt/1.25 "Segoe UI", Calibri, Arial, "Nirmala UI", "Mangal", sans-serif; color: #1f2937; }
.sheet { width: 210mm; height: 297mm; padding: 7mm; background: #fff; overflow: hidden; }
.frame { height: 100%; background: #3f9f45; padding: 2.2mm 4mm 4mm; display: flex; flex-direction: column; }
.strip { display: flex; justify-content: space-between; color: #fff; font-size: 7.5pt; font-weight: 600; padding: 0 1mm 1.6mm; }
.paper { flex: 1; background: #dde8f1; border: 1.2mm solid #6cbf62; padding: 4mm 6mm 3mm; position: relative; display: flex; flex-direction: column; }
.head { display: flex; align-items: flex-start; }
.formno { width: 40mm; font-size: 8.5pt; padding-top: 2mm; } .formno b { font: 600 14pt "Courier New", monospace; color: #374151; margin-left: 2mm; letter-spacing: 1px; }
.title { flex: 1; text-align: center; }
.title .h { font: 700 18pt "Arial Narrow", Arial, sans-serif; letter-spacing: 3px; white-space: nowrap; color: #1f2937; }
.title .c { font: 500 13pt Arial, sans-serif; letter-spacing: 1px; margin-top: .5mm; }
.pill { display: inline-block; background: #e5322d; color: #fff; font: italic 700 13pt Georgia, "Times New Roman", serif; padding: 1mm 4mm; border-radius: 2mm; margin-top: 2.5mm; }
.photo { width: 27mm; height: 29mm; border: .4mm solid #9ca3af; border-radius: 2mm; background: #eef3f8; overflow: hidden; }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.dear { display: flex; justify-content: space-between; margin-top: 1.5mm; font-size: 8.6pt; }
.dear .d { text-align: right; } .ul { border-bottom: .25mm dotted #374151; display: inline-block; min-width: 30mm; padding: 0 1mm; font-weight: 600; }
.letter { font-size: 8.4pt; margin-top: 1mm; }
.bar { display: flex; align-items: center; margin: 2.2mm 0 1.4mm; } .bar:before, .bar:after { content: ""; flex: 1; border-top: .35mm solid #4b5563; }
.bar span { background: #3f3f46; color: #fff; font: 700 9pt Arial, sans-serif; padding: .7mm 3mm; border-radius: 1mm; letter-spacing: .5px; }
.row { display: flex; gap: 2mm; margin: 1.5mm 0; align-items: center; }
.f { display: flex; align-items: center; gap: 1.5mm; min-width: 0; }
.f label { white-space: nowrap; font-size: 8.4pt; }
.bx { flex: 1; min-height: 6.2mm; background: #fff; border: .25mm solid #b6c3cf; padding: 1mm 1.6mm; font: 600 8.8pt "Segoe UI", Arial, sans-serif; color: #0f2b5b; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.letters { flex: 1; display: flex; border: .25mm solid #b6c3cf; background: #fff; }
.letters span { flex: 1; height: 6.2mm; border-right: .25mm solid #b6c3cf; text-align: center; font: 700 9pt Arial, sans-serif; color: #0f2b5b; line-height: 6.2mm; }
.letters span:last-child { border-right: 0; }
.chk { display: inline-block; width: 5mm; height: 5mm; background: #fff; border: .3mm solid #6b7280; text-align: center; line-height: 4.6mm; font-weight: 700; color: #0f2b5b; margin: 0 4mm 0 1.5mm; vertical-align: middle; }
.decl { font-style: italic; font-size: 8.2pt; margin-top: 2.5mm; }
.sig { text-align: right; margin: 1.5mm 0 5mm; color: #b45309; font-weight: 600; font-size: 10pt; } .sig i { display: inline-block; width: 45mm; border-bottom: .25mm dotted #6b7280; }
.off { margin-top: auto; flex-shrink: 0; border: .35mm solid #6b7280; border-radius: 2mm; background: #eef3f8; padding: 4mm 3mm 2mm; position: relative; }
.off .tag { position: absolute; top: -3.2mm; left: 50%; transform: translateX(-50%); background: #e5322d; color: #fff; font: 700 8.5pt Arial; padding: .6mm 2.5mm; border-radius: 1mm; }
.off .bx { background: #cdd9e5; border-color: #aebccb; }
.off .note { text-align: center; font-style: italic; font-size: 7.6pt; margin-top: 1.5mm; }
.bill { padding: 14mm 16mm; }
.bill h1 { font: 700 18pt Arial; margin: 0; letter-spacing: 2px; } .bill .sub { color: #4b5563; margin-bottom: 6mm; }
.bill table { width: 100%; border-collapse: collapse; margin-top: 4mm; font-size: 10pt; }
.bill th { background: #3f9f45; color: #fff; text-align: left; padding: 2.4mm 3mm; } .bill td { border: .25mm solid #c7d2dc; padding: 2.4mm 3mm; }
.bill .r { text-align: right; } .bill tfoot td { font-weight: 700; background: #eef6ee; }
.bill .kv { display: grid; grid-template-columns: 38mm 1fr 38mm 1fr; gap: 1.6mm 3mm; font-size: 9.5pt; } .bill .kv b { color: #4b5563; font-weight: 600; }
.bill .signs { display: flex; justify-content: space-between; margin-top: 28mm; font-size: 9pt; } .bill .signs div { width: 60mm; border-top: .3mm solid #6b7280; padding-top: 1.5mm; } .bill .signs div:last-child { text-align: right; }
.gen { color: #6b7280; font-size: 7.5pt; margin-top: 10mm; }
</style></head><body>
<div class="sheet"><div class="frame">
 <div class="strip"><span>होस्टल व्यवसायी संघ नेपालमा आवद्ध</span><span>Application Form Fee Rs. ${rs(rec.formFee || 200)}/-</span></div>
 <div class="paper">
  <div class="head"><div class="formno">Form No. <b>${v(rec.formNo)}</b></div>
   <div class="title"><div class="h">${esc(hostel)}</div><div class="c">LALITPUR</div><div class="pill">Student Application Form</div></div>
   <div style="width:40mm;display:flex;justify-content:flex-end"><div class="photo">${rec.photo ? `<img src="${rec.photo}" alt="">` : ''}</div></div></div>
  <div class="dear"><b>Dear Sir/Madam,</b><span class="d">Date: <span class="ul">${v(appDate)}</span></span></div>
  <div class="letter">I <span class="ul" style="min-width:70mm">${esc(name)}</span> being interested to stay in this hostel have submitted this application (filling up all the details concerning me) along with other necessary documents.</div>
  <div class="bar"><span>STUDENT'S PROFILE</span></div>
  ${row(`<div class="f" style="flex:1"><label>Student's Name (IN CAPITAL)</label><div class="letters">${letters}</div></div>`)}
  ${row(f('विद्यार्थीको नाम : (नेपालीमा)', rec.nameNepali))}
  ${row(f('Date of Birth', rec.dob, 1.1), f('Contact No.', rec.whatsapp, 1.4), f('E-mail', rec.email, 1.9))}
  ${row(f('Address: District', rec.district, 1.3), f('Metro/Sub-Metro/Rural/Municipality', rec.municipality, 2))}
  ${row(f('Ward No.:', rec.ward, .55), f('Street Name/Tole/Chowk', rec.street, 2.5))}
  ${row(f('Citizenship No./Date of Issue/Place', rec.citizenship))}
  ${row(f('Name of the Educational Institute', rec.institute, 2.2), f('Class Time', rec.shift, 1))}
  ${row(f('Level of Study', rec.level, 1.5), f('Time duration to stay in the hostel', rec.stayDuration, 1.8))}
  ${row(f('Blood Group', rec.bloodGroup, 1.3), `<div class="f" style="flex:2.2;justify-content:flex-end"><label>Food : Vegetarian</label>${tick('vegetarian')}<label>Only Egg</label>${tick('only egg')}<label>Non-vegetarian</label>${tick('non-vegetarian')}</div>`)}
  ${row(f('Mention the disease (if any)', rec.health))}
  <div class="bar"><span>GUARDIAN'S PROFILE</span></div>
  ${row(f("Father's Name", rec.fatherName, 1.7, '24mm'), f('Contact No.', rec.fatherPhone, 1.1), f('Occupation', rec.fatherOccupation, 1))}
  ${row(f("Mother's Name", rec.motherName, 1.7, '24mm'), f('Contact No.', rec.motherPhone, 1.1), f('Occupation', rec.motherOccupation, 1))}
  ${row(f('Spouse Name', rec.spouseName, 1.7, '24mm'), f('Contact No.', rec.spousePhone, 1.1), f('Occupation', rec.spouseOccupation, 1))}
  ${row(f('Name of the Local Guardian', rec.guardianName, 1.5), f('Address :', rec.guardianAddress, 1.4))}
  ${row(f('Contact No.', rec.emergencyPhone, 1.2), f('Occupation', rec.occupation, 1.3), f('Relation', rec.relation, 1.2))}
  <div class="decl">I hereby declare that I am fully satisfied with the terms and conditions of the hostel. I agree every rule and regulation of the hostel and would like to get admission. I promise that I will not violet any rules. If found, I accept any action taken by the hostel management. Therefore, I would like to request the hostel management to allow me to get admission.</div>
  <div class="sig">Student's Signature: <i></i></div>
  <div class="off"><span class="tag">For Official Purpose Only</span>
   <div style="display:flex;gap:4mm">
    <div style="flex:1.25">
     ${row(f('Booking Date', rec.bookingDate, 1.4, '24mm'), f('Room No.', [String(rec.roomLabel || '').replace(/^Room\s*/i, ''), rec.roomNo].filter(Boolean).join(' · '), 1))}
     ${row(f('Monthly Fee', monthly ? 'Rs. ' + rs(monthly) : '', 1, '24mm'))}
     ${row(f('Admission Date', rec.admissionDate, 1, '24mm'))}
    </div>
    <div style="flex:1"><div style="text-align:center;font-weight:700;margin:1mm 0 1mm">Approved by</div>
     ${row(f('Name', rec.approvedBy, 1, '16mm'))}${row(f('Signature', '', 1, '16mm'))}</div>
   </div>
   <div class="note">Only the original copy of the application form will be valid while admitting the student.</div>
  </div>
 </div>
</div></div>
<div class="sheet bill">
 <h1>${esc(hostel)}</h1><div class="sub">Lalitpur · Joining Bill</div>
 <div class="kv"><b>Student</b><span>${esc(name)}</span><b>Form No.</b><span>${v(rec.formNo) || '-'}</span>
  <b>Room / Bed</b><span>${v([rec.roomLabel, rec.roomNo].filter(Boolean).join(' · '))}</span><b>Admission Date</b><span>${v(rec.admissionDate)}</span>
  <b>Contact No.</b><span>${v(rec.whatsapp) || '-'}</span><b>Monthly Fee</b><span>Rs. ${rs(monthly)}</span></div>
 <table><thead><tr><th>Joining Bill Item</th><th class="r">Amount (Rs.)</th></tr></thead><tbody>
 <tr><td>Admission Fee</td><td class="r">${rs(rec.admissionFee)}</td></tr>
 <tr><td>Security Deposit (refundable)</td><td class="r">${rs(rec.deposit)}</td></tr>
 <tr><td>Form Fee</td><td class="r">${rs(rec.formFee)}</td></tr>
 <tr><td>Bed / Room Fee (first month)</td><td class="r">${rs(rec.bedFee)}</td></tr>${Number(rec.discount) ? `<tr><td>Discount given${rec.discountNote ? ' (' + esc(rec.discountNote) + ')' : ''} — already taken off the amounts above</td><td class="r">${rs(rec.discount)}</td></tr>` : ''}</tbody>
 <tfoot><tr><td>TOTAL</td><td class="r">${rs(total)}</td></tr></tfoot></table>
 <div class="signs"><div>Student / Guardian Signature</div><div>Authorized Signature (${esc(br.name || 'Padma Hostel')})</div></div>
 <div class="gen">Generated: {{GENERATED}}</div>
</div>
</body></html>`;
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
