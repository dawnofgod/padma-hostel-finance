// Shared server code (files starting with "_" are not public endpoints on Vercel).
//
// Vercel Environment Variables:
//   KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL / _TOKEN) – the free Upstash Redis database
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET – OAuth client "Padma Hostel Finance (web app)"
//   ADMIN_EMAIL     – optional; the only Gmail allowed into the admin panel (default below)
//   GEMINI_API_KEY  – for the form scanner
// The owner's Google Drive permission is saved in the database when the admin signs in (no copy/paste).
const crypto = require('crypto');

const ORIGIN = process.env.APP_ORIGIN || 'https://padma-hostel-finance.vercel.app';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'arunpoudel9957@gmail.com').toLowerCase();
const REDIRECT = ORIGIN + '/api/drive-callback';
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'Padma Hostel Finance';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n) => crypto.randomBytes(n).toString('hex');
const SECRET = () => String(process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '') + '|padma';
const hmac = (s) => crypto.createHmac('sha256', SECRET()).update(String(s)).digest('hex');

// ---------------- database (Upstash Redis REST) ----------------
const DB_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const dbReady = () => !!(DB_URL() && DB_TOKEN());
async function redis(...cmd) {
  const r = await fetch(DB_URL(), { method: 'POST', headers: { Authorization: 'Bearer ' + DB_TOKEN(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Database error: ' + (j.error || r.status));
  return j.result;
}
async function hgetall(key) {
  const a = (await redis('HGETALL', key)) || [];
  const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
  return o;
}
async function hset(key, obj) {
  const args = []; for (const [k, v] of Object.entries(obj)) if (v !== undefined) args.push(k, v == null ? '' : v);
  if (args.length) await redis('HSET', key, ...args);
}

// ---------------- Google (owner's Drive) ----------------
let cached = { token: null, exp: 0, rt: null };
async function ownerRefreshToken() { return (await redis('HGET', 'owner', 'refresh')) || null; }
async function accessToken() {
  const rt = await ownerRefreshToken();
  if (!rt) { const e = new Error('Google Drive is not connected yet (the admin must sign in to the admin panel once).'); e.status = 409; throw e; }
  if (cached.token && cached.rt === rt && Date.now() < cached.exp - 60000) return cached.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Google Drive permission expired (' + (j.error || r.status) + '). The admin must sign in to the admin panel again.'); e.status = 409; throw e; }
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, rt };
  return cached.token;
}
async function gapi(method, url, body, headers = {}, token) {
  const t = token || await accessToken();
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, ...headers }, body });
  if (!r.ok) {
    let msg = String(r.status); try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch { /* ignore */ }
    const e = new Error('Google Drive: ' + msg); e.status = r.status === 401 ? 409 : r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function findChild(parentId, name, folder, token) {
  const j = await gapi('GET', `${API}/files?` + new URLSearchParams({
    q: `name='${q(name)}' and '${parentId}' in parents and trashed=false` + (folder ? ` and mimeType='${FOLDER}'` : ` and mimeType!='${FOLDER}'`),
    fields: 'files(id,name)', spaces: 'drive', pageSize: '10',
  }), undefined, {}, token);
  return j.files && j.files[0] ? j.files[0].id : null;
}
async function makeFolder(name, parentId, token) {
  const j = await gapi('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }), { 'Content-Type': 'application/json' }, token);
  return j.id;
}
async function findOrMakeFolder(name, parentId, token) { return (await findChild(parentId, name, true, token)) || makeFolder(name, parentId, token); }

const folderCache = new Map();
async function folderFor(rootId, parts) {
  let parent = rootId, key = rootId;
  for (const name of parts) {
    key += '/' + name;
    if (folderCache.has(key)) { parent = folderCache.get(key); continue; }
    parent = await findOrMakeFolder(name, parent);
    folderCache.set(key, parent);
  }
  return parent;
}
function cleanPath(p) {
  const parts = String(p || '').split('/');
  if (parts.length < 1 || parts.length > 8 || String(p).length > 400) return null;
  for (const s of parts) if (!s || s === '.' || s === '..' || s.length > 150 || /[\u0000-\u001f]/.test(s)) return null;
  return parts;
}

// ---------------- clients ----------------
// client:<id> hash: name, folderId, frozen, createdAt, tokenHash, deviceName, lastSeen, version, dataBytes, records, activatedAt
async function clientByToken(token) {
  if (!token || String(token).length < 20) return null;
  const id = await redis('GET', 'token:' + sha(token));
  if (!id) return null;
  const c = await hgetall('client:' + id);
  return c && c.name ? { id, ...c } : null;
}
const newCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const b = crypto.randomBytes(8); for (let i = 0; i < 8; i++) s += A[b[i] % A.length]; return s.slice(0, 4) + '-' + s.slice(4); };

// ---------------- admin session cookie ----------------
function sessionCookie(email) {
  const exp = Date.now() + 12 * 3600e3;
  const v = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  return `padma_admin=${v}.${hmac(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${12 * 3600}`;
}
function adminFrom(req) {
  const m = /(?:^|;\s*)padma_admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [v, sig] = m[1].split('.');
  if (!v || !sig || hmac(v) !== sig) return null;
  try { const o = JSON.parse(Buffer.from(v, 'base64url').toString()); return o.exp > Date.now() && String(o.email).toLowerCase() === ADMIN_EMAIL ? o : null; } catch { return null; }
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const s = String(req.body || '');
  try { return JSON.parse(s); } catch { return Object.fromEntries(new URLSearchParams(s)); }
}

module.exports = {
  ORIGIN, ADMIN_EMAIL, REDIRECT, SCOPE, API, UPLOAD, FOLDER, ROOT_NAME,
  sleep, sha, rand, hmac, dbReady, redis, hgetall, hset,
  accessToken, gapi, findChild, makeFolder, findOrMakeFolder, folderFor, cleanPath,
  clientByToken, newCode, sessionCookie, adminFrom, body,
};
