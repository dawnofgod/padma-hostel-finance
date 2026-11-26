// Google sends people back here after signing in.
//  • app users: the account is created at once; the app then picks up a
//    device token through a short-lived cookie (api/user {action:'claim'}).
//  • admin: only ADMIN_EMAIL. The same sign-in gives the server permission to keep backups in the
//    admin's Google Drive (folder "Padma Hostel Finance", or "... – TEST" on the test copy).
const L = require('./_lib');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, msg, back) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;background:#f6f7f9;margin:0;padding:40px 16px;color:#0f172a}.c{max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}a{color:#4f46e5;font-weight:600}</style></head>
<body><div class="c"><h2>${esc(title)}</h2><p>${msg}</p><p><a href="${back}">← Back</a></p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error } = req.query || {};
  const kind = L.checkState(state);
  const back = kind === 'admin' ? '/admin.html' : '/';
  if (error) return res.status(400).send(page('Not signed in', 'Google said: ' + esc(error), back));
  if (!kind) return res.status(400).send(page('Link expired', 'Please sign in again.', back));
  if (!L.dbReady()) return res.status(503).send(page('Database missing', 'The server database is not connected yet.', back));

  let g;
  try { g = await L.exchangeCode(req, code); } catch (e) { return res.status(400).send(page('Not signed in', esc(e.message), back)); }

  if (kind === 'admin') {
    if (g.id.email !== L.ADMIN_EMAIL) {
      try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(g.tokens.refresh_token || g.tokens.access_token), { method: 'POST' }); } catch { /* ignore */ }
      return res.status(403).send(page('Access denied', 'Only the admin Gmail can open this panel.', back));
    }
    try {
      let root = await L.redis('HGET', L.K('owner'), 'root');
      if (!root) root = await L.findChild('root', L.ROOT_NAME, true, g.tokens.access_token) || await L.makeFolder(L.ROOT_NAME, 'root', g.tokens.access_token);
      const fields = { email: g.id.email, root, connectedAt: new Date().toISOString() };
      if (g.tokens.refresh_token) fields.refresh = g.tokens.refresh_token;
      await L.hset(L.K('owner'), fields);
    } catch (e) { return res.status(502).send(page('Drive problem', esc(e.message || String(e)), back)); }
    res.setHeader('Set-Cookie', L.adminCookie(g.id.email));
    res.setHeader('Location', '/admin.html');
    return res.status(302).send('');
  }

  // hostel app user: create the account on first sign-in
  const key = L.K('user:' + g.id.sub);
  const existing = await L.hgetall(key);
  const now = new Date().toISOString();
  await L.hset(key, { email: g.id.email, gname: g.id.name.slice(0, 80), gpicture: g.id.picture.slice(0, 400), createdAt: existing.createdAt || now, frozen: existing.frozen || '0', lastSignIn: now });
  await L.redis('SADD', L.K('users'), g.id.sub);
  res.setHeader('Set-Cookie', L.signed('padma_handoff', { sub: g.id.sub, exp: Date.now() + 10 * 60e3 }, 600));
  res.setHeader('Location', '/?signedin=1');
  return res.status(302).send('');
};
