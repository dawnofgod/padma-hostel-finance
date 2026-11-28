// Admin panel API. The admin logs in with a username + password (made on the first visit).
//   POST /api/admin {action:'status'}                         → { setup: true|false, env }
//   {action:'setup', username, password}                     (only while no admin exists)
//   {action:'login', username, password} / {action:'logout'}
//   {action:'me'|'list'}
//   {action:'create', profile, username, password}            new staff account
//   {action:'resetpw', sub, password}  {action:'rename', sub, profile}
//   {action:'freeze'|'unfreeze'|'delete'|'records', sub}
//   {action:'adminpw', old, username, password}               change the admin's own login
//   {action:'reset', sub}                                     delete this user's records (also on their computer at next check)
//   {action:'driveon'|'driveoff', sub}                         Google Drive backup on/off for one person
//   {action:'disconnect'}                                     forget the Google Drive connection
const L = require('./_lib');

async function listUsers() {
  const subs = (await L.redis('SMEMBERS', L.K('users'))) || [];
  const out = [];
  for (const sub of subs) {
    const u = await L.hgetall(L.K('user:' + sub));
    if (!u.username) continue;
    const files = await L.hgetall(L.K(`user:${sub}:files`));
    const last = Number(u.lastSeen) || 0;
    out.push({
      sub, username: u.username, profile: u.profile || '', frozen: u.frozen === '1', createdAt: u.createdAt || '',
      online: Date.now() - last < L.ONLINE_MS, lastSeen: last || null, version: u.version || '', device: u.device || '',
      dataBytes: Number(u.dataBytes) || 0, records: Number(u.records) || 0, students: Number(u.students) || 0, scans: Number(u.scans) || 0,
      driveBytes: Object.values(files).reduce((a, b) => a + (Number(b) || 0), 0), driveFiles: Object.keys(files).length,
      lastBackup: Number(u.lastBackup) || null, folderId: u.folderId || '', folderName: u.folderName || '', neverLoggedIn: !last, driveOff: u.driveOff === '1',
    });
  }
  return out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || a.profile.localeCompare(b.profile));
}
const pwError = (p) => (String(p || '').length < 6 ? 'The password must have at least 6 characters.' : '');
const userError = (u) => (L.validUser(u) ? '' : 'Username: 3–30 letters or numbers (also . _ -), no spaces.');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = L.body(req);
  if (!L.dbReady()) return res.status(503).json({ error: 'Database is not connected in Vercel yet.' });
  try {
    if (b.action === 'logout') { res.setHeader('Set-Cookie', L.clearCookie('padma_admin')); return res.status(200).json({ ok: true }); }
    const stored = await L.hgetall(L.ADMIN_KEY);
    if (b.action === 'status') return res.status(200).json({ setup: !stored.user, env: L.ENV });
    if (b.action === 'setup') {
      if (stored.user) return res.status(409).json({ error: 'The admin login already exists. Please log in.' });
      const user = L.cleanUser(b.username);
      const err = userError(user) || pwError(b.password);
      if (err) return res.status(400).json({ error: err });
      const a = { user, pw: L.hashPw(b.password), v: '1', createdAt: new Date().toISOString() };
      const ok = await L.redis('HSETNX', L.ADMIN_KEY, 'user', user); // first one wins
      if (!ok) return res.status(409).json({ error: 'The admin login already exists. Please log in.' });
      await L.hset(L.ADMIN_KEY, a);
      res.setHeader('Set-Cookie', L.adminCookie(a));
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'login') {
      const user = L.cleanUser(b.username);
      if (await L.locked('admin-login')) return res.status(429).json({ error: 'Too many wrong passwords. Wait 15 minutes.' });
      if (!stored.user || user !== stored.user || !L.checkPw(b.password, stored.pw)) {
        await L.failed('admin-login'); await L.sleep(700);
        return res.status(401).json({ error: 'Wrong username or password.' });
      }
      res.setHeader('Set-Cookie', L.adminCookie(stored));
      return res.status(200).json({ ok: true });
    }

    const admin = await L.adminFrom(req);
    if (!admin) return res.status(401).json({ error: 'Please log in.', login: true, setup: !stored.user, env: L.ENV });

    if (b.action === 'me') {
      const o = await L.hgetall(L.K('owner'));
      return res.status(200).json({ user: admin.user, env: L.ENV, root: L.ROOT_NAME, drive: { connected: !!o.refresh, email: o.email || '' }, gemini: !!process.env.GEMINI_API_KEY });
    }
    if (b.action === 'list') return res.status(200).json({ users: await listUsers(), now: Date.now() });
    if (b.action === 'adminpw') {
      if (!L.checkPw(b.old, admin.pw)) return res.status(400).json({ error: 'The current password is not correct.' });
      const user = L.cleanUser(b.username || admin.user);
      const err = userError(user) || pwError(b.password);
      if (err) return res.status(400).json({ error: err });
      const a = { user, pw: L.hashPw(b.password), v: String((Number(admin.v) || 1) + 1) };
      await L.hset(L.ADMIN_KEY, a);
      res.setHeader('Set-Cookie', L.adminCookie(a));
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'disconnect') { await L.redis('DEL', L.K('owner')); return res.status(200).json({ ok: true }); }
    if (b.action === 'create') {
      const user = L.cleanUser(b.username);
      const profile = String(b.profile || '').trim().slice(0, 60);
      const err = (!profile && 'Enter the person\'s name.') || userError(user) || pwError(b.password);
      if (err) return res.status(400).json({ error: err });
      if (user === admin.user) return res.status(400).json({ error: 'This username is used by the admin. Choose another one.' });
      const sub = L.rand(8);
      const ok = await L.redis('SETNX', L.K('username:' + user), sub);
      if (!ok) return res.status(409).json({ error: 'This username is already used. Choose another one.' });
      const u = { username: user, pw: L.hashPw(b.password), profile, hostel: 'Padma Hostel', onboarded: '1', frozen: '0', createdAt: new Date().toISOString() };
      await L.hset(L.K('user:' + sub), u);
      await L.redis('SADD', L.K('users'), sub);
      try { if (await L.redis('HGET', L.K('owner'), 'refresh')) await L.userFolder({ sub, ...u }); } catch (e) { console.warn('folder', e.message); }
      return res.status(200).json({ ok: true, sub });
    }

    const sub = String(b.sub || '');
    const u = await L.hgetall(L.K('user:' + sub));
    if (!u.username) return res.status(404).json({ error: 'User not found.' });
    if (b.action === 'resetpw') {
      const err = pwError(b.password);
      if (err) return res.status(400).json({ error: err });
      await L.hset(L.K('user:' + sub), { pw: L.hashPw(b.password) });
      await L.dropTokens(sub);
      await L.redis('DEL', L.K('fail:' + u.username));
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'rename') {
      const profile = String(b.profile || '').trim().slice(0, 60);
      if (!profile) return res.status(400).json({ error: 'Enter the person\'s name.' });
      await L.hset(L.K('user:' + sub), { profile });
      if (u.folderId) {
        const name = L.folderNameOf({ ...u, profile });
        try { await L.gapi('PATCH', `${L.API}/files/${u.folderId}?fields=id`, JSON.stringify({ name }), { 'Content-Type': 'application/json' }); await L.hset(L.K('user:' + sub), { folderName: name }); } catch (e) { console.warn(e.message); }
      }
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'reset') {
      // clears the admin's copy now; the user's app deletes its records at its next check (a safety copy stays on that computer)
      await L.redis('DEL', L.K('user:' + sub + ':copy'));
      await L.hset(L.K('user:' + sub), { resetAt: Date.now(), dataBytes: 0, records: 0, students: 0, lastCopy: '', copyBytes: 0, lastBackup: '' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'driveon' || b.action === 'driveoff') {
      await L.hset(L.K('user:' + sub), { driveOff: b.action === 'driveoff' ? '1' : '0' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'freeze' || b.action === 'unfreeze') {
      await L.hset(L.K('user:' + sub), { frozen: b.action === 'freeze' ? '1' : '0', frozenAt: b.action === 'freeze' ? new Date().toISOString() : '' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'delete') { await L.deleteUser(sub); return res.status(200).json({ ok: true }); }
    if (b.action === 'records') return res.status(200).json(await L.readBackup({ sub, ...u }));
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) { return L.fail(res, e); }
};
