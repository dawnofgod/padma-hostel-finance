// Shared server code (files starting with "_" are not public endpoints on Vercel).
//
// Vercel Environment Variables:
//   KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL / _TOKEN) – the free Upstash Redis database
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET – Google OAuth web client
//   GEMINI_API_KEY  – for the form scanner
//   ADMIN_EMAIL     – optional; the only Gmail allowed into the admin panel (default below)
//   APP_ENV=test    – set ONLY for the test copy (Preview deployments). Test data then lives under other
//                     database keys and in the Drive folder "Padma Hostel Finance – TEST", so it never mixes with real data.
const crypto = require('crypto');

const ENV = process.env.APP_ENV === 'test' ? 'test' : 'live';
const PREFIX = ENV === 'test' ? 'padma-test:' : 'padma:';
const ROOT_NAME = ENV === 'test' ? 'Padma Hostel Finance – TEST' : 'Padma Hostel Finance';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'arunpoudel9957@gmail.com').toLowerCase();
const ADMIN_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email profile';
const USER_SCOPE = 'openid email profile';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const BACKUP_PATH = 'Backup/padma-data.json';
const ONLINE_MS = 3 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n) => crypto.randomBytes(n).toString('hex');
const SECRET = () => String(process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '') + '|padma5|' + ENV;
const hmac = (s) => crypto.createHmac('sha256', SECRET()).update(String(s)).digest('hex');
const K = (k) => PREFIX + k;

// The address the request came to (live or test copy). Google only accepts redirect addresses that are
// registered in the OAuth client, so a wrong host can't be abused.
function originOf(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(h) ? (/^localhost(:|$)/.test(h) ? 'http://' : 'https://') + h : '';
}
const redirectOf = (req) => originOf(req) + '/api/callback';

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

// ---------------- Google ----------------
async function exchangeCode(req, code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectOf(req), grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'Google sign-in failed.');
  let id = {};
  try { id = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()); } catch { /* ignore */ }
  if (id.aud !== process.env.GOOGLE_CLIENT_ID || !id.sub || !id.email) throw new Error('Google did not confirm the account.');
  if (id.email_verified === false) throw new Error('This Google account has no verified email.');
  return { tokens: j, id: { sub: String(id.sub), email: String(id.email).toLowerCase(), name: String(id.name || ''), picture: String(id.picture || '') } };
}
function googleAuthUrl(req, kind, extra = {}) {
  const ts = String(Date.now());
  const st = `${kind}.${ts}`;
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectOf(req), response_type: 'code',
    scope: kind === 'admin' ? ADMIN_SCOPE : USER_SCOPE, state: st + '.' + hmac(st), ...extra,
  });
}
function checkState(state) {
  const [kind, ts, sig] = String(state || '').split('.');
  if (!kind || !ts || sig !== hmac(kind + '.' + ts) || Date.now() - Number(ts) > 15 * 60 * 1000) return null;
  return kind;
}

