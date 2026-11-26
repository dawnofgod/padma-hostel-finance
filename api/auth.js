// Starts Google sign-in.  /api/auth?kind=user  (hostel app)   /api/auth?kind=admin  (admin panel)
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Server not set up: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing.');
  const kind = (req.query || {}).kind === 'admin' ? 'admin' : 'user';
  const url = kind === 'admin'
    ? L.googleAuthUrl(req, 'admin', { access_type: 'offline', prompt: 'consent', login_hint: L.ADMIN_EMAIL })
    : L.googleAuthUrl(req, 'user', { prompt: 'select_account' });
  res.setHeader('Location', url);
  return res.status(302).send('');
};
