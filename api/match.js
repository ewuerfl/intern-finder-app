// Vercel serverless function: resume matching with an AI model.
// Set ONE of these in Vercel → Project → Settings → Environment Variables:
//   GEMINI_API_KEY     Google Gemini (from aistudio.google.com). Optional GEMINI_MODEL (default gemini-flash-latest).
//   ANTHROPIC_API_KEY  Claude. Optional MODEL (default claude-sonnet-5-5) and MODEL_QUICK (default claude-haiku-4-5-20251001).
const hits = new Map(); // best-effort per-IP limit: 12 calls per 10 minutes

function pickJSON(text) {
  const m = (text || '').match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('invalid_json');
  return JSON.parse(m[0]);
}

const GEMINI_MODELS = () => [...new Set([process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'].filter(Boolean))];
let goodModel = null; // remembered after the first model that works

async function geminiCall(model, parts) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  const text = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) { const e = new Error('Empty reply (finish reason: ' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'unknown') + ')'); e.status = 502; throw e; }
  return text;
}

async function gemini(prompt, image) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.type, data: image.data } });
  parts.push({ text: prompt });
  // Try the model that worked last time first, then the others. Busy (503), overloaded (500),
  // over quota (429) or retired (404/400) models fall through to the next one.
  const order = [...new Set([goodModel, ...GEMINI_MODELS()].filter(Boolean))];
  let last;
  for (const m of order) {
    try { const text = await geminiCall(m, parts); goodModel = m; return pickJSON(text); }
    catch (e) { last = e; if (![400, 404, 429, 500, 502, 503, 504].includes(e.status)) break; }
  }
  throw last;
}

async function claude(prompt, image, quick) {
  const content = [];
  if (image) content.push(image.type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image.data } }
    : { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } });
  content.push({ type: 'text', text: prompt + '\n\nReply with only the JSON. No other text.' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: quick ? (process.env.MODEL_QUICK || 'claude-haiku-4-5-20251001') : (process.env.MODEL || 'claude-sonnet-5-5'),
      max_tokens: 8000, messages: [{ role: 'user', content }]
    })
  });
  if (r.status === 429) { const e = new Error('rate_limited'); e.status = 429; throw e; }
  if (!r.ok) throw new Error('refused');
  const j = await r.json();
  return pickJSON((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
}

module.exports = async (req, res) => {
  const useGemini = !!process.env.GEMINI_API_KEY, useClaude = !!process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') {
    if (req.query && req.query.test && useGemini) {   // diagnostics: tiny Gemini call, reports model and any error (never the key)
      const tried = [];
      for (const m of GEMINI_MODELS()) {
        try {
          const big = false;
          const lines = Array.from({ length: 140 }, (_, i) => `${i}|Company ${i}|Hardware Engineering Intern ${i}|Electrical & Computer Engineering|Summer 2027|Miami, FL`).join('\n');
          const p = big ? `Candidate: computer engineering junior, skills Verilog, C++, Python, FPGA. Pick the 15 best fits. Reply with only a JSON array: [{"id": number, "score": integer, "why": "one sentence"}]\n\n${lines}` : 'Reply with this JSON only: {"ok": true}';
          const t0 = Date.now(); const text = await geminiCall(m, [{ text: p }]);
          return res.status(200).json({ ok: true, model: m, seconds: (Date.now() - t0) / 1000, reply: text.slice(0, 120), tried });
        }
        catch (e) { tried.push({ model: m, status: e.status, error: String(e.message).slice(0, 200) }); }
      }
      return res.status(200).json({ ok: false, tried });
    }
    return res.status(200).json({ ok: useGemini || useClaude, provider: useGemini ? 'gemini' : useClaude ? 'claude' : null });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!useGemini && !useClaude) return res.status(503).json({ error: 'not_configured' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (list.length >= 12) return res.status(429).json({ error: 'rate_limited' });
  list.push(now); hits.set(ip, list);

  const { prompt, image, quick } = req.body || {};
  if (typeof prompt !== 'string' || prompt.length > 120000) return res.status(400).json({ error: 'refused' });
  if (image && image.data && !/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(image.type || '')) return res.status(400).json({ error: 'image_rejected' });
  const img = image && image.data ? image : null;

  try {
    const result = useGemini ? await gemini(prompt, img) : await claude(prompt, img, quick);
    return res.status(200).json({ result });
  } catch (e) {
    if (e.status === 429) return res.status(429).json({ error: 'rate_limited', detail: String(e.message).slice(0, 200) });
    console.error('match failed:', e.status, e.message);
    return res.status(502).json({ error: e.message === 'invalid_json' ? 'invalid_json' : 'refused', detail: String(e.message).slice(0, 200) });
  }
};
