// netlify/functions/generate.js
// AdsGenius Italia — Backend Netlify Function
// Interroga Google Gemini 1.5 Flash via REST fetch
// Richiede: process.env.GOOGLE_API_KEY

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const SYSTEM_PROMPT = `Sei il miglior copywriter italiano specializzato in performance marketing digitale.
Il tuo compito è creare copy pubblicitari AIDA professionali, persuasivi e immediatamente utilizzabili.

ISTRUZIONI OBBLIGATORIE:
- Scrivi SEMPRE e SOLO in italiano, tono caldo, diretto e persuasivo.
- Usa emoji professionali per aumentare l'engagement visivo (2-4 per sezione).
- Ogni sezione deve essere autonoma e pronta per Meta Ads, Google Ads o TikTok.
- Sii specifico al prodotto indicato: evita frasi generiche e clichés.
- Lunghezza ideale per sezione: 60-120 parole.

FRAMEWORK AIDA:
- [ATTENZIONE]: Headline/hook potente che ferma lo scroll. Identifica un problema urgente o promette un beneficio immediato.
- [INTERESSE]: Costruisce curiosità e rilevanza. Approfondisce il problema o la soluzione con dettagli concreti.
- [DESIDERIO]: Dipinge il beneficio emotivo e trasformativo. Come cambia la vita del cliente dopo l'acquisto?
- [AZIONE]: Call-to-action chiara, urgente e irresistibile. Include un passo specifico da compiere ora.

FORMATO RISPOSTA OBBLIGATORIO — usa esattamente questi tag:
[ATTENZIONE]
testo qui

[INTERESSE]
testo qui

[DESIDERIO]
testo qui

[AZIONE]
testo qui`;

// ── CORS Headers ──
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── Response helper ──
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

// ── Main handler ──
exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Solo POST
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Metodo non consentito.' });
  }

  // API Key check
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('[AdsGenius] GOOGLE_API_KEY non configurata nelle variabili d\'ambiente.');
    return respond(500, { error: 'Configurazione server mancante. Contatta il supporto.' });
  }

  // Parse body
  let product;
  try {
    const body = JSON.parse(event.body || '{}');
    product = (body.product || '').trim();
  } catch {
    return respond(400, { error: 'Formato richiesta non valido.' });
  }

  if (!product) {
    return respond(400, { error: 'Il campo prodotto è obbligatorio.' });
  }
  if (product.length > 800) {
    return respond(400, { error: 'Descrizione troppo lunga (massimo 800 caratteri).' });
  }

  // Build Gemini request
  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Crea un copy AIDA professionale per il seguente prodotto/servizio:\n\n${product}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.88,
      topP: 0.93,
      topK: 40,
      maxOutputTokens: 1400,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`[AdsGenius] Gemini API error ${geminiRes.status}:`, errText);

      const errorMap = {
        400: 'Richiesta non valida inviata a Gemini.',
        403: 'Chiave API non autorizzata o scaduta.',
        429: 'Troppe richieste. Attendi qualche secondo e riprova.',
        500: 'Servizio Gemini temporaneamente non disponibile.',
      };
      const msg = errorMap[geminiRes.status] || `Errore API: ${geminiRes.status}`;
      return respond(502, { error: msg });
    }

    const data = await geminiRes.json();

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      console.error('[AdsGenius] Risposta Gemini vuota:', JSON.stringify(data));
      return respond(502, { error: "L'AI non ha restituito contenuto. Riprova." });
    }

    // Validate that the response contains at least one AIDA tag
    const hasAIDA = ['[ATTENZIONE]','[INTERESSE]','[DESIDERIO]','[AZIONE]']
      .some(tag => text.includes(tag));

    if (!hasAIDA) {
      console.error('[AdsGenius] Risposta senza tag AIDA:', text.slice(0, 200));
      return respond(502, { error: 'Formato risposta AI non valido. Riprova.' });
    }

    return respond(200, { text });

  } catch (err) {
    console.error('[AdsGenius] Errore interno:', err.message || err);
    return respond(500, { error: 'Errore interno del server. Riprova tra poco.' });
  }
};

