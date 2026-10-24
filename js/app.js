/* ============================================================
   LakshyaGram — the app: chats, people, messages, Lakshya AI
============================================================ */
import * as store from './store.js';
import { createTargetScene } from './target-scene.js';
import { renderAdmin } from './admin.js';

const gsap = window.gsap;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = window.matchMedia('(max-width: 860px)');

const $ = s => document.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const EMOJIS = ['😀','😂','🥲','😍','🤩','😎','🥳','😜','🤔','😴','🤯','😭','🙏','👍','👏','🤝','❤️','🔥','💯','✨','🎉','🚀','✅','💪','🎯','📚','💻','☕','🍕','🎮','🏏','🌙'];
const REACTIONS = ['👍','❤️','😂','😮','😢','🔥'];
const HUES = ['#F7A8B8','#9ED9B5','#B9C7FF','#FFD58A','#9FD8EC','#F5B38F','#C8E89A','#E5B8F0'];
const THEMES = ['target','ocean','forest','ember','sakura','midnight'];

const S = {
  user: null, profile: null, isAdmin: false,
  chats: [], users: new Map(),
  activeId: null, otherId: null, chat: null, messages: [],
  unsub: [], replyTo: null, editing: null, menuMsg: null,
  view: 'chats', search: '', seen: new Set(), aiThinking: false,
  typingTimer: null, typingOn: false, emptyScene: null, listsAnimated: false,
};

