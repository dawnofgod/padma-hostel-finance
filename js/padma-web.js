// Browser replacement for the old desktop app's main.js + preload.js.
// Gives the screens the same `window.padma` API, but:
//   • data is kept in this browser's private storage (IndexedDB) on this computer
//   • "Save" writes the PDF reports + a data backup into a folder you choose once
//     (pick a folder inside Google Drive for Desktop and Google uploads it automatically)
'use strict';
(function () {
  const { dates, logic, db, reports } = window.PadmaCore;
  const APP_VERSION = '3.1.0';
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
    driveTimer = setTimeout(() => { GDrive.backupOnly().catch((e) => console.warn('Drive auto backup failed', e)); }, 20000);
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
  function buildAll() {
    const nowYm = logic.ymOf(dates.today().bs.str);
    const built = reports.buildReports(state, nowYm, { logo: LOGO });
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
      const driveOn = await GDrive.isConnected();
      const hasLocal = !!(await getFolder());
      if (!driveOn && !hasLocal && !folderSupported) throw new Error('Connect Google Drive in Settings to save the reports.');
      if (!LOGO) await loadLogo();
      const all = buildAll();
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

  // ---------------- Google Drive (direct upload) ----------------
  // Sign-in uses Google's own window; no password or secret key is stored in this app.
  // Permission asked: "drive.file" = the app can only see files and folders it created or that you picked for it.
  const GDrive = (() => {
    const CLIENT_ID = '1094434090912-0t2r755pimfd4e7af20rasvqde3hdo4j.apps.googleusercontent.com';
    const API_KEY = 'AIzaSyAIRwmRbqpCuRRlaoSfwvtUKvA9GqtacPw'; // only works from padma-hostel-finance.vercel.app, only for the folder picker
    const APP_ID = '1094434090912';
    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const API = 'https://www.googleapis.com/drive/v3';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
    const FOLDER = 'application/vnd.google-apps.folder';
    let token = null, tokenExp = 0, tokenClient = null;

    const loadScript = (src) => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('Could not reach Google (check the internet connection).'));
      document.head.appendChild(s);
    });
    const cfg = async () => (await kvGet('gdrive')) || null; // { folderId, folderName, lastSync }
    const isConnected = async () => !!((await cfg()) || {}).folderId;
    const hasToken = () => !!token && Date.now() < tokenExp - 60000;

    async function getToken(interactive) {
      if (hasToken()) return token;
      if (window.__PADMA_TEST_DRIVE__) { token = 'test-token'; tokenExp = Date.now() + 3600e3; return token; }
      if (!interactive) throw new Error('Google sign-in needed — press Save again.');
      await loadScript('https://accounts.google.com/gsi/client');
      return new Promise((res, rej) => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPE, prompt: '',
          callback: (r) => {
            if (r.error) return rej(new Error('Google sign-in was not completed (' + r.error + ').'));
            token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000; res(token);
          },
          error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'The Google sign-in window was closed.' : 'Google sign-in failed' + (e && e.type ? ' (' + e.type + ')' : '') + '. If a pop-up was blocked, allow pop-ups for this app.')),
        });
        tokenClient.requestAccessToken();
      });
    }

    async function api(method, url, body, headers = {}) {
      const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body });
      if (r.status === 401) { token = null; throw new Error('Google sign-in expired — press Save again.'); }
      if (!r.ok) {
        let msg = r.status + ''; try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch { /* ignore */ }
        const err = new Error('Google Drive error: ' + msg); err.status = r.status; throw err;
      }
      return r.status === 204 ? null : r.json();
    }
    const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    async function findOrMakeFolder(name, parentId, cache) {
      const key = parentId + '/' + name;
      if (cache[key]) return cache[key];
      const found = await api('GET', `${API}/files?` + new URLSearchParams({
        q: `name='${q(name)}' and '${parentId}' in parents and mimeType='${FOLDER}' and trashed=false`,
        fields: 'files(id,name)', spaces: 'drive',
      }));
      const id = found.files && found.files[0] ? found.files[0].id
        : (await api('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }), { 'Content-Type': 'application/json' })).id;
      cache[key] = id;
      return id;
    }
    async function folderFor(rel, rootId, cache) {
      let parent = rootId;
      for (const part of rel.split('/').slice(0, -1)) parent = await findOrMakeFolder(part, parent, cache);
      return parent;
    }
    async function upload(rel, blob, mime, rootId, cache, existingId) {
      if (existingId) {
        try {
          await api('PATCH', `${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, blob, { 'Content-Type': mime });
          return existingId;
        } catch (e) { if (e.status !== 404) throw e; } // file was deleted in Drive → create it again
      }
      const parent = await folderFor(rel, rootId, cache);
      const meta = { name: rel.split('/').pop(), parents: [parent], mimeType: mime };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', blob);
      return (await api('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, form)).id;
    }

    async function sync(all, force) {
      const c = await cfg();
      if (!c || !c.folderId) throw new Error('Google Drive is not connected.');
      await getToken(false);
      const man = force ? {} : ((await kvGet('driveManifest')) || {}); // rel -> { hash, id }
      const folderCache = (await kvGet('driveFolders')) || {};
      if (folderCache.__root !== c.folderId) { for (const k of Object.keys(folderCache)) delete folderCache[k]; folderCache.__root = c.folderId; }
      const next = {};
      let changed = 0, removed = 0, errors = 0, completed = false;
      try {
        // data backup: always
        const bRel = `${BACKUP_DIR}/${BACKUP_FILE}`;
        status = { ...status, message: 'Uploading backup to Google Drive…' }; notify();
        const bId = await upload(bRel, new Blob([JSON.stringify(state)], { type: 'application/json' }), 'application/json', c.folderId, folderCache, (man[bRel] || {}).id);
        next[bRel] = { hash: '', id: bId };
        // PDF reports: only new or changed ones
        let done = 0;
        for (const f of all.files) {
          done += 1;
          const h = await sha(f.html);
          const old = man[f.rel];
          if (old && old.hash === h) { next[f.rel] = old; continue; }
          status = { ...status, message: `Uploading to Google Drive… ${done}/${all.files.length}` }; notify();
          try {
            const id = await upload(f.rel, await all.getPdf(f), 'application/pdf', c.folderId, folderCache, old && old.id);
            next[f.rel] = { hash: h, id }; changed += 1;
          } catch (e) {
            if (/sign-in expired/.test(e.message)) throw e;
            errors += 1; console.error('Drive upload failed', f.rel, e);
            if (old) next[f.rel] = { hash: '', id: old.id };
          }
        }
        // reports that no longer exist (e.g. a deleted month): move to Drive's Trash
        const wanted = new Set(all.files.map((f) => f.rel).concat([bRel]));
        for (const [rel, v] of Object.entries(man)) {
          if (wanted.has(rel) || !v || !v.id) continue;
          try { await api('PATCH', `${API}/files/${v.id}?fields=id`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' }); removed += 1; } catch { /* already gone */ }
        }
        completed = true;
      } finally {
        // finished: keep exactly what is in Drive now; stopped half-way: keep old entries + the progress made
        await kvSet('driveManifest', completed ? next : { ...man, ...next });
        await kvSet('driveFolders', folderCache);
      }
      await kvSet('gdrive', { ...c, lastSync: new Date().toISOString() });
      return { changed, removed, errors };
    }

    // Quick backup of the data file only (used automatically after changes, when already signed in).
    async function backupOnly() {
      const c = await cfg();
      if (!c || !c.folderId || !hasToken() || !navigator.onLine) return false;
      const man = (await kvGet('driveManifest')) || {};
      const folderCache = (await kvGet('driveFolders')) || {};
      if (folderCache.__root !== c.folderId) return false;
      const bRel = `${BACKUP_DIR}/${BACKUP_FILE}`;
      const id = await upload(bRel, new Blob([JSON.stringify(state)], { type: 'application/json' }), 'application/json', c.folderId, folderCache, (man[bRel] || {}).id);
      man[bRel] = { hash: '', id };
      await kvSet('driveManifest', man); await kvSet('driveFolders', folderCache);
      await kvSet('gdrive', { ...c, lastBackup: new Date().toISOString() });
      return true;
    }

    // Sign in, then let the user pick (or create) the Drive folder with Google's own folder picker.
    async function connect() {
      if (!navigator.onLine) throw new Error('Connect to the internet to set up Google Drive.');
      await getToken(true);
      if (window.__PADMA_TEST_DRIVE__) { const t = window.__PADMA_TEST_DRIVE__; await kvSet('gdrive', { folderId: t.folderId, folderName: t.folderName }); await kvDel('driveManifest'); await kvDel('driveFolders'); return t.folderName; }
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((res) => window.gapi.load('picker', res));
      const P = window.google.picker;
      const picked = await new Promise((res) => {
        const view = new P.DocsView(P.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes(FOLDER).setParent('root');
        new P.PickerBuilder()
          .setTitle('Choose the Google Drive folder for Padma Hostel Finance')
          .addView(view)
          .setOAuthToken(token).setDeveloperKey(API_KEY).setAppId(APP_ID)
          .setCallback((d) => {
            if (d.action === P.Action.PICKED) res(d.docs[0]);
            else if (d.action === P.Action.CANCEL) res(null);
          })
          .build().setVisible(true);
      });
      if (!picked) throw new Error('No Google Drive folder was chosen.');
      const prev = await cfg();
      await kvSet('gdrive', { folderId: picked.id, folderName: picked.name });
      if (!prev || prev.folderId !== picked.id) { await kvDel('driveManifest'); await kvDel('driveFolders'); }
      return picked.name;
    }
    async function disconnect() {
      try { if (token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* ignore */ }
      token = null; tokenExp = 0;
      await kvDel('gdrive'); await kvDel('driveManifest'); await kvDel('driveFolders');
    }
    async function info() { const c = await cfg(); return { connected: !!(c && c.folderId), folderName: c ? c.folderName : '', lastSync: c ? c.lastSync : null, lastBackup: c ? c.lastBackup : null, signedIn: hasToken() }; }
    return { isConnected, getToken, sync, backupOnly, connect, disconnect, info, hasToken };
  })();

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
    load: async (token) => { await ready; guard(token); GDrive.isConnected().then((c) => { if (c && navigator.onLine && !window.__PADMA_TEST_DRIVE__) { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; if (!document.querySelector('script[src="' + sc.src + '"]')) document.head.appendChild(sc); } }).catch(() => {}); return { state, folder: ((await getFolder()) || {}).name || '', dbFile: 'Browser storage on this computer', status: getStatus() }; },
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
    gdrive: {
      info: async (token) => { guard(token); return GDrive.info(); },
      connect: async (token) => { guard(token); return GDrive.connect(); },
      disconnect: async (token) => { guard(token); return GDrive.disconnect(); },
      // Call at the very start of a click (before other waiting) so Google's sign-in window is allowed to open.
      prepare: async (token) => { guard(token); if (!(await GDrive.isConnected()) || !navigator.onLine || GDrive.hasToken()) return true; await GDrive.getToken(true); return true; },
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
