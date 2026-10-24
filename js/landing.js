/* ============================================================
   LakshyaGram — landing page behaviour
============================================================ */
import { createTargetScene } from './target-scene.js';
import * as store from './store.js';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- hero target ---------------- */
const hero = $('.hero');
const hitLayer = $('#hit-layer');
const aimScore = $('#aim-score');
let scene = null;
let pendingText = null;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

if (webglAvailable()) {
  try {
    scene = createTargetScene($('#target-canvas'), { layout: 'hero', onHit: showHit });
  } catch (e) {
    console.warn('Target scene failed to start', e);
  }
}
if (!scene) document.documentElement.classList.add('no-webgl');

function showHit({ x, y, ring }) {
  const text = pendingText;
  pendingText = null;
  if (!text) return;
  aimScore.textContent = ring >= 10 ? 'Bullseye. Straight into the gold.' : `Landed in the ${ring} ring.`;
  const box = hero.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'hit-bubble';
  b.textContent = text;
  const small = document.createElement('small');
  small.textContent = 'Delivered just now';
  b.appendChild(small);
  hitLayer.appendChild(b);
  const left = Math.min(x - box.left + 14, box.width - b.offsetWidth - 16);
  b.style.left = Math.max(16, left) + 'px';
  b.style.top = (y - box.top - b.offsetHeight - 14) + 'px';
  gsap.timeline({ onComplete: () => b.remove() })
    .from(b, { scale: .4, opacity: 0, duration: .45, ease: 'back.out(2)' })
    .to(b, { y: -24, opacity: 0, duration: .5, ease: 'power2.in' }, '+=2.8');
}

$('#aim-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#aim-input');
  const text = input.value.trim() || input.placeholder;
  input.value = '';
  if (!scene) { aimScore.textContent = 'Your browser cannot draw the 3D target, but your message would be delivered.'; return; }
  pendingText = text;
  scene.fire({ precise: true });
});

