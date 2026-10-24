/* ============================================================
   LakshyaGram — data layer
   Every Firebase call goes through here. The Firestore shape is
   the same as V2, so existing users and chats keep working:
     users/{uid}
     chats/{uidA_uidB}            participants, lastMessage, updatedAt,
                                  unreadCount, typing, pinnedBy
     chats/{id}/messages/{msgId}
============================================================ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, sendPasswordResetEmail, signInAnonymously, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy,
  onSnapshot, serverTimestamp, increment, arrayUnion, arrayRemove, writeBatch, limit,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* global FIREBASE_CONFIG, ADMIN_EMAILS, AI_BOT_ID, AI_BOT_NAME */
const firebaseConfig = typeof FIREBASE_CONFIG !== 'undefined' ? FIREBASE_CONFIG : null;
const adminEmails = typeof ADMIN_EMAILS !== 'undefined' ? ADMIN_EMAILS : [];
export const botId = typeof AI_BOT_ID !== 'undefined' ? AI_BOT_ID : 'lakshyagram';
export const botName = typeof AI_BOT_NAME !== 'undefined' ? AI_BOT_NAME : 'Lakshya AI';
export const configured = Boolean(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_'));

const app = configured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

const AVATAR_COLORS = ['#F7A8B8', '#9ED9B5', '#B9C7FF', '#FFD58A', '#9FD8EC', '#F5B38F', '#C8E89A', '#E5B8F0'];
export const BOT_PROFILE = { uid: botId, name: botName, avatarColor: '#FFC93C', bio: 'Your AI assistant, always here', status: 'Always online', online: true, isBot: true };
const MAGIC_EMAIL_KEY = 'lg_magic_email';
const GUEST_KEY = 'lg_guest';
const GUEST_DOMAIN = '@guest.lakshyagram.app';
const isGuestUser = user => Boolean(user?.isAnonymous || user?.email?.endsWith(GUEST_DOMAIN));
const guestName = uid => `Guest ${uid.slice(0, 4).toUpperCase()}`;

export const isAdminEmail = email => adminEmails.map(e => e.toLowerCase()).includes((email || '').toLowerCase());
export const chatIdFor = (a, b) => [a, b].sort().join('_');
const requireConfig = () => { if (!configured) throw new Error('Firebase is not set up yet. Copy firebase-config.example.js to firebase-config.js and add your project keys.'); };

// ---------------- auth ----------------
export function onAuth(cb) {
  if (!configured) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}
export async function signIn(email, password) { requireConfig(); return signInWithEmailAndPassword(auth, email, password); }
// Guests use Firebase anonymous sign-in. If that provider is switched off,
// they get a private email/password account remembered on this device.
export async function signInAsGuest() {
  requireConfig();
  try {
    return await signInAnonymously(auth);
  } catch (err) {
    const code = err?.code || '';
    if (!code.includes('operation-not-allowed') && !code.includes('admin-restricted')) throw err;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(GUEST_KEY)); } catch {}
  if (saved?.email && saved?.password) {
    try { return await signInWithEmailAndPassword(auth, saved.email, saved.password); } catch {}
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  const email = `guest-${id.slice(0, 16)}${GUEST_DOMAIN}`;
  const password = crypto.randomUUID() + crypto.randomUUID();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try { localStorage.setItem(GUEST_KEY, JSON.stringify({ email, password })); } catch {}
  await setDoc(doc(db, 'users', cred.user.uid), {
    uid: cred.user.uid, email: '', name: guestName(cred.user.uid), bio: '', isGuest: true,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    status: 'Active now', online: true, createdAt: serverTimestamp(),
  });
  return cred;
}
export async function signUp({ name, email, password, bio }) {
  requireConfig();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    uid: cred.user.uid, email, name, bio: bio || '',
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    status: 'Active now', online: true, createdAt: serverTimestamp(),
  });
  return cred;
}
export async function sendMagicLink(email, url) {
  requireConfig();
  await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  try { localStorage.setItem(MAGIC_EMAIL_KEY, email); } catch {}
}
export function hasMagicLink() { return configured && isSignInWithEmailLink(auth, window.location.href); }
export async function completeMagicLink(fallbackEmail) {
  let email = null;
  try { email = localStorage.getItem(MAGIC_EMAIL_KEY); } catch {}
  email = email || fallbackEmail;
  if (!email) return { needsEmail: true };
  await signInWithEmailLink(auth, email, window.location.href);
  try { localStorage.removeItem(MAGIC_EMAIL_KEY); } catch {}
  window.history.replaceState(null, '', window.location.pathname);
  return { ok: true };
}
export async function resetPassword(email) { requireConfig(); return sendPasswordResetEmail(auth, email); }
export async function signOut(uid) {
  if (uid) await setPresence(uid, false).catch(() => {});
  return fbSignOut(auth);
}

