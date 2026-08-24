const airtableFields = {
  parolaSuggerita: "Parola suggerita",
  significato: "Significato",
  esempioUso: "Esempio d'uso",
  cognome: "Cognome",
  nome: "Nome"
};

const limits = {
  parolaSuggerita: 150,
  significato: 1000,
  esempioUso: 1500,
  cognome: 100,
  nome: 100
};

const allowedKeys = new Set([
  ...Object.keys(airtableFields),
  "website",
  "formStartedAt"
]);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function normalize(value, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("invalid-field");
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (normalized.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error("invalid-field");
  }
  return normalized;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid-payload");
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) throw new Error("unexpected-field");

  const fields = {};
  for (const [key, airtableName] of Object.entries(airtableFields)) {
    const value = normalize(payload[key], limits[key]);
    if (value) fields[airtableName] = value;
  }

  if (!fields[airtableFields.parolaSuggerita]) throw new Error("required-word");
  return fields;
}

function hasValidConfiguration(env) {
  return Boolean(
    env.AIRTABLE_SUGGESTIONS_TOKEN &&
    env.AIRTABLE_SUGGESTIONS_BASE_ID &&
    env.AIRTABLE_SUGGESTIONS_TABLE_NAME
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "Metodo non consentito." }, 405);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return json({ error: "Richiesta non consentita." }, 403);

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Formato della richiesta non valido." }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12_000) return json({ error: "La proposta è troppo lunga." }, 413);

  let payload;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 12_000) return json({ error: "La proposta è troppo lunga." }, 413);
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Dati della proposta non validi." }, 400);
  }

  if (typeof payload.website !== "string" || typeof payload.formStartedAt !== "number") {
    return json({ error: "Dati della proposta non validi." }, 400);
  }

  // Honeypot: ai bot viene mostrata una risposta neutra senza scrivere su Airtable.
  if (payload.website.trim()) return json({ ok: true }, 202);

  const elapsed = Date.now() - payload.formStartedAt;
  if (!Number.isFinite(elapsed) || elapsed < 2000 || elapsed > 24 * 60 * 60 * 1000) {
    return json({ error: "Attendi qualche secondo e riprova." }, 429);
  }

  let fields;
  try {
    fields = validatePayload(payload);
  } catch (error) {
    if (error.message === "required-word") {
      return json({ error: "Inserisci la parola o l'espressione da proporre." }, 400);
    }
    return json({ error: "Controlla i dati inseriti e riprova." }, 400);
  }

  if (!hasValidConfiguration(env)) {
    return json({ error: "Il servizio dei suggerimenti non è momentaneamente disponibile." }, 503);
  }

  const endpoint = `https://api.airtable.com/v0/${encodeURIComponent(env.AIRTABLE_SUGGESTIONS_BASE_ID)}/${encodeURIComponent(env.AIRTABLE_SUGGESTIONS_TABLE_NAME)}`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.AIRTABLE_SUGGESTIONS_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ fields, typecast: false })
    });

    if (!response.ok) {
      console.error("Creazione suggerimento Airtable non riuscita:", response.status);
      return json({ error: "Non è stato possibile inviare la proposta. Riprova più tardi." }, 502);
    }

    return json({ ok: true }, 201);
  } catch (error) {
    console.error("Servizio suggerimenti non raggiungibile:", error?.message || "errore sconosciuto");
    return json({ error: "Non è stato possibile inviare la proposta. Riprova più tardi." }, 502);
  }
}
