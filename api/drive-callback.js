// Google sends the admin back here after signing in. Only ADMIN_EMAIL is accepted.
// The Google Drive permission is stored in the database (so every client can back up to the owner's Drive),
// the main "Padma Hostel Finance" folder is found or created, and the admin is signed in to the panel.
const L = require('./_lib');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, msg) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;background:#f6f7f9;margin:0;padding:40px 16px;color:#0f172a}.c{max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}a{color:#78350f;font-weight:600}</style></head>
<body><div class="c"><h2>${esc(title)}</h2><p>${msg}</p><p><a href="/admin.html">← Back to the admin panel</a></p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error } = req.query || {};
  if (error) return res.status(400).send(page('Not signed in', 'Google said: ' + esc(error)));
  const [ts, sig] = String(state || '').split('.');
  if (!ts || sig !== L.hmac(ts) || Date.now() - Number(ts) > 15 * 60 * 1000) return res.status(400).send(page('Link expired', 'Please sign in again.'));
  if (!L.dbReady()) return res.status(503).send(page('Database missing', 'Connect the Upstash database to this project in Vercel first.'));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: L.REDIRECT, grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(400).send(page('Not signed in', esc(j.error_description || j.error || 'Google sign-in failed.')));

  let email = '';
  try { email = String(JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()).email || '').toLowerCase(); } catch { /* ignore */ }
  if (email !== L.ADMIN_EMAIL) {
    try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(j.refresh_token || j.access_token), { method: 'POST' }); } catch { /* ignore */ }
    return res.status(403).send(page('Access denied', 'Only the admin Gmail can open this panel.'));
  }

  try {
    let root = await L.redis('HGET', 'owner', 'root');
    if (!root) {
      root = await L.findChild('root', L.ROOT_NAME, true, j.access_token) || await L.makeFolder(L.ROOT_NAME, 'root', j.access_token);
    }
    const fields = { email, root, connectedAt: new Date().toISOString() };
    if (j.refresh_token) fields.refresh = j.refresh_token;
    await L.hset('owner', fields);
  } catch (e) {
    return res.status(502).send(page('Drive problem', esc(e.message || String(e))));
  }
  res.setHeader('Set-Cookie', L.sessionCookie(email));
  res.setHeader('Location', '/admin.html');
  return res.status(302).send('');
};