// ---------------- users ----------------
export async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { online: true }).catch(() => {});
    return { ...snap.data(), uid: user.uid };
  }
  const profile = {
    uid: user.uid, email: isGuestUser(user) ? '' : user.email,
    name: isGuestUser(user) ? guestName(user.uid) : (user.email || 'friend').split('@')[0],
    bio: '', isGuest: isGuestUser(user),
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)], status: 'Active now', online: true, createdAt: serverTimestamp(),
  };
  await setDoc(ref, profile);
  return profile;
}
export const updateProfile = (uid, data) => updateDoc(doc(db, 'users', uid), data);
export const setPresence = (uid, online) =>
  updateDoc(doc(db, 'users', uid), online ? { online: true } : { online: false, lastSeen: serverTimestamp() });

export async function getUser(uid) {
  if (uid === botId) return BOT_PROFILE;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { ...snap.data(), uid } : { uid, name: 'Unknown user', avatarColor: '#6F86A6', online: false };
}
export function watchUser(uid, cb) {
  if (uid === botId) { cb(BOT_PROFILE); return () => {}; }
  return onSnapshot(doc(db, 'users', uid), s => s.exists() && cb({ ...s.data(), uid }));
}
export async function listUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ ...d.data(), uid: d.id }));
}

// ---------------- chats ----------------
export function watchChats(uid, cb, onError) {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', uid), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
}
export function watchChat(chatId, cb) {
  return onSnapshot(doc(db, 'chats', chatId), s => cb(s.exists() ? { id: s.id, ...s.data() } : null));
}
export async function openChatWith(uid, otherUid) {
  const chatId = chatIdFor(uid, otherUid);
  const ref = doc(db, 'chats', chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { participants: [uid, otherUid], lastMessage: '', updatedAt: serverTimestamp(), unreadCount: {} });
  }
  return chatId;
}
export const togglePin = (chatId, uid, pin) =>
  updateDoc(doc(db, 'chats', chatId), { pinnedBy: pin ? arrayUnion(uid) : arrayRemove(uid) });
export const setTyping = (chatId, uid, typing) =>
  updateDoc(doc(db, 'chats', chatId), { [`typing.${uid}`]: typing }).catch(() => {});

// ---------------- messages ----------------
export function watchMessages(chatId, cb) {
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt'));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function sendMessage(chatId, otherId, msg, preview) {
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    text: '', read: false, deleted: false, edited: false, starred: false, flagged: false,
    ...msg, createdAt: serverTimestamp(),
  });
  const update = { lastMessage: preview.slice(0, 60), updatedAt: serverTimestamp() };
  if (otherId && otherId !== msg.senderId) update[`unreadCount.${otherId}`] = increment(1);
  await updateDoc(doc(db, 'chats', chatId), update);
}
export const updateMessage = (chatId, msgId, data) => updateDoc(doc(db, 'chats', chatId, 'messages', msgId), data);
export const react = (chatId, msgId, emoji, uid, on) =>
  updateMessage(chatId, msgId, { [`reactions.${emoji}`]: on ? arrayUnion(uid) : arrayRemove(uid) });

export async function markRead(chatId, uid, messages) {
  await updateDoc(doc(db, 'chats', chatId), { [`unreadCount.${uid}`]: 0 }).catch(() => {});
  const unread = messages.filter(m => m.senderId !== uid && !m.read).slice(-50);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach(m => batch.update(doc(db, 'chats', chatId, 'messages', m.id), { read: true }));
  await batch.commit().catch(() => {});
}

// ---------------- Lakshya AI ----------------
export async function askAI(history) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Lakshya AI did not answer.');
  return data.reply;
}

// ---------------- admin ----------------
export async function adminOverview() {
  const [users, chats] = await Promise.all([getDocs(collection(db, 'users')), getDocs(query(collection(db, 'chats'), orderBy('updatedAt', 'desc')))]);
  return {
    users: users.docs.map(d => ({ ...d.data(), uid: d.id })),
    chats: chats.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}
export const deleteUserDoc = uid => deleteDoc(doc(db, 'users', uid));
export async function broadcast(adminUid, adminName, text, users, onProgress) {
  let done = 0;
  for (const u of users) {
    if (u.uid === adminUid) continue;
    const chatId = await openChatWith(adminUid, u.uid);
    await sendMessage(chatId, u.uid, { senderId: adminUid, senderName: adminName, text, isBroadcast: true }, 'Broadcast: ' + text);
    onProgress?.(++done);
  }
  return done;
}
export async function recentMessages(chatId, n = 30) {
  const snap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
}
