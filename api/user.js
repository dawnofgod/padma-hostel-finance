// Calls from the app. Staff log in with the username + password the admin gave them.
//   {action:'env'}                                   → { env }   ("test" on the test copy)
//   {action:'login', username, password, device}     → { token, user }
//   {action:'ping', token, stats}                    → { user }   (also tells the admin panel "online")
//   {action:'changepw', token, old, password}
//   {action:'start', token, path, mime, size}        → { uploadUrl }  (browser PUTs the file straight to Google)
//   {action:'trash', token, path}
//   {action:'copy', token, data}                     compressed copy of the records (for View records)
//   {action:'cleared', token}                         the user deleted all records (Start fresh)
//   {action:'mybackup', token}                        → { data, modifiedTime }  (restore on a new computer)
//   {action:'signout', token}
// A frozen account gets HTTP 423 for everything; a removed account gets 401 {removed:true}.
const L = require('./_lib');

function publicUser(u, ownerReady) {
  let sections = null; try { sections = u.sections ? JSON.parse(u.sections) : null; } catch { /* ignore */ }
  return {
    username: u.username, email: u.username, gname: '', gpicture: '', hostel: 'Padma Hostel', profile: u.profile || '',
    logo: '', sections, onboarded: true, frozen: u.frozen === '1',
    resetAt: Number(u.resetAt) || 0,
    drive: { ready: !!ownerReady && u.driveOff !== '1', off: u.driveOff === '1', folderName: u.folderName || '' }, env: L.ENV,
  };
}
const ownerReady = async () => !!(await L.redis('HGET', L.K('owner'), 'refresh'));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = L.body(req);
  if (b.action === 'env') return res.status(200).json({ env: L.ENV });
  if (!L.dbReady()) return res.status(503).json({ error: 'The server is not set up yet (database missing).' });
  try {
    if (b.action === 'login') {
      const name = L.cleanUser(b.username);
      if (await L.locked(name)) return res.status(429).json({ error: 'Too many wrong passwords. Wait 15 minutes or ask the admin.' });
      const sub = name && await L.redis('GET', L.K('username:' + name));
      const u = sub ? await L.hgetall(L.K('user:' + sub)) : {};
      if (!u.username || !L.checkPw(b.password, u.pw)) { await L.failed(name || '?'); await L.sleep(700); return res.status(401).json({ error: 'Wrong username or password.', wrong: true }); }
      if (u.frozen === '1') return res.status(423).json({ error: 'This account is frozen by the admin. Please contact the admin.', frozen: true });
      await L.redis('DEL', L.K('fail:' + name));
      const token = await L.newDeviceToken(sub, b.device);
      return res.status(200).json({ token, user: publicUser({ sub, ...u }, await ownerReady()) });
    }

    const u = await L.userByToken(b.token);
    if (!u) { await L.sleep(400); return res.status(401).json({ error: 'You were signed out (the admin removed the account or reset the password). Log in again.', removed: true }); }
    const key = L.K('user:' + u.sub);
    if (b.action === 'signout') {
      await L.redis('DEL', L.K('token:' + L.sha(b.token)));
      await L.redis('SREM', L.K('user:' + u.sub + ':tokens'), L.sha(b.token));
      return res.status(200).json({ ok: true });
    }
    if (u.frozen === '1') return res.status(423).json({ error: 'This account is frozen by the admin. Please contact the admin.', frozen: true });

    if (b.action === 'ping') {
      const s = b.stats || {};
      await L.hset(key, {
        lastSeen: Date.now(), version: String(s.version || '').slice(0, 20),
        dataBytes: Number(s.dataBytes) || 0, records: Number(s.records) || 0, students: Number(s.students) || 0,
        device: s.device ? String(s.device).slice(0, 80) : undefined,
      });
      return res.status(200).json({ user: publicUser(u, await ownerReady()) });
    }

    if (b.action === 'changepw') {
      const full = await L.hgetall(key);
      if (!L.checkPw(b.old, full.pw)) return res.status(400).json({ error: 'The current password is not correct.' });
      if (String(b.password || '').length < 6) return res.status(400).json({ error: 'The new password must have at least 6 characters.' });
      await L.hset(key, { pw: L.hashPw(b.password) });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'copy') {
      const data = String(b.data || '');
      if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 3000000) return res.status(400).json({ error: 'The copy is too big.' });
      try { JSON.parse(require('zlib').gunzipSync(Buffer.from(data, 'base64')).toString()); } catch { return res.status(400).json({ error: 'Bad copy.' }); }
      await L.redis('SET', L.K('user:' + u.sub + ':copy'), data);
      await L.hset(key, { lastCopy: Date.now(), copyBytes: Number(b.bytes) || 0, lastBackup: Date.now() });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'cleared') {
      await L.redis('DEL', L.K('user:' + u.sub + ':copy'));
      await L.hset(key, { dataBytes: 0, records: 0, students: 0, lastCopy: '', copyBytes: 0 });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'mybackup') return res.status(200).json(await L.readBackup(u));

    const parts = L.cleanPath(b.path);
    if (!parts) return res.status(400).json({ error: 'Bad file path.' });
    if (u.onboarded !== '1') return res.status(409).json({ error: 'Account not ready.' });
    const name = parts.pop();

    if (b.action === 'start') {
      if (u.driveOff === '1') return res.status(409).json({ error: 'Google Drive backup is turned off for this account by the admin.' });
      const mime = String(b.mime || ''); const size = Number(b.size) || 0;
      if (!['application/pdf', 'application/json'].includes(mime)) return res.status(400).json({ error: 'Only PDF and JSON files are uploaded.' });
      if (!(size > 0 && size < 50 * 1024 * 1024)) return res.status(400).json({ error: 'File size is not allowed.' });
      const parent = await L.folderFor(await L.userFolder(u), parts);
      const existing = await L.findChild(parent, name, false);
      const t = await L.accessToken();
      const headers = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: L.originOf(req) };
      const r = existing
        ? await fetch(`${L.UPLOAD}/files/${existing}?uploadType=resumable&fields=id`, { method: 'PATCH', headers, body: JSON.stringify({}) })
        : await fetch(`${L.UPLOAD}/files?uploadType=resumable&fields=id`, { method: 'POST', headers, body: JSON.stringify({ name, parents: [parent], mimeType: mime }) });
      const loc = r.headers.get('location');
      if (!r.ok || !loc) { let m = r.status; try { m = (await r.json()).error.message; } catch { /* ignore */ } throw Object.assign(new Error('Google Drive: ' + m), { status: 502 }); }
      await L.redis('HSET', L.K(`user:${u.sub}:files`), b.path, size);
      await L.hset(key, { lastSeen: Date.now(), lastUpload: Date.now(), lastBackup: b.path === L.BACKUP_PATH ? Date.now() : undefined });
      return res.status(200).json({ uploadUrl: loc });
    }
    if (b.action === 'trash') {
      const parent = await L.folderFor(await L.userFolder(u), parts, false);
      const id = parent && await L.findChild(parent, name, false);
      if (id) await L.gapi('PATCH', `${L.API}/files/${id}?fields=id`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' });
      await L.redis('HDEL', L.K(`user:${u.sub}:files`), b.path);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) { return L.fail(res, e); }
};
