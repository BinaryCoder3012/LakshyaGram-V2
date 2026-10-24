/* ============================================================
   LakshyaGram — admin: people, conversations, broadcasts
============================================================ */
import * as store from './store.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const toDate = ts => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);
const when = ts => { const d = toDate(ts); return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
const ago = ts => {
  const d = toDate(ts);
  if (!d) return '—';
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export async function renderAdmin(root, { uid, me, toast, users: cache }) {
  root.innerHTML = '<div class="admin-head"><div><h1 id="admin-title">Admin</h1><p>Loading people and conversations…</p></div></div>';
  let data;
  try { data = await store.adminOverview(); }
  catch (e) {
    console.error(e);
    root.querySelector('p').textContent = 'Could not load admin data. Your Firestore rules may not allow reading every user and chat.';
    return;
  }
  const users = data.users.filter(u => u.uid !== store.botId);
  users.forEach(u => cache.set(u.uid, u));
  const nameOf = id => (id === store.botId ? store.botName : users.find(u => u.uid === id)?.name || 'Unknown user');
  const weekAgo = Date.now() - 7 * 86400000;
  const online = users.filter(u => u.online).length;
  const newThisWeek = users.filter(u => (toDate(u.createdAt)?.getTime() || 0) > weekAgo).length;
  const activeToday = data.chats.filter(c => (toDate(c.updatedAt)?.getTime() || 0) > Date.now() - 86400000).length;

  root.innerHTML = `
    <div class="admin-head">
      <div><h1 id="admin-title">Admin</h1><p>Updated ${new Date().toLocaleString()}</p></div>
      <button class="btn small quiet" id="adm-refresh">Refresh</button>
    </div>
    <div class="kpis">
      <div class="kpi"><b>${users.length}</b><span>People signed up</span></div>
      <div class="kpi"><b>${online}</b><span>Online now</span></div>
      <div class="kpi"><b>${data.chats.length}</b><span>Conversations</span></div>
      <div class="kpi"><b>${activeToday}</b><span>Active in the last day</span></div>
      <div class="kpi"><b>${newThisWeek}</b><span>Joined this week</span></div>
    </div>
    <div class="admin-grid">
      <section class="panel">
        <h2>People <label class="search"><input type="search" id="adm-search" placeholder="Search people" aria-label="Search people"/></label></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Joined</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody id="adm-users"></tbody>
        </table></div>
      </section>
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="panel">
          <h2>Broadcast to everyone</h2>
          <form class="form" id="adm-bc">
            <label>Message<textarea name="text" maxlength="600" placeholder="Server maintenance tonight from 1 to 2 am."></textarea></label>
            <div class="bc-preview" id="adm-preview" hidden><b>Admin broadcast</b><span></span></div>
            <div class="bc-actions"><button class="btn small" type="submit">Send to ${users.length - 1} people</button><small id="adm-progress"></small></div>
          </form>
        </section>
        <section class="panel">
          <h2>Recent conversations</h2>
          <div class="convos">${data.chats.slice(0, 40).map(c => `<div><b>${esc(c.participants.map(nameOf).join(' and '))}</b><span>${esc(c.lastMessage || 'No messages yet')} · ${esc(ago(c.updatedAt))}</span></div>`).join('') || '<p class="list-empty">No conversations yet.</p>'}</div>
        </section>
      </div>
    </div>`;

  const tbody = root.querySelector('#adm-users');
  const paint = (q = '') => {
    const list = users.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
    tbody.innerHTML = list.map(u => `<tr>
      <td><span class="who"><span class="av" style="--hue:${esc(u.avatarColor || '#B9C7FF')}"><span>${esc(initials(u.name))}</span></span>${esc(u.name)}</span></td>
      <td>${esc(u.email || '')}</td>
      <td><span class="state ${u.online ? 'on' : ''}">${u.online ? 'Online' : 'Offline'}</span></td>
      <td>${esc(when(u.createdAt))}</td>
      <td>${u.uid === uid ? '' : `<button class="link-danger" data-del="${esc(u.uid)}">Remove</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="5">Nobody matches that search.</td></tr>';
  };
  paint();
  root.querySelector('#adm-search').addEventListener('input', e => paint(e.target.value.trim()));
  tbody.addEventListener('click', async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Remove profile?'; return; }
    try {
      await store.deleteUserDoc(b.dataset.del);
      users.splice(users.findIndex(u => u.uid === b.dataset.del), 1);
      cache.delete(b.dataset.del);
      paint(root.querySelector('#adm-search').value.trim());
      toast('Profile removed. Their sign-in account still exists in Firebase Auth.');
    } catch { toast('Could not remove that profile.'); }
  });

  const form = root.querySelector('#adm-bc');
  const preview = root.querySelector('#adm-preview');
  form.text.addEventListener('input', () => {
    const v = form.text.value.trim();
    preview.hidden = !v;
    preview.querySelector('span').textContent = v;
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) return toast('Write the broadcast first.');
    const btn = form.querySelector('button');
    btn.disabled = true;
    const progress = root.querySelector('#adm-progress');
    try {
      const n = await store.broadcast(uid, me.name || 'Admin', text, users, done => { progress.textContent = `Sent to ${done} of ${users.length - 1}`; });
      form.reset();
      preview.hidden = true;
      progress.textContent = '';
      toast(`Broadcast sent to ${n} people`);
    } catch (err) {
      console.error(err);
      toast('The broadcast stopped partway. Check the console, then send again.');
    } finally { btn.disabled = false; }
  });
  root.querySelector('#adm-refresh').addEventListener('click', () => renderAdmin(root, { uid, me, toast, users: cache }));
}
