// Installs the offline support and shows "Update now" when a new version has been published on GitHub.
'use strict';
(function () {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const banner = document.getElementById('updateBanner');
  const btn = document.getElementById('updateBtn');
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });

  const loggedIn = () => !document.getElementById('app').classList.contains('hidden');
  function offer(worker) {
    if (!worker) return;
    // Not logged in yet: nothing is open, so just switch to the new version straight away.
    if (!loggedIn()) { worker.postMessage('SKIP_WAITING'); return; }
    banner.classList.remove('hidden');
    btn.onclick = () => { btn.disabled = true; btn.textContent = 'Updating…'; worker.postMessage('SKIP_WAITING'); };
  }

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      setInterval(check, 30 * 60 * 1000);
      window.addEventListener('online', check);
    } catch (e) { console.warn('Offline support could not start', e); }
  });
})();
