// Browser replacement for the old desktop app's main.js + preload.js.
// Gives the screens the same `window.padma` API, but:
//   • data is kept in this browser's private storage (IndexedDB) on this computer
//   • "Save" writes the PDF reports + a data backup into a folder you choose once
//     (pick a folder inside Google Drive for Desktop and Google uploads it automatically)
'use strict';
(function () {
  const { dates, logic, db, reports } = window.PadmaCore;
  const APP_VERSION = '3.0.0';
  const BACKUP_DIR = 'Backup';
  const BACKUP_FILE = 'padma-data.json';

  // ---------------- tiny IndexedDB key/value store ----------------
  let idb;
  const idbOpen = () => new Promise((res, rej) => {
    const r = indexedDB.open('padma-hostel-finance', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { idb = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
  const kvGet = (k) => new Promise((res, rej) => { const q = idb.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const kvSet = (k, v) => new Promise((res, rej) => { const tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  const kvDel = (k) => new Promise((res, rej) => { const tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

  // ---------------- helpers ----------------
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha = async (s) => hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)));
  const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let state = null;
  let status = { busy: false, lastRun: null, changed: 0, removed: 0, errors: 0, message: '' };
  let dirty = false, lastSaveAt = null, syncing = false;
  const listeners = [];
  const getStatus = () => ({ ...status, dirty, lastSaveAt });
  const notify = () => listeners.forEach((cb) => { try { cb(getStatus()); } catch { /* ignore */ } });
  const stateHash = () => sha(JSON.stringify(state));

  let LOGO = '';
  async function loadLogo() {
    try {
      const blob = await (await fetch('assets/logo.png')).blob();
      LOGO = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    } catch { LOGO = ''; }
  }

  const stamp = () => {
    const t = dates.today();
    const h12 = t.time.h % 12 || 12;
    return `${t.bs.day} ${dates.MONTHS[t.bs.month - 1]} ${t.bs.year} B.S., ${h12}:${dates.pad(t.time.m)} ${t.time.h < 12 ? 'AM' : 'PM'} (Nepal time)`;
  };

  // ---------------- data ----------------
  const ready = (async () => {
    await idbOpen();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ }
    let src = await kvGet('state');
    if (!src || src.version !== db.VERSION) src = (await kvGet('state.bak')) || null;
    state = db.normalize(src && src.version === db.VERSION ? src : null);
    if (!src) await kvSet('state', state);
    const meta = await kvGet('meta');
    lastSaveAt = meta ? meta.at : null;
    const anything = logic.BRANCH_IDS.some((b) => ['records', 'income', 'expenditure', 'fees'].some((k) => state.branches[b][k].length));
    dirty = meta ? meta.hash !== await stateHash() : anything;
    loadLogo();
  })();

  async function storeState(next) {
    const prev = await kvGet('state');
    if (prev) await kvSet('state.bak', prev);
    state = db.normalize(next);
    await kvSet('state', state);
    const meta = await kvGet('meta');
    dirty = !meta || meta.hash !== await stateHash();
    scheduleAutoBackup();
  }

  // ---------------- login ----------------
  const sessions = new Set();
  const ITER = 210000;
  async function pbkdf2(password, salt, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, key, 256));
  }
  async function makeCred(username, password) { const salt = randHex(16); return { username, salt, iter: ITER, hash: await pbkdf2(password, salt, ITER) }; }
  const getCred = () => kvGet('auth');
  const auth = {
    async needsSetup() { await ready; return !(await getCred()); },
    async setup(username, password) {
      await ready;
      if (await getCred()) return { ok: false, error: 'A login already exists.' };
      const u = String(username || '').trim();
      if (!u) return { ok: false, error: 'Please enter a username.' };
      if (String(password || '').length < 6) return { ok: false, error: 'The password must have at least 6 characters.' };
      await kvSet('auth', await makeCred(u, password));
      return auth.login(u, password);
    },
    async login(username, password) {
      await ready;
      const c = await getCred();
      if (!c) return { ok: false, error: 'No login has been created yet.' };
      const okUser = String(username || '').trim() === c.username;
      const okPass = (await pbkdf2(password || '', c.salt, c.iter || ITER)) === c.hash;
      if (!(okUser && okPass)) { await sleep(600); return { ok: false, error: 'Invalid credentials' }; }
      const token = randHex(24); sessions.add(token);
      return { ok: true, token, username: c.username, fallback: false };
    },
    async check(token) { const c = await getCred(); return { ok: sessions.has(token), username: c && c.username }; },
    async logout(token) { sessions.delete(token); return true; },
    async change(token, oldPassword, username, newPassword) {
      guard(token);
      const c = await getCred();
      if ((await pbkdf2(oldPassword || '', c.salt, c.iter || ITER)) !== c.hash) throw new Error('The current password is not correct.');
      const u = String(username || '').trim();
      if (!u) throw new Error('Username cannot be empty.');
      if (String(newPassword || '').length < 6) throw new Error('The new password must have at least 6 characters.');
      await kvSet('auth', await makeCred(u, newPassword));
      return true;
    },
  };
  function guard(token) { if (!sessions.has(token)) throw new Error('Please log in again.'); }

  // ---------------- save folder (Google Drive for Desktop folder) ----------------
  const folderSupported = 'showDirectoryPicker' in window;
  const getFolder = () => kvGet('folder');
  async function folderPermission(h, ask) {
    if (!h) return 'none';
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'readwrite' });
    return p;
  }
  async function chooseFolder() {
    if (!folderSupported) throw new Error('Choosing a folder needs Microsoft Edge or Google Chrome.');
    const h = await window.showDirectoryPicker({ id: 'padma-reports', mode: 'readwrite' });
    await kvSet('folder', h);
    await kvDel('manifest'); // new folder: every PDF will be written again
    return h.name;
  }
  // Returns a usable folder handle or throws a friendly error. `ask` may show the browser's permission prompt.
  async function usableFolder(ask) {
    let h = await getFolder();
    if (!h) {
      if (!ask) throw new Error('No save folder chosen yet.');
      await chooseFolder(); h = await getFolder();
    }
    if ((await folderPermission(h, ask)) !== 'granted') throw new Error('Please allow the app to use the save folder (press Save again and choose "Allow").');
    return h;
  }
  async function dirAt(root, parts, create = true) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async function writeFile(root, rel, data) {
    const parts = rel.split('/');
    const name = parts.pop();
    const dir = await dirAt(root, parts, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data); await w.close();
  }
  async function fileExists(root, rel) {
    try { const parts = rel.split('/'); const name = parts.pop(); const dir = await dirAt(root, parts, false); await dir.getFileHandle(name); return true; } catch { return false; }
  }
  async function removeFile(root, rel) {
    try { const parts = rel.split('/'); const name = parts.pop(); const dir = await dirAt(root, parts, false); await dir.removeEntry(name); return true; } catch { return false; }
  }

  // The data backup is written to the folder automatically (a few seconds after each change) whenever
  // the folder permission is already granted. PDFs are only written when Save is pressed.
  let autoTimer = null;
  function scheduleAutoBackup() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      try {
        const h = await getFolder();
        if (!h || (await folderPermission(h, false)) !== 'granted') return;
        await writeFile(h, `${BACKUP_DIR}/${BACKUP_FILE}`, JSON.stringify(state));
        await kvSet('lastAutoBackup', new Date().toISOString());
      } catch (e) { console.warn('auto backup failed', e); }
    }, 3000);
  }

  // ---------------- PDF making (html2canvas + jsPDF) ----------------
  const PX_PER_MM = 96 / 25.4;
  function pageSetup(html) {
    const landscape = /size:\s*A4\s+landscape/i.test(html);
    const zero = /@page\s*\{[^}]*margin:\s*0\s*;/i.test(html);
    const m = zero ? [0, 0, 0, 0] : [13, 11, 15, 11]; // top right bottom left, same as the old PDFs
    const W = landscape ? 297 : 210, H = landscape ? 210 : 297;
    return { landscape, m, W, H, cw: W - m[1] - m[3], ch: H - m[0] - m[2] };
  }

  async function htmlToPdf(html) {
    const ps = pageSetup(html);
    const widthPx = Math.round(ps.cw * PX_PER_MM);
    const pageHpx = ps.ch * PX_PER_MM;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:${Math.round(pageHpx)}px;border:0;visibility:hidden;`;
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument;
      doc.open(); doc.write(html); doc.close();
      await new Promise((r) => (doc.readyState === 'complete' ? r() : frame.addEventListener('load', r, { once: true })));
      await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
      doc.body.style.margin = '0';
      doc.body.style.background = '#fff';
      // the native renderer draws ~2px to the right; keep the right-hand borders inside the picture
      doc.body.style.boxSizing = 'border-box';
      doc.body.style.paddingRight = '4px';

      // keep table rows / headings / result boxes from being cut between two pages
      if (ps.m[0] !== 0) {
        const items = [...doc.body.querySelectorAll('tr, h2, .result, .banner, .foot')];
        for (const el of items) {
          if (el.closest('thead')) continue;
          const r = el.getBoundingClientRect();
          const top = r.top + doc.defaultView.scrollY;
          let h = r.height;
          if (el.tagName === 'H2') h += 70; // keep a heading together with the first lines below it
          if (h >= pageHpx) continue;
          const startPage = Math.floor(top / pageHpx);
          const endPage = Math.floor((top + h - 1) / pageHpx);
          if (startPage === endPage) continue;
          const gap = (startPage + 1) * pageHpx - top + 2;
          if (el.tagName === 'TR') {
            const sp = doc.createElement('tr');
            const td = doc.createElement('td');
            td.colSpan = 50;
            td.style.cssText = `height:${gap}px;padding:0;border:0;background:#fff`;
            sp.appendChild(td);
            el.parentNode.insertBefore(sp, el);
          } else {
            el.style.marginTop = (parseFloat(doc.defaultView.getComputedStyle(el).marginTop) || 0) + gap + 'px';
          }
        }
      }

      const fullH = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      frame.style.height = fullH + 'px';
      const scale = 2;
      const canvas = await window.html2canvas(doc.body, {
        scale, backgroundColor: '#ffffff', logging: false, useCORS: true,
        foreignObjectRendering: true, // draw with the browser's own engine: text sits exactly where Chrome/Edge puts it
        width: widthPx, height: fullH, windowWidth: widthPx, windowHeight: fullH,
      });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: ps.landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
      const slicePx = Math.floor(pageHpx * scale);
      // One-sheet forms (the admission form) are shrunk a little to stay on one page instead of spilling over.
      if (ps.m[0] === 0 && canvas.height > slicePx && canvas.height <= slicePx * 1.4) {
        const k = slicePx / canvas.height;
        const w = ps.cw * k;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', (ps.W - w) / 2, 0, w, ps.ch, undefined, 'FAST');
        return pdf.output('blob');
      }
      const pages = Math.max(1, Math.ceil((canvas.height - 4) / slicePx));
      const piece = document.createElement('canvas');
      piece.width = canvas.width;
      for (let i = 0; i < pages; i++) {
        const h = Math.min(slicePx, canvas.height - i * slicePx);
        if (h <= 0) break;
        piece.height = h;
        const ctx = piece.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, piece.width, h);
        ctx.drawImage(canvas, 0, i * slicePx, canvas.width, h, 0, 0, canvas.width, h);
        if (i > 0) pdf.addPage();
        pdf.addImage(piece.toDataURL('image/jpeg', 0.9), 'JPEG', ps.m[3], ps.m[0], ps.cw, h / scale / PX_PER_MM, undefined, 'FAST');
      }
      return pdf.output('blob');
    } finally {
      frame.remove();
    }
  }

  // ---------------- Save: data backup + PDF reports into the folder ----------------
  async function syncReports(root, force) {
    let changed = 0, removed = 0, errors = 0;
    const nowYm = logic.ymOf(dates.today().bs.str);
    if (!LOGO) await loadLogo();
    const { files, dirs } = reports.buildReports(state, nowYm, { logo: LOGO });
    for (const d of dirs) await dirAt(root, d.split('/'), true);
    const manifest = force ? {} : ((await kvGet('manifest')) || {});
    const next = {};
    const generated = stamp();
    let done = 0;
    for (const f of files) {
      done += 1;
      const h = await sha(f.html);
      if (manifest[f.rel] === h && await fileExists(root, f.rel)) { next[f.rel] = h; continue; }
      status = { ...status, message: `Saving PDF reports… ${done}/${files.length}` }; notify();
      try {
        const blob = await htmlToPdf(f.html.replace('{{GENERATED}}', generated));
        await writeFile(root, f.rel, blob);
        next[f.rel] = h; changed += 1;
      } catch (e) { errors += 1; console.error('PDF failed', f.rel, e); }
    }
    const wanted = new Set(files.map((f) => f.rel));
    for (const rel of Object.keys(manifest)) {
      if (!wanted.has(rel) && await removeFile(root, rel)) removed += 1;
    }
    await kvSet('manifest', next);
    return { changed, removed, errors };
  }

  async function saveToFolders(force) {
    if (syncing) return getStatus();
    syncing = true;
    status = { ...status, busy: true, message: 'Saving…' }; notify();
    try {
      const root = await usableFolder(true);
      await writeFile(root, `${BACKUP_DIR}/${BACKUP_FILE}`, JSON.stringify(state));
      const r = await syncReports(root, force);
      status = { busy: false, lastRun: new Date().toISOString(), ...r, message: r.errors ? `${r.errors} PDF(s) could not be created` : '' };
      if (!r.errors) {
        lastSaveAt = new Date().toISOString();
        await kvSet('meta', { hash: await stateHash(), at: lastSaveAt });
        dirty = false;
      }
    } catch (e) {
      status = { ...status, busy: false, errors: 1, message: e && e.name === 'AbortError' ? 'No folder was chosen.' : String((e && e.message) || e) };
    } finally {
      syncing = false; notify();
    }
    return getStatus();
  }

  // ---------------- backup file download / restore ----------------
  function downloadBackup() {
    const t = dates.today();
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Padma Hostel Backup ${t.bs.str}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // Reads a backup made by this app OR by the old desktop app (padma-data-v3.json / Backup\padma-data.json).
  async function readBackupFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Padma Hostel backup (it could not be read).'); }
    if (!data || data.version !== db.VERSION || !data.branches) throw new Error('This file is not a Padma Hostel backup (version ' + (data && data.version) + ').');
    const n = db.normalize(data);
    const count = (k) => logic.BRANCH_IDS.reduce((a, b) => a + n.branches[b][k].length, 0);
    return { data: n, summary: { students: count('students'), admissions: count('records'), income: count('income'), expenditure: count('expenditure'), fees: count('fees') } };
  }

  // ---------------- folder info for the settings screen ----------------
  async function folderInfo() {
    const h = await getFolder();
    const perm = h ? await folderPermission(h, false) : 'none';
    return { supported: folderSupported, name: h ? h.name : '', permission: perm, lastAutoBackup: (await kvGet('lastAutoBackup')) || null };
  }

  // ---------------- the API the screens use (same shape as the desktop app) ----------------
  window.padma = {
    version: APP_VERSION,
    auth,
    load: async (token) => { await ready; guard(token); return { state, folder: ((await getFolder()) || {}).name || '', dbFile: 'Browser storage on this computer', status: getStatus() }; },
    save: async (token, next) => { guard(token); await storeState(next); return getStatus(); },
    openFolder: async (token) => { guard(token); return chooseFolder(); },
    isOnline: async () => navigator.onLine,
    reports: {
      status: async (token) => { guard(token); return getStatus(); },
      save: async (token) => { guard(token); return saveToFolders(false); },
      regenerate: async (token) => { guard(token); return saveToFolders(true); },
    },
    // Opens one admission form as a PDF in a new tab (nothing is written to the folders).
    openAdmission: async (token, branchId, recordId) => {
      guard(token);
      const win = window.open('', '_blank');
      try {
        const br = logic.BRANCHES[branchId];
        const rec = br && state.branches[branchId].records.find((r) => r.id === recordId);
        if (!rec) throw new Error('Admission record not found.');
        if (!LOGO) await loadLogo();
        reports.buildReports(state, '', { logo: LOGO }); // sets the logo used by the form
        const html = reports.admissionHtml(rec, br).replace('{{GENERATED}}', stamp());
        if (win) win.document.write('<p style="font:14px Segoe UI,Arial;padding:20px">Preparing the admission form…</p>');
        const blob = await htmlToPdf(html);
        const url = URL.createObjectURL(blob);
        if (win) win.location.href = url; else window.open(url, '_blank');
        return true;
      } catch (e) { if (win) win.close(); throw e; }
    },
    onReports: (cb) => listeners.push(cb),
    drive: {
      status: async (token) => { guard(token); const f = await folderInfo(); return { configured: !!f.name, connected: f.permission === 'granted', lastSync: lastSaveAt, ...f }; },
      upload: async (token) => { guard(token); downloadBackup(); return { count: 1, skipped: 0 }; },
    },
    backup: {
      download: async (token) => { guard(token); downloadBackup(); return true; },
      read: async (token, file) => { guard(token); return readBackupFile(file); },
      restore: async (token, data) => { guard(token); await storeState(data); await kvDel('manifest'); dirty = true; notify(); return state; },
      folderInfo: async (token) => { guard(token); return folderInfo(); },
      chooseFolder: async (token) => { guard(token); return chooseFolder(); },
      folderSupported,
    },
    // business rules shared with the PDF reports
    logic: {
      BRANCHES: logic.BRANCHES,
      DEPOSIT_CAT: logic.DEPOSIT_CAT,
      feeStatus: logic.feeStatus,
      periodTotals: (branch, year, month) => {
        const t = logic.periodTotals(branch, year, month);
        return { revenue: t.revenue, expenditure: t.expenditure, net: t.net, deposits: t.deposits };
      },
      isRefundable: logic.isRefundable,
      revenueRows: logic.revenueRows,
      ymOf: logic.ymOf,
      prevYm: logic.prevYm,
      bedTypeOf: logic.bedTypeOf,
    },
    dates: {
      MONTHS: dates.MONTHS, MONTHS_NP: dates.MONTHS_NP, WEEKDAYS: dates.WEEKDAYS, WEEKDAYS_NP: dates.WEEKDAYS_NP,
      MIN_YEAR: dates.MIN_YEAR, MAX_YEAR: dates.MAX_YEAR,
      today: dates.today,
      daysInMonth: dates.daysInBsMonth,
      bsToAdString: dates.bsStringToAdString,
      formatLong: dates.formatBsLong,
      parse: dates.parseBs,
    },
  };
})();
