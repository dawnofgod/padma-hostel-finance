// Calls from the hostel app.
//   {action:'env'}                                   → { env }   ("test" on the test copy)
//   {action:'claim'}  (after Google sign-in, cookie)  → { token, user }
//   {action:'ping', token, stats}                    → { user }   (also tells the admin panel "online")
//   {action:'profile', token, hostel, profile, logo, sections} → { user }
//   {action:'start', token, path, mime, size}        → { uploadUrl }  (browser PUTs the file straight to Google)
//   {action:'trash', token, path}
//   {action:'mybackup', token}                        → { data, modifiedTime }  (restore on a new computer)
//   {action:'signout', token}
// A frozen account gets HTTP 423 for everything; a removed account gets 401 {removed:true}.
const L = require('./_lib');

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function publicUser(u, ownerReady) {
  let sections = null; try { sections = u.sections ? JSON.parse(u.sections) : null; } catch { /* ignore */ }
  return {
    email: u.email, gname: u.gname || '', gpicture: u.gpicture || '', hostel: u.hostel || '', profile: u.profile || '',
    logo: u.logo || '', sections, onboarded: u.onboarded === '1', frozen: u.frozen === '1',
    drive: { ready: !!ownerReady, folderName: u.folderName || '' }, env: L.ENV,
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
    if (b.action === 'claim') {
      const h = L.readSigned(req, 'padma_handoff');
      if (!h || !h.sub) return res.status(401).json({ error: 'Google sign-in did not finish. Please try again.' });
      const u = await L.hgetall(L.K('user:' + h.sub));
      if (!u.email) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
      const token = await L.newDeviceToken(h.sub, b.device);
      res.setHeader('Set-Cookie', L.clearCookie('padma_handoff'));
      return res.status(200).json({ token, user: publicUser(u, await ownerReady()) });
    }

    const u = await L.userByToken(b.token);
    if (!u) { await L.sleep(400); return res.status(401).json({ error: 'This account was removed by the admin. Sign in again to start a new profile.', removed: true }); }
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

    if (b.action === 'profile') {
      const hostel = 'Padma Hostel';
      const profile = String(b.profile || '').trim().slice(0, 60);
      if (!profile) return res.status(400).json({ error: 'Enter your profile name.' });
      const fields = { hostel, profile, onboarded: '1', lastSeen: Date.now() };
      if (b.logo !== undefined) {
        const logo = String(b.logo || '');
        if (logo && (!LOGO_RE.test(logo) || logo.length > 200000)) return res.status(400).json({ error: 'The logo picture is too big or not a picture.' });
        fields.logo = logo;
      }
      if (b.sections && typeof b.sections === 'object') fields.sections = JSON.stringify(b.sections).slice(0, 1000);
      const renamed = u.folderId && profile !== u.profile;
      await L.hset(key, fields);
      Object.assign(u, fields);
      try {
        if (renamed) {
          const name = L.folderNameOf(u);
          await L.gapi('PATCH', `${L.API}/files/${u.folderId}?fields=id`, JSON.stringify({ name }), { 'Content-Type': 'application/json' });
          await L.hset(key, { folderName: name }); u.folderName = name;
        } else if (await ownerReady()) await L.userFolder(u);
      } catch (e) { console.warn('folder', e.message); }
      return res.status(200).json({ user: publicUser(u, await ownerReady()) });
    }

    if (b.action === 'mybackup') return res.status(200).json(await L.readBackup(u));

    const parts = L.cleanPath(b.path);
    if (!parts) return res.status(400).json({ error: 'Bad file path.' });
    if (u.onboarded !== '1') return res.status(409).json({ error: 'Finish setting up your profile first.' });
    const name = parts.pop();

    if (b.action === 'start') {
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
