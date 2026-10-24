// Lakshya AI — Vercel serverless function that relays a conversation to Gemini.
// Body: { messages: [{ role: 'user' | 'model', text }] }  (V2's { prompt } still works)

const API = 'https://generativelanguage.googleapis.com/v1beta';
let discovered = null; // models this key can use, cached while the function stays warm

// Newest stable Flash models first; previews, lite and special-purpose models last or never.
async function flashModels(key) {
  if (discovered) return discovered;
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return [];
  const { models = [] } = await res.json();
  const version = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  discovered = models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => n.startsWith('gemini-') && n.includes('flash') && !/image|tts|audio|live|embed|thinking/.test(n))
    .sort((a, b) =>
      /preview|exp|lite/.test(a) - /preview|exp|lite/.test(b) || version(b) - version(a));
  return discovered;
}

const SYSTEM = `You are Lakshya AI, the assistant inside LakshyaGram, a chat app made by a student at BITS Pilani, Hyderabad Campus.
Be friendly, witty, concise and genuinely helpful. Answer like a sharp senior who wants the person to understand, not just copy.
Keep replies short enough to read in a chat bubble unless asked for detail. Use plain text; **bold**, bullet lists and \`code\` are fine.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('GEMINI_API_KEY is not set.');
    return res.status(500).json({ error: 'Server config error: API key missing.' });
  }

  try {
    const { messages, prompt } = req.body || {};
    let contents = Array.isArray(messages)
      ? messages
          .filter(m => m && typeof m.text === 'string' && m.text.trim())
          .slice(-20)
          .map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text.slice(0, 4000) }] }))
      : [];
    if (!contents.length && typeof prompt === 'string' && prompt.trim()) {
      contents = [{ role: 'user', parts: [{ text: prompt.slice(0, 4000) }] }];
    }
    // Gemini expects the conversation to start with the user.
    while (contents.length && contents[0].role !== 'user') contents.shift();
    if (!contents.length) return res.status(400).json({ error: 'Send at least one message.' });

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
    });
    const ask = model => fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY }, body,
    });

    // Try the configured model, then the Flash alias, then whatever Flash models this key can see.
    const tried = new Set();
    let response = null;
    for (const next of [process.env.GEMINI_MODEL, 'gemini-flash-latest', null]) {
      const candidates = next === null ? await flashModels(API_KEY) : next ? [next] : [];
      for (const model of candidates) {
        if (tried.has(model) || tried.size >= 6) continue;
        tried.add(model);
        response = await ask(model);
        if (response.ok) break;
        const err = await response.json().catch(() => ({}));
        console.error(`Gemini API error (${model}):`, JSON.stringify(err));
        // Only a missing or retired model is worth retrying with another one.
        if (![404, 400].includes(response.status)) return res.status(502).json({ error: 'AI service unavailable.' });
      }
      if (response?.ok) break;
    }
    if (!response?.ok) return res.status(502).json({ error: 'AI service unavailable.' });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim()
      || "I couldn't come up with an answer to that. Try asking another way.";
    return res.status(200).json({ reply });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
