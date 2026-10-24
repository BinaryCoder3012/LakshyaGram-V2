// Lakshya AI — Vercel serverless function that relays a conversation to Gemini or Ollama.
// Body: { messages: [{ role: 'user' | 'model', text }] }  (V2's { prompt } still works)
//
// Environment:
//   GEMINI_API_KEY   Google AI Studio key
//   OLLAMA_API_KEY   ollama.com key
//   AI_PROVIDER      optional: 'gemini' or 'ollama' to try that one first (default gemini)
//   GEMINI_MODEL     optional model override
//   OLLAMA_MODEL     optional model override (default gpt-oss:120b)
// If the first provider fails, the other one answers, when its key is set.

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
const OLLAMA_API = 'https://ollama.com/api';
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

async function askGemini(history, key) {
  const contents = history.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
  });
  const tried = new Set();
  let last = null;
  for (const next of [process.env.GEMINI_MODEL, 'gemini-flash-latest', null]) {
    const candidates = next === null ? await listGeminiFlash(key) : next ? [next] : [];
    for (const model of candidates) {
      if (tried.has(model) || tried.size >= 6) continue;
      tried.add(model);
      const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('').trim();
        if (text) return text;
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

async function askOllama(history, key) {
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
      const res = await fetch(`${OLLAMA_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.6 } }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.message?.content || '').trim();
        if (text) return text;
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

// ---------------- handler ----------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keys = { gemini: process.env.GEMINI_API_KEY, ollama: process.env.OLLAMA_API_KEY };
  const first = process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'gemini';
  const order = [first, first === 'gemini' ? 'ollama' : 'gemini'].filter(p => keys[p]);
  if (!order.length) {
    console.error('Neither GEMINI_API_KEY nor OLLAMA_API_KEY is set.');
    return res.status(500).json({ error: 'Server config error: API key missing.' });
  }

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
  if (!history.length) return res.status(400).json({ error: 'Send at least one message.' });

  for (const provider of order) {
    try {
      const reply = provider === 'gemini' ? await askGemini(history, keys.gemini) : await askOllama(history, keys.ollama);
      return res.status(200).json({ reply, provider });
    } catch (err) {
      console.error(`Lakshya AI ${provider} failed:`, err.detail || err.message);
    }
  }
  return res.status(502).json({ error: 'AI service unavailable.' });
}
