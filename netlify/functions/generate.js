// netlify/functions/generate.js
// Usa il modulo https nativo di Node — compatibile con qualsiasi versione

const https = require('https');

const SYSTEM_PROMPT = `Sei il miglior copywriter italiano specializzato in performance marketing digitale.
Crea copy pubblicitari AIDA professionali, persuasivi e immediatamente utilizzabili.

ISTRUZIONI:
- Scrivi SEMPRE in italiano, tono caldo, diretto e persuasivo.
- Usa emoji professionali (2-4 per sezione).
- Sii specifico al prodotto: evita frasi generiche.
- Lunghezza ideale per sezione: 60-120 parole.

FORMATO RISPOSTA OBBLIGATORIO:
[ATTENZIONE]
testo qui

[INTERESSE]
testo qui

[DESIDERIO]
testo qui

[AZIONE]
testo qui`;

function httpsPost(hostname, path, apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path: `${path}?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: raw });
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Metodo non consentito.' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('[AdsGenius] GOOGLE_API_KEY mancante');
    return respond(500, { error: 'Configurazione server mancante.' });
  }

  let product;
  try {
    const parsed = JSON.parse(event.body || '{}');
    product = (parsed.product || '').trim();
  } catch {
    return respond(400, { error: 'Formato richiesta non valido.' });
  }

  if (!product) return respond(400, { error: 'Campo prodotto obbligatorio.' });
  if (product.length > 800) return respond(400, { error: 'Testo troppo lungo (max 800 caratteri).' });

  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: `Prodotto/servizio: ${product}` }],
      },
    ],
    generationConfig: {
      temperature: 0.88,
      topP: 0.93,
      maxOutputTokens: 1400,
    },
  };

  try {
    const result = await httpsPost(
      'generativelanguage.googleapis.com',
      '/v1beta/models/gemini-2.0-flash:generateContent',
      apiKey,
      requestBody
    );

    if (result.status !== 200) {
      console.error('[AdsGenius] Gemini status:', result.status, result.body.slice(0, 300));
      const map = { 400: 'Richiesta non valida.', 403: 'API key non autorizzata.', 429: 'Troppe richieste, riprova.' };
      return respond(502, { error: map[result.status] || `Errore Gemini: ${result.status}` });
    }

    const data = JSON.parse(result.body);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) return respond(502, { error: "L'AI non ha restituito contenuto. Riprova." });

    return respond(200, { text });

  } catch (err) {
    console.error('[AdsGenius] Errore interno:', err.message);
    return respond(500, { error: 'Errore interno del server.' });
  }
};
