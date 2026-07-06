import { fetchVocabulary } from "../../../_shared/airtable.js";

function text(message, status = 500) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequest(context) {
  try {
    const { recordId, attachmentId } = context.params;
    const { items } = await fetchVocabulary(context.env);
    const item = items.find((entry) => entry.id === recordId);
    const audio = item?.audio?.find((entry) => entry.id === attachmentId);

    if (!audio?.url) {
      return text("Audio non trovato.", 404);
    }

    const headers = {};
    const range = context.request.headers.get("range");
    if (range) headers.range = range;

    const response = await fetch(audio.url, { headers });
    if (!response.ok) {
      return text("Audio non disponibile.", response.status);
    }

    const responseHeaders = new Headers({
      "content-type": response.headers.get("content-type") || audio.type || "audio/mpeg",
      "cache-control": "private, max-age=300",
      "accept-ranges": response.headers.get("accept-ranges") || "bytes"
    });

    for (const header of ["content-length", "content-range"]) {
      const value = response.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }

    return new Response(context.request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    return text(error.message || "Errore audio.", error.status || 500);
  }
}

