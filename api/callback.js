// Google sends the admin back here after "Connect Google Drive". The server then keeps every user's
// backups in that Google Drive (folder "Padma Hostel Finance", or "... – TEST" on the test copy).
const L = require('./_lib');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, msg) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;background:#f6f7f9;margin:0;padding:40px 16px;color:#0f172a}.c{max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}a{color:#78350f;font-weight:600}</style></head>
<body><div class="c"><h2>${esc(title)}</h2><p>${msg}</p><p><a href="/admin.html">← Back to the admin panel</a></p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error } = req.query || {};
  if (error) return res.status(400).send(page('Drive not connected', 'Google said: ' + esc(error)));
  if (L.checkState(state) === 'recover') {
    if (!L.dbReady()) return res.status(503).send(page('Not ready', 'Database is not connected.'));
    const emails = [(await L.hgetall(L.LIVE_OWNER_KEY)).email, (await L.hgetall(L.K('owner'))).email].filter(Boolean).map((e) => String(e).toLowerCase());
    if (!emails.length) return res.status(400).send(page('Cannot reset', 'Google Drive is not connected yet, so there is no Google account to check.'));
    let g;
    try { g = await L.exchangeCode(req, code); } catch (e) { return res.status(502).send(page('Cannot reset', esc(e.message || String(e)))); }
    if (!emails.includes(g.id.email)) return res.status(403).send(page('Wrong Google account', 'Please choose the same Google account that is connected for Google Drive backups.'));
    res.setHeader('Set-Cookie', L.signed('padma_recover', { email: g.id.email, exp: Date.now() + 10 * 60 * 1000 }, 600));
    res.setHeader('Location', '/admin.html?recover=1');
    return res.status(302).send('');
  }
  if (L.checkState(state) !== 'drive') return res.status(400).send(page('Link expired', 'Please press "Connect Google Drive" again.'));
  if (!L.dbReady() || !(await L.adminFrom(req))) return res.status(401).send(page('Please log in', 'Log in to the admin panel first, then press "Connect Google Drive".'));
  try {
    const g = await L.exchangeCode(req, code);
    if (!g.tokens.refresh_token) throw new Error('Google did not give lasting permission. Press "Connect Google Drive" again.');
    let root = await L.findChild('root', L.ROOT_NAME, true, g.tokens.access_token);
    if (!root) root = await L.makeFolder(L.ROOT_NAME, 'root', g.tokens.access_token);
    const old = await L.hgetall(L.K('owner'));
    if (old.root && old.root !== root) {
      // a different Google account: every user's folder is made again inside the new Drive
      for (const sub of (await L.redis('SMEMBERS', L.K('users'))) || []) await L.redis('HDEL', L.K('user:' + sub), 'folderId', 'folderName');
    }
    await L.hset(L.K('owner'), { refresh: g.tokens.refresh_token, email: g.id.email, root, connectedAt: new Date().toISOString() });
  } catch (e) { return res.status(502).send(page('Drive not connected', esc(e.message || String(e)))); }
  res.setHeader('Location', '/admin.html?drive=connected');
  return res.status(302).send('');
};
