// The install manifest. The test copy gets its own name so both apps can be installed side by side.
const L = require('./_lib');
module.exports = (req, res) => {
  const test = L.ENV === 'test';
  if ((req.query || {}).app === 'admin') {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(JSON.stringify({
      name: test ? 'Padma Admin TEST' : 'Padma Admin', short_name: test ? 'Admin TEST' : 'Padma Admin',
      description: 'Admin panel of Padma Hostel Finance: users, records and access.',
      id: '/admin.html', start_url: '/admin.html', scope: '/admin.html', display: 'standalone',
      background_color: '#f4f5f9', theme_color: test ? '#c2410c' : '#1e293b',
      icons: [
        { src: '/assets/admin-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/admin-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  }
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(JSON.stringify({
    name: test ? 'Padma Hostel Finance TEST' : 'Padma Hostel Finance',
    short_name: test ? 'Padma TEST' : 'Padma Finance',
    description: 'Padma Hostel – offline fees, dues, receipts, expenses and reports.',
    id: '/', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f6f7f9', theme_color: test ? '#c2410c' : '#78350f',
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
};
