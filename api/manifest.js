// The install manifest. The test copy gets its own name so both apps can be installed side by side.
const L = require('./_lib');
module.exports = (req, res) => {
  const test = L.ENV === 'test';
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
