// Admin panel API. Only the ADMIN_EMAIL Gmail can sign in (via /api/auth?kind=admin).
//   POST /api/admin {action:'me'|'list'|'freeze'|'unfreeze'|'delete'|'records'|'logout', sub}
const L = require('./_lib');

async function listUsers() {
  const subs = (await L.redis('SMEMBERS', L.K('users'))) || [];
  const out = [];
  for (const sub of subs) {
    const u = await L.hgetall(L.K('user:' + sub));
    if (!u.email) continue;
    const files = await L.hgetall(L.K(`user:${sub}:files`));
    const last = Number(u.lastSeen) || 0;
    out.push({
      sub, email: u.email, gname: u.gname || '', gpicture: u.gpicture || '', hostel: u.hostel || '', profile: u.profile || '',
      logo: u.logo || '', onboarded: u.onboarded === '1', frozen: u.frozen === '1', createdAt: u.createdAt || '',
      online: Date.now() - last < L.ONLINE_MS, lastSeen: last || null, version: u.version || '', device: u.device || '',
      dataBytes: Number(u.dataBytes) || 0, records: Number(u.records) || 0, students: Number(u.students) || 0, scans: Number(u.scans) || 0,
      driveBytes: Object.values(files).reduce((a, b) => a + (Number(b) || 0), 0), driveFiles: Object.keys(files).length,
      lastBackup: Number(u.lastBackup) || null, folderId: u.folderId || '', folderName: u.folderName || '',
    });
  }
  return out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') { res.setHeader('Location', '/api/auth?kind=admin'); return res.status(302).send(''); }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = L.body(req);
  if (b.action === 'logout') { res.setHeader('Set-Cookie', L.clearCookie('padma_admin')); return res.status(200).json({ ok: true }); }
  const admin = L.adminFrom(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in.', login: true, env: L.ENV });
  if (!L.dbReady()) return res.status(503).json({ error: 'Database is not connected in Vercel yet.' });

  try {
    if (b.action === 'me') {
      const o = await L.hgetall(L.K('owner'));
      return res.status(200).json({ email: admin.email, env: L.ENV, root: L.ROOT_NAME, drive: { connected: !!o.refresh, email: o.email || '', rootId: o.root || '' }, gemini: !!process.env.GEMINI_API_KEY });
    }
    if (b.action === 'list') return res.status(200).json({ users: await listUsers(), now: Date.now() });

    const sub = String(b.sub || '');
    const u = await L.hgetall(L.K('user:' + sub));
    if (!u.email) return res.status(404).json({ error: 'User not found.' });

    if (b.action === 'freeze' || b.action === 'unfreeze') {
      await L.hset(L.K('user:' + sub), { frozen: b.action === 'freeze' ? '1' : '0', frozenAt: b.action === 'freeze' ? new Date().toISOString() : '' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'delete') { await L.deleteUser(sub); return res.status(200).json({ ok: true }); }
    if (b.action === 'records') return res.status(200).json(await L.readBackup(u));
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) { return L.fail(res, e); }
};