/* ---------------- motion ---------------- */
const mm = gsap.matchMedia();
mm.add({ motion: '(prefers-reduced-motion: no-preference)', desktop: '(min-width: 761px)' }, ctx => {
  if (!ctx.conditions.motion) return;

  // The one orchestrated moment: the target swings in, the headline rises, then three arrows land.
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
  if (scene) intro.add(scene.intro(), 0);
  intro.from('.hero-title .line > span', { yPercent: 110, duration: 1.1, stagger: .1 }, .15)
    .from('.hero-sub', { y: 24, opacity: 0, duration: .9 }, .45)
    .from('.hero-actions > *', { y: 20, opacity: 0, duration: .8, stagger: .07 }, .55)
    .from('.aim', { y: 20, opacity: 0, duration: .8 }, .7)
    .from('.nav > *', { y: -16, opacity: 0, duration: .8, stagger: .08 }, .3);
  if (scene) {
    [1.2, 1.55, 1.85].forEach((t, i) => intro.call(() => scene.fire({ precise: i === 2 }), null, t));
  }

  if (scene) {
    ScrollTrigger.create({
      trigger: hero, start: 'top top', end: 'bottom top', scrub: true,
      onUpdate: self => scene.setScroll(self.progress),
    });
  }
  gsap.to('.hero-copy', { yPercent: -18, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });

  // Signature move: the app fragment opens like a shutter across the disc.
  gsap.timeline({ scrollTrigger: { trigger: '.showcase', start: 'top 65%', once: true } })
    .from('.disc', { scale: .6, opacity: 0, duration: 1.1, ease: 'expo.out' })
    .fromTo('.disc-object', { clipPath: 'inset(0 0 100% 0 round 28px)' }, { clipPath: 'inset(0 0 0% 0 round 28px)', duration: 1.1, ease: 'expo.inOut' }, .1)
    .from('.disc-object .frag.is-active > *', { y: 24, opacity: 0, duration: .6, stagger: .06, ease: 'power3.out' }, .6)
    .from('.disc-list > *', { y: 28, opacity: 0, duration: .7, stagger: .07, ease: 'power3.out' }, .2)
    .from('.disc-fact', { opacity: 0, x: 20, duration: .7 }, .8);

  // Board tiles enter in reading order; their enlarged parts drift with the scroll.
  ScrollTrigger.batch('.board .tile', {
    start: 'top 88%', once: true,
    onEnter: els => gsap.from(els, { y: 32, opacity: 0, duration: .8, stagger: .07, ease: 'power3.out' }),
  });
  $$('.board .macro').forEach(m => {
    gsap.fromTo(m, { yPercent: 12 }, { yPercent: -12, ease: 'none', scrollTrigger: { trigger: m.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  gsap.from('.how-intro > *', { y: 28, opacity: 0, duration: .8, stagger: .08, ease: 'power3.out', scrollTrigger: { trigger: '.how', start: 'top 75%', once: true } });
  gsap.from('.how-steps li', { y: 24, opacity: 0, duration: .7, stagger: .09, ease: 'power3.out', scrollTrigger: { trigger: '.how-steps', start: 'top 90%', once: true } });

  gsap.from('.cta-line > span', { y: 40, opacity: 0, duration: .9, stagger: .1, ease: 'expo.out', scrollTrigger: { trigger: '.cta', start: 'top 75%', once: true } });
  gsap.from('.cta-note', { opacity: 0, y: 16, duration: .7, delay: .3, scrollTrigger: { trigger: '.cta', start: 'top 75%', once: true } });

  gsap.from('.blocks span', {
    scaleY: 0, duration: 1, stagger: { each: .05, from: 'start' }, ease: 'expo.out',
    scrollTrigger: { trigger: '.footer', start: 'top 85%', once: true },
  });
});

if (reduce && scene) [0, 1, 2].forEach(i => scene.fire({ precise: i === 2 }));

/* ---------------- showcase tabs ---------------- */
const FACTS = [
  { disc: '#FFC93C', text: 'Messages arrive the moment they are sent, on every device you are signed in on.' },
  { disc: '#EF4B4B', text: 'Lakshya AI sits in your chat list like a friend. Ask it anything, it remembers the conversation.' },
  { disc: '#2F6FB5', text: 'Reply to a specific message, react with an emoji, or edit what you sent.' },
  { disc: '#0A1F38', text: 'Six themes, chosen per chat. Your study group can look different from your family.' },
  { disc: '#FFC93C', text: 'Admins can message every user at once for announcements and downtime notices.' },
];
const tabs = $$('.disc-list [role="tab"]');
const frags = $$('.disc-object .frag');
let current = 0;
function selectTab(i, focus = false) {
  if (i === current) return;
  const prev = frags[current];
  const next = frags[i];
  tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
  if (focus) tabs[i].focus();
  $('#disc').style.setProperty('--disc', FACTS[i].disc);
  $('#disc-fact').textContent = FACTS[i].text;
  current = i;
  if (reduce) {
    prev.classList.remove('is-active');
    next.classList.add('is-active');
    return;
  }
  gsap.to(prev, { opacity: 0, duration: .3, onComplete: () => { prev.classList.remove('is-active'); gsap.set(prev, { clearProps: 'opacity' }); } });
  next.classList.add('is-active');
  gsap.fromTo(next, { opacity: 0 }, { opacity: 1, duration: .3 });
  gsap.from(next.children, { y: 18, opacity: 0, duration: .45, stagger: .05, ease: 'power3.out', delay: .1 });
  gsap.fromTo('#disc', { scale: .94 }, { scale: 1, duration: .8, ease: 'elastic.out(1, .5)' });
}
tabs.forEach((t, i) => {
  t.tabIndex = i === 0 ? 0 : -1;
  t.addEventListener('click', () => selectTab(i));
  t.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); selectTab((current + 1) % tabs.length, true); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab((current - 1 + tabs.length) % tabs.length, true); }
  });
});

/* ---------------- how-it-works diagram ---------------- */
(function buildDiagram() {
  const svg = $('#how-diagram');
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1200, H = 270, R = 6;
  const rand = mulberry32(7);
  const dots = [];
  // Left third: loose scatter. Middle: a ribbon three dots high. Right: even rows.
  for (let i = 0; i < 48; i++) dots.push({ x: 10 + rand() * 360, y: 20 + rand() * 230, fill: rand() > .5 ? '#A9BAD0' : '#CBD6E4' });
  for (let i = 0; i < 48; i++) dots.push({ x: 430 + (i % 16) * 21, y: 114 + Math.floor(i / 16) * 21, fill: i % 3 ? '#6F86A6' : '#2F6FB5' });
  for (let i = 0; i < 48; i++) dots.push({ x: 820 + (i % 8) * 50, y: 22 + Math.floor(i / 8) * 45, fill: '#FFC93C' });
  const els = dots.map(d => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', d.x); c.setAttribute('cy', d.y); c.setAttribute('r', R); c.setAttribute('fill', d.fill);
    svg.appendChild(c);
    return c;
  });
  if (reduce) return;
  // On scroll the dots travel from one shared cloud to their places, so the order is earned.
  gsap.from(els, {
    attr: { cx: () => W / 2 + (rand() - .5) * W * .9, cy: () => H / 2 + (rand() - .5) * H },
    opacity: 0, ease: 'power2.out', stagger: { each: .004, from: 'random' },
    scrollTrigger: { trigger: svg, start: 'top 90%', end: 'center 45%', scrub: 1 },
  });
})();

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------- auth dialog ---------------- */
const dialog = $('#auth');
const msg = $('#auth-msg');
let magicPending = false;

