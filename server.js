const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set.');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-flash-lite-latest';
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/ask', async (req, res) => {
  try {
    const { systemInstruction, prompt, imgs, search } = req.body;

    const parts = (imgs || []).map(d => ({
      inlineData: { mimeType: 'image/jpeg', data: d }
    }));
    parts.push({ text: prompt });

    const config = {};
    if (systemInstruction) {
      config.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (search) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config
    });

    const text = response.text || '';

    let sources = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      sources = chunks.map(g => g.web?.uri).filter(Boolean);
    }

    res.json({ text, sources });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message || 'خطا در ارتباط با سرور' });
  }
});

function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

app.post('/api/tts', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'empty text' });
    if (text.length > 3000) return res.status(400).json({ error: 'text too long' });

    const r = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });

    const data = r.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) return res.status(500).json({ error: 'no audio returned' });

    res.set('Content-Type', 'audio/wav');
    res.send(pcmToWav(Buffer.from(data, 'base64')));
  } catch (err) {
    console.error('TTS Error:', err);
    const msg = String((err && err.message) || '');
    const quota = (err && err.status === 429) || msg.includes('RESOURCE_EXHAUSTED');
    res.status(quota ? 429 : 500).json({ error: msg || 'tts error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