let cached = { token: null, exp: 0, rt: null };
async function accessToken() {
  const rt = (await redis('HGET', K('owner'), 'refresh')) || null;
  if (!rt) { const e = new Error('Google Drive backup is not connected yet (the admin must sign in to the admin panel once).'); e.status = 409; throw e; }
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
async function gapi(method, url, body, headers = {}, token, raw) {
  const t = token || await accessToken();
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, ...headers }, body });
  if (!r.ok) {
    let msg = String(r.status); try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch { /* ignore */ }
    const e = new Error('Google Drive: ' + msg); e.status = r.status === 401 ? 409 : r.status; throw e;
  }
  if (raw) return r;
  return r.status === 204 ? null : r.json();
}
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function findChild(parentId, name, folder, token) {
  const j = await gapi('GET', `${API}/files?` + new URLSearchParams({
    q: `name='${q(name)}' and '${parentId}' in parents and trashed=false` + (folder ? ` and mimeType='${FOLDER}'` : ` and mimeType!='${FOLDER}'`),
    fields: 'files(id,name,modifiedTime)', spaces: 'drive', pageSize: '10',
  }), undefined, {}, token);
  return j.files && j.files[0] ? j.files[0].id : null;
}
async function makeFolder(name, parentId, token) {
  const j = await gapi('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }), { 'Content-Type': 'application/json' }, token);
  return j.id;
}
async function findOrMakeFolder(name, parentId, token) { return (await findChild(parentId, name, true, token)) || makeFolder(name, parentId, token); }

const folderCache = new Map();
async function folderFor(rootId, parts, create = true) {
  let parent = rootId, key = rootId;
  for (const name of parts) {
    key += '/' + name;
    if (folderCache.has(key)) { parent = folderCache.get(key); continue; }
    parent = create ? await findOrMakeFolder(name, parent) : await findChild(parent, name, true);
    if (!parent) return null;
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
const folderNameOf = (u) => `${(u.profile || u.gname || 'User').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60)} (${u.email})`;

// The user's own Drive folder inside "Padma Hostel Finance" in the owner's Drive; made the first time it is needed.
async function userFolder(u) {
  if (u.folderId) return u.folderId;
  const root = await redis('HGET', K('owner'), 'root');
  if (!root) { const e = new Error('Google Drive backup is not connected yet (the admin must sign in to the admin panel once).'); e.status = 409; throw e; }
  const name = folderNameOf(u);
  const folderId = await findOrMakeFolder(name, root);
  await hset(K('user:' + u.sub), { folderId, folderName: name });
  u.folderId = folderId; u.folderName = name;
  return folderId;
}

// The latest data backup the hostel app uploaded (read-only).
async function readBackup(u) {
  if (!u.folderId) throw Object.assign(new Error('This user has not backed up to Google Drive yet.'), { status: 404 });
  const parts = BACKUP_PATH.split('/'); const name = parts.pop();
  const dir = await folderFor(u.folderId, parts, false);
  const id = dir && await findChild(dir, name, false);
  if (!id) throw Object.assign(new Error('No backup file yet. It is uploaded about 20 seconds after a change is made (when online).'), { status: 404 });
  const meta = await gapi('GET', `${API}/files/${id}?fields=modifiedTime,size`);
  const r = await gapi('GET', `${API}/files/${id}?alt=media`, undefined, {}, undefined, true);
  return { data: JSON.parse(await r.text()), modifiedTime: meta.modifiedTime, size: Number(meta.size) || 0 };
}

// ---------------- users ----------------
// user:<sub> hash: email, gname, gpicture, hostel, profile, logo (small data URL), sections (JSON), onboarded,
//   createdAt, lastSeen, version, dataBytes, records, students, device, frozen, folderId, folderName, lastBackup
async function userByToken(token) {
  if (!token || String(token).length < 20) return null;
  const sub = await redis('GET', K('token:' + sha(token)));
  if (!sub) return null;
  const u = await hgetall(K('user:' + sub));
  return u && u.email ? { sub, ...u } : null;
}
async function newDeviceToken(sub, device) {
  const token = rand(24);
  await redis('SET', K('token:' + sha(token)), sub);
  await redis('SADD', K('user:' + sub + ':tokens'), sha(token));
  await hset(K('user:' + sub), { lastSeen: Date.now(), device: String(device || '').slice(0, 80) || undefined });
  return token;
}
async function deleteUser(sub) {
  const toks = (await redis('SMEMBERS', K('user:' + sub + ':tokens'))) || [];
  for (const t of toks) await redis('DEL', K('token:' + t));
  await redis('DEL', K('user:' + sub), K('user:' + sub + ':tokens'), K('user:' + sub + ':files'));
  await redis('SREM', K('users'), sub);
}

// ---------------- cookies ----------------
function signed(name, obj, maxAge) {
  const v = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${name}=${v}.${hmac(name + v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function readSigned(req, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || '');
  if (!m) return null;
  const [v, sig] = m[1].split('.');
  if (!v || !sig || hmac(name + v) !== sig) return null;
  try { const o = JSON.parse(Buffer.from(v, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const clearCookie = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const adminCookie = (email) => signed('padma_admin', { email, exp: Date.now() + 12 * 3600e3 }, 12 * 3600);
function adminFrom(req) { const o = readSigned(req, 'padma_admin'); return o && String(o.email).toLowerCase() === ADMIN_EMAIL ? o : null; }

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const s = String(req.body || '');
  try { return JSON.parse(s); } catch { return Object.fromEntries(new URLSearchParams(s)); }
}
const fail = (res, e) => res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || String(e) });

module.exports = {
  ENV, PREFIX, K, ROOT_NAME, ADMIN_EMAIL, API, UPLOAD, FOLDER, BACKUP_PATH, ONLINE_MS,
  sleep, sha, rand, hmac, originOf, redirectOf, dbReady, redis, hgetall, hset,
  exchangeCode, googleAuthUrl, checkState, accessToken, gapi, findChild, makeFolder, findOrMakeFolder, folderFor, cleanPath,
  folderNameOf, userFolder, readBackup, userByToken, newDeviceToken, deleteUser,
  signed, readSigned, clearCookie, adminCookie, adminFrom, body, fail,
};
