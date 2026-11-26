// "Connect Google Drive" from the admin panel: /api/auth?kind=drive (admin must be logged in).
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Server not set up: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing.');
  if (!L.dbReady() || !(await L.adminFrom(req))) { res.setHeader('Location', '/admin.html'); return res.status(302).send(''); }
  res.setHeader('Location', L.googleAuthUrl(req, 'drive', { access_type: 'offline', prompt: 'consent' }));
  return res.status(302).send('');
};
