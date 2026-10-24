// Lakshya AI — Vercel serverless function that relays a conversation to Gemini or Ollama.
// Body: { messages: [{ role: 'user' | 'model', text }] }  (V2's { prompt } still works)
//
// Environment:
//   GEMINI_API_KEY   Google AI Studio key
//   OLLAMA_API_KEY   ollama.com key
//   AI_PROVIDER      optional: 'gemini' or 'ollama' to try that one first (default gemini)
//   GEMINI_MODEL     optional model override
//   OLLAMA_MODEL     optional model override (default gpt-oss:120b)
//   AI_DAILY_LIMIT   free messages a day for signed-in members (default 25)
//   AI_GUEST_LIMIT   free messages a day for guests (default 10)
//   AI_IP_LIMIT      messages a day from one network, all accounts together (default 80)
//   ADMIN_EMAILS     comma-separated emails with no limit (default the project owner)
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + _TOKEN)
//                    Upstash Redis for the counters. Without it, counts live in the
//                    function's memory, which resets when Vercel recycles it.
// If the first provider fails, the other one answers, when its key is set.
// Callers must send a Firebase ID token: Authorization: Bearer <token>.

const SYSTEM = `You are Lakshya AI, the assistant inside LakshyaGram, a chat app made by a student at BITS Pilani, Hyderabad Campus. Most people talking to you are college students.

How to answer:
- Be correct first. Think the problem through before answering, and check facts, numbers and code.
- Lead with the direct answer, then the reasoning or steps that make it useful. No preamble, no repeating the question.
- Fit the length to the question: one or two lines for quick questions, clear steps for problems, full code when code is asked for.
- For maths, show the working. For code, give complete, runnable code in fenced blocks with the language named, and say how to run it.
- If the question is ambiguous, answer the most likely reading and say what you assumed. If you don't know or can't know (live data, today's news), say so plainly instead of guessing.
- Use **bold**, short bullet lists and \`code\` where they help; avoid headings and tables, they don't fit a chat bubble.
- Be warm and a little witty, like a sharp senior who wants the person to understand, not just copy. Reply in the language the person writes in.`;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
// The Firebase web API key is public (it ships to every browser); it is only used to verify ID tokens.
const FIREBASE_WEB_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBwIix3qNTgtGWUxJJEQHKWKoJ4Dnrbiec';
const GUEST_DOMAIN = '@guest.lakshyagram.app';
const LIMITS = {
  member: Number(process.env.AI_DAILY_LIMIT) || 25,
  guest: Number(process.env.AI_GUEST_LIMIT) || 10,
  ip: Number(process.env.AI_IP_LIMIT) || 80,
};
const ADMINS = (process.env.ADMIN_EMAILS || 'lakshya.sudipta15@gmail.com').toLowerCase().split(',').map(e => e.trim());
const OLLAMA_API = 'https://ollama.com/api';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000; // per provider, before the other one takes over
let geminiModels = null; // cached while the function stays warm
let ollamaModels = null;

class ProviderError extends Error {
  constructor(provider, status, detail) {
    super(`${provider} ${status}`);
    this.provider = provider; this.status = status; this.detail = detail;
  }
}

// ---------------- Gemini ----------------
// Newest stable Flash models first; previews, lite and special-purpose models last or never.
async function listGeminiFlash(key) {
  if (geminiModels) return geminiModels;
  const res = await fetch(`${GEMINI_API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return [];
  const { models = [] } = await res.json();
  const version = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  geminiModels = models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => n.startsWith('gemini-') && n.includes('flash') && !/image|tts|audio|live|embed|thinking/.test(n))
    .sort((a, b) => /preview|exp|lite/.test(a) - /preview|exp|lite/.test(b) || version(b) - version(a));
  return geminiModels;
}

async function askGemini(history, key, signal) {
  const contents = history.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  // Light thinking keeps replies fast; models that reject the setting are retried without it.
  const bodyFor = (model, light) => JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: {
      temperature: 0.6, maxOutputTokens: 8192,
      ...(light ? { thinkingConfig: /gemini-2\./.test(model) ? { thinkingBudget: 512 } : { thinkingLevel: 'low' } } : {}),
    },
  });
  const tried = new Set();
  let last = null;
  for (const next of [process.env.GEMINI_MODEL, 'gemini-flash-latest', null]) {
    const candidates = next === null ? await listGeminiFlash(key) : next ? [next] : [];
    for (const model of candidates) {
      if (tried.has(model) || tried.size >= 6) continue;
      tried.add(model);
      const call = light => fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: bodyFor(model, light),
        signal,
      });
      let res = await call(true);
      if (res.status === 400) res = await call(false);
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('').trim();
        if (text) return { text, model };
        last = new ProviderError('gemini', 502, `empty reply from ${model}`);
        continue;
      }
      const err = await res.json().catch(() => ({}));
      last = new ProviderError('gemini', res.status, `${model}: ${JSON.stringify(err)}`);
      // Only a missing or retired model is worth retrying with another one.
      if (![404, 400].includes(res.status)) throw last;
    }
  }
  throw last || new ProviderError('gemini', 502, 'no usable model');
}

// ---------------- Ollama ----------------
async function listOllama(key) {
  if (ollamaModels) return ollamaModels;
  const res = await fetch(`${OLLAMA_API}/tags`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return [];
  const { models = [] } = await res.json();
  ollamaModels = models.map(m => m.name || m.model).filter(Boolean);
  return ollamaModels;
}

async function askOllama(history, key, signal) {
  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
  ];
  const tried = new Set();
  let last = null;
  for (const next of [process.env.OLLAMA_MODEL || 'gpt-oss:120b', null]) {
    const candidates = next === null ? await listOllama(key) : [next];
    for (const model of candidates) {
      if (tried.has(model) || tried.size >= 4) continue;
      tried.add(model);
      const call = light => fetch(`${OLLAMA_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, stream: false, ...(light ? { think: 'low' } : {}), options: { temperature: 0.6 } }),
        signal,
      });
      // Models without a thinking mode reject the setting, so retry without it.
      let res = await call(true);
      if (res.status === 400) res = await call(false);
      if (res.ok) {
        const data = await res.json();
        const text = (data.message?.content || '').trim();
        if (text) return { text, model };
        last = new ProviderError('ollama', 502, `empty reply from ${model}`);
        continue;
      }
      const err = await res.text().catch(() => '');
      last = new ProviderError('ollama', res.status, `${model}: ${err.slice(0, 500)}`);
      if (res.status !== 404) throw last;
    }
  }
  throw last || new ProviderError('ollama', 502, 'no usable model');
}

