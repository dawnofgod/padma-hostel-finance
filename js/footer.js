// Small footer shown at the bottom of the app, the admin panel, Help and Privacy.
// Change the contact details here; leave a link empty ('') to hide it.
(function () {
  const C = {
    maker: 'arunpoudel_dm',
    email: 'arunpoudel9957@gmail.com',
    whatsapp: '9779761119707', // country code + number, digits only
    instagram: 'https://www.instagram.com/arunpoudel_dm',
    facebook: '',
    youtube: '',
  };
  window.PadmaContact = C;
  const ico = {
    wa: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Zm0 16.3c-1.4 0-2.8-.4-4-1.1l-.3-.2-2.7.7.7-2.6-.2-.3A7.3 7.3 0 1 1 12 19.3Zm4-5.5c-.2-.1-1.3-.6-1.5-.7s-.4-.1-.5.1l-.7.9c-.1.1-.3.2-.5.1a6 6 0 0 1-3-2.6c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.8 2c0 1.2.8 2.3.9 2.4.1.2 1.7 2.6 4.1 3.6 1.5.7 2.1.7 2.9.6.5-.1 1.3-.6 1.5-1.1.2-.5.2-1 .1-1.1l-.6-.2Z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 6h18v12H3zM3 7l9 6 9-6"/></svg>',
    ig: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg>',
    fb: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M13 8h2V5.5h-2a3 3 0 0 0-3 3V10H8v2.5h2V19h3v-6.5h2l.4-2.5H13V8.7c0-.4.3-.7.7-.7Z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="m10 9 5 3-5 3z"/></svg>',
  };
  const a = (href, title, icon, color) => href ? `<a href="${href}" target="_blank" rel="noopener" title="${title}" aria-label="${title}" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;color:${color};border:1px solid currentColor;opacity:.85">${icon}</a>` : '';
  const social = [
    a(C.whatsapp && `https://wa.me/${C.whatsapp}`, 'Chat on WhatsApp', ico.wa, '#16a34a'),
    a(C.email && `mailto:${C.email}`, 'Email', ico.mail, '#475569'),
    a(C.instagram, 'Instagram', ico.ig, '#c13584'),
    a(C.facebook, 'Facebook', ico.fb, '#1877f2'),
    a(C.youtube, 'YouTube', ico.yt, '#dc2626'),
  ].join('');
  const html = `<div style="max-width:1400px;margin:0 auto;padding:10px 24px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;font:12px/1.4 system-ui,'Segoe UI',Arial,sans-serif;color:#64748b">
    <span>Made by <b style="color:#334155">${C.maker}</b> · © ${new Date().getFullYear()}</span>
    <span style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><a href="help.html" style="color:inherit">Help &amp; Support</a><a href="privacy.html" style="color:inherit">Privacy Policy</a><span style="display:inline-flex;gap:6px">${social}</span></span></div>`;
  function mount() {
    const f = document.createElement('footer'); f.id = 'padmaFooter';
    f.style.cssText = 'border-top:1px solid #e2e8f0;margin-top:24px;background:transparent';
    f.innerHTML = html; document.body.appendChild(f);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
