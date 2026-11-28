// Padma Hostel Finance – the browser side (replaces the old desktop app's main.js + preload.js).
// Gives the screens the same `window.padma` API, but:
//   • data is kept in this browser's private storage (IndexedDB) on this computer
//   • "Save" writes the PDF reports + a data backup into a folder you choose once
//     (pick a folder inside Google Drive for Desktop and Google uploads it automatically)
'use strict';
(function () {
  const { dates, logic, db, reports } = window.PadmaCore;
  const APP_VERSION = '5.5.3';
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
    if (LOGO) return;
    try {
      const blob = await (await fetch('assets/logo.png')).blob();
      LOGO = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    } catch { LOGO = ''; }
  }
  async function orgName() { return 'Padma Hostel'; }

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

  async function wipeRecords() {
    await ready;
    if (!state) state = db.normalize((await kvGet('state')) || db.defaultState());
    await kvSet('preReset', { at: new Date().toISOString(), state });
    const next = JSON.parse(JSON.stringify(state));
    for (const id of logic.BRANCH_IDS) {
      const b = next.branches[id];
      b.students = []; b.records = []; b.fees = []; b.income = []; b.expenditure = [];
      b.rooms.forEach((r) => { r.beds = r.beds.map(() => ({ studentId: null, name: null, phone: null })); });
    }
    await storeState(next);
    await kvDel('manifest'); await kvDel('driveManifest');
    const a = await kvGet('account'); if (a) { a.copyHash = ''; await kvSet('account', a); }
  }
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
  let autoTimer = null, driveTimer = null;
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
    clearTimeout(driveTimer);
    driveTimer = setTimeout(() => {
      GDrive.backupOnly().catch((e) => console.warn('Drive auto backup failed', e));
      Client.ping().catch(() => {}); // also sends the copy for the admin panel
    }, 20000);
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

  // ---------------- Save: data backup + PDF reports into the folder and/or Google Drive ----------------
  // One PDF is made once per Save and reused for both places.
  function buildAll(org) {
    const nowYm = logic.ymOf(dates.today().bs.str);
    const built = reports.buildReports(state, nowYm, { logo: LOGO, org });
    const generated = stamp();
    const cache = new Map();
    const getPdf = async (f) => {
      if (!cache.has(f.rel)) cache.set(f.rel, await htmlToPdf(f.html.replace('{{GENERATED}}', generated)));
      return cache.get(f.rel);
    };
    return { ...built, getPdf };
  }

  async function syncReports(root, all, force) {
    let changed = 0, removed = 0, errors = 0;
    const { files, dirs, getPdf } = all;
    for (const d of dirs) await dirAt(root, d.split('/'), true);
    const manifest = force ? {} : ((await kvGet('manifest')) || {});
    const next = {};
    let done = 0;
    for (const f of files) {
      done += 1;
      const h = await sha(f.html);
      if (manifest[f.rel] === h && await fileExists(root, f.rel)) { next[f.rel] = h; continue; }
      status = { ...status, message: `Saving PDF reports… ${done}/${files.length}` }; notify();
      try {
        await writeFile(root, f.rel, await getPdf(f));
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
      if (await Client.isFrozen()) throw new Error('This account is frozen. Please contact the admin.');
      const driveOn = await GDrive.isConnected();
      const hasLocal = !!(await getFolder());
      if (!driveOn && !hasLocal && !folderSupported) throw new Error('Connect Google Drive in Settings to save the reports.');
      await loadLogo();
      const all = buildAll(await orgName());
      let r = { changed: 0, removed: 0, errors: 0 };
      const notes = [];
      let pending = false, driveDone = false;
      // 1) the folder on this computer (if one is chosen — or nothing else is set up yet)
      if (hasLocal || !driveOn) {
        try {
          const root = await usableFolder(true);
          await writeFile(root, `${BACKUP_DIR}/${BACKUP_FILE}`, JSON.stringify(state));
          r = await syncReports(root, all, force);
        } catch (e) {
          if (!driveOn) throw e;
          r.errors += 1; notes.push('Folder on this PC: ' + (e.message || e));
        }
      }
      // 2) Google Drive
      if (driveOn) {
        if (!navigator.onLine) { pending = true; notes.push('No internet — saved on this PC; press Save again when online to upload to Google Drive'); }
        else {
          try {
            const d = await GDrive.sync(all, force); driveDone = true;
            r = { changed: Math.max(r.changed, d.changed), removed: Math.max(r.removed, d.removed), errors: r.errors + d.errors };
            if (d.errors) notes.push(`${d.errors} file(s) could not be uploaded to Google Drive`);
          } catch (e) { r.errors += 1; notes.push('Google Drive: ' + (e.message || e)); }
        }
      }
      status = { busy: false, lastRun: new Date().toISOString(), ...r, drive: driveDone, message: notes.join(' · ') || (r.errors ? `${r.errors} PDF(s) could not be created` : '') };
      if (!r.errors && !pending) {
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

  // ---------------- Account (username + password made by the admin) ----------------
  // Staff log in with the username + password the admin gave them. The first login on a computer needs
  // internet; after that the same login also works offline. Every person has their own profile and their own
  // backup folder in the owner's Google Drive.
  // The account is kept on this computer (kv 'account': { token, user, pending }). With it the app tells the
  // admin panel it is online (every 2 minutes), backs up to the person's own folder in the owner's Google Drive,
  // can use the form scanner, and gets locked if the admin freezes the account.
  const Client = (() => {
    const listeners = [], removedListeners = [], resetListeners = [];
    const acc = async () => { await ready; return (await kvGet('account')) || null; };
    const tok = async () => { const a = await acc(); return a && a.token; };
    async function setFrozen(v) {
      const was = !!(await kvGet('frozen'));
      await kvSet('frozen', !!v);
      if (was !== !!v) listeners.forEach((cb) => { try { cb(!!v); } catch { /* ignore */ } });
    }
    async function removed(msg) {
      await kvDel('account'); await kvDel('driveManifest'); await setFrozen(false);
      removedListeners.forEach((cb) => { try { cb(msg); } catch { /* ignore */ } });
    }
    async function post(body, url) {
      let r;
      try { r = await fetch(url || 'api/user', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
      catch { throw new Error('Could not reach the server (check the internet connection).'); }
      return { r, out: await r.json().catch(() => ({})) };
    }
    async function call(body, opts = {}) {
      const token = await tok();
      if (!token) { const e = new Error('Please sign in with Google first.'); e.code = 'SIGNIN'; throw e; }
      const { r, out } = await post({ ...body, token }, opts.url);
      if (r.status === 423 || out.frozen) { await setFrozen(true); const e = new Error(out.error || 'This account is frozen. Please contact the admin.'); e.code = 'FROZEN'; throw e; }
      if (r.status === 401 && out.removed) { await removed(out.error); const e = new Error(out.error); e.code = 'SIGNIN'; throw e; }
      if (!r.ok) { const e = new Error(out.error || 'Server error ' + r.status); e.status = r.status; throw e; }
      return out;
    }
    function stats() {
      const cnt = (k) => logic.BRANCH_IDS.reduce((a, b) => a + ((state && state.branches[b][k]) || []).length, 0);
      const ua = navigator.userAgent;
      const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Computer';
      const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
      return { version: APP_VERSION, dataBytes: state ? JSON.stringify(state).length : 0, records: cnt('income') + cnt('expenditure') + cnt('fees'), students: cnt('students'), device: `${os} · ${br}` };
    }
    async function remember(user) {
      const a = (await acc()) || {};
      // a profile changed on this computer but not yet sent keeps the local version
      a.user = a.pending ? { ...user, hostel: a.user.hostel, profile: a.user.profile, logo: a.user.logo, sections: a.user.sections, onboarded: true } : user;
      a.checkedAt = new Date().toISOString();
      await kvSet('account', a);
      return a;
    }
    async function ping() {
      if (!navigator.onLine || !(await tok())) return info();
      try {
        const out = await call({ action: 'ping', stats: stats() });
        await setFrozen(false);
        await remember(out.user);
        const seen = Number(await kvGet('resetSeen')) || 0;
        if (out.user.resetAt && Number(out.user.resetAt) > seen) {
          await kvSet('resetSeen', Number(out.user.resetAt));
          await wipeRecords();
          resetListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
        }
        await sendCopy();
      } catch (e) { if (e.code !== 'FROZEN' && e.code !== 'SIGNIN') console.warn('ping failed', e); }
      return info();
    }
    // A compressed copy of the records goes to the server whenever it changed, so the admin can open
    // "View records" and a new computer can bring the data back, even without Google Drive.
    let copyBusy = false;
    async function sendCopy() {
      if (copyBusy || !state || typeof CompressionStream === 'undefined') return;
      copyBusy = true;
      try {
        const json = JSON.stringify(state);
        const h = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
        const a = await acc();
        if (!a || a.copyHash === h) return;
        const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        let bin = ''; const u8 = new Uint8Array(gz);
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        await call({ action: 'copy', data: btoa(bin), bytes: json.length });
        const b = await acc(); b.copyHash = h; b.lastCopy = new Date().toISOString(); await kvSet('account', b);
      } catch (e) { if (e.code !== 'FROZEN' && e.code !== 'SIGNIN') console.warn('copy failed', e); } finally { copyBusy = false; }
    }
    async function login(username, password) {
      await ready;
      const name = String(username || '').trim().toLowerCase();
      let r = null, out = {};
      if (navigator.onLine) {
        try { ({ r, out } = await post({ action: 'login', username: name, password, device: stats().device })); } catch { r = null; }
      }
      if (r && r.ok) {
        const prev = (await kvGet('account')) || {};
        if (prev.user && prev.user.username !== out.user.username) await kvDel('driveManifest');
        await kvSet('account', { token: out.token, user: out.user, pending: false, signedInAt: new Date().toISOString() });
        await setFrozen(false);
        await kvSet('auth', await makeCred(name, password)); // so the same login works offline
        return auth.login(name, password);
      }
      if (r && r.status === 423) { await setFrozen(true); return { ok: false, error: out.error || 'This account is frozen by the admin.' }; }
      if (r && (r.status === 401 || r.status === 429 || r.status === 400)) return { ok: false, error: out.error || 'Wrong username or password.' };
      // no internet (or server not reachable): use the login saved on this computer
      if (await auth.needsSetup() || !((await kvGet('account')) || {}).token) return { ok: false, error: 'The first login on this computer needs internet.' };
      const res = await auth.login(name, password);
      if (!res.ok) res.error = 'Wrong username or password.';
      return res;
    }
    async function changePassword(oldPw, newPw) {
      if (String(newPw || '').length < 6) throw new Error('The new password must have at least 6 characters.');
      if (!navigator.onLine) throw new Error('Changing the password needs internet.');
      await call({ action: 'changepw', old: oldPw, password: newPw });
      const a = await acc();
      await kvSet('auth', await makeCred(a.user.username, newPw));
      return true;
    }
    async function info() {
      await ready;
      const a = (await kvGet('account')) || null;
      const u = (a && a.user) || {};
      return {
        signedIn: !!(a && a.token), onboarded: true, username: u.username || '', email: u.username || '', gname: '', gpicture: '',
        hostel: u.hostel || '', profile: u.profile || '', logo: u.logo || '', sections: u.sections || null, env: u.env || '',
        driveReady: !!(u.drive && u.drive.ready), driveOff: !!(u.drive && u.drive.off), folderName: (u.drive && u.drive.folderName) || '', pending: !!(a && a.pending),
        checkedAt: (a && a.checkedAt) || null, frozen: !!(await kvGet('frozen')), lastSync: (a && a.lastSync) || null, lastBackup: (a && a.lastBackup) || null,
      };
    }
    async function note(k) { const a = await acc(); if (!a) return; a[k] = new Date().toISOString(); await kvSet('account', a); }
    async function myBackup() { return call({ action: 'mybackup' }); }
    return {
      call, ping, login, changePassword, info, note, myBackup,
      isFrozen: async () => { await ready; return !!(await kvGet('frozen')); },
      onFrozen: (cb) => listeners.push(cb), onRemoved: (cb) => removedListeners.push(cb), onReset: (cb) => resetListeners.push(cb),
      hasToken: async () => !!(await tok()),
    };
  })();
  setInterval(() => { if (!document.hidden) Client.ping(); }, 120000);
  window.addEventListener('online', () => Client.ping());

  // ---------------- Google Drive backup (owner's Drive, one folder per person) ----------------
  const GDrive = (() => {
    const isConnected = async () => { const i = await Client.info(); return i.signedIn && i.onboarded && i.driveReady; };
    async function upload(rel, blob, mime) {
      const { uploadUrl } = await Client.call({ action: 'start', path: rel, mime, size: blob.size });
      let r;
      try { r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob }); }
      catch { throw new Error('Upload to Google Drive was interrupted.'); }
      if (!r.ok) throw new Error('Google Drive did not accept ' + rel.split('/').pop() + ' (' + r.status + ').');
    }
    async function sync(all, force) {
      const man = force ? {} : ((await kvGet('driveManifest')) || {}); // rel -> hash
      const next = {};
      let changed = 0, removed = 0, errors = 0, completed = false;
      try {
        const bRel = `${BACKUP_DIR}/${BACKUP_FILE}`;
        status = { ...status, message: 'Uploading backup to Google Drive…' }; notify();
        await upload(bRel, new Blob([JSON.stringify(state)], { type: 'application/json' }), 'application/json');
        next[bRel] = 'data';
        let done = 0;
        for (const f of all.files) {
          done += 1;
          const h = await sha(f.html);
          if (man[f.rel] === h) { next[f.rel] = h; continue; }
          status = { ...status, message: `Uploading to Google Drive… ${done}/${all.files.length}` }; notify();
          try { await upload(f.rel, await all.getPdf(f), 'application/pdf'); next[f.rel] = h; changed += 1; }
          catch (e) { if (e.code || e.status === 409) throw e; errors += 1; console.error('Drive upload failed', f.rel, e); }
        }
        const wanted = new Set(all.files.map((f) => f.rel).concat([bRel]));
        for (const rel of Object.keys(man)) {
          if (wanted.has(rel)) continue;
          try { await Client.call({ action: 'trash', path: rel }); removed += 1; } catch { /* ignore */ }
        }
        completed = true;
      } finally {
        await kvSet('driveManifest', completed ? next : { ...man, ...next });
      }
      await Client.note('lastSync');
      return { changed, removed, errors };
    }
    async function backupOnly() {
      if (!navigator.onLine || !(await isConnected()) || (await Client.isFrozen())) return false;
      await upload(`${BACKUP_DIR}/${BACKUP_FILE}`, new Blob([JSON.stringify(state)], { type: 'application/json' }), 'application/json');
      await Client.note('lastBackup');
      return true;
    }
    return { isConnected, sync, backupOnly };
  })();

  // ---------------- backup file download / restore ----------------
  async function downloadBackup() {
    const t = dates.today();
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Padma Hostel Backup ${t.bs.str}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // Reads a backup made by this app, by Padma Hostel Finance, or by the old desktop app (padma-data-v3.json).
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
    load: async (token) => { await ready; guard(token); Client.ping().catch(() => {}); return { state, folder: ((await getFolder()) || {}).name || '', dbFile: 'Browser storage on this computer', status: getStatus() }; },
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
        await loadLogo();
        reports.buildReports(state, '', { logo: LOGO, org: await orgName() }); // sets the logo and name used by the form
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
      upload: async (token) => { guard(token); await downloadBackup(); return { count: 1, skipped: 0 }; },
    },
    // Reads a photo of an old paper application form (needs internet). The photo is shrunk first, sent to this
    // app's own server (api/scan on Vercel) which asks Google Gemini, and is not stored anywhere.
    scan: {
      read: async (token, file) => {
        guard(token);
        if (!navigator.onLine) throw new Error('Scanning needs internet. Connect and try again.');
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not a photo the app can open (use JPG or PNG).')); i.src = URL.createObjectURL(file); });
        const k = Math.min(1, 2000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        const dataUrl = c.toDataURL('image/jpeg', 0.85);
        const out = await Client.call({ mime: 'image/jpeg', image: dataUrl.split(',')[1] }, { url: 'api/scan' });
        return { fields: out.fields || {}, image: dataUrl };
      },
    },
    // Google account. These work before the username/password login (they are needed to set it up).
    account: {
      info: () => Client.info(),
      ping: () => Client.ping(),
      login: (u, p) => Client.login(u, p),
      changePassword: async (token, oldPw, newPw) => { guard(token); return Client.changePassword(oldPw, newPw); },
      myBackup: () => Client.myBackup(),
      isFrozen: () => Client.isFrozen(),
      onFrozen: (cb) => Client.onFrozen(cb),
      onRemoved: (cb) => Client.onRemoved(cb),
      onReset: (cb) => Client.onReset(cb),
      env: async () => { try { const r = await fetch('api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"env"}' }); return (await r.json()).env || ''; } catch { return ''; } },
    },
    // "Start fresh": removes all records of both hostels; rooms and settings stay. A safety copy is kept.
    resetAll: async (token) => {
      guard(token);
      await wipeRecords();
      try { await Client.call({ action: 'cleared' }); await Client.ping(); } catch (e) { console.warn('admin copy not cleared yet', e); }
      return state;
    },
    setSections: async (token, sections) => { guard(token); const next = JSON.parse(JSON.stringify(state)); next.settings.sections = sections; next.settings.sectionsSet = true; await storeState(next); return state; },
    // e.g. on a new computer: replace the data here with this person's latest Google Drive backup
    restoreFromDrive: async (token) => {
      guard(token);
      const out = await Client.myBackup();
      const n = db.normalize(out.data);
      await storeState(n); await kvDel('manifest'); dirty = true;
      const count = (k) => logic.BRANCH_IDS.reduce((a, b) => a + n.branches[b][k].length, 0);
      return { students: count('students'), records: count('income') + count('expenditure') + count('fees'), modifiedTime: out.modifiedTime };
    },
    backup: {
      download: async (token) => { guard(token); await downloadBackup(); return true; },
      read: async (token, file) => { guard(token); return readBackupFile(file); },
      restore: async (token, data) => { guard(token); if (!data.settings.sectionsSet && state.settings.sectionsSet) { data.settings.sections = state.settings.sections; data.settings.sectionsSet = true; } await storeState(data); await kvDel('manifest'); dirty = true; notify(); return state; },
      folderInfo: async (token) => { guard(token); return folderInfo(); },
      chooseFolder: async (token) => { guard(token); return chooseFolder(); },
      folderSupported,
    },
    // business rules shared with the PDF reports
    logic: {
      BRANCHES: logic.BRANCHES,
      activeBranchIds: logic.activeBranchIds,
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
      adToBs: dates.adToBs,
      daysInMonth: dates.daysInBsMonth,
      bsToAdString: dates.bsStringToAdString,
      formatLong: dates.formatBsLong,
      parse: dates.parseBs,
    },
  };
})();