// ---------------- who is asking ----------------
async function verifyUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  if (!res.ok) return null;
  const user = (await res.json()).users?.[0];
  if (!user) return null;
  const email = (user.email || '').toLowerCase();
  const guest = !email || email.endsWith(GUEST_DOMAIN);
  return { uid: user.localId, kind: ADMINS.includes(email) ? 'admin' : guest ? 'guest' : 'member' };
}

// ---------------- daily quota ----------------
// Days roll over at midnight India time.
function today() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 5.5 * 3600 * 1000;
  return { day: ist.toISOString().slice(0, 10), resetAt: new Date(next).toISOString() };
}

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map();

async function bump(key, by) {
  if (redisUrl && redisToken) {
    const res = await fetch(`${redisUrl}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCRBY', key, String(by)], ['EXPIRE', key, '172800']]),
    });
    if (res.ok) return Number((await res.json())[0]?.result) || 0;
    console.error('Rate limit store error', res.status);
  }
  const n = (memory.get(key) || 0) + by;
  memory.set(key, n);
  if (memory.size > 5000) memory.delete(memory.keys().next().value);
  return n;
}

// ---------------- handler ----------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = { gemini: process.env.GEMINI_API_KEY, ollama: process.env.OLLAMA_API_KEY };
  const asked = ['gemini', 'ollama'].includes(req.body?.provider) ? req.body.provider : null;
  const first = asked || (process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'gemini');
  const order = [first, first === 'gemini' ? 'ollama' : 'gemini'].filter(p => keys[p]);
  if (!order.length) {
    console.error('Neither GEMINI_API_KEY nor OLLAMA_API_KEY is set.');
    return res.status(500).json({ error: 'Server config error: API key missing.' });
  }

  let user;
  try { user = await verifyUser(req); } catch (e) { console.error('Token check failed', e); }
  if (!user) return res.status(401).json({ error: 'Sign in to talk to Lakshya AI.' });

  // Count first so parallel requests can't slip past the limit; refund if no answer comes back.
  const { day, resetAt } = today();
  const limit = user.kind === 'admin' ? Infinity : LIMITS[user.kind];
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const userKey = `ai:${day}:u:${user.uid}`;
  const ipKey = `ai:${day}:ip:${ip}`;
  let used = 0;
  if (user.kind !== 'admin') {
    used = await bump(userKey, 1);
    const ipUsed = await bump(ipKey, 1);
    if (used > limit || ipUsed > LIMITS.ip) {
      await bump(userKey, -1);
      await bump(ipKey, -1);
      return res.status(429).json({ error: `You've used today's ${limit} free Lakshya AI messages.`, limit, remaining: 0, resetAt });
    }
  }
  const refund = async () => {
    if (user.kind !== 'admin') { await bump(userKey, -1); await bump(ipKey, -1); }
  };

  const { messages, prompt } = req.body || {};
  let history = Array.isArray(messages)
    ? messages
        .filter(m => m && typeof m.text === 'string' && m.text.trim())
        .slice(-30)
        .map(m => ({ role: m.role === 'model' ? 'model' : 'user', text: m.text.slice(0, 8000) }))
    : [];
  if (!history.length && typeof prompt === 'string' && prompt.trim()) {
    history = [{ role: 'user', text: prompt.slice(0, 8000) }];
  }
  // The conversation has to start with the user.
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) { await refund(); return res.status(400).json({ error: 'Send at least one message.' }); }

  for (const [i, provider] of order.entries()) {
    const started = Date.now();
    // The last provider in line gets more time, since nobody is waiting behind it.
    const signal = AbortSignal.timeout(i === order.length - 1 ? TIMEOUT_MS * 2 : TIMEOUT_MS);
    try {
      const { text, model } = provider === 'gemini'
        ? await askGemini(history, keys.gemini, signal)
        : await askOllama(history, keys.ollama, signal);
      const ms = Date.now() - started;
      console.log(`Lakshya AI answered with ${provider}/${model} in ${ms} ms`);
      return res.status(200).json({
        reply: text, provider, model, ms,
        limit: Number.isFinite(limit) ? limit : null,
        remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null,
        resetAt,
      });
    } catch (err) {
      console.error(`Lakshya AI ${provider} failed after ${Date.now() - started} ms:`, err.detail || err.message);
    }
  }
  await refund();
  return res.status(502).json({ error: 'AI service unavailable.' });
}
