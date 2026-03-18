const https = require('https');

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Metodo non consentito' }) };

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key mancante' }) };

  let product;
  try {
    product = (JSON.parse(event.body || '{}').product || '').trim();
  } catch {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Richiesta non valida' }) };
  }

  if (!product) return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Prodotto mancante' }) };

  const prompt = `Sei il miglior copywriter italiano. Crea un copy AIDA per questo prodotto: "${product}"

Rispondi ESATTAMENTE in questo formato:

[ATTENZIONE]
testo qui

[INTERESSE]
testo qui

[DESIDERIO]
testo qui

[AZIONE]
testo qui

Ogni sezione 60-100 parole, italiano persuasivo, emoji professionali.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 1200 },
  };

  try {
    const result = await httpsPost(
      'generativelanguage.googleapis.com',
      `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      body
    );

    console.log('Gemini status:', result.status);
    console.log('Gemini body:', result.body.slice(0, 500));

    if (result.status !== 200) {
      return {
        statusCode: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Errore Gemini ${result.status}: ${result.body.slice(0, 200)}` }),
      };
    }

    const data = JSON.parse(result.body);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Risposta AI vuota' }) };

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };

  } catch (err) {
    console.error('Errore:', err.message);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
