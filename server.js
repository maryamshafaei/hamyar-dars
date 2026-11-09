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
const MODEL = 'gemini-flash-latest';

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
app.get('/api/test', async (req, res) => {
  const out = { model: MODEL, models: [], test: null };
  try {
    const pager = await ai.models.list();
    for await (const m of pager) {
      out.models.push(m.name);
    }
  } catch (e) {
    out.listError = e.message;
  }
  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: 'Say hi in one word'
    });
    out.test = { ok: true, text: r.text, ms: Date.now() - t0 };
  } catch (e) {
    out.test = { ok: false, error: e.message };
  }
  res.json(out);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
