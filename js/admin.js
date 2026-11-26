// Padma Hostel Finance admin panel: every user as a profile card, freeze / remove, and a read-only viewer
// for each user's records (taken from their latest data backup in the owner's Google Drive).
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'Rs. ' + (Number(n) || 0).toLocaleString('en-IN');
  const size = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  };
  let toastT;
  function toast(m, bad) { const t = $('toast'); t.textContent = m; t.className = 'toast show' + (bad ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500); }
  async function api(body) {
    const r = await fetch('api/admin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.login) { showLogin(j.env); throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(j.error || 'Server error ' + r.status);
    return j;
  }
  function confirmBox(title, text, ok, danger) {
    return new Promise((res) => {
      const b = document.createElement('div'); b.className = 'modal-back';
      b.innerHTML = `<div class="modal"><h3 style="margin-top:0">${esc(title)}</h3><p class="muted" style="font-size:14px">${text}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button data-x="0">Cancel</button><button data-x="1" class="${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></div>`;
      b.onclick = (e) => { const x = e.target.dataset.x; if (x != null) { b.remove(); res(x === '1'); } };
      document.body.appendChild(b);
    });
  }
  function showLogin(env) {
    $('panel').classList.add('hidden'); $('loginBox').classList.remove('hidden'); $('logoutBtn').classList.add('hidden');
    if (env === 'test') $('testBar').classList.remove('hidden');
  }

  let USERS = [], FILTER = 'all';
  async function start() {
    let me;
    try { me = await api({ action: 'me' }); } catch { return; }
    $('loginBox').classList.add('hidden'); $('panel').classList.remove('hidden'); $('logoutBtn').classList.remove('hidden');
    $('who').textContent = me.email;
    if (me.env === 'test') { $('testBar').classList.remove('hidden'); document.title = 'Padma TEST – Admin'; }
    $('stDrive').innerHTML = me.drive.connected ? '✔ Connected' : '<span style="color:#b91c1c">Not connected</span>';
    $('stDriveS').textContent = me.drive.connected ? `${me.drive.email} · folder "${me.root}"` : 'Sign out and sign in again, and tick the Google Drive box.';
    $('stScan').innerHTML = me.gemini ? '✔ Ready' : '<span style="color:#b91c1c">No key</span>';
    $('stScanS').textContent = me.gemini ? 'Gemini (free tier)' : 'GEMINI_API_KEY missing in Vercel';
    await refresh();
    setInterval(() => { if (!document.hidden && $('viewer').classList.contains('hidden')) refresh().catch(() => {}); }, 30000);
  }
  async function refresh() {
    const j = await api({ action: 'list' });
    USERS = j.users;
    const total = USERS.reduce((a, u) => a + u.driveBytes, 0);
    $('stUsers').textContent = USERS.length;
    $('stUsersS').textContent = `${USERS.filter((u) => u.frozen).length} frozen · ${USERS.filter((u) => !u.onboarded).length} not set up`;
    $('stOnline').textContent = USERS.filter((u) => u.online && !u.frozen).length;
    $('stStorage').textContent = size(total);
    $('stFiles').textContent = USERS.reduce((a, u) => a + u.driveFiles, 0) + ' files in Drive';
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    render();
  }
  function status(u) {
    if (u.frozen) return '<span class="pill frz">❄ Frozen</span>';
    if (!u.onboarded) return '<span class="pill wait">Setting up</span>';
    return u.online ? '<span class="pill on">● Online</span>' : '<span class="pill off">Offline</span>';
  }
  function render() {
    const q = $('q').value.trim().toLowerCase();
    const list = USERS.filter((u) => (!q || [u.profile, u.email, u.gname].join(' ').toLowerCase().includes(q))
      && (FILTER === 'all' || (FILTER === 'online' && u.online && !u.frozen) || (FILTER === 'frozen' && u.frozen) || (FILTER === 'setup' && !u.onboarded)));
    $('none').classList.toggle('hidden', list.length > 0);
    $('pins').innerHTML = list.map((u) => {
      const name = u.profile || u.gname || '(no profile name yet)';
      const logo = u.gpicture ? `<img class="logo" src="${esc(u.gpicture.replace(/=s\d+-c$/, '=s256-c'))}" alt="" referrerpolicy="no-referrer">` : `<div class="initial">${esc((name || u.email || '?')[0].toUpperCase())}</div>`;
      const avatar = '';
      const folder = u.folderId ? `<a class="btn" href="https://drive.google.com/drive/folders/${esc(u.folderId)}" target="_blank" rel="noopener" title="${esc(u.folderName)}">📁 Drive folder</a>` : '';
      return `<div class="pin ${u.frozen ? 'frozen' : ''}" data-sub="${esc(u.sub)}">
        <div class="cover"><span class="status">${status(u)}</span>${avatar}${logo}</div>
        <div class="body">
          <h3>${esc(name)}</h3>
          <div class="who">${esc(u.email)}${u.gname && u.gname !== name ? ' · Google name: ' + esc(u.gname) : ''}</div>
          <div class="facts">
            <div>Last active<b>${esc(ago(u.lastSeen))}</b></div>
            <div>Students<b>${u.students}</b></div>
            <div>Records<b>${u.records}</b></div>
            <div>Drive storage<b>${size(u.driveBytes)}</b></div>
            <div>Last backup<b>${esc(ago(u.lastBackup))}</b></div>
            <div>App<b>${esc(u.version || '–')}</b></div>
          </div>
          <div class="muted" style="margin-bottom:10px">${esc(u.device || '')}${u.scans ? ' · ' + u.scans + ' scans' : ''}${u.createdAt ? ' · joined ' + esc(new Date(u.createdAt).toLocaleDateString()) : ''}</div>
          <div class="acts">
            <button class="primary" data-a="records">📖 View records</button>
            ${folder}
            ${u.frozen ? '<button class="ice" data-a="unfreeze">Unfreeze</button>' : '<button class="ice" data-a="freeze">❄ Freeze</button>'}
            <button class="danger" data-a="delete">Remove</button>
          </div>
        </div></div>`;
    }).join('');
  }

  $('pins').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-a]'); if (!btn) return;
    const sub = btn.closest('.pin').dataset.sub; const u = USERS.find((x) => x.sub === sub); const a = btn.dataset.a;
    const name = u.profile || u.email;
    try {
      if (a === 'records') return openViewer(u);
      if (a === 'freeze' && !(await confirmBox('Freeze ' + name + '?', 'The app on their computers locks at the next check (within about 2 minutes when online). Their data stays on their computers. You can unfreeze any time.', 'Freeze'))) return;
      if (a === 'delete' && !(await confirmBox('Remove ' + name + '?', 'Their account is removed and the app goes back to “Sign in with Google”. The data on their computer and the backup files in your Google Drive are <b>not</b> deleted. If they sign in again they start as a new profile.', 'Remove', true))) return;
      await api({ action: a, sub });
      toast({ freeze: 'Frozen.', unfreeze: 'Unfrozen.', delete: 'Removed.' }[a]);
      await refresh();
    } catch (err) { toast(err.message, true); }
  });
  $('q').addEventListener('input', render);
  $('filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; FILTER = b.dataset.f; document.querySelectorAll('#filter button').forEach((x) => x.classList.toggle('sel', x === b)); render(); });
  $('logoutBtn').onclick = async () => { await fetch('api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"logout"}' }); location.reload(); };

  // ---------------- read-only records viewer ----------------
  const C = window.PadmaCore;
  let V = null;
  async function openViewer(u) {
    $('viewer').classList.remove('hidden'); document.body.style.overflow = 'hidden';
    $('vLogo').src = u.gpicture || 'assets/logo.png';
    $('vName').textContent = u.profile || u.gname || u.email; $('vSub').textContent = u.email;
    $('vBody').innerHTML = '<div class="empty">Loading the latest backup from Google Drive…</div>';
    $('vStats').innerHTML = ''; $('vSections').innerHTML = ''; $('vMonth').innerHTML = ''; $('vWhen').textContent = '';
    try {
      const j = await api({ action: 'records', sub: u.sub });
      const data = C.db.normalize(j.data); // read-only copy
      const ids = C.logic.activeBranchIds();
      V = { data, br: ids[0], tab: V ? V.tab : 'students', ym: C.logic.ymOf(C.dates.today().bs.str) };
      $('vWhen').textContent = 'Backup from ' + new Date(j.modifiedTime).toLocaleString() + ' · ' + size(j.size);
      $('vSections').innerHTML = ids.length > 1 ? ids.map((id) => `<button data-b="${id}" class="${id === V.br ? 'sel' : ''}">${esc(C.logic.BRANCHES[id].name)}</button>`).join(' ') : '';
      const months = new Set([V.ym]);
      for (const id of ids) { const b = data.branches[id]; b.income.concat(b.expenditure).forEach((r) => months.add(C.logic.ymOf(r.dateBS))); b.fees.forEach((f) => months.add(f.forMonth)); }
      $('vMonth').innerHTML = [...months].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse().map((m) => `<option value="${m}">${m.slice(0, 4)} ${C.dates.MONTHS[+m.slice(5) - 1]}</option>`).join('');
      $('vMonth').value = V.ym;
      drawViewer();
    } catch (err) { $('vBody').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }
  function drawViewer() {
    if (!V) return;
    const b = V.data.branches[V.br];
    const [y, m] = V.ym.split('-').map(Number);
    const t = C.logic.periodTotals(b, y, m);
    const fs = C.logic.feeStatus(b, V.ym);
    const due = fs.reduce((a, r) => a + r.due, 0);
    $('vStats').innerHTML = [
      ['Active students', b.students.filter((s) => s.active === '1').length],
      ['Revenue (month)', money(t.revenue)], ['Expenditure (month)', money(t.expenditure)],
      ['Profit / loss (month)', `<span style="color:${t.net < 0 ? '#b91c1c' : '#047857'}">${money(t.net)}</span>`],
      ['Fees still due (month)', money(due)],
    ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v" style="font-size:18px">${v}</div></div>`).join('');
    document.querySelectorAll('#vTabs button').forEach((x) => x.classList.toggle('sel', x.dataset.t === V.tab));
    const table = (head, rows, empty) => `<div class="tbl"><table><thead><tr>${head.map((h) => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
    const inMonth = (r) => C.logic.ymOf(r.dateBS) === V.ym;
    let html = '';
    if (V.tab === 'students') {
      const list = [...b.students].sort((a, c) => (c.active.localeCompare(a.active)) || String(a.room).localeCompare(String(c.room), undefined, { numeric: true }));
      html = table([['#'], ['Name'], ['Phone'], ['Room'], ['Bed type'], ['Monthly fee', 'n'], ['Since'], ['Status']],
        list.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.room)}</td><td>${s.bed} Bed</td><td class="n">${money(s.fee)}</td><td>${esc(s.since)}</td><td>${s.active === '1' ? '<span class="pill on">Active</span>' : '<span class="pill off">Left ' + esc(s.until) + '</span>'}</td></tr>`), 'No students.');
    } else if (V.tab === 'fees') {
      html = table([['Name'], ['Room'], ['Expected', 'n'], ['Paid', 'n'], ['Due', 'n'], ['Status'], ['Paid on']],
        fs.map((r) => `<tr><td>${esc(r.s.name)}</td><td>${esc(r.s.room)}</td><td class="n">${money(r.expected)}</td><td class="n">${money(r.paid)}</td><td class="n">${money(r.due)}</td><td><span class="pill ${r.status === 'paid' ? 'on' : r.status === 'part' ? 'wait' : 'frz'}">${r.status === 'paid' ? 'Paid' : r.status === 'part' ? 'Part paid' : 'Not paid'}</span></td><td>${esc(r.dates.join(', '))}</td></tr>`), 'No fees expected this month.');
    } else if (V.tab === 'income' || V.tab === 'expenditure') {
      const rows = b[V.tab].filter(inMonth).sort((a, c) => String(a.dateBS).localeCompare(String(c.dateBS)));
      html = table([['Date (BS)'], [V.tab === 'income' ? 'Category' : 'Particular'], ['Description'], ['Amount', 'n']],
        rows.map((r) => `<tr><td>${esc(r.dateBS)}</td><td>${esc(r.category)}${C.logic.isRefundable(r) ? ' <span class="pill wait">refundable</span>' : ''}</td><td>${esc(r.description)}</td><td class="n">${money(r.amount)}</td></tr>`), 'Nothing this month.');
    } else if (V.tab === 'admissions') {
      const rows = [...b.records].sort((a, c) => String(c.admissionDate || '').localeCompare(String(a.admissionDate || '')));
      html = table([['Date (BS)'], ['Student'], ['Phone'], ['Room'], ['Joining bill', 'n']],
        rows.map((r) => `<tr><td>${esc(r.admissionDate)}</td><td>${esc(r.name)}</td><td>${esc(r.whatsapp || r.phone || '')}</td><td>${esc(r.roomLabel || '')} ${esc(r.roomNo || '')}</td><td class="n">${money((+r.admissionFee || 0) + (+r.deposit || 0) + (+r.formFee || 0) + (+r.bedFee || 0))}</td></tr>`), 'No admissions.');
    } else if (V.tab === 'rooms') {
      html = table([['Room'], ['Beds'], ['Occupied by']],
        b.rooms.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.beds.length}</td><td>${r.beds.map((x) => (x.name ? esc(x.name) : '<span class="muted">empty</span>')).join(', ')}</td></tr>`), 'No rooms.');
    }
    $('vBody').innerHTML = html;
  }
  $('vClose').onclick = () => { $('viewer').classList.add('hidden'); document.body.style.overflow = ''; };
  $('vTabs').addEventListener('click', (e) => { const x = e.target.closest('button'); if (x && V) { V.tab = x.dataset.t; drawViewer(); } });
  $('vSections').addEventListener('click', (e) => { const x = e.target.closest('button'); if (x && V) { V.br = x.dataset.b; document.querySelectorAll('#vSections button').forEach((q) => q.classList.toggle('sel', q === x)); drawViewer(); } });
  $('vMonth').onchange = () => { if (V) { V.ym = $('vMonth').value; drawViewer(); } };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('vClose').click(); });

  const err = new URLSearchParams(location.search).get('error');
  if (err) $('loginMsg').textContent = err;
  start();
})();
