// Google sends the owner back here after they allow access. Shows the two values to put into Vercel.
const G = require('./_google');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Padma Hostel – Google Drive connected</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;background:#f6f7f9;margin:0;padding:40px 16px;color:#0f172a}.c{max-width:640px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 8px}code,textarea{font:13px ui-monospace,Consolas,monospace}textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px;height:64px;margin:4px 0 4px}
button{background:#78350f;color:#fff;border:0;border-radius:8px;padding:7px 14px;font-weight:600;cursor:pointer}.k{background:#f1f5f9;border-radius:6px;padding:2px 6px}.w{background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px;font-size:13px}.e{color:#b91c1c}</style></head><body><div class="c">${body}</div>
<script>document.querySelectorAll('button[data-copy]').forEach(function(b){b.onclick=function(){var t=document.getElementById(b.dataset.copy);t.select();navigator.clipboard.writeText(t.value).then(function(){b.textContent='Copied ✓';});};});</script></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, state, error } = req.query || {};
  if (error) return res.status(400).send(page(`<h1>Not connected</h1><p class="e">Google said: ${esc(error)}</p>`));
  const [ts, sig] = String(state || '').split('.');
  if (!ts || sig !== G.hmac(ts) || Date.now() - Number(ts) > 15 * 60 * 1000) return res.status(400).send(page('<h1>Link expired</h1><p>Please start again from the app (Settings → Google Drive).</p>'));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: G.REDIRECT, grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) return res.status(400).send(page(`<h1>Not connected</h1><p class="e">${esc(j.error_description || j.error || 'Google did not give a long-term permission. Please try again.')}</p>`));

  let email = '';
  try { email = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString()).email || ''; } catch { /* ignore */ }

  // the backup folder: "Padma Hostel Finance" in My Drive (one this app can use), created if needed
  const auth = { Authorization: 'Bearer ' + j.access_token };
  const NAME = 'Padma Hostel Finance';
  let folderId = '';
  const l = await fetch(`${G.API}/files?` + new URLSearchParams({ q: `name='${NAME}' and mimeType='${G.FOLDER}' and 'root' in parents and trashed=false`, fields: 'files(id)', spaces: 'drive' }), { headers: auth }).then((x) => x.json()).catch(() => ({}));
  if (l.files && l.files[0]) folderId = l.files[0].id;
  else {
    const c = await fetch(`${G.API}/files?fields=id`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAME, mimeType: G.FOLDER, parents: ['root'] }) }).then((x) => x.json()).catch(() => ({}));
    folderId = c.id || '';
  }

  const same = process.env.GOOGLE_REFRESH_TOKEN && process.env.DRIVE_FOLDER_ID === folderId;
  return res.status(200).send(page(`<h1>✔ Google Drive connected</h1>
<p>Backups will go to the Google Drive of <b>${esc(email || 'this Gmail')}</b>, folder <b>${NAME}</b>.</p>
<p><b>Last step:</b> in Vercel → <i>padma-hostel-finance</i> → <b>Settings → Environment Variables</b>, add these two (type <b>Secret</b>), click <b>Save</b>, then <b>Redeploy</b>.${same ? ' (If they are already there, replace GOOGLE_REFRESH_TOKEN with the new one.)' : ''}</p>
<p>Key: <span class="k">GOOGLE_REFRESH_TOKEN</span></p><textarea id="t1" readonly>${esc(j.refresh_token)}</textarea><button data-copy="t1">Copy</button>
<p style="margin-top:18px">Key: <span class="k">DRIVE_FOLDER_ID</span></p><textarea id="t2" readonly style="height:40px">${esc(folderId)}</textarea><button data-copy="t2">Copy</button>
<p class="w" style="margin-top:20px">Keep the first value private: it lets this app save into your Drive. Don't send it in chats or screenshots. Close this page when done.</p>`));
};
