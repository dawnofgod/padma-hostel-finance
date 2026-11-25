// Nepali (Bikram Sambat) calendar helpers – browser version (same functions as the old app's src/dates.js).
// Uses the month-length table in bs-data.js. 2000-01-01 B.S. = 14 April 1943 A.D.
const MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const MONTHS_NP = ['बैशाख', 'जेठ', 'असार', 'श्रावण', 'भाद्र', 'आश्विन', 'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुन', 'चैत्र'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_NP = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

const MIN_YEAR = 2000;
const MAX_YEAR = 2089;
const EPOCH = Date.UTC(1943, 3, 14);
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
const yearLen = (y) => BS_DATA[y].reduce((a, b) => a + b, 0);

// Current wall-clock time in Nepal (UTC+05:45), independent of the PC's own timezone.
function nepalNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

function adToBs(y, m, d) {
  let n = Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY);
  if (n < 0) throw new Error('Date is before 2000 B.S.');
  let year = MIN_YEAR;
  while (BS_DATA[year] && n >= yearLen(year)) { n -= yearLen(year); year += 1; }
  if (!BS_DATA[year]) throw new Error('Date is outside the supported B.S. range.');
  let month = 1;
  while (n >= BS_DATA[year][month - 1]) { n -= BS_DATA[year][month - 1]; month += 1; }
  return { year, month, day: n + 1 };
}

function bsToAd(year, month, day) {
  if (!BS_DATA[year]) throw new Error('Year outside the supported B.S. range.');
  let n = 0;
  for (let y = MIN_YEAR; y < year; y++) n += yearLen(y);
  for (let k = 1; k < month; k++) n += BS_DATA[year][k - 1];
  n += day - 1;
  const t = new Date(EPOCH + n * DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function daysInBsMonth(year, month) {
  const row = BS_DATA[year];
  if (!row) return 30;
  return row[month - 1];
}

function today() {
  const n = nepalNow();
  const bs = adToBs(n.y, n.m, n.d);
  return {
    bs: { ...bs, str: `${bs.year}-${pad(bs.month)}-${pad(bs.day)}` },
    ad: { year: n.y, month: n.m, day: n.d, str: `${n.y}-${pad(n.m)}-${pad(n.d)}` },
    time: { h: n.h, m: n.mi, s: n.s },
    weekday: new Date(Date.UTC(n.y, n.m - 1, n.d)).getUTCDay(),
  };
}

function parseBs(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

function bsStringToAdString(str) {
  const b = parseBs(str);
  if (!b) return '';
  const a = bsToAd(b.year, b.month, b.day);
  return `${a.year}-${pad(a.month)}-${pad(a.day)}`;
}

function formatBsLong(str) {
  const b = parseBs(str);
  if (!b) return str || '';
  return `${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
}

module.exports = {
  MONTHS, MONTHS_NP, WEEKDAYS, WEEKDAYS_NP, MIN_YEAR, MAX_YEAR,
  nepalNow, adToBs, bsToAd, daysInBsMonth, today, parseBs, bsStringToAdString, formatBsLong, pad,
};
