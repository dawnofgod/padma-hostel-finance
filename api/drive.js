// Google Drive backup — every computer's backups go into the OWNER's Drive (one Gmail only).
// The owner connects once (GET /api/drive → PIN → Google). After that the app on any PC uploads with just the PIN.
//
//   GET  /api/drive                      → small page: enter PIN → Google sign-in (owner only, one time)
//   POST /api/drive {action:'connect'}   → (form) redirects to Google
//   POST /api/drive {action:'status', pin}
//   POST /api/drive {action:'start', pin, path, mime, size}  → { uploadUrl } (browser then PUTs the file straight to Google)
//   POST /api/drive {action:'trash', pin, path}
const G = require('./_google');

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Padma Hostel – connect Google Drive</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;background:#f6f7f9;margin:0;padding:40px 16px;color:#0f172a}.c{max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 8px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;margin:10px 0}button{background:#78350f;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-weight:600;font-size:15px;cursor:pointer}.m{color:#64748b;font-size:13px}.e{color:#b91c1c}</style></head><body><div class="c">${body}</div></body></html>`;

const connectForm = (err) => page(`<h1>Connect Google Drive (owner only)</h1>
<p>All Padma Hostel backups from every computer will be saved in the Google Drive of the Gmail you sign in with next. Do this only with the <b>owner's</b> Gmail.</p>
${err ? `<p class="e">${err}</p>` : ''}
<form method="post"><input type="hidden" name="action" value="connect"><label>App PIN (the SCAN_PIN)</label><input name="pin" type="password" autocomplete="off" required autofocus><button>Continue to Google →</button></form>
<p class="m">The app only gets access to the files and folders it creates in your Drive — nothing else.</p>`);

function parseForm(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const s = String(req.body || '');
  try { return JSON.parse(s); } catch { return Object.fromEntries(new URLSearchParams(s)); }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SCAN_PIN);
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!configured) return res.status(503).send(page('<h1>Not set up yet</h1><p>Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SCAN_PIN in Vercel, then redeploy.</p>'));
    return res.status(200).send(connectForm(''));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const b = parseForm(req);

  if (b.action === 'connect') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!configured) return res.status(503).send(page('<h1>Not set up yet</h1>'));
    if (!G.pinOk(b.pin)) { await G.sleep(800); return res.status(401).send(connectForm('Wrong PIN.')); }
    const ts = String(Date.now());
    const state = ts + '.' + G.hmac(ts);
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: G.REDIRECT, response_type: 'code',
      scope: G.SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    res.setHeader('Location', url);
    return res.status(302).send('');
  }

  // ----- calls from the app -----
  if (!configured) return res.status(503).json({ error: 'Google Drive backup is not set up on the server yet.' });
  if (!G.pinOk(b.pin)) { await G.sleep(800); return res.status(401).json({ error: 'Wrong app PIN.' }); }
  const ready = !!(process.env.GOOGLE_REFRESH_TOKEN && process.env.DRIVE_FOLDER_ID);

  try {
    if (b.action === 'status') {
      if (!ready) return res.status(200).json({ connected: false });
      const t = await G.accessToken();
      const [about, folder] = await Promise.all([
        fetch(`${G.API}/about?fields=user(emailAddress,displayName)`, { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.json()),
        fetch(`${G.API}/files/${process.env.DRIVE_FOLDER_ID}?fields=id,name,trashed`, { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.json()),
      ]);
      if (!folder || !folder.id || folder.trashed) return res.status(200).json({ connected: false, error: 'The backup folder was deleted or moved to Trash in Google Drive. The owner must connect Google Drive again.' });
      return res.status(200).json({ connected: true, email: about.user && about.user.emailAddress, folderName: folder.name, folderId: folder.id });
    }
    if (!ready) return res.status(409).json({ error: 'Google Drive is not connected yet. The owner must connect it once.' });

    const parts = G.cleanPath(b.path);
    if (!parts) return res.status(400).json({ error: 'Bad file path.' });
    const name = parts.pop();

    if (b.action === 'start') {
      const mime = String(b.mime || '');
      const size = Number(b.size) || 0;
      if (!['application/pdf', 'application/json'].includes(mime)) return res.status(400).json({ error: 'Only PDF and JSON files are uploaded.' });
      if (!(size > 0 && size < 50 * 1024 * 1024)) return res.status(400).json({ error: 'File size is not allowed.' });
      const parent = await G.folderFor(parts);
      const existing = await G.findChild(parent, name, false);
      const t = await G.accessToken();
      const headers = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: G.ORIGIN };
      const r = existing
        ? await fetch(`${G.UPLOAD}/files/${existing}?uploadType=resumable&fields=id`, { method: 'PATCH', headers, body: JSON.stringify({}) })
        : await fetch(`${G.UPLOAD}/files?uploadType=resumable&fields=id`, { method: 'POST', headers, body: JSON.stringify({ name, parents: [parent], mimeType: mime }) });
      const loc = r.headers.get('location');
      if (!r.ok || !loc) { let m = r.status; try { m = (await r.json()).error.message; } catch { /* ignore */ } throw Object.assign(new Error('Google Drive: ' + m), { status: r.status }); }
      return res.status(200).json({ uploadUrl: loc, updating: !!existing });
    }

    if (b.action === 'trash') {
      const parent = await G.folderFor(parts);
      const id = await G.findChild(parent, name, false);
      if (id) await G.gapi('PATCH', `${G.API}/files/${id}?fields=id`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' });
      return res.status(200).json({ ok: true, found: !!id });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(e.status === 401 ? 401 : 502).json({ error: e.message || String(e), reconnect: e.status === 401 });
  }
};
