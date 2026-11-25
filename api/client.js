// Calls from the hostel app. Each computer is activated once with a code from the admin panel and then
// sends its token with every call. A frozen client gets HTTP 423 for everything.
//
//   {action:'activate', code, device}           → { token, name }
//   {action:'ping', token, stats}               → { name, frozen, drive:{ready, folderName} }
//   {action:'start', token, path, mime, size}   → { uploadUrl }   (browser PUTs the file straight to Google)
//   {action:'trash', token, path}
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!L.dbReady()) return res.status(503).json({ error: 'The server is not set up yet (database missing).' });
  const b = L.body(req);
  try {
    if (b.action === 'activate') {
      const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 8) return res.status(400).json({ error: 'The activation code has 8 letters/numbers, like ABCD-1234.' });
      const pretty = code.slice(0, 4) + '-' + code.slice(4);
      const id = await L.redis('GET', 'code:' + L.sha(pretty));
      if (!id) { await L.sleep(800); return res.status(401).json({ error: 'This activation code is wrong or was already used. Ask the admin for a new one.' }); }
      const c = await L.hgetall('client:' + id);
      if (!c.name) return res.status(401).json({ error: 'This client was removed by the admin.' });
      const token = L.rand(24);
      if (c.tokenHash) await L.redis('DEL', 'token:' + c.tokenHash); // one computer per client: the old one is signed out
      await L.redis('SET', 'token:' + L.sha(token), id);
      await L.redis('DEL', 'code:' + L.sha(pretty));
      await L.hset('client:' + id, { tokenHash: L.sha(token), deviceName: String(b.device || '').slice(0, 80), activatedAt: new Date().toISOString(), lastSeen: Date.now() });
      return res.status(200).json({ token, name: c.name, frozen: c.frozen === '1' });
    }

    const c = await L.clientByToken(b.token);
    if (!c) { await L.sleep(500); return res.status(401).json({ error: 'This computer is not activated (or the admin issued a new code). Enter a new activation code.', deactivated: true }); }
    if (c.frozen === '1') return res.status(423).json({ error: 'This account is frozen. Please contact the admin.', frozen: true, name: c.name });

    if (b.action === 'ping') {
      const s = b.stats || {};
      await L.hset('client:' + c.id, {
        lastSeen: Date.now(), version: String(s.version || '').slice(0, 20),
        dataBytes: Number(s.dataBytes) || 0, records: Number(s.records) || 0, students: Number(s.students) || 0,
        deviceName: s.device ? String(s.device).slice(0, 80) : undefined,
      });
      return res.status(200).json({ name: c.name, frozen: false, drive: { ready: !!c.folderId && !!(await L.redis('HGET', 'owner', 'refresh')), folderName: c.folderName || '' } });
    }

    const parts = L.cleanPath(b.path);
    if (!parts) return res.status(400).json({ error: 'Bad file path.' });
    if (!c.folderId) return res.status(409).json({ error: 'The admin has not set up a Google Drive folder for this client yet.' });
    const name = parts.pop();

    if (b.action === 'start') {
      const mime = String(b.mime || ''); const size = Number(b.size) || 0;
      if (!['application/pdf', 'application/json'].includes(mime)) return res.status(400).json({ error: 'Only PDF and JSON files are uploaded.' });
      if (!(size > 0 && size < 50 * 1024 * 1024)) return res.status(400).json({ error: 'File size is not allowed.' });
      const parent = await L.folderFor(c.folderId, parts);
      const existing = await L.findChild(parent, name, false);
      const t = await L.accessToken();
      const headers = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: L.ORIGIN };
      const r = existing
        ? await fetch(`${L.UPLOAD}/files/${existing}?uploadType=resumable&fields=id`, { method: 'PATCH', headers, body: JSON.stringify({}) })
        : await fetch(`${L.UPLOAD}/files?uploadType=resumable&fields=id`, { method: 'POST', headers, body: JSON.stringify({ name, parents: [parent], mimeType: mime }) });
      const loc = r.headers.get('location');
      if (!r.ok || !loc) { let m = r.status; try { m = (await r.json()).error.message; } catch { /* ignore */ } throw Object.assign(new Error('Google Drive: ' + m), { status: 502 }); }
      await L.redis('HSET', `client:${c.id}:files`, b.path, size);
      await L.hset('client:' + c.id, { lastSeen: Date.now(), lastUpload: Date.now() });
      return res.status(200).json({ uploadUrl: loc });
    }
    if (b.action === 'trash') {
      const parent = await L.folderFor(c.folderId, parts);
      const id = await L.findChild(parent, name, false);
      if (id) await L.gapi('PATCH', `${L.API}/files/${id}?fields=id`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' });
      await L.redis('HDEL', `client:${c.id}:files`, b.path);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || String(e) });
  }
};
