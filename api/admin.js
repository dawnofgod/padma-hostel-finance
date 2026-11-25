// Admin panel API. Only the ADMIN_EMAIL Gmail can sign in (Google sign-in; the same sign-in connects the
// owner's Google Drive for all backups).
//
//   GET  /api/admin?login=1   → redirect to Google
//   POST /api/admin {action:'me'|'list'|'create'|'rename'|'freeze'|'unfreeze'|'newcode'|'delete'|'newfolder'|'logout'}
const L = require('./_lib');

const ONLINE_MS = 3 * 60 * 1000;

async function ensureClientFolder(id, name) {
  const root = await L.redis('HGET', 'owner', 'root');
  if (!root) return null;
  const folderId = await L.findOrMakeFolder(name, root);
  await L.hset('client:' + id, { folderId, folderName: name });
  return folderId;
}

async function listClients() {
  const ids = (await L.redis('SMEMBERS', 'clients')) || [];
  const out = [];
  for (const id of ids) {
    const c = await L.hgetall('client:' + id);
    if (!c.name) continue;
    const files = await L.hgetall(`client:${id}:files`);
    const driveBytes = Object.values(files).reduce((a, b) => a + (Number(b) || 0), 0);
    const last = Number(c.lastSeen) || 0;
    out.push({
      id, name: c.name, frozen: c.frozen === '1', activated: !!c.tokenHash, device: c.deviceName || '',
      online: !!c.tokenHash && Date.now() - last < ONLINE_MS, lastSeen: last || null, version: c.version || '',
      dataBytes: Number(c.dataBytes) || 0, records: Number(c.records) || 0, students: Number(c.students) || 0,
      driveBytes, driveFiles: Object.keys(files).length, lastUpload: Number(c.lastUpload) || null,
      folderId: c.folderId || '', folderName: c.folderName || '', createdAt: c.createdAt || '', pendingCode: c.pendingCode || '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Server not set up: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing.');
    const ts = String(Date.now());
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: L.REDIRECT, response_type: 'code', scope: L.SCOPE,
      access_type: 'offline', prompt: 'consent', login_hint: L.ADMIN_EMAIL, state: ts + '.' + L.hmac(ts),
    });
    res.setHeader('Location', url);
    return res.status(302).send('');
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = L.body(req);
  if (b.action === 'logout') { res.setHeader('Set-Cookie', 'padma_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'); return res.status(200).json({ ok: true }); }
  const admin = L.adminFrom(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in.', login: true });
  if (!L.dbReady()) return res.status(503).json({ error: 'Database is not connected in Vercel yet.' });

  try {
    if (b.action === 'me') {
      const o = await L.hgetall('owner');
      return res.status(200).json({ email: admin.email, drive: { connected: !!o.refresh, email: o.email || '', rootId: o.root || '' }, gemini: !!process.env.GEMINI_API_KEY });
    }
    if (b.action === 'list') return res.status(200).json({ clients: await listClients(), now: Date.now() });

    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Enter a client name.' });
      const id = L.rand(6);
      const code = L.newCode();
      await L.hset('client:' + id, { name, frozen: '0', createdAt: new Date().toISOString(), pendingCode: code });
      await L.redis('SADD', 'clients', id);
      await L.redis('SET', 'code:' + L.sha(code), id, 'EX', 30 * 24 * 3600);
      let folderNote = '';
      try { await ensureClientFolder(id, name); } catch (e) { folderNote = e.message; }
      return res.status(200).json({ id, code, folderNote });
    }

    const id = String(b.id || '');
    const c = await L.hgetall('client:' + id);
    if (!c.name) return res.status(404).json({ error: 'Client not found.' });

    if (b.action === 'rename') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      await L.hset('client:' + id, { name });
      if (c.folderId) { try { await L.gapi('PATCH', `${L.API}/files/${c.folderId}?fields=id`, JSON.stringify({ name }), { 'Content-Type': 'application/json' }); await L.hset('client:' + id, { folderName: name }); } catch { /* ignore */ } }
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'freeze' || b.action === 'unfreeze') {
      await L.hset('client:' + id, { frozen: b.action === 'freeze' ? '1' : '0', frozenAt: b.action === 'freeze' ? new Date().toISOString() : '' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'newcode') {
      // new code for a new/replacement computer; the computer currently activated keeps working until the code is used
      if (c.pendingCode) await L.redis('DEL', 'code:' + L.sha(c.pendingCode));
      const code = L.newCode();
      await L.redis('SET', 'code:' + L.sha(code), id, 'EX', 30 * 24 * 3600);
      await L.hset('client:' + id, { pendingCode: code });
      return res.status(200).json({ code });
    }
    if (b.action === 'newfolder') {
      const folderId = await ensureClientFolder(id, c.name);
      if (!folderId) return res.status(409).json({ error: 'Connect Google Drive first (sign out and sign in again).' });
      await L.redis('DEL', `client:${id}:files`);
      return res.status(200).json({ folderId });
    }
    if (b.action === 'delete') {
      if (c.tokenHash) await L.redis('DEL', 'token:' + c.tokenHash);
      if (c.pendingCode) await L.redis('DEL', 'code:' + L.sha(c.pendingCode));
      await L.redis('DEL', 'client:' + id, `client:${id}:files`);
      await L.redis('SREM', 'clients', id);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || String(e) });
  }
};
