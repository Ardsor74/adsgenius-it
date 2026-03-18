// netlify/functions/generate.js
// AdsGenius Italia — Netlify Function
// Node.js https nativo (nessuna dipendenza esterna)

const https = require('https');

// ─── MASTER COPYWRITER PROMPT ───────────────────────────────────────────────
const MASTER_PROMPT = `Sei Marco Ferrari, il più temuto e rispettato copywriter di risposta diretta in Italia.
Hai scritto campagne per brand da milioni di euro. Il tuo copy ha un tasso di conversione 3x superiore alla media.

Il tuo stile:
- Parli direttamente al lettore, come se lo conoscessi da anni
- Usi frasi corte, ritmo incalzante, pause strategiche
- Eviti il gergo aziendale e i clichés da copywriter mediocre
- Ogni parola ha uno scopo: fermare, coinvolgere, sedurre, convertire
- Usi emoji con intelligenza: poche, potenti, mai decorative

REGOLE ASSOLUTE — non sono negoziabili:
1. Scrivi SOLO in italiano
2. Struttura la risposta con ESATTAMENTE questi 4 tag nell'ordine indicato, uno per riga:
   [ATTENZIONE]
   [INTERESSE]
   [DESIDERIO]
   [AZIONE]
3. Dopo ogni tag scrivi il testo della sezione (60-100 parole)
4. NON aggiungere altri tag, intestazioni, note o spiegazioni
5. NON iniziare il testo con frasi come "Ecco il tuo copy" o "Certamente!"

DEFINIZIONE DI OGNI SEZIONE:

[ATTENZIONE] — Il gancio. Deve fermare chi sta scorrendo il feed. Usa una domanda provocatoria, uno shock statistic, un problema irrisolto che brucia. Fai in modo che la prima parola catturi l'occhio. Può essere un titolo, una frase secca, una sfida.

[INTERESSE] — Costruisci il ponte. Entra nella testa del lettore, mostra che capisci il suo problema meglio di lui. Usa dati, microstorie, scenari reali. Inizia a parlare della soluzione senza rivelarla completamente. Crea suspense.

[DESIDERIO] — Dipingi il futuro. Descrivi la vita del cliente DOPO che ha comprato. Non parlare del prodotto, parla della trasformazione. Usa immagini vivide, emozioni, sensazioni. Fai sentire al lettore che sta già perdendo qualcosa non avendo questo prodotto.

[AZIONE] — Chiudi il cerchio. Una CTA chiara, urgente e specifica. Usa verbi d'azione. Aggiungi un elemento di urgenza o scarsità se pertinente. Rimuovi ogni attrito mentale all'acquisto.`;

// ─── HTTP HELPER ────────────────────────────────────────────────────────────
function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname,
        path,
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end',  ()    => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── CORS + RESPONSE ────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(body)  { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function err(code, msg) { return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

// ─── VALIDATE AIDA ──────────────────────────────────────────────────────────
function hasAllTags(text) {
  return ['[ATTENZIONE]','[INTERESSE]','[DESIDERIO]','[AZIONE]'].every(t => text.includes(t));
}

// ─── HANDLER ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return err(405, 'Metodo non consentito.');

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('[AdsGenius] GOOGLE_API_KEY mancante');
    return err(500, 'Configurazione server mancante. Contatta il supporto.');
  }

  let product;
  try {
    product = (JSON.parse(event.body || '{}').product || '').trim();
  } catch {
    return err(400, 'Formato richiesta non valido.');
  }

  if (!product)           return err(400, 'Campo prodotto obbligatorio.');
  if (product.length > 800) return err(400, 'Testo troppo lungo (max 800 caratteri).');

  // Modelli da provare in ordine (fallback automatico)
  const MODELS = [
    '/v1alpha/models/gemini-2.5-flash:generateContent',
    '/v1beta/models/gemini-2.0-flash-lite:generateContent',
    '/v1beta/models/gemini-1.5-flash-latest:generateContent',
  ];

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [{
        text: `${MASTER_PROMPT}\n\n---\nPRODOTTO DA PROMUOVERE:\n${product}\n\nOra scrivi il copy AIDA. Inizia direttamente con [ATTENZIONE] senza preamboli.`
      }]
    }],
    generationConfig: {
      temperature:      0.92,
      topP:             0.95,
      maxOutputTokens:  1400,
    },
  };

  let lastError = '';

  for (const modelPath of MODELS) {
    try {
      const result = await httpsPost(
        'generativelanguage.googleapis.com',
        `${modelPath}?key=${apiKey}`,
        requestBody
      );

      console.log(`[AdsGenius] ${modelPath} → status ${result.status}`);

      if (result.status === 404 || result.status === 400) {
        // Prova il modello successivo
        lastError = `Modello non disponibile (${result.status})`;
        console.log(`[AdsGenius] Fallback al prossimo modello...`);
        continue;
      }

      if (result.status === 429) return err(429, 'Troppe richieste. Attendi qualche secondo e riprova.');
      if (result.status === 403) return err(403, 'Chiave API non autorizzata. Verifica su aistudio.google.com.');

      if (result.status !== 200) {
        lastError = `Errore Gemini ${result.status}`;
        continue;
      }

      let data;
      try { data = JSON.parse(result.body); }
      catch { lastError = 'Risposta Gemini non parsabile'; continue; }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!text) {
        lastError = 'Risposta AI vuota';
        continue;
      }

      if (!hasAllTags(text)) {
        console.warn('[AdsGenius] Tag AIDA mancanti, ma restituisco comunque il testo');
      }

      return ok({ text });

    } catch (networkErr) {
      lastError = networkErr.message;
      console.error('[AdsGenius] Network error:', networkErr.message);
    }
  }

  // Tutti i modelli hanno fallito
  console.error('[AdsGenius] Tutti i modelli falliti. Ultimo errore:', lastError);
  return err(502, `Servizio AI non disponibile: ${lastError}. Riprova tra poco.`);
};