/* ---------------- small helpers ---------------- */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const toDate = ts => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);
const timeOf = ts => { const d = toDate(ts); return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };
function dayOf(ts) {
  const d = toDate(ts) || new Date();
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
function shortWhen(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(ts);
  const diff = (now - d) / 86400000;
  if (diff < 6) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function lastSeen(u) {
  if (u.isBot) return 'Always online';
  if (u.online) return 'Online';
  const d = toDate(u.lastSeen);
  if (!d) return u.status || 'Offline';
  return `Last seen ${dayOf(u.lastSeen) === 'Today' ? 'today' : dayOf(u.lastSeen).toLowerCase()} at ${timeOf(u.lastSeen)}`;
}

function formatText(raw) {
  const blocks = [];
  let s = esc(raw);
  s = s.replace(/```(?:[a-z]*)\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(`<pre><code>${code.trim()}</code></pre>`) - 1}\u0000`);
  s = s.replace(/`([^`\n]+)`/g, (_, code) => `\u0000${blocks.push(`<code>${code}</code>`) - 1}\u0000`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?]|$)/gm, '$1<strong>$2</strong>')
       .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,!?]|$)/gm, '$1<em>$2</em>')
       .replace(/^\s*[-*] /gm, '• ')
       .replace(/(https?:\/\/[^\s<]+[^\s<.,!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function paintAvatar(el, u) {
  el.classList.toggle('bot', Boolean(u?.isBot));
  el.style.setProperty('--hue', u?.avatarColor || '#B9C7FF');
  el.innerHTML = `<span>${esc(initials(u?.name))}</span>`;
  el.dataset.online = String(Boolean(u?.online && !u?.isBot));
}
function avatarHTML(u, cls = '') {
  return `<span class="av ${cls} ${u?.isBot ? 'bot' : ''}" style="--hue:${esc(u?.avatarColor || '#B9C7FF')}" data-online="${Boolean(u?.online && !u?.isBot)}"><span>${esc(initials(u?.name))}</span></span>`;
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const userOf = id => (id === store.botId ? store.BOT_PROFILE : S.users.get(id));
const otherOf = chat => chat.participants.find(p => p !== S.user.uid) || S.user.uid;
async function ensureUser(id) {
  if (userOf(id)) return userOf(id);
  const u = await store.getUser(id);
  S.users.set(id, u);
  return u;
}

/* ---------------- starred (kept on this device) ---------------- */
const starKey = () => `lg_starred_v3_${S.user.uid}`;
function starred() { try { return JSON.parse(localStorage.getItem(starKey())) || []; } catch { return []; } }
function setStarred(list) { try { localStorage.setItem(starKey(), JSON.stringify(list)); } catch {} }
const isStarred = id => starred().some(s => s.msgId === id);

/* ============================================================
   BOOT
============================================================ */
if (!store.configured) {
  $('#boot span').textContent = 'Firebase is not set up yet. Copy firebase-config.example.js to firebase-config.js and add your project keys.';
} else {
  store.onAuth(user => {
    if (!user) { location.replace('index.html#signin'); return; }
    if (!S.user) start(user).catch(err => {
      console.error(err);
      $('#boot span').textContent = 'Could not load your account. Check your connection and reload the page.';
    });
  });
}

async function start(user) {
  S.user = user;
  S.profile = await store.ensureProfile(user);
  S.isAdmin = store.isAdminEmail(user.email);
  S.users.set(user.uid, S.profile);
  renderMe();
  $('#admin-btn').hidden = !S.isAdmin;

  buildEmoji();
  buildMenuReacts();
  buildHues();
  wire();

  $('#boot').remove();
  $('#shell').hidden = false;
  renderLists();
  if (!reduce) {
    gsap.from('.side > *', { x: -18, opacity: 0, duration: .6, stagger: .05, ease: 'power3.out' });
    gsap.from('.empty > *', { y: 20, opacity: 0, duration: .7, stagger: .07, ease: 'power3.out', delay: .15 });
  }
  startEmptyScene();

  store.listUsers().then(list => { list.forEach(u => S.users.set(u.uid, u)); renderLists(); }).catch(() => {});
  S.unsubChats = store.watchChats(user.uid, chats => {
    S.chats = chats;
    Promise.all(chats.map(c => ensureUser(otherOf(c)))).then(renderLists);
    renderLists();
    updateTitle();
  }, err => {
    console.error(err);
    $('#list-chats').innerHTML = `<p class="list-empty">Your chats could not load. ${esc(err.code === 'failed-precondition' ? 'The Firestore index for chats is missing; open the link in the browser console to create it.' : 'Check your connection and reload.')}</p>`;
  });

  store.setPresence(user.uid, true).catch(() => {});
  document.addEventListener('visibilitychange', () => store.setPresence(user.uid, !document.hidden).catch(() => {}));
  window.addEventListener('pagehide', () => store.setPresence(user.uid, false).catch(() => {}));
  if (location.hash === '#admin' && S.isAdmin) showAdmin();
}

function startEmptyScene() {
  if (S.emptyScene) return;
  try {
    S.emptyScene = createTargetScene($('#empty-canvas'), { layout: 'center' });
    S.emptyScene.intro();
    setTimeout(() => S.emptyScene?.fire({ precise: true }), 900);
  } catch { $('.empty-stage').hidden = true; }
}

function renderMe() {
  paintAvatar($('#me-av'), { ...S.profile, online: false });
  $('#me-name').textContent = S.profile.name;
  $('#me-status').textContent = S.profile.status || 'Active now';
}

function updateTitle() {
  const n = S.chats.reduce((sum, c) => sum + (c.id !== S.activeId ? (c.unreadCount?.[S.user.uid] || 0) : 0), 0);
  document.title = n ? `(${n}) LakshyaGram` : 'LakshyaGram';
}

/* ============================================================
   SIDEBAR LISTS
============================================================ */
function renderLists() {
  if (S.view === 'chats') renderChats();
  if (S.view === 'people') renderPeople();
  if (S.view === 'starred') renderStarred();
}

function chatRow(chat) {
  const otherId = otherOf(chat);
  const u = userOf(otherId) || { name: '…' };
  const unread = chat.id === S.activeId ? 0 : (chat.unreadCount?.[S.user.uid] || 0);
  const pinned = chat.pinnedBy?.includes(S.user.uid);
  const typing = chat.typing?.[otherId];
  return `<button class="row ${chat.id === S.activeId ? 'is-active' : ''} ${unread ? 'unread' : ''}" data-chat="${esc(chat.id)}" data-other="${esc(otherId)}">
    ${avatarHTML(u)}
    <span class="row-main">
      <span class="row-top"><span class="row-name">${esc(u.name)}</span><span class="row-time">${esc(shortWhen(chat.updatedAt))}</span></span>
      <span class="row-bottom"><span class="row-sub">${typing ? 'typing…' : esc((chat.lastMessage || 'No messages yet').replace(/\*\*|[`*_]/g, ''))}</span>
      ${pinned ? '<svg class="pin-mark" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l-1 6 4 4v2h-5v6l-1 1-1-1v-6H6v-2l4-4z"/></svg>' : ''}
      ${unread ? `<span class="count">${unread > 99 ? '99+' : unread}</span>` : ''}</span>
    </span></button>`;
}

function renderChats() {
  const q = S.search.toLowerCase();
  const list = $('#list-chats');
  const match = c => !q || (userOf(otherOf(c))?.name || '').toLowerCase().includes(q) || (c.lastMessage || '').toLowerCase().includes(q);
  const chats = S.chats.filter(match);
  const pinned = chats.filter(c => c.pinnedBy?.includes(S.user.uid));
  const rest = chats.filter(c => !c.pinnedBy?.includes(S.user.uid));
  const hasBot = S.chats.some(c => c.participants.includes(store.botId));
  let html = '';
  if (pinned.length) html += `<p class="list-label">Pinned</p>${pinned.map(chatRow).join('')}<p class="list-label">All chats</p>`;
  html += rest.map(chatRow).join('');
  if (!hasBot && (!q || store.botName.toLowerCase().includes(q))) {
    html += `<button class="row" data-start="${esc(store.botId)}">${avatarHTML(store.BOT_PROFILE)}<span class="row-main"><span class="row-top"><span class="row-name">${esc(store.botName)}</span></span><span class="row-bottom"><span class="row-sub">Ask anything, it answers in seconds</span></span></span></button>`;
  }
  if (!chats.length && q) html = `<p class="list-empty">No chats match “${esc(S.search)}”. Look in People to start a new one.</p>`;
  else if (!S.chats.length) html += `<div class="list-empty">No chats yet. Find a classmate in People, or say hi to ${esc(store.botName)}.<br/><button class="btn small" data-open-new>Start a chat</button></div>`;
  list.innerHTML = html;
  if (!S.listsAnimated && S.chats.length && !reduce) {
    S.listsAnimated = true;
    gsap.from($$('.row', list), { x: -14, opacity: 0, duration: .45, stagger: .035, ease: 'power3.out' });
  }
}

function peopleRows(filter) {
  const q = filter.toLowerCase();
  const people = [store.BOT_PROFILE, ...[...S.users.values()].filter(u => u.uid !== S.user.uid && u.uid !== store.botId)]
    .filter(u => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    .sort((a, b) => (b.isBot - a.isBot) || (b.online - a.online) || (a.name || '').localeCompare(b.name || ''));
  if (!people.length) return `<p class="list-empty">Nobody matches “${esc(filter)}”. Try their email address.</p>`;
  return people.map(u => `<button class="row" data-start="${esc(u.uid)}">${avatarHTML(u)}<span class="row-main"><span class="row-top"><span class="row-name">${esc(u.name)}</span></span><span class="row-bottom"><span class="row-sub">${esc(u.isBot ? u.bio : u.online ? 'Online' : (u.bio || u.status || ''))}</span></span></span></button>`).join('');
}
function renderPeople() { $('#list-people').innerHTML = peopleRows(S.search); }

function renderStarred() {
  const q = S.search.toLowerCase();
  const items = starred().filter(s => !q || (s.text || '').toLowerCase().includes(q)).reverse();
  $('#list-starred').innerHTML = items.length
    ? items.map(s => `<button class="row starred-item" data-chat="${esc(s.chatId)}" data-other="${esc(s.otherId)}" data-msg="${esc(s.msgId)}"><span class="row-top" style="width:100%"><span class="row-name">${esc(s.from)}</span><span class="row-time">${esc(shortWhen(s.at))}</span></span><span class="row-sub">${esc(s.text || 'Photo')}</span></button>`).join('')
    : '<p class="list-empty">Nothing starred yet. Open a message menu and choose Star to keep it here.</p>';
}

/* ============================================================
   CONVERSATION
============================================================ */
function clearChatSubs() { S.unsub.forEach(u => u()); S.unsub = []; }

async function startChatWith(uid) {
  try {
    const id = await store.openChatWith(S.user.uid, uid);
    $('#new-chat').close();
    openChat(id, uid);
  } catch (e) { console.error(e); toast('Could not start that chat. Try again.'); }
}

async function openChat(chatId, otherId, focusMsg) {
  if (S.activeId === chatId) { if (focusMsg) flashMessage(focusMsg); showPane('convo'); return; }
  clearChatSubs();
  stopTyping();
  cancelReply();
  S.activeId = chatId; S.otherId = otherId; S.messages = []; S.seen = new Set(); S.chat = null; S.aiThinking = false;
  $('#msgs').innerHTML = '';
  $('#typing').hidden = true;
  closeFind();
  showPane('convo');
  renderLists();
  updateTitle();

  const u = await ensureUser(otherId);
  paintHeader(u);
  applyTheme(readTheme(chatId));
  autosize();

  S.unsub.push(store.watchUser(otherId, u2 => { S.users.set(otherId, u2); if (S.otherId === otherId) paintHeader(u2); }));
  S.unsub.push(store.watchChat(chatId, chat => {
    if (S.activeId !== chatId) return;
    S.chat = chat;
    const pinned = Boolean(chat?.pinnedBy?.includes(S.user.uid));
    $('#pin-btn').setAttribute('aria-pressed', String(pinned));
    $('#pin-btn').setAttribute('aria-label', pinned ? 'Unpin this chat' : 'Pin this chat');
    showTyping(Boolean(chat?.typing?.[otherId]) || S.aiThinking);
  }));
  let first = true;
  S.unsub.push(store.watchMessages(chatId, msgs => {
    if (S.activeId !== chatId) return;
    S.messages = msgs;
    renderMessages(first);
    if (first && focusMsg) flashMessage(focusMsg);
    first = false;
    if (!document.hidden) store.markRead(chatId, S.user.uid, msgs);
  }));
  if (!phone.matches) $('#input').focus();
}

function paintHeader(u) {
  paintAvatar($('#c-av'), u);
  $('#c-name').textContent = u.name;
  const st = $('#c-status');
  st.textContent = lastSeen(u);
  st.classList.toggle('online', Boolean(u.online && !u.isBot));
  $('#input').placeholder = u.isBot ? `Ask ${u.name} anything` : `Message ${u.name.split(' ')[0]}`;
}

function showPane(which) {
  $('#empty').hidden = which !== 'empty';
  $('#convo').hidden = which !== 'convo';
  $('#admin').hidden = which !== 'admin';
  $('#shell').classList.toggle('in-chat', which !== 'empty');
  if (which === 'convo' && !reduce && phone.matches === false) {
    gsap.fromTo('#convo', { opacity: 0 }, { opacity: 1, duration: .25 });
  }
}

function closeChat() {
  clearChatSubs();
  stopTyping();
  S.activeId = null; S.otherId = null;
  showPane('empty');
  renderLists();
  updateTitle();
}

/* ---------------- messages ---------------- */
function renderMessages(first) {
  const scroller = $('#scroller');
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  const list = $('#msgs');
  const other = userOf(S.otherId) || { name: '' };
  const frag = document.createDocumentFragment();
  const fresh = [];

  if (!S.messages.length) {
    const start = document.createElement('div');
    start.className = 'chat-start';
    start.innerHTML = `${avatarHTML(other)}<b>${esc(other.name)}</b>${other.isBot ? 'Ask a question, get help with an assignment, or just talk. Answers come from Google Gemini.' : 'This is the start of your chat. Say hello.'}`;
    frag.appendChild(start);
  }

  let lastDay = '';
  S.messages.forEach((m, i) => {
    const day = dayOf(m.createdAt);
    if (day !== lastDay) {
      const d = document.createElement('div');
      d.className = 'day';
      d.textContent = day;
      frag.appendChild(d);
      lastDay = day;
    }
    const prev = S.messages[i - 1];
    const next = S.messages[i + 1];
    const near = (a, b) => a && b && a.senderId === b.senderId && dayOf(a.createdAt) === dayOf(b.createdAt) && Math.abs((toDate(b.createdAt) || new Date()) - (toDate(a.createdAt) || new Date())) < 5 * 60000;
    const el = messageEl(m, near(prev, m), !near(m, next));
    frag.appendChild(el);
    if (!S.seen.has(m.id)) { if (!first) fresh.push(el); S.seen.add(m.id); }
  });
  list.replaceChildren(frag);

  const mineJustSent = fresh.some(el => el.classList.contains('out'));
  if (first || atBottom || mineJustSent) scrollToBottom(!first);
  else if (fresh.length) $('#to-bottom').hidden = false;

  if (reduce) return;
  if (first) {
    gsap.from($$('.m', list).slice(-12), { y: 12, opacity: 0, duration: .35, stagger: .018, ease: 'power2.out' });
  } else if (fresh.length) {
    fresh.forEach(el => gsap.from(el.querySelector('.bubble'), {
      y: 14, scale: .92, opacity: 0, duration: .45, ease: 'back.out(1.7)',
      transformOrigin: el.classList.contains('out') ? '100% 100%' : '0% 100%',
    }));
  }
}

function messageEl(m, cont, last) {
  const mine = m.senderId === S.user.uid;
  const el = document.createElement('div');
  el.className = `m ${mine ? 'out' : 'in'}${cont ? ' cont' : ''}${last ? ' last' : ''}`;
  el.dataset.id = m.id;
  const sender = userOf(m.senderId) || { name: m.senderName, avatarColor: '#B9C7FF' };

  let inner = '';
  if (m.deleted) {
    inner = '<span class="text">This message was deleted</span>';
  } else {
    if (m.isBroadcast) inner += '<span class="tag">Admin broadcast</span>';
    if (m.replyTo) inner += `<span class="quote" data-jump="${esc(m.replyTo.id || '')}"><b>${esc(m.replyTo.senderName || '')}</b><span>${esc((m.replyTo.text || 'Photo').slice(0, 90))}</span></span>`;
    if (m.imageUrl && /^(data:image\/|https:)/.test(m.imageUrl)) inner += '<img class="photo" alt="Photo" loading="lazy"/>';
    if (m.text) inner += `<span class="text">${formatText(m.text)}</span>`;
    const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids?.length);
    if (reacts.length) inner += `<span class="reacts">${reacts.map(([e, ids]) => `<button data-react="${esc(e)}" class="${ids.includes(S.user.uid) ? 'mine' : ''}" aria-label="${esc(e)} ${ids.length}">${esc(e)} ${ids.length}</button>`).join('')}</span>`;
  }
  const star = isStarred(m.id) ? '★ ' : '';
  const ticks = mine && !m.deleted ? `<span class="ticks ${m.read ? 'read' : ''}" aria-label="${m.read ? 'Read' : 'Sent'}">${m.read ? '✓✓' : '✓'}</span>` : '';
  inner += `<span class="meta">${star}${m.edited && !m.deleted ? 'edited · ' : ''}${esc(timeOf(m.createdAt) || 'Sending')}${ticks}</span>`;

  el.innerHTML = `${mine ? '' : avatarHTML(sender, 'sm')}
    <div class="bubble ${m.deleted ? 'deleted' : ''} ${m.isBroadcast ? 'broadcast' : ''}">${inner}</div>
    ${m.deleted ? '' : `<span class="m-tools">
      <button class="icon-btn" data-tool="reply" aria-label="Reply"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/></svg></button>
      <button class="icon-btn" data-tool="menu" aria-label="More actions"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
    </span>`}`;
  const img = el.querySelector('img.photo');
  if (img) img.src = m.imageUrl;
  return el;
}

function scrollToBottom(smooth) {
  const s = $('#scroller');
  s.scrollTo({ top: s.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  $('#to-bottom').hidden = true;
}
function flashMessage(id) {
  const el = document.querySelector(`.m[data-id="${CSS.escape(id)}"]`);
  if (!el) return toast('That message is no longer here.');
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function showTyping(on) {
  const row = $('#typing');
  if (on === !row.hidden) return;
  row.hidden = !on;
  $('#typing-name').textContent = on ? `${userOf(S.otherId)?.name || ''} is typing` : '';
  if (on) {
    const s = $('#scroller');
    if (s.scrollHeight - s.scrollTop - s.clientHeight < 200) scrollToBottom(true);
  }
}

/* ---------------- sending ---------------- */
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !S.activeId) return;
  const chatId = S.activeId, otherId = S.otherId;

  if (S.editing) {
    const id = S.editing;
    cancelReply();
    input.value = ''; autosize();
    await store.updateMessage(chatId, id, { text, edited: true }).catch(() => toast('Could not edit that message.'));
    return;
  }

  const msg = { senderId: S.user.uid, senderName: S.profile.name, text };
  if (S.replyTo) msg.replyTo = S.replyTo;
  cancelReply();
  input.value = ''; autosize();
  stopTyping();
  launchSendButton();
  try {
    await store.sendMessage(chatId, otherId, msg, text);
  } catch (e) {
    console.error(e);
    input.value = text; autosize();
    return toast('Message not sent. Check your connection and try again.');
  }
  if (otherId === store.botId) replyAsBot(chatId, [...S.messages, msg]);
}

async function replyAsBot(chatId, msgs) {
  S.aiThinking = true;
  if (S.activeId === chatId) showTyping(true);
  const history = msgs.filter(m => !m.deleted && m.text).slice(-20)
    .map(m => ({ role: m.senderId === store.botId ? 'model' : 'user', text: m.text }));
  try {
    const reply = await store.askAI(history);
    await store.sendMessage(chatId, null, { senderId: store.botId, senderName: store.botName, text: reply, read: true }, reply);
  } catch (e) {
    console.error('Lakshya AI', e);
    toast(`${store.botName} could not answer right now. Try again in a moment.`);
  } finally {
    S.aiThinking = false;
    if (S.activeId === chatId) showTyping(Boolean(S.chat?.typing?.[S.otherId]));
  }
}

function launchSendButton() {
  if (reduce) return;
  const icon = $('#send-btn svg');
  gsap.timeline()
    .to(icon, { x: 26, opacity: 0, duration: .18, ease: 'power2.in' })
    .set(icon, { x: -22 })
    .to(icon, { x: 0, opacity: 1, duration: .35, ease: 'back.out(2)' });
}

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  if (t.scrollHeight) t.style.height = Math.min(t.scrollHeight, 160) + 'px';
  $('#send-btn').disabled = !t.value.trim();
}

function onType() {
  autosize();
  if (!S.activeId || S.otherId === store.botId || S.editing) return;
  if (!S.typingOn) { S.typingOn = true; store.setTyping(S.activeId, S.user.uid, true); }
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(stopTyping, 2500);
}
function stopTyping() {
  clearTimeout(S.typingTimer);
  if (S.typingOn && S.activeId) store.setTyping(S.activeId, S.user.uid, false);
  S.typingOn = false;
}

/* ---------------- reply and edit ---------------- */
function startReply(m) {
  S.editing = null;
  S.replyTo = { id: m.id, text: (m.text || 'Photo').slice(0, 140), senderName: m.senderName || userOf(m.senderId)?.name || '' };
  $('#reply-bar').hidden = false;
  $('#reply-bar').classList.remove('editing');
  $('#reply-name').textContent = `Replying to ${S.replyTo.senderName}`;
  $('#reply-snippet').textContent = S.replyTo.text;
  $('#input').focus();
}
function startEdit(m) {
  S.replyTo = null;
  S.editing = m.id;
  $('#reply-bar').hidden = false;
  $('#reply-bar').classList.add('editing');
  $('#reply-name').textContent = 'Editing message';
  $('#reply-snippet').textContent = m.text;
  const input = $('#input');
  input.value = m.text;
  autosize();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function cancelReply() {
  const wasEditing = S.editing;
  S.replyTo = null; S.editing = null;
  $('#reply-bar').hidden = true;
  if (wasEditing) { $('#input').value = ''; autosize(); }
}

/* ---------------- message menu ---------------- */
function openMenu(m, x, y) {
  S.menuMsg = m;
  const menu = $('#menu');
  const mine = m.senderId === S.user.uid;
  menu.querySelector('[data-act="edit"]').hidden = !mine || !m.text || Boolean(m.imageUrl);
  const del = menu.querySelector('[data-act="delete"]');
  del.hidden = !mine;
  del.textContent = 'Delete';
  delete del.dataset.confirm;
  menu.querySelector('[data-act="star"]').textContent = isStarred(m.id) ? 'Remove star' : 'Star';
  menu.querySelector('[data-act="copy"]').hidden = !m.text;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  if (!reduce) gsap.fromTo(menu, { scale: .9, opacity: 0, transformOrigin: 'top left' }, { scale: 1, opacity: 1, duration: .22, ease: 'back.out(2)' });
  menu.querySelector('.menu-reacts button').focus();
}
function closeMenu() { $('#menu').hidden = true; S.menuMsg = null; }

async function menuAction(act) {
  const m = S.menuMsg;
  if (!m) return;
  const chatId = S.activeId;
  if (act === 'delete') {
    const del = $('#menu [data-act="delete"]');
    if (!del.dataset.confirm) { del.dataset.confirm = '1'; del.textContent = 'Delete for everyone?'; return; }
    closeMenu();
    await store.updateMessage(chatId, m.id, { deleted: true, text: '', imageUrl: null, reactions: {} }).then(() => toast('Message deleted')).catch(() => toast('Could not delete that message.'));
    return;
  }
  closeMenu();
  if (act === 'reply') startReply(m);
  if (act === 'edit') startEdit(m);
  if (act === 'copy') navigator.clipboard.writeText(m.text).then(() => toast('Copied')).catch(() => toast('Copy is blocked in this browser.'));
  if (act === 'star') {
    const list = starred();
    if (isStarred(m.id)) { setStarred(list.filter(s => s.msgId !== m.id)); toast('Star removed'); }
    else {
      list.push({ chatId, otherId: S.otherId, msgId: m.id, text: m.text || '', from: m.senderName || userOf(m.senderId)?.name || '', at: toDate(m.createdAt)?.toISOString() });
      setStarred(list);
      toast('Starred');
    }
    renderMessages(false);
    if (S.view === 'starred') renderStarred();
  }
}

async function toggleReaction(m, emoji) {
  const on = !(m.reactions?.[emoji] || []).includes(S.user.uid);
  await store.react(S.activeId, m.id, emoji, S.user.uid, on).catch(() => toast('Could not add that reaction.'));
}

/* ---------------- photos ---------------- */
async function sendPhoto(file) {
  if (!file || !S.activeId) return;
  if (!file.type.startsWith('image/')) return toast('Only photos can be sent. Choose a JPG, PNG or WebP image.');
  try {
    const url = await compress(file);
    await store.sendMessage(S.activeId, S.otherId, { senderId: S.user.uid, senderName: S.profile.name, imageUrl: url }, 'Photo');
    launchSendButton();
  } catch (e) { console.error(e); toast('That photo could not be sent. Try a smaller one.'); }
}
function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let quality = .82, max = 1280, url;
      for (let i = 0; i < 5; i++) {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        url = c.toDataURL('image/jpeg', quality);
        if (url.length < 900000) break;
        max *= .75; quality -= .08;
      }
      URL.revokeObjectURL(img.src);
      url.length < 900000 ? resolve(url) : reject(new Error('too large'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function viewPhoto(src) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.style.cssText = 'width:auto;max-width:calc(100% - 32px);padding:12px';
  const img = new Image();
  img.src = src; img.alt = 'Photo';
  img.style.cssText = 'max-height:80dvh;border-radius:18px';
  d.appendChild(img);
  d.addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
}

/* ---------------- find in chat ---------------- */
function closeFind() {
  $('#find').hidden = true;
  $('#find-input').value = '';
  $$('.m.found, .m.dim').forEach(el => el.classList.remove('found', 'dim'));
}
function runFind() {
  const q = $('#find-input').value.trim().toLowerCase();
  const els = $$('#msgs .m');
  let hits = [];
  els.forEach(el => {
    const t = el.querySelector('.text')?.textContent.toLowerCase() || '';
    const hit = q && t.includes(q);
    el.classList.toggle('found', Boolean(hit));
    el.classList.toggle('dim', Boolean(q && !hit));
    if (hit) hits.push(el);
  });
  $('#find-count').textContent = q ? (hits.length ? `${hits.length} found` : 'None found') : '';
  hits.at(-1)?.scrollIntoView({ block: 'center' });
}

/* ---------------- themes ---------------- */
function readTheme(chatId) {
  let t = 'target';
  try { t = localStorage.getItem(`lg_theme_${chatId}`) || 'target'; } catch {}
  return THEMES.includes(t) ? t : 'target';
}
function applyTheme(t) {
  $('#convo').dataset.chatTheme = t;
  $$('#themes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.theme === t)));
}

/* ---------------- pickers and dialogs ---------------- */
function buildEmoji() {
  $('#emoji').innerHTML = EMOJIS.map(e => `<button type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('');
}
function buildMenuReacts() {
  $('#menu-reacts').innerHTML = REACTIONS.map(e => `<button data-react="${e}" aria-label="React ${e}">${e}</button>`).join('');
}
let pickedHue = null;
function buildHues() {
  $('#hues').innerHTML = HUES.map(h => `<button type="button" role="radio" aria-checked="false" aria-label="Colour ${h}" data-hue="${h}" style="--c:${h}"></button>`).join('');
}
function openProfile() {
  const f = $('#profile-form');
  f.name.value = S.profile.name || '';
  f.bio.value = S.profile.bio || '';
  f.status.value = S.profile.status || 'Active now';
  pickedHue = S.profile.avatarColor || HUES[0];
  paintProfileAv();
  $('#profile').showModal();
  popIn('#profile');
}
function paintProfileAv() {
  paintAvatar($('#profile-av'), { name: $('#profile-form').name.value || S.profile.name, avatarColor: pickedHue });
  $$('#hues button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.hue === pickedHue)));
}
function openContact() {
  const u = userOf(S.otherId);
  if (!u) return;
  paintAvatar($('#contact-av'), u);
  $('#contact-name').textContent = u.name;
  $('#contact-status').textContent = lastSeen(u);
  $('#contact-bio').textContent = u.bio || '';
  $('#contact-email').textContent = u.isBot ? 'Powered by Google Gemini' : (u.email || '');
  $('#contact').showModal();
  popIn('#contact');
}
function openNewChat() {
  $('#new-chat-search').value = '';
  $('#new-chat-list').innerHTML = peopleRows('');
  $('#new-chat').showModal();
  popIn('#new-chat');
  setTimeout(() => $('#new-chat-search').focus(), 50);
}
function popIn(sel) {
  if (!reduce) gsap.fromTo(sel, { y: 24, scale: .96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .45, ease: 'expo.out' });
}

function showAdmin() {
  closeChat();
  showPane('admin');
  renderAdmin($('#admin'), { me: S.profile, uid: S.user.uid, toast, users: S.users, openChat: (id, other) => openChat(id, other) });
}

/* ============================================================
   WIRING
============================================================ */
function wire() {
  // sidebar
  $('#side-search').addEventListener('input', e => { S.search = e.target.value.trim(); renderLists(); });
  $$('.seg [role="tab"]').forEach(b => b.addEventListener('click', () => {
    S.view = b.dataset.view;
    $$('.seg [role="tab"]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $$('.lists .list').forEach(l => { l.hidden = l.dataset.view !== S.view; });
    renderLists();
    if (!reduce) gsap.from(`#list-${S.view} > *`, { y: 10, opacity: 0, duration: .3, stagger: .02, ease: 'power2.out' });
  }));
  document.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (row?.dataset.start) startChatWith(row.dataset.start);
    else if (row?.dataset.chat) openChat(row.dataset.chat, row.dataset.other, row.dataset.msg);
    if (e.target.closest('[data-open-new]')) openNewChat();
  });
  $('#new-chat-btn').addEventListener('click', openNewChat);
  $('#empty-new').addEventListener('click', openNewChat);
  $('#empty-ai').addEventListener('click', () => startChatWith(store.botId));
  $('.empty-stage').addEventListener('click', () => S.emptyScene?.fire({ precise: Math.random() > .4 }));
  $('#new-chat-search').addEventListener('input', e => { $('#new-chat-list').innerHTML = peopleRows(e.target.value.trim()); });
  $('#profile-btn').addEventListener('click', openProfile);
  $('#admin-btn').addEventListener('click', showAdmin);
  $('#signout-btn').addEventListener('click', async () => {
    stopTyping();
    await store.signOut(S.user.uid).catch(() => {});
    location.replace('index.html');
  });
  $('#mode-btn').addEventListener('click', () => {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]').content = light ? '#EEF2F7' : '#0A1F38';
    $('#mode-btn').setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    try { localStorage.setItem('lg_dark_mode', String(!light)); } catch {}
    if (!reduce) gsap.fromTo('#mode-btn svg', { rotate: -90, scale: .5 }, { rotate: 0, scale: 1, duration: .5, ease: 'back.out(2)' });
  });

  // header
  $('#back-btn').addEventListener('click', closeChat);
  $('#c-who').addEventListener('click', openContact);
  $('#pin-btn').addEventListener('click', async () => {
    const pinned = $('#pin-btn').getAttribute('aria-pressed') === 'true';
    await store.togglePin(S.activeId, S.user.uid, !pinned).then(() => toast(pinned ? 'Chat unpinned' : 'Chat pinned')).catch(() => toast('Could not pin this chat.'));
  });
  $('#find-btn').addEventListener('click', () => {
    const f = $('#find');
    if (!f.hidden) return closeFind();
    f.hidden = false;
    $('#find-input').focus();
  });
  $('#find-close').addEventListener('click', closeFind);
  $('#find-input').addEventListener('input', runFind);
  $('#theme-btn').addEventListener('click', e => {
    e.stopPropagation();
    const p = $('#themes');
    p.hidden = !p.hidden;
    $('#theme-btn').setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden && !reduce) gsap.from('#themes button', { y: 10, opacity: 0, duration: .3, stagger: .03, ease: 'power2.out' });
  });
  $('#themes').addEventListener('click', e => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    applyTheme(b.dataset.theme);
    try { localStorage.setItem(`lg_theme_${S.activeId}`, b.dataset.theme); } catch {}
    $('#themes').hidden = true;
  });

  // composer
  const input = $('#input');
  input.addEventListener('input', onType);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'ArrowUp' && !input.value) {
      const mine = [...S.messages].reverse().find(m => m.senderId === S.user.uid && !m.deleted && m.text);
      if (mine) { e.preventDefault(); startEdit(mine); }
    }
  });
  autosize();
  $('#send-btn').addEventListener('click', send);
  $('#reply-cancel').addEventListener('click', cancelReply);
  $('#emoji-btn').addEventListener('click', e => {
    e.stopPropagation();
    const p = $('#emoji');
    p.hidden = !p.hidden;
    $('#emoji-btn').setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden && !reduce) gsap.from('#emoji button', { scale: .4, opacity: 0, duration: .3, stagger: .008, ease: 'back.out(2)' });
  });
  $('#emoji').addEventListener('click', e => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    const pos = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, pos) + b.dataset.emoji + input.value.slice(input.selectionEnd ?? pos);
    input.focus();
    input.setSelectionRange(pos + b.dataset.emoji.length, pos + b.dataset.emoji.length);
    autosize();
  });
  $('#photo-btn').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', e => { sendPhoto(e.target.files[0]); e.target.value = ''; });

  // drag and drop a photo
  const convo = $('#convo');
  let dragDepth = 0;
  convo.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop-zone').hidden = false; } });
  convo.addEventListener('dragover', e => e.preventDefault());
  convo.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-zone').hidden = true; } });
  convo.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#drop-zone').hidden = true; sendPhoto(e.dataTransfer.files[0]); });
  input.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); sendPhoto(file); }
  });

  // messages
  const msgs = $('#msgs');
  const msgFor = el => S.messages.find(m => m.id === el.closest('.m')?.dataset.id);
  msgs.addEventListener('contextmenu', e => {
    const m = e.target.closest('.bubble') && msgFor(e.target);
    if (!m || m.deleted) return;
    e.preventDefault();
    openMenu(m, e.clientX, e.clientY);
  });
  msgs.addEventListener('click', e => {
    const tool = e.target.closest('[data-tool]');
    const m = msgFor(e.target);
    if (tool && m) {
      if (tool.dataset.tool === 'reply') startReply(m);
      else { const r = tool.getBoundingClientRect(); openMenu(m, r.left, r.bottom + 6); }
      return;
    }
    const react = e.target.closest('[data-react]');
    if (react && m) return toggleReaction(m, react.dataset.react);
    const quote = e.target.closest('[data-jump]');
    if (quote?.dataset.jump) return flashMessage(quote.dataset.jump);
    const img = e.target.closest('img.photo');
    if (img) viewPhoto(img.src);
  });
  let press;
  msgs.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const m = e.target.closest('.bubble') && msgFor(e.target);
    if (!m || m.deleted) return;
    press = setTimeout(() => { navigator.vibrate?.(12); openMenu(m, e.clientX, e.clientY); }, 450);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach(t => msgs.addEventListener(t, () => clearTimeout(press)));
  $('#scroller').addEventListener('scroll', () => {
    const s = $('#scroller');
    $('#to-bottom').hidden = s.scrollHeight - s.scrollTop - s.clientHeight < 140;
  }, { passive: true });
  $('#to-bottom').addEventListener('click', () => scrollToBottom(true));

  // menu
  $('#menu').addEventListener('click', e => {
    const r = e.target.closest('[data-react]');
    if (r && S.menuMsg) { const m = S.menuMsg; closeMenu(); return toggleReaction(m, r.dataset.react); }
    const a = e.target.closest('[data-act]');
    if (a) menuAction(a.dataset.act);
  });

  // dialogs
  $$('dialog.sheet').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('#hues').addEventListener('click', e => { const b = e.target.closest('[data-hue]'); if (b) { pickedHue = b.dataset.hue; paintProfileAv(); } });
  $('#profile-form').name.addEventListener('input', paintProfileAv);
  $('#profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const data = { name: f.name.value.trim(), bio: f.bio.value.trim(), status: f.status.value, avatarColor: pickedHue };
    if (!data.name) return toast('Add a name so people know who you are.');
    try {
      await store.updateProfile(S.user.uid, data);
      Object.assign(S.profile, data);
      renderMe();
      $('#profile').close();
      toast('Profile saved');
    } catch { toast('Could not save your profile. Try again.'); }
  });

  // outside clicks and keys
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#menu')) closeMenu();
    if (!e.target.closest('#emoji, #emoji-btn')) { $('#emoji').hidden = true; $('#emoji-btn').setAttribute('aria-expanded', 'false'); }
    if (!e.target.closest('#themes, #theme-btn')) { $('#themes').hidden = true; $('#theme-btn').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#side-search').focus(); }
    if (e.key === 'Escape') {
      if (!$('#menu').hidden) return closeMenu();
      if (!$('#emoji').hidden) return ($('#emoji').hidden = true);
      if (!$('#themes').hidden) return ($('#themes').hidden = true);
      if (!$('#find').hidden) return closeFind();
      if (S.replyTo || S.editing) return cancelReply();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.activeId) store.markRead(S.activeId, S.user.uid, S.messages);
  });
}
