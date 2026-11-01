// Vercel serverless function. Keys live only in Vercel env vars, never in code or chat.
// Env var: GROQ_API_KEY only. Gemini was removed 2026-10-31: its free quota
// was exhausted (20/day), 3.8-flash was repeatedly 503, and other model
// names returned 404, so it only slowed the demo down. Groq is the provider.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  if (!text) return res.status(400).json({ error: 'No text given' });
  if (text.length > 4000) return res.status(400).json({ error: 'Text is too long for this step' });

  const prompt = [
    'Rewrite the user text below into a clear, natural, articulate version.',
    'Keep the exact same meaning and the same language the user used. Do not add new ideas, facts, or claims.',
    'Fix grammar and word order. Make it direct and easy to say out loud.',
    'Return JSON only, no other text, in this shape:',
    '{"clean": "...", "changes": ["...", "...", "..."]}',
    'Changes: exactly 3 short, simple sentences, each saying what changed and why, in plain English a learner can reuse next time.',
    'User text:',
    text,
  ].join('\n');

  function parseClean(raw) {
    if (!raw) return null;
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[0]);
      if (!parsed.clean) return null;
      return { clean: parsed.clean, changes: Array.isArray(parsed.changes) ? parsed.changes.slice(0, 3) : [] };
    } catch { return null; }
  }

  const errors = [];

  // Groq only, open-weight models, OpenAI-compatible API.
  // Model list is tried in order because Groq rotates its free catalog;
  // a 404 for one model does not stop the next one.
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    for (const model of ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b']) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            messages: [
              { role: 'system', content: 'You rewrite text into a clear, articulate version, keeping the exact meaning and language. Return JSON only, no other text.' },
              { role: 'user', content: prompt },
            ],
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          errors.push('Groq ' + model + ': ' + (data?.error?.message || 'HTTP ' + r.status));
          continue;
        }
        const out = data?.choices?.[0]?.message?.content || '';
        const parsed = parseClean(out);
        if (parsed) return res.status(200).json(parsed);
        errors.push('Groq ' + model + ': unexpected format');
      } catch (e) { errors.push('Groq ' + model + ': ' + String(e.message || e)); }
    }
  } else {
    errors.push('Groq: GROQ_API_KEY is not set on the server');
  }

  return res.status(500).json({ error: 'All clean providers failed. ' + errors.join(' | ') });
}
