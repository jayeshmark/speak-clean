// Vercel serverless function, PREVIEW ONLY on the diplomat review branch.
// Keys live only in Vercel env vars, never in code or chat. Groq only, GROQ_API_KEY.
// Hard rule, from Jayesh's correction: a diplomatic rewrite must NOT invent a
// commitment the user did not make. No new date, deadline, promise, number,
// deliverable, or update frequency. If the user gave no date, no version gets
// a date. If the user gave a date, only that date may be kept.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const they = (req.body && req.body.they ? String(req.body.they) : '').trim();
  const mine = (req.body && req.body.mine ? String(req.body.mine) : '').trim();
  if (!mine) return res.status(400).json({ error: 'No message given' });
  if (mine.length > 4000 || they.length > 4000) return res.status(400).json({ error: 'Text is too long for this step' });

  const prompt = [
    'You are a diplomat trainer. Rewrite the user message below into exactly 3 diplomatic versions of the SAME message.',
    'HARD RULE, do not break it: keep the exact same meaning, the same commitment level, and the same timing as the user message.',
    'Do NOT add a date, deadline, day, time, number, deliverable, promise, or update frequency that is not already in the user message.',
    'If the user message says "soon" with no date, every version must also say soon or an equally vague timing, never a weekday or a date.',
    'If the user message already gives a date, keep that exact date and add no other date.',
    'Do NOT upgrade "I will try" into "I will deliver" or "I will update you every day". Keep try as try, soon as soon.',
    'Diplomat techniques to use, one per version:',
    '1. Acknowledge and reframe: validate what the other person said, restate the problem as a shared problem, no blame, no character attack.',
    '2. Soft and indirect: modal verbs like could and would, hedging like it seems, a question instead of an order, focus on the action not the person.',
    '3. Firm but warm: hard on the problem, soft on the person, clear about what is true, focus on the shared interest, still with no new promise.',
    'Return JSON only, no other text, in this shape:',
    '{"versions": [{"label": "Acknowledge and reframe", "text": "...", "why": "..."}, {"label": "Soft and indirect", "text": "...", "why": "..."}, {"label": "Firm but warm", "text": "...", "why": "..."}], "lesson": "..."}',
    'Each why: exactly 1 short sentence naming the diplomat technique used and why it calms the conversation.',
    'Lesson: exactly 2 short sentences, a diplomat trainer note on what to learn from these three versions, in plain English.',
    'What they said:',
    they || '(not given)',
    'What the user said, or wants to say:',
    mine,
  ].join('\n');

  function parse(raw) {
    if (!raw) return null;
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const p = JSON.parse(m[0]);
      if (!Array.isArray(p.versions) || p.versions.length < 3) return null;
      return { versions: p.versions.slice(0, 3), lesson: p.lesson || '' };
    } catch { return null; }
  }

  const errors = [];
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
              { role: 'system', content: 'You are a diplomat trainer. Rewrite into 3 diplomatic versions with the exact same meaning and commitment level, adding no date, deadline, or promise. Return JSON only, no other text.' },
              { role: 'user', content: prompt },
            ],
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { errors.push('Groq ' + model + ': ' + (data?.error?.message || 'HTTP ' + r.status)); continue; }
        const out = data?.choices?.[0]?.message?.content || '';
        const parsed = parse(out);
        if (parsed) return res.status(200).json(parsed);
        errors.push('Groq ' + model + ': unexpected format');
      } catch (e) { errors.push('Groq ' + model + ': ' + String(e.message || e)); }
    }
  } else {
    errors.push('Groq: GROQ_API_KEY is not set on the server');
  }
  return res.status(500).json({ error: 'All diplomat providers failed. ' + errors.join(' | ') });
}
