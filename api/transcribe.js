// Vercel serverless function: browser-independent speech to text.
// The browser records audio with MediaRecorder (works in Chrome, Safari,
// Firefox, Edge, on desktop and mobile) and posts it here as base64.
// This server sends it to Groq Whisper and returns plain text.
// Why not Chrome SpeechRecognition: that API only works reliably in
// Chrome desktop, silently fails in other browsers and on some Mac
// Chrome setups even with mic permission on, and pauses on silence.
// Recording + Whisper removes the browser condition entirely: if the
// browser can record a mic, the text comes back the same way for everyone.
// Env var: GROQ_API_KEY only, same key as /api/clean.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const audio = req.body && req.body.audio ? String(req.body.audio) : '';
  const mimeType = req.body && req.body.mimeType ? String(req.body.mimeType) : 'audio/webm';
  if (!audio) return res.status(400).json({ error: 'No audio given' });
  // Base64 of a few minutes of speech is well under this; reject abuse.
  if (audio.length > 12 * 1024 * 1024) return res.status(400).json({ error: 'Audio is too long, keep it under about 2 minutes' });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server' });

  try {
    const buf = Buffer.from(audio, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Audio could not be read' });
    const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), 'audio.' + ext);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('response_format', 'json');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + groqKey },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(500).json({ error: 'Transcription failed: ' + (data?.error?.message || 'HTTP ' + r.status) });
    const text = (data.text || '').trim();
    if (!text) return res.status(500).json({ error: 'No speech was detected in that recording. Check the mic is not muted and the right input is selected, then try again, or type it.' });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'Transcription failed: ' + String(e.message || e) });
  }
}
