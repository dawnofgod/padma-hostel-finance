'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = (b) => { b = Number(b) || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB'; };
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' days ago';
  };
  let tt;
  const toast = (m, err) => { const t = $('toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast'), 4000); };

  async function api(action, extra) {
    const r = await fetch('api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  function showLogin() { $('loginBox').classList.remove('hidden'); $('panel').classList.add('hidden'); $('who').textContent = ''; }

  function modal(title, html, buttons) {
    return new Promise((resolve) => {
      $('modalRoot').innerHTML = `<div class="modal-back"><div class="modal"><h3 style="margin-top:0">${esc(title)}</h3><div>${html}</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px" id="mBtns"></div></div></div>`;
      const box = $('mBtns');
      buttons.forEach(([label, val, cls]) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = () => { const inp = $('modalRoot').querySelector('input'); $('modalRoot').innerHTML = ''; resolve(val === 'input' ? (inp ? inp.value : '') : val); }; box.appendChild(b); });
      const i = $('modalRoot').querySelector('input'); if (i) i.focus();
    });
  }
  const showCode = (name, code) => modal('Activation code', `<p>On <b>${esc(name)}</b>'s computer, open the Padma Hostel app → <b>Settings → Activate this computer</b> and type:</p><p style="text-align:center;margin:18px 0"><span class="code" style="font-size:26px">${esc(code)}</span></p><p class="muted">The code works once and expires in 30 days. Using it on a new computer signs out the old one.</p>`, [['Done', true, 'primary']]);

  async function loadMe() {
    const me = await api('me');
    $('loginBox').classList.add('hidden'); $('panel').classList.remove('hidden');
    $('who').innerHTML = `${esc(me.email)} · <button id="logoutBtn">Sign out</button>`;
    $('logoutBtn').onclick = async () => { await api('logout'); showLogin(); };
    $('dState').textContent = me.drive.connected ? '✔ Connected' : 'Not connected';
    $('dInfo').innerHTML = me.drive.connected
      ? `${esc(me.drive.email)}${me.drive.rootId ? ` · <a href="https://drive.google.com/drive/folders/${esc(me.drive.rootId)}" target="_blank" rel="noopener">open folder</a>` : ''}`
      : '<a href="api/admin">Sign in again to connect</a>';
    $('gState').textContent = me.gemini ? '✔ Ready' : 'Not set up';
  }

  async function loadClients() {
    const { clients } = await api('list');
    const online = clients.filter((c) => c.online && !c.frozen).length;
    $('cCount').textContent = clients.length;
    $('cOnline').textContent = `${online} online now · ${clients.filter((c) => c.frozen).length} frozen`;
    const used = clients.reduce((a, c) => a + c.driveBytes, 0);
    $('sUsed').textContent = size(used);
    $('sInfo').textContent = clients.reduce((a, c) => a + c.driveFiles, 0) + ' files in Drive';
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    $('rows').innerHTML = clients.length ? clients.map((c) => {
      const st = c.frozen ? '<span class="pill frz">❄ Frozen</span>'
        : !c.activated ? '<span class="pill wait">Waiting for activation</span>'
          : c.online ? '<span class="pill on">● Online</span>' : '<span class="pill off">○ Offline</span>';
      return `<tr class="${c.frozen ? 'row-frozen' : ''}">
        <td><b>${esc(c.name)}</b><div class="muted">added ${esc((c.createdAt || '').slice(0, 10))}</div>${c.pendingCode ? `<div class="muted" style="margin-top:4px">code: <span class="code">${esc(c.pendingCode)}</span></div>` : ''}</td>
        <td>${st}</td>
        <td>${esc(ago(c.lastSeen))}${c.lastSeen ? `<div class="muted">${esc(new Date(c.lastSeen).toLocaleString())}</div>` : ''}</td>
        <td>${esc(c.device || '–')}<div class="muted">${c.version ? 'app v' + esc(c.version) : ''}</div></td>
        <td>${c.activated ? `${esc(size(c.dataBytes))}<div class="muted">${c.students} students · ${c.records} entries</div>` : '–'}</td>
        <td>${esc(size(c.driveBytes))}<div class="muted">${c.driveFiles} files${c.lastUpload ? ' · last upload ' + esc(ago(c.lastUpload)) : ''}</div></td>
        <td>${c.folderId ? `<a href="https://drive.google.com/drive/folders/${esc(c.folderId)}" target="_blank" rel="noopener">📁 ${esc(c.folderName || 'Open')}</a>` : '<span class="muted">none</span>'}<div style="margin-top:4px"><button data-a="newfolder" data-id="${esc(c.id)}">New folder</button></div></td>
        <td><div class="acts">
          ${c.frozen ? `<button class="ice" data-a="unfreeze" data-id="${esc(c.id)}">Unfreeze</button>` : `<button class="ice" data-a="freeze" data-id="${esc(c.id)}" data-n="${esc(c.name)}">❄ Freeze</button>`}
          <button data-a="newcode" data-id="${esc(c.id)}" data-n="${esc(c.name)}">New code</button>
          <button data-a="rename" data-id="${esc(c.id)}" data-n="${esc(c.name)}">Rename</button>
          <button class="danger" data-a="delete" data-id="${esc(c.id)}" data-n="${esc(c.name)}">Remove</button>
        </div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="muted">No clients yet. Add one above, then type its activation code in the app on that computer.</td></tr>';
  }

  async function refresh() { try { await loadMe(); await loadClients(); } catch (e) { if (!/sign in/i.test(e.message)) toast(e.message, true); } }

  $('addBtn').onclick = async () => {
    const name = $('newName').value.trim(); if (!name) return toast('Enter a client name.', true);
    try { const r = await api('create', { name }); $('newName').value = ''; await loadClients(); if (r.folderNote) toast('Folder: ' + r.folderNote, true); await showCode(name, r.code); } catch (e) { toast(e.message, true); }
  };
  $('rows').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b) return;
    const { a, id, n } = b.dataset;
    try {
      if (a === 'freeze') { if (!(await modal('Freeze client?', `<p><b>${esc(n)}</b> will be locked: the app shows “Account frozen – contact admin” and cannot be used until you unfreeze. Their data stays safe.</p>`, [['Cancel', false], ['Freeze', true, 'primary']]))) return; await api('freeze', { id }); toast('Frozen.'); }
      else if (a === 'unfreeze') { await api('unfreeze', { id }); toast('Unfrozen. The app unlocks the next time it connects.'); }
      else if (a === 'newcode') { if (!(await modal('New activation code?', `<p>Use this to activate <b>${esc(n)}</b> on a new or replacement computer. When the new code is used, the old computer is signed out.</p>`, [['Cancel', false], ['Create code', true, 'primary']]))) return; const r = await api('newcode', { id }); await loadClients(); await showCode(n, r.code); }
      else if (a === 'rename') { const v = await modal('Rename client', `<input value="${esc(n)}" maxlength="60" style="width:100%">`, [['Cancel', null], ['Save', 'input', 'primary']]); if (!v || !v.trim()) return; await api('rename', { id, name: v.trim() }); toast('Renamed.'); }
      else if (a === 'newfolder') { await api('newfolder', { id }); toast('Backup folder ready.'); }
      else if (a === 'delete') { if (!(await modal('Remove client?', `<p><b>${esc(n)}</b> will be signed out and can no longer back up or scan. Files already in Google Drive stay there.</p>`, [['Cancel', false], ['Remove', true, 'danger']]))) return; await api('delete', { id }); toast('Removed.'); }
      await loadClients();
    } catch (e) { toast(e.message, true); }
  });

  refresh();
  setInterval(() => { if (!$('panel').classList.contains('hidden') && !document.hidden) loadClients().catch(() => {}); }, 30000);
})();