function say(text, type = '') { msg.textContent = text; msg.className = 'auth-msg ' + type; }
function setTab(tab) {
  $$('.auth-tabs [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.auth-form').forEach(f => { f.hidden = f.dataset.tab !== tab; });
  $('#auth-title').textContent = tab === 'login' ? 'Welcome back' : 'Join LakshyaGram';
  say('');
}
function openAuth(tab = 'login', email) {
  setTab(tab);
  if (email) $(`#form-${tab} [name="email"]`).value = email;
  if (!dialog.open) dialog.showModal();
  if (!reduce) gsap.fromTo(dialog, { y: 30, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: .5, ease: 'expo.out' });
  if (!store.configured) say('Firebase is not set up yet. Copy firebase-config.example.js to firebase-config.js and add your project keys.', 'error');
  setTimeout(() => $(`#form-${tab} input`).focus(), 60);
}
$$('[data-auth]').forEach(a => a.addEventListener('click', e => {
  if (a.dataset.signedIn) return;
  e.preventDefault();
  openAuth(a.dataset.auth);
}));
$$('.auth-tabs [role="tab"]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { if (location.hash === '#signin' || location.hash === '#signup') history.replaceState(null, '', location.pathname); });
$$('.show-pass').forEach(b => b.addEventListener('click', () => {
  const input = b.previousElementSibling;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.textContent = show ? 'Hide' : 'Show';
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}));

$('#form-signup [name="password"]').addEventListener('input', e => {
  const v = e.target.value;
  const score = [v.length >= 6, v.length >= 10, /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
  const bar = $('.strength i');
  bar.style.width = score * 20 + '%';
  bar.style.background = score < 2 ? 'var(--red)' : score < 4 ? 'var(--gold)' : '#7BD389';
});

function friendly(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'That email and password do not match an account. Check them, or create an account.';
  if (code.includes('email-already-in-use')) return 'An account already uses this email. Sign in instead.';
  if (code.includes('invalid-email')) return 'Enter a full email address, like you@email.com.';
  if (code.includes('weak-password')) return 'Use a password of at least 6 characters.';
  if (code.includes('too-many-requests')) return 'Too many tries. Wait a minute, then sign in again.';
  if (code.includes('network')) return 'No connection. Check your internet and try again.';
  return err?.message || 'Something went wrong. Try again.';
}
async function busy(form, fn) {
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  try { await fn(); } catch (err) { say(friendly(err), 'error'); } finally { btn.disabled = false; }
}

$('#form-login').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const email = f.email.value.trim(), password = f.password.value;
  if (magicPending && email) {
    return busy(f, async () => { await store.completeMagicLink(email); say('Signed in. Opening your chats…', 'ok'); location.href = 'app.html'; });
  }
  if (!email || !password) return say('Enter your email and password to sign in.', 'error');
  busy(f, async () => { await store.signIn(email, password); say('Signed in. Opening your chats…', 'ok'); location.href = 'app.html'; });
});
$('#form-signup').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const data = { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value, bio: f.bio.value.trim() };
  if (!data.name || !data.email || !data.password) return say('Add your name, email and a password to create an account.', 'error');
  if (data.password.length < 6) return say('Use a password of at least 6 characters.', 'error');
  busy(f, async () => { await store.signUp(data); say('Account created. Opening your chats…', 'ok'); location.href = 'app.html'; });
});
$('#magic-btn').addEventListener('click', async () => {
  const email = $('#form-login [name="email"]').value.trim();
  if (!email) return say('Enter your email first, then we will send the link to it.', 'error');
  try {
    await store.sendMagicLink(email, new URL('index.html', location.href).href);
    say('Link sent. Open it from your inbox on this device. Check spam if it is not there in a minute.', 'ok');
  } catch (err) { say(friendly(err), 'error'); }
});
$('#reset-btn').addEventListener('click', async () => {
  const email = $('#form-login [name="email"]').value.trim();
  if (!email) return say('Enter your email first, then we will send a reset link to it.', 'error');
  try { await store.resetPassword(email); say('Password reset email sent.', 'ok'); } catch (err) { say(friendly(err), 'error'); }
});

$('#cta-form').addEventListener('submit', e => {
  e.preventDefault();
  openAuth('signup', $('#cta-email').value.trim());
  setTimeout(() => $('#form-signup [name="name"]').focus(), 80);
});

/* ---------------- session ---------------- */
if (store.hasMagicLink()) {
  store.completeMagicLink().then(r => {
    if (r.ok) location.href = 'app.html';
    if (r.needsEmail) {
      magicPending = true;
      openAuth('login');
      say('Enter the email the link was sent to, then press Sign in.', 'ok');
    }
  }).catch(err => { openAuth('login'); say(friendly(err), 'error'); });
}

store.onAuth(user => {
  if (user) {
    $$('[data-auth="login"]').forEach(a => {
      a.textContent = a.classList.contains('text-link') ? 'Open your chats' : 'Open the app';
      a.href = 'app.html';
      a.dataset.signedIn = '1';
    });
  }
});

if (location.hash === '#signin') openAuth('login');
if (location.hash === '#signup') openAuth('signup');
