// Shared helpers for the Google Drive backup functions (files starting with "_" are not public endpoints on Vercel).
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID      – OAuth client "Padma Hostel Finance (web app)"
//   GOOGLE_CLIENT_SECRET  – that client's secret
//   GOOGLE_REFRESH_TOKEN  – shown once by /api/drive-callback after the owner connects their Drive
//   DRIVE_FOLDER_ID       – shown on the same page (the "Padma Hostel Finance" folder in the owner's Drive)
//   SCAN_PIN              – the app PIN (also used by the scanner)
const crypto = require('crypto');

const ORIGIN = process.env.APP_ORIGIN || 'https://padma-hostel-finance.vercel.app';
const REDIRECT = ORIGIN + '/api/drive-callback';
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

function pinOk(pin) {
  const want = process.env.SCAN_PIN;
  if (!want) return false;
  const a = Buffer.from(String(pin || '')); const b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hmac = (s) => crypto.createHmac('sha256', String(process.env.GOOGLE_CLIENT_SECRET || '') + '|' + String(process.env.SCAN_PIN || '')).update(s).digest('hex');

let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Google sign-in for the backup is no longer valid (' + (j.error || r.status) + '). The owner must connect Google Drive again.'); e.status = 401; throw e; }
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function gapi(method, url, body, headers = {}) {
  const t = await accessToken();
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, ...headers }, body });
  if (!r.ok) {
    let msg = String(r.status); try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch { /* ignore */ }
    const e = new Error('Google Drive: ' + msg); e.status = r.status; throw e;
  }
  return r;
}
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findChild(parentId, name, folder) {
  const r = await gapi('GET', `${API}/files?` + new URLSearchParams({
    q: `name='${q(name)}' and '${parentId}' in parents and trashed=false` + (folder ? ` and mimeType='${FOLDER}'` : ` and mimeType!='${FOLDER}'`),
    fields: 'files(id,name)', spaces: 'drive', pageSize: '10',
  }));
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0].id : null;
}

const folderCache = new Map();
async function folderFor(parts) {
  let parent = process.env.DRIVE_FOLDER_ID;
  let key = parent;
  for (const name of parts) {
    key += '/' + name;
    if (folderCache.has(key)) { parent = folderCache.get(key); continue; }
    let id = await findChild(parent, name, true);
    if (!id) {
      const r = await gapi('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }), { 'Content-Type': 'application/json' });
      id = (await r.json()).id;
    }
    folderCache.set(key, id); parent = id;
  }
  return parent;
}

// "Padma Boys Hostel/2083/08 Mangsir/Income Record/x.pdf" → safe parts, or null
function cleanPath(p) {
  const parts = String(p || '').split('/');
  if (parts.length < 1 || parts.length > 8 || String(p).length > 400) return null;
  for (const s of parts) if (!s || s === '.' || s === '..' || s.length > 150 || /[\u0000-\u001f]/.test(s)) return null;
  return parts;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

module.exports = { ORIGIN, REDIRECT, SCOPE, API, UPLOAD, FOLDER, pinOk, sleep, hmac, accessToken, gapi, findChild, folderFor, cleanPath, readBody };
